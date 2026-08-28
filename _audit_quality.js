/* Task #465: 采集质量四维审计 —— 类别/国别/重点/翻译（全部基于真实库数据） */
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
const scrapers = require('./scrapers');

const TIER1 = ['巴基斯坦', '俄罗斯', '哈萨克斯坦', '沙特阿拉伯', '印度尼西亚'];
const TIER2 = ['印度', '阿富汗', '尼日利亚', '刚果（金）', '刚果(金)', '伊朗', '伊拉克', '越南', '泰国', '马来西亚', '缅甸', '斯里兰卡', '吉布提', '埃及', '埃塞俄比亚', '肯尼亚', '几内亚', '秘鲁', '巴西', '阿根廷', '老挝', '柬埔寨', '孟加拉国', '阿尔及利亚', '阿联酋', '希腊', '巴拿马', '乌兹别克斯坦', '塔吉克斯坦'];
const BRI_KWS = ['CPEC', '中巴经济走廊', '瓜达尔', 'Gwadar', '汉班托塔', 'Hambantota', '比雷埃夫斯', 'Piraeus', '皎漂', 'Kyaukpyu', '中老铁路', '雅万高铁', '蒙内铁路', '钱凯港', 'Chancay', '西芒杜', 'Simandou', '卡莫阿', 'Kamoa', '中欧班列', '一带一路', 'Belt and Road', 'BRI'];

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s || '');
const latinRuns = (s) => (String(s || '').match(/[A-Za-z]{4,}/g) || []).filter(w => !['CPEC', 'ISIS', 'GDELT', 'APPROVED'].includes(w.toUpperCase()));
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '0%';

(async () => {
  console.log('============ A. 类别分布 ============');
  const catWin = await pool.query(`SELECT data_type, COUNT(*)::int n,
      COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours')::int d1,
      COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int d7
    FROM intel_data GROUP BY 1 ORDER BY d7 DESC`);
  console.log('data_type | 24h | 7d | 总量');
  for (const r of catWin.rows) console.log(`${r.data_type} | ${r.d1} | ${r.d7} | ${r.n}`);
  const tot = catWin.rows.reduce((s, r) => s + r.n, 0), tot7 = catWin.rows.reduce((s, r) => s + r.d7, 0), tot1 = catWin.rows.reduce((s, r) => s + r.d1, 0);
  console.log(`合计: 24h=${tot1} | 7d=${tot7} | 总量=${tot}`);

  console.log('\n--- 近 14 天每日采集量趋势 ---');
  const daily = await pool.query(`SELECT to_char(collect_time, 'MM-DD') d, COUNT(*)::int n FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days' GROUP BY 1 ORDER BY 1`);
  for (const r of daily.rows) console.log(`${r.d}: ${r.n}${r.n < 200 ? '  ⚠️偏低' : ''}`);

  console.log('\n============ B. 国别分布（近7天） ============');
  const ctry = await pool.query(`SELECT country, COUNT(*)::int d7,
      COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '24 hours')::int d1
    FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY d7 DESC`);
  let t1 = 0, t2 = 0, blank = 0;
  for (const r of ctry.rows) {
    if (!r.country || r.country === '未知' || r.country === '') blank += r.d7;
    else if (TIER1.includes(r.country)) t1 += r.d7;
    else if (TIER2.includes(r.country)) t2 += r.d7;
  }
  console.log(`近7天总量=${tot7} | TIER1五国=${t1}(${pct(t1, tot7)}) | TIER2 29国=${t2}(${pct(t2, tot7)}) | 国别空/未知=${blank}(${pct(blank, tot7)})`);
  console.log('\nTop 25 国别:');
  ctry.rows.slice(0, 25).forEach((r, i) => console.log(`  ${i + 1}. ${r.country || '(空)'}: 7d=${r.d7} 24h=${r.d1}`));
  console.log('\n⚠️ TIER1/TIER2 重点国近7天 0 条覆盖:');
  const covered = new Set(ctry.rows.map(r => r.country));
  for (const c of [...TIER1, ...TIER2]) if (!covered.has(c)) console.log(`  ${c}`);

  console.log('\n============ C. 采集重点（涉华/BRI 命中密度，近7天） ============');
  const recent = await pool.query(`SELECT id, title, country, data_type, source, data_json->>'title_zh' AS tzh, data_json->>'_untranslated' AS untr
    FROM intel_data WHERE collect_time >= NOW() - INTERVAL '7 days'`);
  const rows = recent.rows;
  console.log(`近7天样本: ${rows.length} 条`);
  let chinaHit = 0, chinaNeg = 0, briHit = 0;
  const chinaByType = {}, chinaBySource = {};
  const NEG = ['袭击', '绑架', '遇袭', 'killed', 'kidnap', 'attack', 'sanction', '制裁', '抗议', 'protest', '受伤', '遇难', '身亡', '逮捕', 'arrest'];
  for (const r of rows) {
    const txt = `${r.title || ''} ${r.tzh || ''}`;
    const isCN = scrapers.isChinaRelatedStrict(txt);
    if (isCN) {
      chinaHit++;
      chinaByType[r.data_type] = (chinaByType[r.data_type] || 0) + 1;
      const src = String(r.source || '').slice(0, 30);
      chinaBySource[src] = (chinaBySource[src] || 0) + 1;
      if (NEG.some(k => txt.toLowerCase().includes(k.toLowerCase()))) chinaNeg++;
    }
    if (BRI_KWS.some(k => txt.includes(k))) briHit++;
  }
  console.log(`涉华命中(isChinaRelatedStrict): ${chinaHit} (${pct(chinaHit, rows.length)})  其中负面: ${chinaNeg} (${pct(chinaNeg, chinaHit)})`);
  console.log(`BRI/重点项目命中: ${briHit} (${pct(briHit, rows.length)})`);
  console.log('涉华按类别:', JSON.stringify(chinaByType));
  console.log('涉华按来源 Top10:', Object.entries(chinaBySource).sort((a, b) => b[1] - a[1]).slice(0, 10));

  console.log('\n============ D. 翻译质量（近7天） ============');
  let noZh = 0, halfHalf = 0, untrFlag = 0;
  const noZhSrc = {}, halfSrc = {}, halfSamples = [], noZhSamples = [];
  for (const r of rows) {
    const tzh = r.tzh || '', en = r.title || '';
    if (r.untr) untrFlag++;
    if (!hasCJK(tzh)) {
      noZh++;
      const src = String(r.source || '').slice(0, 30);
      noZhSrc[src] = (noZhSrc[src] || 0) + 1;
      if (noZhSamples.length < 8) noZhSamples.push(`[${src}] ${(tzh || en).slice(0, 80)}`);
    } else if (latinRuns(tzh).length >= 2) {
      halfHalf++;
      const src = String(r.source || '').slice(0, 30);
      halfSrc[src] = (halfSrcSrc => halfSrcSrc)(halfSrc), halfSrc[src] = (halfSrc[src] || 0) + 1;
      if (halfSamples.length < 8) halfSamples.push(`[${src}] ${tzh.slice(0, 90)}`);
    }
  }
  console.log(`无中文标题: ${noZh} (${pct(noZh, rows.length)})`);
  console.log(`半中半英(≥2个4字母以上英文残留): ${halfHalf} (${pct(halfHalf, rows.length)})`);
  console.log(`_untranslated 标记: ${untrFlag}`);
  console.log('\n无中文 Top 来源:', Object.entries(noZhSrc).sort((a, b) => b[1] - a[1]).slice(0, 8));
  console.log('无中文样本:');
  noZhSamples.forEach(s => console.log('  ' + s));
  console.log('\n半中半英 Top 来源:', Object.entries(halfSrc).sort((a, b) => b[1] - a[1]).slice(0, 8));
  console.log('半中半英样本:');
  halfSamples.forEach(s => console.log('  ' + s));

  console.log('\n============ E. 来源健康度（近7天 Top20 + 翻译失败率） ============');
  const srcAll = {};
  for (const r of rows) {
    const src = String(r.source || '').slice(0, 35);
    srcAll[src] = srcAll[src] || { n: 0, nozh: 0 };
    srcAll[src].n++;
    if (!hasCJK(r.tzh || '')) srcAll[src].nozh++;
  }
  Object.entries(srcAll).sort((a, b) => b[1].n - a[1].n).slice(0, 20).forEach(([k, v]) =>
    console.log(`  ${k}: ${v.n} 条, 无中文率 ${pct(v.nozh, v.n)}`));

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
