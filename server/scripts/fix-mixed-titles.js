/* ============================================================
 * 一次性脚本：回修存量混排标题（2026-08-29 三部委审查 P1-4）
 * 近 7 天 591 条(21%) title_zh 混排——专名未译（Pezeshkian/P@SHA 等）。
 * 逻辑与 server.js _fixMixedZh 同源：提取英文片段逐个送 TranSmart 二次翻译，
 * 译出中文则替换，译不出保留原样。片段缓存避免重复调用。
 * 用法：node scripts/fix-mixed-titles.js [--dry]
 * ============================================================ */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

const DRY = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function tr(text) {
  const src = String(text || '').slice(0, 2000);
  if (!src.trim()) return '';
  const res = await fetch('https://transmart.qq.com/api/imt', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://transmart.qq.com/zh-CN/index' },
    body: JSON.stringify({
      header: { fn: 'auto_translation', client_key: 'browser-chrome-120.0.0-Windows 10-' + Date.now() },
      type: 'plain', model_category: 'normal',
      source: { lang: 'auto', text_list: ['', src, ''] },
      target: { lang: 'zh' }
    })
  });
  if (!res.ok) throw new Error('TranSmart HTTP ' + res.status);
  const j = await res.json();
  return (j.auto_translation || []).filter(Boolean).join('').trim();
}

function isMixed(s) { return /[\u4e00-\u9fa5]/.test(s) && /[A-Za-z]{3,}/.test(s); }

const fragCache = new Map();
async function fixTitle(zh) {
  const frags = zh.match(/[A-Za-z][A-Za-z@.'-]*(?:\s+[A-Za-z][A-Za-z@.'-]*)?/g) || [];
  let out = zh, fixed = 0;
  for (const f of frags) {
    const key = f.trim();
    if (key.length < 3) continue;
    /* 全大写缩写不翻（COP17/ICE/AIM/CCECC/PL/CBC/BABA——字面翻译会出"警察17/冰/目的"） */
    if (/^[A-Z0-9@.'-]{2,}$/.test(key.replace(/\s/g, ''))) continue;
    let t = fragCache.get(key);
    if (t === undefined) {
      t = '';
      try {
        const r = await tr(key);
        if (r && /[\u4e00-\u9fa5]/.test(r) && !isMixed(r)) t = r.trim();
      } catch (e) {}
      fragCache.set(key, t);
      await new Promise(s => setTimeout(s, 250)); /* 限速防 429 */
    }
    if (t) { out = out.split(f).join(t); fixed++; }
  }
  return { out, fixed };
}

(async () => {
  const { rows } = await db.query(`
    SELECT id, title, data_json->>'title_zh' AS tzh
    FROM intel_data
    WHERE created_at > now() - interval '7 days'
      AND COALESCE(data_json->>'title_zh','') ~ '[A-Za-z]{3,}'
      AND COALESCE(data_json->>'title_zh','') ~ '[\\u4e00-\\u9fa5]'
    LIMIT 700`);
  console.log('待修混排标题:', rows.length, DRY ? '(dry-run)' : '');
  let done = 0, updated = 0;
  for (const r of rows) {
    const zh = r.tzh || '';
    if (!isMixed(zh)) continue;
    try {
      const { out, fixed } = await fixTitle(zh);
      if (fixed > 0 && out !== zh) {
        updated++;
        if (!DRY) {
          await db.query(`UPDATE intel_data SET data_json = data_json || jsonb_build_object('title_zh', $1::text) WHERE id = $2`, [out, r.id]);
          /* title 列若同存旧中文标题也一并修（6473 行 it.title=tZh 同源写入） */
          if (r.title === zh) await db.query(`UPDATE intel_data SET title = $1::text WHERE id = $2`, [out, r.id]);
        }
        console.log('[' + (++done) + '] ' + zh.slice(0, 45) + ' → ' + out.slice(0, 45));
      } else { done++; }
    } catch (e) { console.warn('跳过 #' + r.id, e.message); }
  }
  console.log('完成：扫描', rows.length, '/ 实修', updated, DRY ? '(dry 未写库)' : '');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
