const ENTITY = require('../entities.js');

function _scoreRiskItem(it) {
  const r = ENTITY.assessRisk({
    title: String(it.title || '') + ' ' + String(it.title_zh || ''),
    content: String(it.content_zh || '') + ' ' + String(it.content || it.desc || it.description || ''),
    country: it.country || it.country_cn || '',
    source: it.source || '', platform: it.platform || '',
    publishedAt: it.publishedAt || it.pubDate || it.collect_time || '',
    chinaNegative: it._chinaNegative === true || it.chinaNegative === true
  });
  let score = r.riskScore;
  const hits = (r.ruleHits || []).slice();
  const hitIds = hits.map(h => h.rule);
  const ent = r.entities || { enterprises: [], projects: [], assets: [] };
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.desc || '').slice(0, 300);
  const chinaSig = /中国|中资|中企|中方|华人|华侨|华裔|中国公民|留学生|一带一路|中国使领馆|中国驻|撤侨|Chinese|China|CPEC/i.test(t)
    || ent.enterprises.length > 0 || ent.projects.length > 0 || (it.asset_tags && it.asset_tags.length > 0);
  const cm = t.match(/(\d{1,4})\s*(?:名|人|个)?\s*(?:死亡|身亡|遇难|丧生|被打死|被击毙)/) ||
             t.match(/(\d{1,4})\s*(?:people\s+)?(?:killed|dead|deaths)/i) ||
             t.match(/(?:death toll|kills)\s*(\d{1,4})/i);
  const deaths = cm ? parseInt(cm[1], 10) : 0;
  const RED_ELIGIBLE_RE = /中国公民[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持|被枪杀|被击毙|被杀害)|中方人员[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持)|华人[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持)|华侨[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持)|华裔[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持)|中国留学生[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持)|中国工人[^，。；;]{0,20}(?:被袭|遭袭|受袭|遇袭|被绑|遭绑架|被绑架|遭劫持|被劫持)|撤侨|撤离[^，。；;]{0,20}中国公民|遣返[^，。；;]{0,20}中国公民|群体开枪|大规模枪击|中国公民[^，。；;]{0,20}枪击|中方人员[^，。；;]{0,20}枪击|华人[^，。；;]{0,20}枪击|华侨[^，。；;]{0,20}枪击|华裔[^，。；;]{0,20}枪击/i;
  const redEligible = RED_ELIGIBLE_RE.test(t);
  if (score >= 61 && !redEligible) {
    hits.push({ rule: 'R-Z05', name: '红区硬约束：仅中国公民被袭击/绑架/撤侨/群体开枪可入红，压至橙区上沿', add: 60 - score });
    score = 60;
  }
  if (redEligible && score < 61) {
    hits.push({ rule: 'R-Z06', name: '红区触发：命中中国公民被袭击/绑架/撤侨/群体开枪', add: 61 - score });
    score = 61;
  }
  const topThreat = (hits[0] && hits[0].rule) || '';
  if (topThreat === 'R-T09' && score >= 61 && !redEligible) {
    hits.push({ rule: 'R-Z04', name: '制裁类硬约束：一律不准入红', add: 55 - score });
    score = 55;
  }
  const zone = score >= 61 ? 'red' : score >= 31 ? 'yellow' : 'green';
  const level = score >= 61 ? 'red' : score >= 46 ? 'orange' : score >= 31 ? 'yellow' : 'blue';
  return { score, zone, level, rationale: hits.map(h => h.name + '(' + (h.add > 0 ? '+' : '') + h.add + ')').join('；') };
}

const cases = [
  { title: '匈牙利公交车相撞至少12人死亡', country: '匈牙利' },
  { title: '中国公民在巴基斯坦遭袭击', country: '巴基斯坦' },
  { title: '中国工人在阿富汗被绑架', country: '阿富汗' },
  { title: '美国宣布对华加征新关税', country: '美国' },
  { title: '中国宣布从利比亚撤侨', country: '利比亚' },
  { title: '尼泊尔-中国边境山洪暴发造成至少22人死亡', country: '尼泊尔' },
  { title: '菲律宾警方称群体开枪事件涉及中国公民', country: '菲律宾' }
];

for (const c of cases) {
  const s = _scoreRiskItem(c);
  console.log(c.title, '=> score', s.score, 'level', s.level, 'zone', s.zone);
}
