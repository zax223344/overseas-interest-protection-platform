# -*- coding: utf-8 -*-
# 分类器修正：标题优先 + 综述体裁前置 + 去掉 ied 裸匹配
import io
p = 'server/server.js'
s = io.open(p, encoding='utf-8').read()

old = """function _classifyIntelType(it) {
  const t = (String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || '')).toLowerCase();
  if (/恐袭|恐怖|爆炸|绑架|劫持|人质|自杀式|枪手|武装分子|伏击|塔利班|基地组织|博科|青年党|terror|bomb|blast|explosion|kidnap|hostage|gunmen|militant|suicide|vbied|ied|ambush|isis|isil|taliban|qaeda|al-shabaab|boko haram/i.test(t)) return 'terror_events';"""
new = """/* 分类器 v2（2026-08-17 用户指令：什么数据放什么类别，别乱放）：
 * ① 标题优先——标题能定类就用标题，正文只作兜底（正文提及≠事件本体）；
 * ② 综述/评论/分析体裁前置——非事件类内容归地缘情报，不占事件类席位；
 * ③ 去掉 ied 裸匹配——ied 是 denied/studied/allied 的子串，曾经把一切含 denied 的文章误判成恐袭。 */
const _CLS_RULES = [
  ['terror_events', /恐袭|恐怖|爆炸|绑架|劫持|人质|自杀式|枪手|武装分子|伏击|塔利班|基地组织|博科|青年党|terror|bomb|blast|explosion|kidnap|hostage|gunmen|militant|suicide bomb|vbied|car bomb|ambush|isis|isil|taliban|qaeda|al-shabaab|boko haram/i],
  ['sanctions_data', /制裁|关税|出口管制|实体清单|黑名单|反倾销|反补贴|禁运|安全审查|sanction|tariff|export control|entity list|blacklist|anti-dumping|countervailing|embargo|cfius|uflpa/i],
  ['public_health', /疫情|病毒|传染病|霍乱|埃博拉|outbreak|epidemic|pandemic|virus|cholera|ebola|mpox/i],
  ['cyber_security', /网络攻击|数据泄露|勒索软件|黑客|漏洞利用|cyberattack|cyber attack|data breach|ransomware|malware|phishing|cve-|ddos/i],
  ['legal_compliance', /诉讼|仲裁|罚款|处罚|合规审查|监管|lawsuit|litigation|arbitration|penalty|compliance|regulatory|antitrust/i],
  ['economic_risk', /债务危机|通胀|汇率|金融|衰退|股市|央行|利率|debt crisis|inflation|recession|default|currency|central bank|interest rate|stock market/i],
  ['social_unrest', /抗议|示威|骚乱|暴动|罢工|宵禁|protest|riot|unrest|strike action|curfew|demonstration/i],
  ['political_events', /政变|军政府|选举|弹劾|政权更迭|coup|junta|election|impeach|president-elect|parliament/i],
  ['military_conflicts', /战争|空袭|导弹|交火|停火|炮击|无人机|军事行动|战线|war|airstrike|missile|ceasefire|shelling|artillery|drone strike|offensive|frontline/i],
  ['natural_disasters', /地震|洪水|台风|飓风|暴雨|海啸|火山|山火|earthquake|flood|typhoon|hurricane|tsunami|volcano|wildfire|cyclone/i],
  ['infrastructure', /港口|矿山|管道|铁路|大桥|电站|供应链|关键矿产|稀土|port|mine|mining|pipeline|railway|bridge|power plant|supply chain|critical mineral|rare earth|lithium|cobalt/i],
  ['security_events', /枪击|抢劫|谋杀|治安|被捕|shooting|robbery|murder|arrest/i],
  ['geopolitical_intel', /外交|会晤|协议|争端|紧张|沙文主义|diplomat|summit|treaty|dispute|tension|chauvinism/i]
];
const _CLS_GENRE_RE = /综述|社评|专栏|观察家|深度分析|盘点|回顾|展望|解读|opinion|editorial|analysis|review of|commentary|explained|chauvinism/i;
function _classifyIntelType(it) {
  const title = (String(it.title || '') + ' ' + String(it.title_zh || '')).toLowerCase();
  const all = title + ' ' + String(it.content || '').toLowerCase();
  /* 综述体裁：标题无明确突发事件词的，归地缘情报（不是事件） */
  if (_CLS_GENRE_RE.test(title) && !/爆炸|袭击|枪击|绑架|劫持|恐袭|地震|blast|attack|shooting|kidnap|hostage|killed/i.test(title)) {
    return 'geopolitical_intel';
  }
  /* 标题优先 */
  for (const [type, re] of _CLS_RULES) { if (re.test(title)) return type; }
  /* 正文兜底 */
  for (const [type, re] of _CLS_RULES) { if (re.test(all)) return type; }
  return 'osint_intel';
}
function _classifyIntelType_legacy(it) {
  const t = (String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || '')).toLowerCase();
  if (/恐袭|恐怖|爆炸|绑架|劫持|人质|自杀式|枪手|武装分子|伏击|塔利班|基地组织|博科|青年党|terror|bomb|blast|explosion|kidnap|hostage|gunmen|militant|suicide|vbied|ied|ambush|isis|isil|taliban|qaeda|al-shabaab|boko haram/i.test(t)) return 'terror_events';"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
