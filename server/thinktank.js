/**
 * thinktank.js — 智库报告库（加密存储版，2026-09-04）
 * ============================================================
 * 定位：管理员上传自有智库报告（PDF），全角色按密级分级可见、可检索、可下载。
 * 保密设计（四层）：
 *   1) 文件加密落盘：AES-256-GCM，复用 DATA_FIELD_KEY（与 JWT_SECRET 密钥分层），
 *      磁盘布局 [iv12][tag16][ciphertext]，vault 目录 server/ttvault/——
 *      服务器磁盘被拷走也读不出报告内容；
 *   2) 密级可见性：公开/内部/秘密/机密 四级，非管理员仅见 公开+内部，
 *      秘密/机密 仅管理员可见可下载（列表/下载双重校验，防越权直链）；
 *   3) 写操作防篡改：上传/删除走 authMiddleware + adminOnly + _signCheck 三件套；
 *   4) 全量审计：thinktank_audit 记录 上传/下载/删除 的操作者与 IP。
 * 上传通道：base64 JSON（express.json 50mb 已就位，无需引入 multer 依赖）。
 * ============================================================
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VAULT_DIR = path.join(__dirname, 'ttvault');
const MAX_FILE_BYTES = 20 * 1024 * 1024;          /* 单个 PDF ≤ 20MB */
const CATEGORIES = ['战略研究', '区域国别', '专题分析', '风险评估', '政策法规', '合规制裁'];
const CLASSIFICATIONS = ['公开', '内部', '秘密', '机密'];
const DIMENSIONS = ['经济基础', '人员机构', '安全事件', '东道国风险', '海上走廊', '合规制裁'];
/* 非管理员可见密级 */
const OPEN_TO_USER = ['公开', '内部'];

const _keyHex = process.env.DATA_FIELD_KEY || '';
const KEY = /^[0-9a-f]{64}$/i.test(_keyHex) ? Buffer.from(_keyHex, 'hex') : null;

/* ---------- 二进制 AES-256-GCM（fieldcrypt 仅支持字符串，PDF 须二进制版） ---------- */
function encryptBuffer(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}
function decryptBuffer(enc) {
  const iv = enc.subarray(0, 12), tag = enc.subarray(12, 28), ct = enc.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function _ensureVault() {
  try { if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true }); } catch (e) {}
}

/* ---------- 建表（幂等） ---------- */
async function _migrate(query) {
  await query(`CREATE TABLE IF NOT EXISTS thinktank_reports (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '专题分析',
    classification TEXT NOT NULL DEFAULT '内部',
    source_org TEXT DEFAULT '',
    authors TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    keywords TEXT DEFAULT '',
    countries TEXT DEFAULT '',
    dimensions TEXT DEFAULT '',
    report_date DATE,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_sha256 TEXT NOT NULL,
    enc_path TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    downloads INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tt_reports_alive ON thinktank_reports(deleted_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tt_reports_cls ON thinktank_reports(classification)`);
  await query(`CREATE TABLE IF NOT EXISTS thinktank_audit (
    id SERIAL PRIMARY KEY,
    report_id INTEGER,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    ip TEXT DEFAULT '',
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function _clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
}
async function _audit(query, reportId, action, actor, ip) {
  try { await query(`INSERT INTO thinktank_audit(report_id, action, actor, ip) VALUES($1,$2,$3,$4)`, [reportId, action, actor, ip]); } catch (e) {}
}

function init(app, deps) {
  const { authMiddleware, adminOnly, _signCheck, query } = deps;
  _ensureVault();

  /* ===== 上传（管理员 + 签名） ===== */
  app.post('/api/thinktank/upload', authMiddleware, adminOnly, _signCheck, async (req, res) => {
    try {
      if (!KEY) return res.status(500).json({ error: '服务端未配置 DATA_FIELD_KEY，无法加密存储' });
      const b = req.body || {};
      const title = String(b.title || '').trim();
      if (!title) return res.status(400).json({ error: '报告标题不能为空' });
      if (title.length > 120) return res.status(400).json({ error: '标题过长（≤120字）' });
      const fileName = String(b.file_name || '').trim();
      const fileData = String(b.file_data || '');
      if (!fileName || !fileData) return res.status(400).json({ error: '缺少 PDF 文件' });
      let buf;
      try { buf = Buffer.from(fileData, 'base64'); } catch (e) { return res.status(400).json({ error: '文件编码异常' }); }
      if (!buf || !buf.length) return res.status(400).json({ error: '文件内容为空' });
      if (buf.length > MAX_FILE_BYTES) return res.status(400).json({ error: '文件超过 20MB 上限' });
      /* PDF 魔数校验：%PDF- */
      if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return res.status(400).json({ error: '仅允许上传 PDF 文件' });
      }
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const dup = await query(`SELECT id, title FROM thinktank_reports WHERE file_sha256=$1 AND deleted_at IS NULL`, [sha256]);
      if (dup.rows.length) return res.status(409).json({ error: '该文件已存在馆藏：《' + dup.rows[0].title + '》（#' + dup.rows[0].id + '），请勿重复上传' });

      const category = CATEGORIES.includes(b.category) ? b.category : '专题分析';
      const classification = CLASSIFICATIONS.includes(b.classification) ? b.classification : '内部';
      const dims = String(b.dimensions || '').split(/[,，]/).map(s => s.trim()).filter(s => DIMENSIONS.includes(s));
      const kw = String(b.keywords || '').slice(0, 300);
      const countries = String(b.countries || '').slice(0, 300);
      const summary = String(b.summary || '').slice(0, 2000);
      const sourceOrg = String(b.source_org || '').slice(0, 120);
      const authors = String(b.authors || '').slice(0, 120);
      let reportDate = String(b.report_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) reportDate = null;

      const encName = 'rpt_' + sha256.slice(0, 16) + '_' + crypto.randomBytes(4).toString('hex') + '.bin';
      fs.writeFileSync(path.join(VAULT_DIR, encName), encryptBuffer(buf));

      const r = await query(
        `INSERT INTO thinktank_reports(title,category,classification,source_org,authors,summary,keywords,countries,dimensions,report_date,file_name,file_size,file_sha256,enc_path,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [title, category, classification, sourceOrg, authors, summary, kw, countries, dims.join(','), reportDate,
         fileName.slice(0, 200), buf.length, sha256, encName, req.user.username]
      );
      const id = r.rows[0].id;
      await _audit(query, id, 'upload', req.user.username, _clientIp(req));
      res.json({ ok: true, id });
    } catch (e) {
      console.error('[THINKTANK] upload 异常:', e.message);
      res.status(500).json({ error: '上传失败：' + e.message });
    }
  });

  /* ===== 列表（登录可见，密级按角色过滤 + 多维检索） ===== */
  app.get('/api/thinktank/list', authMiddleware, async (req, res) => {
    try {
      const isAdmin = req.user && req.user.role === 'admin';
      const cond = ['deleted_at IS NULL'];
      const params = [];
      if (!isAdmin) { params.push(OPEN_TO_USER); cond.push(`classification = ANY($${params.length})`); }
      const q = String(req.query.q || '').trim();
      if (q) {
        params.push('%' + q + '%');
        cond.push(`(title ILIKE $${params.length} OR authors ILIKE $${params.length} OR summary ILIKE $${params.length} OR keywords ILIKE $${params.length} OR source_org ILIKE $${params.length})`);
      }
      const cat = String(req.query.category || '').trim();
      if (cat && CATEGORIES.includes(cat)) { params.push(cat); cond.push(`category = $${params.length}`); }
      const cls = String(req.query.classification || '').trim();
      if (cls && CLASSIFICATIONS.includes(cls)) { params.push(cls); cond.push(`classification = $${params.length}`); }
      const dim = String(req.query.dimension || '').trim();
      if (dim && DIMENSIONS.includes(dim)) { params.push('%' + dim + '%'); cond.push(`dimensions ILIKE $${params.length}`); }
      const country = String(req.query.country || '').trim();
      if (country) { params.push('%' + country + '%'); cond.push(`countries ILIKE $${params.length}`); }

      const where = ' WHERE ' + cond.join(' AND ');
      const totalR = await query(`SELECT COUNT(*)::int AS n FROM thinktank_reports` + where, params);
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 12));
      params.push(pageSize, (page - 1) * pageSize);
      const rows = await query(
        `SELECT id,title,category,classification,source_org,authors,summary,keywords,countries,dimensions,
                to_char(report_date,'YYYY-MM-DD') AS report_date,file_name,file_size,uploaded_by,
                to_char(uploaded_at,'YYYY-MM-DD HH24:MI') AS uploaded_at,downloads
         FROM thinktank_reports` + where + ` ORDER BY uploaded_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      res.json({ ok: true, total: totalR.rows[0].n, page, pageSize, rows: rows.rows, isAdmin });
    } catch (e) {
      console.error('[THINKTANK] list 异常:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* ===== 统计（登录可见，密级按角色过滤） ===== */
  app.get('/api/thinktank/stats', authMiddleware, async (req, res) => {
    try {
      const isAdmin = req.user && req.user.role === 'admin';
      const cond = isAdmin ? 'WHERE deleted_at IS NULL' : 'WHERE deleted_at IS NULL AND classification = ANY($1)';
      const params = isAdmin ? [] : [OPEN_TO_USER];
      const base = await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(DISTINCT category)::int AS categories,
                COUNT(*) FILTER (WHERE uploaded_at >= date_trunc('month', NOW()))::int AS month_new,
                COALESCE(SUM(downloads),0)::int AS downloads
         FROM thinktank_reports ` + cond, params);
      const byCls = await query(`SELECT classification, COUNT(*)::int AS n FROM thinktank_reports ` + cond + ` GROUP BY classification`, params);
      const byCat = await query(`SELECT category, COUNT(*)::int AS n FROM thinktank_reports ` + cond + ` GROUP BY category ORDER BY n DESC`, params);
      res.json({ ok: true, base: base.rows[0], byClassification: byCls.rows, byCategory: byCat.rows });
    } catch (e) {
      console.error('[THINKTANK] stats 异常:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* ===== 下载（登录 + 密级校验 + 审计；GET 走 auth 不挂签名，与既有 GET 范式一致） ===== */
  app.get('/api/thinktank/download/:id', authMiddleware, async (req, res) => {
    try {
      if (!KEY) return res.status(500).json({ error: '服务端未配置 DATA_FIELD_KEY，无法解密' });
      const id = parseInt(req.params.id, 10);
      const r = await query(`SELECT * FROM thinktank_reports WHERE id=$1 AND deleted_at IS NULL`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: '报告不存在或已删除' });
      const row = r.rows[0];
      const isAdmin = req.user && req.user.role === 'admin';
      if (!isAdmin && !OPEN_TO_USER.includes(row.classification)) {
        return res.status(403).json({ error: '该报告密级为「' + row.classification + '」，仅管理员可获取' });
      }
      const fp = path.join(VAULT_DIR, row.enc_path);
      if (!fs.existsSync(fp)) return res.status(410).json({ error: '馆藏文件缺失，请联系管理员' });
      let plain;
      try { plain = decryptBuffer(fs.readFileSync(fp)); } catch (e) { return res.status(500).json({ error: '解密失败（密钥或数据异常）' }); }
      await query(`UPDATE thinktank_reports SET downloads = downloads + 1 WHERE id=$1`, [id]);
      await _audit(query, id, 'download', req.user.username, _clientIp(req));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(row.file_name));
      res.setHeader('Cache-Control', 'no-store');
      res.send(plain);
    } catch (e) {
      console.error('[THINKTANK] download 异常:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* ===== 删除（管理员 + 签名；软删 + 物理删 vault 文件） ===== */
  app.delete('/api/thinktank/delete/:id', authMiddleware, adminOnly, _signCheck, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await query(`UPDATE thinktank_reports SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING enc_path`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: '报告不存在或已删除' });
      const fp = path.join(VAULT_DIR, r.rows[0].enc_path);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
      await _audit(query, id, 'delete', req.user.username, _clientIp(req));
      res.json({ ok: true });
    } catch (e) {
      console.error('[THINKTANK] delete 异常:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* 建表异步执行（不阻塞 listen） */
  _migrate(query).then(() => console.log('[THINKTANK] 智库报告库就绪（vault=' + VAULT_DIR + '）'))
    .catch(e => console.error('[THINKTANK] 建表失败:', e.message));
}

module.exports = { init };
