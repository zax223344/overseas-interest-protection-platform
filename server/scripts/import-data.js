/**
 * localStorage -> PostgreSQL 数据迁移脚本
 *
 * 用法:
 * 1. 在浏览器中打开 export-localstorage.html，导出 localStorage 数据
 * 2. 将导出的 JSON 文件重命名为 data.backup.json 放到 server/ 目录
 * 3. 运行: node scripts/import-data.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const pool = new Pool();
const DATA_FILE = path.join(__dirname, '..', 'data.backup.json');

async function main() {
  console.log('========================================');
  console.log('  海外利益保护平台 - 数据迁移工具');
  console.log('  localStorage -> PostgreSQL');
  console.log('========================================\n');

  if (!fs.existsSync(DATA_FILE)) {
    console.error('错误: 未找到 data.backup.json');
    console.error('请将导出的 localStorage 数据文件放到 server/data.backup.json');
    process.exit(1);
  }

  let raw;
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { console.error('JSON 解析失败:', e.message); process.exit(1); }

  console.log('数据文件加载成功，共 ' + Object.keys(raw).length + ' 个键\n');

  const client = await pool.connect();
  try { await client.query('BEGIN'); } catch (e) { console.error('DB连接失败:', e.message); process.exit(1); }

  try {
    // ========== 1. 用户 ==========
    console.log('[1/7] 迁移用户数据...');
    let userCount = 0;
    const usersRaw = raw['orps_accounts_db_v2'];
    if (usersRaw) {
      let users = [];
      try { users = JSON.parse(usersRaw); } catch (e) {}
      if (!Array.isArray(users)) users = [];
      for (const u of users) {
        if (!u.username) continue;
        const hashed = await bcrypt.hash(u.password || '123456', 10);
        const role = (u.role === 'admin') ? 'admin' : 'user';
        const status = (u.approved !== false || role === 'admin') ? 'approved' : 'pending';
        const expire = u.expireTime ? new Date(u.expireTime).toISOString() : null;
        await client.query(
          `INSERT INTO users (username, password, role, status, expire_time, trial)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (username) DO UPDATE SET password=$2, role=$3, status=$4, expire_time=$5`,
          [u.username, hashed, role, status, expire, !!u.trial]
        );
        userCount++;
      }
    }
    console.log('  已迁移 ' + userCount + ' 个用户');

    // ========== 2. 情报数据 (DBCenter 11类) ==========
    console.log('[2/7] 迁移情报数据...');
    const intelTypes = [
      'terror_events','security_events','military_conflicts','political_events',
      'natural_disasters','public_health','sanctions_data','social_unrest',
      'infrastructure','geopolitical_intel','osint_intel'
    ];
    let intelCount = 0;
    for (const t of intelTypes) {
      const val = raw['orps_db_' + t];
      if (!val) continue;
      let items = [];
      try { items = JSON.parse(val); } catch (e) { continue; }
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        await client.query(
          `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [t, item.title||'', item.country||'', item.location||'', item.eventDate||item.event_date||'',
           item.severity||'', item.description||'', item.source||'', JSON.stringify(item)]
        );
        intelCount++;
      }
    }
    console.log('  已迁移 ' + intelCount + ' 条情报');

    // ========== 3. DataHub 数据集 ==========
    console.log('[3/7] 迁移 DataHub 数据集...');
    const dhCols = ['countries','enterprises','alerts','events','warning_rules',
      'chokepoints','corridors','predictions','terror_events','china_security','playbooks','_pending_reviews'];
    let dhCount = 0;
    for (const col of dhCols) {
      const val = raw['orps_datahub_' + col];
      if (!val) continue;
      let data = [];
      try { data = JSON.parse(val); } catch (e) { continue; }
      if (!Array.isArray(data)) continue;
      await client.query(
        `INSERT INTO datahub_store (collection, data_json) VALUES ($1,$2)
         ON CONFLICT (collection) DO UPDATE SET data_json=$2, updated_at=NOW()`,
        [col, JSON.stringify(data)]
      );
      dhCount++;
    }
    console.log('  已迁移 ' + dhCount + ' 个 DataHub 集合');

    // ========== 4. AI 报告 ==========
    console.log('[4/7] 迁移 AI 报告...');
    let reportCount = 0;
    const reportsRaw = raw['orps_ai_reports'];
    if (reportsRaw) {
      let reports = [];
      try { reports = JSON.parse(reportsRaw); } catch (e) {}
      if (!Array.isArray(reports)) reports = [];
      for (const r of reports) {
        await client.query(
          `INSERT INTO ai_reports (report_id, title, mode, country, level, report_type,
           materials, threat_analysis, impact_analysis, advice, content_json, author)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT DO NOTHING`,
          [
            r.id||null, r.title||'未命名报告', r.mode||r.reportMode||'elements',
            r.country||'', r.level||r.threatLevel||'', r.reportType||'',
            JSON.stringify(r.materials||[]), r.threatAnalysis||'', r.impactAnalysis||'',
            r.advice||'', JSON.stringify(r), r.author||'system'
          ]
        );
        reportCount++;
      }
    }
    console.log('  已迁移 ' + reportCount + ' 份报告');

    // ========== 5. 威胁组织 ==========
    console.log('[5/7] 迁移威胁组织...');
    let orgCount = 0;
    const orgsRaw = raw['orps_threat_orgs'];
    if (orgsRaw) {
      let orgs = [];
      try { orgs = JSON.parse(orgsRaw); } catch (e) {}
      if (!Array.isArray(orgs)) orgs = [];
      for (const o of orgs) {
        await client.query(
          `INSERT INTO threat_orgs (org_id, name, type, country, level, "desc", data_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (org_id) DO UPDATE SET name=$2, type=$3, country=$4, level=$5, "desc"=$6, data_json=$7`,
          [o.id||String(Date.now()), o.name||'', o.type||'', o.country||'', o.level||'', o.desc||'', JSON.stringify(o)]
        );
        orgCount++;
      }
    }
    console.log('  已迁移 ' + orgCount + ' 个威胁组织');

    // ========== 6. 企业项目 ==========
    console.log('[6/7] 迁移企业项目...');
    let entCount = 0;
    const entRaw = raw['orps_enterprise_projects'];
    if (entRaw) {
      let ents = [];
      try { ents = JSON.parse(entRaw); } catch (e) {}
      if (!Array.isArray(ents)) ents = [];
      for (const e of ents) {
        await client.query(
          `INSERT INTO enterprise_projects (enterprise, project, country, location, status, data_json)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [e.enterprise||'', e.project||'', e.country||'', e.location||'', e.status||'', JSON.stringify(e)]
        );
        entCount++;
      }
    }
    console.log('  已迁移 ' + entCount + ' 个企业项目');

    // ========== 7. 风险融合/预警/评估 ==========
    console.log('[7/7] 迁移风险融合/预警/评估...');

    let fusionCount = 0;
    const fusRaw = raw['orps_risk_fusion'];
    if (fusRaw) {
      let fusions = [];
      try { fusions = JSON.parse(fusRaw); } catch (e) {}
      if (!Array.isArray(fusions)) fusions = [];
      for (const f of fusions) {
        await client.query(
          `INSERT INTO risk_fusion (fusion_id, title, country, level, sources, data_json)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [f.id||String(Date.now()), f.title||'', f.country||'', f.level||'', JSON.stringify(f.sources||[]), JSON.stringify(f)]
        );
        fusionCount++;
      }
    }
    console.log('  风险融合: ' + fusionCount);

    let alertCount = 0;
    const alertRaw = raw['orps_auto_alerts'];
    if (alertRaw) {
      let alerts = [];
      try { alerts = JSON.parse(alertRaw); } catch (e) {}
      if (!Array.isArray(alerts)) alerts = [];
      for (const a of alerts) {
        await client.query(
          `INSERT INTO auto_alerts (alert_id, title, country, level, type, "desc", status, data_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [a.id||String(Date.now()), a.title||'', a.country||'', a.level||'', a.type||'',
           a.desc||'', a.status||'active', JSON.stringify(a)]
        );
        alertCount++;
      }
    }
    console.log('  预警: ' + alertCount);

    let assessCount = 0;
    const assessRaw = raw['orps_threat_assess'];
    if (assessRaw) {
      let assess = {};
      try { assess = JSON.parse(assessRaw); } catch (e) {}
      if (typeof assess === 'object' && !Array.isArray(assess)) {
        await client.query(
          `INSERT INTO threat_assessments (assess_type, data_json) VALUES ('assess',$1)
           ON CONFLICT (assess_type) DO UPDATE SET data_json=$1, updated_at=NOW()`,
          [JSON.stringify(assess)]
        );
        assessCount = Object.keys(assess).length;
      }
    }
    console.log('  威胁评估: ' + assessCount + ' 条');

    await client.query('COMMIT');
    console.log('\n========================================');
    console.log('  迁移成功!');
    console.log('========================================');
    console.log('  用户:     ' + userCount);
    console.log('  情报:     ' + intelCount);
    console.log('  DataHub:  ' + dhCount);
    console.log('  AI报告:   ' + reportCount);
    console.log('  威胁组织: ' + orgCount);
    console.log('  企业项目: ' + entCount);
    console.log('  风险融合: ' + fusionCount);
    console.log('  预警:     ' + alertCount);
    console.log('========================================\n');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('\n迁移失败:', e.message);
    console.error('所有更改已回滚');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
