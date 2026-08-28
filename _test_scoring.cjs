/* 赋分模型实测：真实案例 → 分数/分区/等级 */
const ENTITY = require('C:/Users/28737/Desktop/新建文件夹/entities.js');
const ZONE_ACTIONS = { green: '绿区', yellow: '黄区', red: '红区' };
function score(it) {
  const r = ENTITY.assessRisk({
    title: String(it.title || '') + ' ' + String(it.title_zh || ''),
    content: String(it.content || it.desc || ''),
    country: it.country || '', source: it.source || '',
    publishedAt: it.publishedAt || new Date().toISOString(),
    chinaNegative: it.chinaNegative === true
  });
  let s = r.riskScore;
  const hits = (r.ruleHits || []).slice();
  const hitIds = hits.map(h => h.rule);
  const ent = r.entities || { enterprises: [], projects: [], assets: [] };
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || '').slice(0, 300);
  const chinaSig = /中国|中资|中企|中方|华人|华侨|华裔|中国公民|留学生|一带一路|中国使领馆|中国驻|撤侨|Chinese|China|CPEC/i.test(t)
    || ent.enterprises.length > 0 || ent.projects.length > 0;
  const cm = t.match(/(\d{1,4})\s*(?:名|人|个)?\s*(?:死亡|身亡|遇难|丧生|被打死|被击毙)/) ||
             t.match(/(\d{1,4})\s*(?:people\s+)?(?:killed|dead|deaths)/i) ||
             t.match(/(?:death toll|kills)\s*(\d{1,4})/i);
  const deaths = cm ? parseInt(cm[1], 10) : 0;
  const hardTarget = ent.enterprises.length > 0 || ent.projects.length > 0 || ent.assets.some(a => (a.weight || 0) >= 0.9);
  const chineseVictim = hitIds.indexOf('R-T01') >= 0 || hitIds.indexOf('R-T02') >= 0;
  const VIOLENT_RULES = ['R-T01', 'R-T02', 'R-T03', 'R-T04', 'R-T05', 'R-T07', 'R-T10', 'R-T11'];
  const violentThreat = hitIds.some(id => VIOLENT_RULES.indexOf(id) >= 0);
  if (s >= 61 && !(chineseVictim || (chinaSig && hardTarget && violentThreat) || (chinaSig && deaths >= 5))) { s = 60; }
  if (!chinaSig && deaths >= 10 && s < 46) { s = 46; }
  const SUBSTANTIVE_NONVIOLENT = ['R-T08', 'R-T09', 'R-T15', 'R-T19'];
  if (chinaSig && hitIds.some(id => SUBSTANTIVE_NONVIOLENT.indexOf(id) >= 0) && s < 40) { s = 40; }
  const zone = s >= 61 ? 'red' : s >= 31 ? 'yellow' : 'green';
  const level = s >= 61 ? 'red' : s >= 46 ? 'orange' : s >= 31 ? 'yellow' : 'blue';
  return { s, zone, level, hits: hits.map(h => h.rule).join(',') };
}
const cases = [
  ['刚果金绑架中方人员', { title: '刚果（金）上加丹加省一中资矿企车辆遭武装人员拦截 数名中方员工被带走', content: '武装分子在刚果（金）上加丹加省Pweto地区拦截中资矿业公司车辆，数名中国员工被武装人员带走，下落不明。', country: '刚果（金）' }],
  ['巴铁恐袭中方车队', { title: '巴基斯坦俾路支省中方项目车队遭自杀式爆炸袭击 2名中国公民遇难', content: '瓜达尔港附近中方工程车队遇袭，2名中国公民死亡，俾路支解放军宣称负责。', country: '巴基斯坦' }],
  ['普通涉华抗议', { title: '秘鲁钱凯港附近社区居民抗议中资港口项目征地补偿', content: '当地社区居民举行示威，要求提高征地补偿标准，暂无暴力冲突。', country: '秘鲁' }],
  ['涉华舆论批评', { title: '美媒批评中国一带一路项目债务问题', content: '美国智库报告称中国一带一路项目存在债务陷阱风险。', country: '美国' }],
  ['非涉华重大恐袭', { title: '尼日利亚清真寺遭炸弹袭击 至少50人死亡', content: '尼日利亚东北部博尔诺州一清真寺发生自杀式爆炸，至少50人死亡。', country: '尼日利亚' }],
  ['非涉华一般枪击', { title: '墨西哥城发生枪击事件 2人死亡', content: '墨西哥城一酒吧发生枪击，2人死亡，警方调查贩毒集团关联。', country: '墨西哥' }],
  ['中企制裁', { title: '美国将多家中企列入实体清单', content: '美国商务部宣布将多家中国企业列入出口管制实体清单。', country: '美国' }],
  ['雅万高铁一般新闻', { title: '雅万高铁客流量创新高', content: '印尼雅万高铁开通以来客流量持续攀升。', country: '印度尼西亚' }],
  ['缅甸战乱逼近管道', { title: '缅甸掸邦武装冲突升级 中缅油气管道沿线警戒', content: '缅甸果敢同盟军与政府军在中缅油气管道沿线交火，中方项目营地加强戒备。', country: '缅甸' }],
  ['刚果金旧逻辑会红案例', { title: '刚果（金）东部冲突致15人死亡 联合国呼吁停火', content: '刚果（金）北基伍省武装冲突造成15人死亡，M23与政府军交火持续。', country: '刚果（金）' }]
];
for (const [name, c] of cases) {
  const r = score(c);
  console.log(name.padEnd(14, '　'), '=>', String(r.s).padStart(3), r.zone, '/', r.level, ' |', r.hits);
}
