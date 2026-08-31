/* ============================================================
 * server/manual-entry.js — 手动录入工作区后端（2026-09-01）
 *
 * 铁律（用户原话）：手动录入的数据一律进入预警中心，预警中心的
 * 数据量不存在上限，可以扩容。手动条目(is_manual=true)在
 * server.js 全部时效窗/国别帽/总帽/哨兵降级路径均豁免。
 *
 * 职责：
 *  · POST   /api/manual-entries        提交（UUID 服务端生成 + request_id 幂等防双击）
 *  · GET    /api/manual-entries        最近录入列表（scope=mine|all）
 *  · GET    /api/manual-entries/:id    单条详情
 *  · PUT    /api/manual-entries/:id    编辑（version 乐观锁，不匹配返回 409+最新内容）
 *  · DELETE /api/manual-entries/:id    软删（移出预警队列 + URL 墓碑防复活）
 *  · GET    /api/manual-entries/meta   模板/统计元数据（12 类体系 + 今日统计）
 *  · GET    /api/manual-entries/template.csv  CSV 批量模板下载
 *  · POST   /api/manual-entries/batch  批量分批提交
 *
 * 挂载方式（server.js 仅两行）：
 *   const manualEntry = require('./manual-entry');
 *   app.use(manualEntry(ctx));
 * ============================================================ */
const express = require('express');
const crypto = require('crypto');

/* 12 类情报体系（对齐 server.js INTEL_TYPES 情报类别 + 经济金融类） */
const CATS = {
  terror_events: '恐怖袭击',
  security_events: '涉华安全',
  military_conflicts: '武装冲突',
  political_events: '政治风险',
  geopolitical_intel: '地缘情报',
  sanctions_data: '制裁合规',
  social_unrest: '社会动荡',
  natural_disasters: '自然灾害',
  public_health: '公共卫生',
  infrastructure: '基础设施',
  osint_intel: '开源情报',
  economic_risk: '经济金融'
};
const LEVELS = ['red', 'orange', 'yellow', 'blue'];
const RELIABILITY = ['A', 'B', 'C', 'D', 'E'];
const CLASSIFICATIONS = ['公开', '内部', '秘密'];

function _pad(n) { return String(n).padStart(2, '0'); }
function _nowStr() {
  const d = new Date();
  return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()) + ' ' + _pad(d.getHours()) + ':' + _pad(d.getMinutes()) + ':' + _pad(d.getSeconds());
}

module.exports = function (ctx) {
  const {
    query,
    authMiddleware,
    _addTombstone,
    _tombMatchSync,
    _getTombstones,
    broadcastIntel,
    INTEREST_BASE
  } = ctx;
  const router = express.Router();
  let _tableReady = false;

  /* ===== 表结构（首次访问自动建表，幂等） ===== */
  async function _ensureTable() {
    if (_tableReady) return;
    try {
      await query(`CREATE TABLE IF NOT EXISTS manual_entries (
        id varchar(64) PRIMARY KEY,
        request_id varchar(100),
        version int NOT NULL DEFAULT 1,
        payload jsonb NOT NULL,
        title text,
        country varchar(120),
        data_type varchar(40),
        level varchar(10),
        china_related boolean DEFAULT false,
        submitter varchar(60),
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        updated_by varchar(60),
        deleted boolean DEFAULT false
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_me_request ON manual_entries(request_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_me_submitter ON manual_entries(submitter)`);
      _tableReady = true;
    } catch (e) {
      console.warn('[MANUAL-ENTRY] 建表失败:', e.message);
      throw e;
    }
  }

  /* ===== datahub alerts 读写（与服务端权威路径同一张表） ===== */
  async function _readAlerts() {
    const r = await query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
    const arr = r.rows.length ? r.rows[0].data_json : [];
    return Array.isArray(arr) ? arr : [];
  }
  async function _writeAlerts(arr) {
    await query(`INSERT INTO datahub_store (collection, data_json, updated_at) VALUES ('alerts',$1,NOW()) ON CONFLICT (collection) DO UPDATE SET data_json=$1, updated_at=NOW()`,
      [JSON.stringify(arr)]);
  }

  /* ===== 表单字段 → ALERTS 结构（对齐 server.js _serverAlertGen 生成字段） =====
   * 铁律标记：is_manual=true / _riskVersion=3（防赋分回填覆盖人工选定级别）/
   * is_core=true（置顶展示、不占国别帽）/ url='manual://<uuid>'（删除墓碑按 URL 精确命中，
   * 绝不误伤之后新录入的同题条目）。 */
  function _buildAlert(e, id, submitter, extra) {
    const now = _nowStr();
    const lv = LEVELS.indexOf(e.severity) >= 0 ? e.severity : 'yellow';
    const zone = lv === 'red' ? 'red' : lv === 'orange' ? 'orange' : lv === 'yellow' ? 'yellow' : 'blue';
    const score = lv === 'red' ? 75 : lv === 'orange' ? 55 : lv === 'yellow' ? 35 : 18;
    const a = {
      id: id,
      alert_no: 'MN-' + now.slice(0, 10).replace(/-/g, '') + '-' + String(id).slice(0, 6).toUpperCase(),
      title: String(e.title || '').slice(0, 200),
      title_zh: String(e.title || '').slice(0, 200),
      desc: String(e.content || '').slice(0, 800),
      time: now,
      level: lv,
      type: CATS[e.data_type] || '安全风险',
      country: String(e.country || '未知'),
      source: '手动录入' + (e.source_channel ? ' · ' + e.source_channel : '') + (submitter ? ' · ' + submitter : ''),
      url: 'manual://' + id,
      status: 'active',
      interestLinked: true,
      chinaRelated: e.china_related === true,
      publishedAt: e.event_time || '',
      risk_score: score,
      risk_zone: zone,
      risk_rationale: '人工录入条目：级别由录入员' + (e.severity_ai_suggested && e.severity !== e.severity_ai_suggested ? '（覆盖AI建议）' : '') + '按现场情报判定',
      zone_action: lv === 'red' ? '立即核查相关项目/人员暴露，启动应急联络' : lv === 'orange' ? '加密监测频次，通知相关项目组加强防范' : '保持关注，结合后续情报滚动研判',
      is_manual: true,
      is_core: true,
      _riskVersion: 3,
      _manualMeta: {
        data_type: e.data_type || '',
        city: e.city || '',
        lat: e.lat || null,
        lon: e.lon || null,
        event_time: e.event_time || '',
        obtained_time: e.obtained_time || '',
        china_note: e.china_note || '',
        related_projects: Array.isArray(e.related_projects) ? e.related_projects : [],
        related_enterprises: Array.isArray(e.related_enterprises) ? e.related_enterprises : [],
        related_personnel: e.related_personnel || '',
        deaths: e.deaths != null && e.deaths !== '' ? Number(e.deaths) || 0 : 0,
        injured: e.injured != null && e.injured !== '' ? Number(e.injured) || 0 : 0,
        asset_loss_value: e.asset_loss_value != null && e.asset_loss_value !== '' ? Number(e.asset_loss_value) || 0 : 0,
        asset_loss_currency: e.asset_loss_currency || '',
        source_channel: e.source_channel || '',
        source_desc: e.source_desc || '',
        source_url: e.source_url || '',
        reliability: e.reliability || '',
        classification: e.classification || '内部',
        tags: Array.isArray(e.tags) ? e.tags : [],
        attachments: e.attachments || '',
        submitter: submitter,
        updated_by: (extra && extra.updated_by) || submitter
      }
    };
    return a;
  }

  function _validate(e) {
    const errs = [];
    if (!e.title || !String(e.title).trim()) errs.push('情报标题');
    if (!e.content || !String(e.content).trim()) errs.push('内容详述');
    if (!e.country || !String(e.country).trim()) errs.push('国别/地区');
    if (!CATS[e.data_type]) errs.push('情报类别');
    if (LEVELS.indexOf(e.severity) < 0) errs.push('severity 等级');
    return errs;
  }

  /* ===== 提交（幂等） ===== */
  router.post('/', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const e = req.body || {};
      const requestId = String(e.request_id || '').slice(0, 100);
      const submitter = String((req.user && req.user.username) || e.submitter || '未知用户').slice(0, 60);
      /* 幂等：同 request_id 直接返回已建条目（防双击/重试重复入库） */
      if (requestId) {
        const dup = await query(`SELECT id, version, payload FROM manual_entries WHERE request_id=$1 AND deleted=false LIMIT 1`, [requestId]);
        if (dup.rows.length) {
          return res.json({ duplicate: true, id: dup.rows[0].id, version: dup.rows[0].version, entry: dup.rows[0].payload });
        }
      }
      const errs = _validate(e);
      if (errs.length) return res.status(400).json({ error: '缺少必填字段: ' + errs.join('、') });
      const id = crypto.randomUUID();
      const alert = _buildAlert(e, id, submitter);
      /* 服务端生成唯一 ID —— 前端禁止生成本库 ID（多人并发不打架的根） */
      await query(`INSERT INTO manual_entries (id, request_id, version, payload, title, country, data_type, level, china_related, submitter, updated_by)
        VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [id, requestId || null, JSON.stringify(e), alert.title, alert.country, e.data_type, alert.severity, e.china_related === true, submitter]);
      /* 铁律：手动数据一律进预警中心（直接服务端合并权威库，不依赖任何客户端在线） */
      const alerts = await _readAlerts();
      alerts.unshift(alert);
      await _writeAlerts(alerts);
      try { if (broadcastIntel) broadcastIntel({ type: 'manual_entry_created', alert: { id: alert.id, title: alert.title, level: alert.level, country: alert.country } }); } catch (e2) {}
      console.log('[MANUAL-ENTRY] 新增 ' + id + ' [' + e.data_type + '/' + alert.level + '] ' + alert.title.slice(0, 40) + '（提交人 ' + submitter + '）');
      res.json({ id: id, version: 1, entry: e, alert: alert });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ===== 最近录入列表 ===== */
  router.get('/', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const scope = String(req.query.scope || 'all');
      const user = String(req.query.user || (req.user && req.user.username) || '');
      const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
      const params = [limit];
      let where = 'deleted=false';
      if (scope === 'mine' && user) { where += ' AND submitter=$2'; params.push(user); }
      const r = await query(`SELECT id, version, payload, title, country, data_type, level, china_related, submitter, created_at, updated_at, updated_by
        FROM manual_entries WHERE ${where} ORDER BY updated_at DESC LIMIT $1`, params);
      res.json(r.rows.map(x => ({
        id: x.id, version: x.version, entry: x.payload, title: x.title, country: x.country,
        data_type: x.data_type, level: x.level, china_related: x.china_related,
        submitter: x.submitter, created_at: x.created_at, updated_at: x.updated_at, updated_by: x.updated_by
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ===== 固定路径路由必须先于 /:id 注册（否则被通配吞掉返回 404） ===== */
  /* 元数据：12 类体系 / 等级 / 密级 / 可靠度 / 今日统计 */
  router.get('/meta/summary', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const r = await query(`SELECT data_type, COUNT(*) c FROM manual_entries WHERE deleted=false GROUP BY 1`);
      const byCat = {};
      r.rows.forEach(x => { byCat[x.data_type] = parseInt(x.c, 10); });
      const today = await query(`SELECT COUNT(*) c FROM manual_entries WHERE deleted=false AND created_at >= current_date`);
      const users = await query(`SELECT submitter, COUNT(*) c FROM manual_entries WHERE deleted=false GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
      /* 国别选项：54 国梯队优先排序（TIER1→TIER2→TIER3），前端 datalist 可自定义补充 */
      let tierCountries = [];
      try {
        const tiers = (INTEREST_BASE && INTEREST_BASE.COUNTRY_TIERS) || {};
        ['TIER1', 'TIER2', 'TIER3'].forEach(k => {
          (tiers[k] || []).forEach(c => { if (c && c.cn && tierCountries.indexOf(c.cn) < 0) tierCountries.push(c.cn); });
        });
      } catch (e4) {}
      res.json({
        cats: CATS, levels: LEVELS, reliability: RELIABILITY, classifications: CLASSIFICATIONS,
        by_category: byCat, today_total: parseInt(today.rows[0].c, 10) || 0,
        by_user: users.rows.map(x => ({ user: x.submitter, count: parseInt(x.c, 10) })),
        tier_countries: tierCountries
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* CSV 批量模板下载 */
  const CSV_HEADERS = ['data_type', 'country', 'city', 'event_time', 'title', 'content', 'china_related', 'china_note', 'related_projects', 'related_enterprises', 'deaths', 'injured', 'asset_loss_value', 'asset_loss_currency', 'source_channel', 'source_desc', 'source_url', 'reliability', 'classification', 'severity', 'tags', 'attachments'];
  router.get('/template.csv', authMiddleware, (req, res) => {
    const rows = [
      CSV_HEADERS.join(','),
      ['terror_events', '巴基斯坦', '奎达', '2026-09-01T08:30', '示例-奎达集市发生爆炸袭击', '示例行-请删除本行后按此格式填写；severity 填 red/orange/yellow/blue；china_related 填 是/否', '是', '现场有中资商铺', '中巴经济走廊', '某中资企业', '2', '5', '', 'USD', '现场联络员', '目击者转述', '', 'B', '内部', 'orange', '恐袭;爆炸', ''].join(','),
      ['geopolitical_intel', '美国', '', '2026-09-01T10:00', '示例-新的出口管制清单涉及中企', '示例行-请删除本行后按此格式填写', '是', '', '', '', '', '', '', '', '官方公报', '联邦公报原文', 'https://example.gov', 'A', '公开', 'orange', '出口管制', ''].join(',')
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="manual-entry-template.csv"');
    /* UTF-8 BOM：Excel 中文不乱码 */
    res.send('\ufeff' + rows);
  });

  /* ===== 批量提交（CSV 解析结果分批提交，逐条幂等） ===== */
  router.post('/batch', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ error: '批量数据为空' });
      if (items.length > 200) return res.status(400).json({ error: '单批最多 200 条，请分批提交' });
      const results = [];
      for (const it of items) {
        const requestId = String(it.request_id || crypto.randomUUID());
        const dup = await query(`SELECT id FROM manual_entries WHERE request_id=$1 AND deleted=false LIMIT 1`, [requestId]);
        if (dup.rows.length) { results.push({ ok: true, duplicate: true, id: dup.rows[0].id, title: it.title || '' }); continue; }
        const errs = _validate(it);
        if (errs.length) { results.push({ ok: false, error: '缺少: ' + errs.join('、'), title: it.title || '(无标题)' }); continue; }
        const id = crypto.randomUUID();
        const submitter = String((req.user && req.user.username) || '批量导入').slice(0, 60);
        const alert = _buildAlert(it, id, submitter);
        await query(`INSERT INTO manual_entries (id, request_id, version, payload, title, country, data_type, level, china_related, submitter, updated_by)
          VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$9)`,
          [id, requestId, JSON.stringify(Object.assign({}, it, { request_id: requestId })), alert.title, alert.country, it.data_type, it.severity, it.china_related === true, submitter]);
        const alerts = await _readAlerts();
        alerts.unshift(alert);
        await _writeAlerts(alerts);
        results.push({ ok: true, id: id, title: it.title || '' });
      }
      const okN = results.filter(x => x.ok).length;
      console.log('[MANUAL-ENTRY] 批量导入：成功 ' + okN + '/' + items.length);
      res.json({ total: items.length, ok: okN, failed: items.length - okN, results: results });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ===== 单条详情（含预警中心同步状态） ===== */
  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const r = await query(`SELECT * FROM manual_entries WHERE id=$1 AND deleted=false`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: '条目不存在或已删除' });
      const x = r.rows[0];
      const alerts = await _readAlerts();
      const inCenter = alerts.some(a => a && a.id === x.id && a.is_manual);
      res.json({ id: x.id, version: x.version, entry: x.payload, submitter: x.submitter, created_at: x.created_at, updated_at: x.updated_at, updated_by: x.updated_by, in_alert_center: inCenter });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ===== 编辑（乐观锁：version 不匹配 → 409 + 最新内容，支持前端对比/覆盖） ===== */
  router.put('/:id', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const id = req.params.id;
      const e = req.body || {};
      const clientVersion = parseInt(e.version, 10);
      const editor = String((req.user && req.user.username) || '未知用户').slice(0, 60);
      const r = await query(`SELECT * FROM manual_entries WHERE id=$1 AND deleted=false`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: '条目不存在或已删除' });
      const row = r.rows[0];
      if (!Number.isFinite(clientVersion) || clientVersion !== row.version) {
        /* 他人已修改：返回 409 + 服务端最新内容（含提交人），前端弹「他人已修改」对比/覆盖 */
        return res.status(409).json({
          error: '版本冲突：他人已修改该条目', conflict: true,
          current_version: row.version, current_entry: row.payload,
          updated_by: row.updated_by || row.submitter, updated_at: row.updated_at
        });
      }
      const errs = _validate(e);
      if (errs.length) return res.status(400).json({ error: '缺少必填字段: ' + errs.join('、') });
      const newVersion = row.version + 1;
      const alert = _buildAlert(e, id, row.submitter, { updated_by: editor });
      alert.alert_no = row.payload && row.payload._alert_no ? row.payload._alert_no : alert.alert_no;
      alert.time = row.created_at ? new Date(row.created_at).toISOString().slice(0, 19).replace('T', ' ') : alert.time;
      await query(`UPDATE manual_entries SET version=$1, payload=$2, title=$3, country=$4, data_type=$5, level=$6, china_related=$7, updated_at=NOW(), updated_by=$8 WHERE id=$9`,
        [newVersion, JSON.stringify(Object.assign({}, e, { _alert_no: alert.alert_no })), alert.title, alert.country, e.data_type, e.severity, e.china_related === true, editor, id]);
      /* 同步替换预警中心条目（保 id 不变，铁律：PUT 合并/帽/时效全部豁免 is_manual） */
      const alerts = await _readAlerts();
      const idx = alerts.findIndex(a => a && a.id === id);
      if (idx >= 0) alerts[idx] = alert; else alerts.unshift(alert);
      await _writeAlerts(alerts);
      try { if (broadcastIntel) broadcastIntel({ type: 'manual_entry_updated', alert: { id: alert.id, title: alert.title, level: alert.level, country: alert.country } }); } catch (e2) {}
      console.log('[MANUAL-ENTRY] 更新 ' + id + ' v' + row.version + '→' + newVersion + '（' + editor + '）');
      res.json({ id: id, version: newVersion, entry: e, alert: alert });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ===== 软删除（移出预警中心 + URL 墓碑防旧客户端复活） ===== */
  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      await _ensureTable();
      const id = req.params.id;
      const r = await query(`SELECT id, payload FROM manual_entries WHERE id=$1 AND deleted=false`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: '条目不存在或已删除' });
      await query(`UPDATE manual_entries SET deleted=true, updated_at=NOW(), updated_by=$2 WHERE id=$1`, [id, (req.user && req.user.username) || '']);
      const alerts = await _readAlerts();
      const kept = alerts.filter(a => !(a && a.id === id));
      if (kept.length !== alerts.length) await _writeAlerts(kept);
      /* 墓碑按 URL（manual://<uuid> 唯一）立碑：拦截旧客户端全量 PUT 回灌复活，
       * 同题新录入不受影响（新条目 uuid 不同 → URL 不命中）。 */
      try { if (_addTombstone) await _addTombstone(null, null, 'manual://' + id); } catch (e3) {}
      try { if (broadcastIntel) broadcastIntel({ type: 'manual_entry_deleted', id: id }); } catch (e2) {}
      console.log('[MANUAL-ENTRY] 删除 ' + id);
      res.json({ success: true, removed_from_alert_center: kept.length !== alerts.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
