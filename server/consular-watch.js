/* consular-watch.js — 领事保护哨兵（维度②，2026-08-28）
 * ================================================================
 * 依据官方框架：海外公民和法人的安全是三大支柱之一。领保体系数据（安全提醒/
 * 撤侨行动/领保案件）是官方最直接的海外利益受损信号源：
 *   - 外交部"领事直击"安全提醒（cs.mfa.gov.cn）
 *   - 12308 热线与紧急撤离行动报道
 *   - 使领馆警示/暂停营业/人员疏散
 * 职责：每 30 分钟一轮——
 *   ① 外交部领事司提醒页直采（真实 HTML 解析，零模拟）
 *   ② GDELT/Bing 检索：中国使领馆动态 + 撤侨 + 领保案件（英文+中文）
 *   ③ 走既有闸门入库，data_type=security_events，挂 consular_tags
 * 铁律：撤侨/中国公民遇袭条目命中红区铁律直接红色。 */
'use strict';
const crawler = require('./crawler');
/* GDELT 单查询 30s 硬竞速：复杂查询偶发挂起，绝不让单次检索阻塞哨兵轮次 */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);
const netx = require('./netx');

const MFA_ALERT_URLS = [
  'https://cs.mfa.gov.cn/zlbg/lstz/',
  'https://cs.mfa.gov.cn/zlbg/aqtx/'
];

const CONSULAR_QUERIES = [
  'Chinese embassy OR consulate alert OR warning OR evacuated',
  'China evacuate citizens OR nationals OR workers crisis',
  '领事提醒 OR 安全提醒 OR 暂勿前往 OR 撤离',
  'Chinese citizens abroad rescued OR evacuated OR missing',
  '12308 consular protection Chinese emergency'
];

/* 领保信号词（标题必须命中其一） */
const CONSULAR_RE = /embassy|consulate|consular|evacuat|12308|领保|领事|使馆|撤侨|撤离|撤回|安全提醒|暂勿前往|谨慎前往|提醒.*公民|citizens? (?:evacuated|rescued|missing|abroad)|(?:evacuated|rescued|missing) .{0,20}Chinese/i;

function parseMfaList(html) {
  /* 两段式线性解析（2026-08-28）：旧版嵌套量词正则在领事司大页面上灾难性回溯卡死事件循环。
   * ① 先用简单非贪婪模式取全部 <a>…</a> 块（限长 200 防贪婪）；② 再逐块线性抽取 href/title/文本。 */
  const items = [];
  const blocks = String(html || '').match(/<a\b[^>]*>[\s\S]{0,200}?<\/a>/gi) || [];
  for (const b of blocks) {
    const hrefM = /href="([^"]+)"/i.exec(b);
    const titleM = /title="([^"]{10,120})"/i.exec(b);
    const textM = />([^<>]{10,120})<\/a>/i.exec(b);
    const url = hrefM ? (hrefM[1].startsWith('http') ? hrefM[1] : 'https://cs.mfa.gov.cn' + (hrefM[1].startsWith('/') ? hrefM[1] : '/' + hrefM[1])) : '';
    const title = ((titleM && titleM[1]) || (textM && textM[1]) || '').replace(/\s+/g, ' ').trim();
    if (title.length >= 10 && /提醒|注意|安全|暂勿|谨慎|撤离|领保|风险|警示|防范/.test(title)) {
      items.push({ title, content: '', url, publish_time: '', source: '外交部领事司', country: '', _sourceType: 'consular_watch' });
    }
  }
  return items;
}

async function runConsularWatch(opts) {
  opts = opts || {};
  const out = [];
  /* ① MFA 领事直击直采（硬超时竞速兜底） */
  for (const u of MFA_ALERT_URLS) {
    try {
      const r = await Promise.race([
        netx.smartFetch(u, { timeout: 12000 }).catch(() => null),
        new Promise(res => setTimeout(() => res(null), 14000))
      ]);
      if (r && r.body) parseMfaList(r.body).forEach(x => out.push(x));
    } catch (e) { /* 站点不可达则跳过，靠 GDELT 兜底 */ }
  }
  /* ② GDELT 检索（走 crawler 节流通道） */
  const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
  const q = CONSULAR_QUERIES[cyc % CONSULAR_QUERIES.length];
  const q2 = CONSULAR_QUERIES[(cyc + 2) % CONSULAR_QUERIES.length];
  for (const qq of [q, q2]) {
    try {
      const arts = await _gdelt(qq, { timespan: '1d', maxrecords: opts.maxPerQuery || 12 });
      (arts || []).forEach(a => {
        out.push({
          title: a.title || '', content: '', url: a.url || a.link || '',
          publish_time: a.publish_time || a.publishedAt || a.seendate || '',
          source: a.source || a.domain || 'GDELT', country: a.country || '', _sourceType: 'consular_watch', _viaGdelt: true
        });
      });
    } catch (e) {}
  }
  const filtered = out.filter(it => {
    const t = String(it.title || '');
    if (!t.trim() || t.length < 10) return false;
    return CONSULAR_RE.test(t);
  });
  const seen = new Set();
  const uniq = filtered.filter(it => {
    const k = String(it.url || it.title).toLowerCase().replace(/[#?].*$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { items: uniq, count: uniq.length };
}

module.exports = { runConsularWatch, CONSULAR_QUERIES, MFA_ALERT_URLS };
