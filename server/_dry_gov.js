/* 公文版返工（09-02）离线干跑：验证 5 项修复。 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').split('\n');
const start = src.findIndex(l => l.indexOf('function _escapeHtml') === 0);
const end = src.findIndex(l => l.indexOf('async function _generateDailyReport') === 0);
const seg = src.slice(start, end).join('\n');
const stubs = `
const _SIG_COUNTRIES = ['马里','巴基斯坦','泰国','乌克兰','缅甸','以色列','阿富汗','尼日利亚','伊朗'];
function _regionToCountry(t){ return ''; }
const scrapers = { isChinaRelatedStrict: t => /中国|华人|中资| Chinese/.test(String(t)) };
`;
const build = new Function(stubs + seg + '\nreturn _buildGovDailyReport;')();

const mk = (id, type, title, country, severity, extra) => Object.assign({
  id: id, type: type, title: title, country: country,
  eventCountry: country, severity: severity, source: 'Google News·' + country,
  time: '2026-09-01 10:00', url: '', digest: '', china: /中国|华人/.test(title),
  assets: [], cred: 'B', corr: 1, negative: false, _sig: ''
}, extra || {});

const items = [
  /* 正向外交事件（红色也不进二节、不作代表/案例/威胁研判） */
  mk(1, 'geopolitical_intel', '中国Xi访问埃及，美国制裁威胁笼罩着伊朗联系', '伊朗', 'red', { corr: 2, digest: '中国国家主席Xi近平将于周二抵达埃及，这是一次罕见的中东之行。' }),
  mk(2, 'military_conflicts', '马里武装袭击致一名中国公民死亡两人受伤- 韩联社', '马里', 'red', { corr: 2, digest: '武装人员在马里北部路段袭击一支商队，造成一名中国公民死亡、两人受伤，救援力量已抵达现场处置。' }),
  /* 尼日利亚本地治安案：红色 + corr≥2（红色不豁免，一票排除） */
  mk(3, 'terror_events', '一名受伤的部队在Kogi营救被绑架的军团成员', '尼日利亚', 'red', { china: false, corr: 3, digest: '尼日利亚陆军12旅与警方协调联合行动，从科吉州森林中救出21名被绑架受害者。' }),
  mk(4, 'terror_events', '卡诺警方逮捕244名嫌疑人，追回武器，毒品，车辆', '尼日利亚', 'red', { china: false, digest: '卡诺州警方宣布开展治安专项行动。' }),
  /* 涉华治安案（保留代表事件资格，性质标治安执法）——干净 digest 使案例可测性质映射 */
  mk(5, 'security_events', '曼谷警方逮捕涉嫌假绑架勒索的华人团伙', '泰国', 'red', { digest: '曼谷警方开展专项行动，逮捕一个涉嫌自导假绑架向国内家属勒索赎金的华人团伙，多名嫌疑人被起诉。' }),
  /* digest 网页残留噪声案（案例应整段跳过）：非涉华、全球节 */
  mk(51, 'security_events', '胡齐斯坦省多地发生破坏活动- Tehran Times', '伊朗', 'orange', { china: false, digest: '当地媒体报道多起破坏事件 Facebook 电子邮件打印 分享 评论 相关阅读 ADVERTISEMENT。' }),
  mk(6, 'terror_events', '巴基斯坦白沙瓦发生针对华人商铺的恐怖袭击', '巴基斯坦', 'red', { assets: ['中巴经济走廊项目'], digest: '（记者张振安）白沙瓦市中心商业区发生爆炸袭击，多家华人商铺受损，袭击动机仍在调查中。此前，中国国家主席Xi近平向巴方表示慰问。' }),
  /* 09-02 第四轮：digest 与标题零交集（张冠李戴的人物故事）→ 案例整段跳过 */
  mk(11, 'security_events', '卡拉奇发生针对中资银行的持枪抢劫', '巴基斯坦', 'red', { china: true, digest: '多年来，他一直为路透社和加拿大新闻界工作，报道从政治丑闻到人类利益的故事。' }),
  mk(7, 'security_events', '巴基斯坦卡拉奇华人区治安事件增多', '巴基斯坦', 'orange', { negative: true }),
  mk(8, 'sanctions_data', '美财政部宣布对三家实体实施新一轮制裁', '美国', 'orange', { china: false, digest: '美国财政部海外资产控制办公室宣布将三家实体列入制裁清单，涉及跨境结算业务。' }),
  mk(9, 'military_conflicts', '俄军对乌克兰基辅实施大规模无人机打击', '乌克兰', 'red', { china: false, corr: 3, digest: '俄军于凌晨对基辅实施多波次无人机打击，市区多处基础设施受损。' }),
  mk(10, 'security_events', '巴基斯坦奎达发生路边爆炸袭击', '巴基斯坦', 'yellow', { china: false })
];
const meta = { sourceCount: 12, rawTotal: 300, trend7: [['2026-08-26', 40], ['2026-08-27', 55], ['2026-08-28', 48], ['2026-08-29', 62], ['2026-08-30', 71], ['2026-08-31', 88], ['2026-09-01', 12]], prevSummary: { total: 40, china: 6, negative: 2, red: 1, topCountries: [['乌克兰', 5], ['马里', 3], ['巴基斯坦', 2]] } };
const html = build('2026-09-01', items, meta, [], []);

const checks = [];
const has = (name, cond) => checks.push((cond ? 'PASS' : 'FAIL') + ' ' + name);
const sec2 = html.split('二、涉华重点事件')[1] || '';
const sec3 = (html.split('三、全球重大事件分析')[1] || '').split('四、地区风险动态')[0];
const sec6 = (html.split('六、对策建议')[1] || html.split('六、工作建议')[1] || '').split('drg-sign')[0];
const plain = s => s.replace(/<[^>]+>/g, '');

/* 返工断言 */
has('①尼日利亚Kogi营救案全文零出现（红色不豁免）', html.indexOf('Kogi') < 0 && html.indexOf('营救被绑架的军团成员') < 0);
has('①尼日利亚卡诺逮捕案全文零出现', html.indexOf('卡诺警方') < 0 && html.indexOf('244名嫌疑人') < 0);
has('②访问案无恐袭错标（属高层外交动态或已移出）', html.indexOf('访问埃及') < 0 || /高层外交动态/.test(html));
has('②逮捕案无恐袭错标（曼谷案标治安执法）', /曼谷警方[\s\S]{0,260}属当地治安执法/.test(plain(html)));
has('②曼谷案四维为涉我人员合规涉讼（非人员安全威胁）', /涉我人员维度，涉事人员合规与涉讼风险需关注/.test(html));
has('②恐袭案正确标恐袭（白沙瓦案）', /白沙瓦[\s\S]{0,260}属恐怖主义暴力袭击/.test(plain(html)));
has('②冲突案标武装冲突（乌克兰案非恐袭）', /乌克兰[\s\S]{0,60}方向[\s\S]{0,260}属武装冲突/.test(plain(html)));
has('②制裁案性质映射保留（sanc 分支+结算合规维度/建议模板在代码内）', /k: 'sanc'/.test(seg) && seg.indexOf('合规与结算维度') >= 0 && seg.indexOf('相关企业总部合规部门') >= 0);
has('③二节无正向外交事件（访问埃及不在二节）', plain(sec2).indexOf('访问埃及') < 0);
has('③访问案不作威胁研判（不出现复核安保/撤离建议）', plain(sec6).indexOf('访问埃及') < 0);
has('④噪声digest案跳过案例（胡齐斯坦案无案例段）', !/胡齐斯坦省多地发生破坏活动[^。]{0,5}一案：/.test(plain(html)));
has('④泰国案干净digest正常出案例', /曼谷警方[\s\S]{0,60}一案：/.test(plain(html)));
has('④③记者署名括注剥离（（记者张振安）零残留）', html.indexOf('记者张振安') < 0);
/* 09-02 第四轮修单断言 */
has('新①digest与标题零交集案跳过案例（卡拉奇案无案例段）', !/卡拉奇发生针对中资银行[^。]{0,5}一案：/.test(plain(html)));
has('新①全文零省略号', html.indexOf('\u2026') < 0);
has('新②建议无【宏观】【微观】标签', sec6.indexOf('【宏观】') < 0 && sec6.indexOf('【微观】') < 0);
has('新③微观建议按性质匹配（曼谷law案→使领馆领事司法类，非撤离模板）', (function () {
  const m = plain(sec6).match(/针对泰国“曼谷警方[^：]*：建议([^。]*)。/);
  return m ? /属地使领馆领事部门/.test(m[1]) && !/撤离触发条件/.test(m[1]) : false;
})());
has('新③微观建议按性质匹配（白沙瓦terror案→24小时内安保撤离模板）', (function () {
  const m = plain(sec6).match(/针对巴基斯坦“白沙瓦[^：]*：建议([^。]*)。/);
  return m ? /属地使领馆、企业总部安保部门于24小时内/.test(m[1]) && /撤离触发条件/.test(m[1]) : false;
})());
has('新③建议无复读（无重复条目，撤离触发条件整词≤1次）', (function () {
  const entries = plain(sec6).split(/（\d+）/).filter(x => x.trim().length > 10).map(x => x.trim());
  const uniq = new Set(entries);
  return uniq.size === entries.length && (plain(sec6).match(/撤离触发条件/g) || []).length <= 1;
})());
/* ===== 09-02 指南重构断言 ===== */
const absTxt = (plain(html).split('内容提要：')[1] || '').split('一、总体态势')[0];
has('指南①内容提要存在且150-320字', absTxt.length >= 150 && absTxt.length <= 320);
has('指南①提要首句给最重要结论（总体定性先行）', /^当日(涉华安全风险|总体态势)/.test(absTxt.trim()));
has('指南①提要含关键判断+总体对策', /重点关注|暂无集中风险方向/.test(absTxt) && /建议/.test(absTxt));
has('指南②金钩子节标题（一/二节携关键判断）', /一、总体态势：/.test(plain(html)) && /二、涉华重点事件研判：/.test(plain(html)));
has('指南②二级标题开门见山（判断先行）', /方向涉华安全事件：(红色事件集中|出现红色事件|橙色事件多发|以一般性动态为主)/.test(plain(html)));
has('指南③建议三要素（责任主体+时间节点齐备）', (function () {
  const items = (plain(sec6).match(/（\d+）[^（]+/g) || []).filter(s => /建议|涉及/.test(s));
  return items.length >= 3 && items.every(s => /(使领馆|安保部门|指挥部|承保机构|决策层|风险管理部门|研究部门|合规部门)/.test(s) && /(24小时内|本周内|一个月内)/.test(s));
})());
has('指南③第三轮修正：建议无短期/中期/长期分层标签', !/【(短期|中期|长期)/.test(plain(sec6)));
has('指南③建议完成语式（于X内完成：）', /于(24小时内|本周内|一个月内)完成：/.test(plain(sec6)));
has('指南④表名在表上（表1注于表格前）', /表1　当日核心指标汇总<\/div><div class="drg-tblwrap"><table/.test(html));
has('指南④数字规范（一名中国公民→1名中国公民）', plain(html).indexOf('1名中国公民') >= 0 && plain(html).indexOf('一名中国公民') < 0);
has('GB/T9704②版心CSS（37mm/28mm 天头订口+3号16pt+固定行距28.5pt）', /padding:37mm 26mm 35mm 28mm/.test(html) && /font-size:16pt/.test(html) && /line-height:28\.5pt/.test(html));
has('GB/T9704②@page版心（上37下35左28右26）', /@page\{size:A4;margin:37mm 26mm 35mm 28mm/.test(html));
has('GB/T9704②一级标题黑体3号不加粗', /drg-h1\{font-family:"黑体"[^}]*font-size:16pt;font-weight:400/.test(html));
has('GB/T9704②成文日期月日不编虚位（2026年9月2日非09月02日）', /2026年9月2日/.test(plain(html)) && !/09月0?2日/.test(plain(html)));
has('GB/T9704③版记首末粗线中间细线', /drg-fline thin/.test(html));
/* ===== 图表断言（用户追加：树形图/圆饼图/趋势图） ===== */
has('图①三图齐全（趋势折线/类型环形/国别树形 SVG）', (function () {
  const svgs = html.match(/<svg[^>]*>/g) || [];
  const trend = /<polyline points=/.test(html);
  const donut = /独立事件（件）/.test(html);
  const treemap = /fill="#8b1a1a"/.test(html);
  return svgs.length >= 3 && trend && donut && treemap;
})());
has('图①图1趋势图在提要后、一节标题前（先文后图：提要已述及）', (function () {
  const iAbs = html.indexOf('内容提要：'), iTrend = html.indexOf('图1　近7日独立事件量走势'), iH1 = html.indexOf('一、总体态势');
  return iAbs >= 0 && iTrend > iAbs && iTrend < iH1;
})());
has('图①图名在图下（figcap 紧随 fig 之后）', (function () {
  return /<div class="drg-fig">[\s\S]*?<\/svg><\/div><div class="drg-figcap">图\d/.test(html) && !/<div class="drg-figcap">图\d[\s\S]{0,40}<div class="drg-fig">/.test(html);
})());
has('图①图编号连续（图1、图2、图3 各出现一次）', (function () {
  const n = t => (plain(html).match(new RegExp('图' + t + '　', 'g')) || []).length;
  return n(1) === 1 && n(2) === 1 && n(3) === 1;
})());
has('图①树形图涉华高亮（巴基斯坦深红 #8b1a1a）', /fill="#8b1a1a"/.test(html));
has('图①零 canvas/外链依赖', html.indexOf('<canvas') < 0 && !/<script[^>]+src=/.test(html));
has('图①趋势图涨跌标注（+/-百分比）', /\+\d+\/\+\d+%|-\d+\/-\d+%/.test(html));
has('新④digest路径Xi词典（国家主席Xi近平→国家主席习近平）', plain(html).indexOf('国家主席习近平向巴方') >= 0 && plain(html).indexOf('中国Xi') < 0 && plain(html).indexOf('Xi近平') < 0);
has('④全文无网页残留词', !/(Facebook|电子邮件|打印)/i.test(html));
has('⑤Xi词典兜底（正文零Xi，剥离style后）', (function () {
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '');
  return body.indexOf('Xi') < 0;
})());
has('②恐袭案四维含人员安全', /白沙河|白沙瓦/.test(html) && /人员安全维度/.test(html));
has('②制裁案四维模板保留（合规与结算维度代码内，真实数据制裁案例触发）', seg.indexOf('合规与结算维度') >= 0);
/* 原断言不回归 */
has('R1 代表事件无「」引号', html.indexOf('「') < 0);
has('R2 无信源N家尾巴', sec2.indexOf('信源') < 0 && sec3.indexOf('信源') < 0);
has('R3 无经多源印证尾巴', html.indexOf('经多源印证') < 0);
has('R4 无病句', !/分析事件\d+件的/.test(html) && /占比\d+%/.test(html));
has('R5 无媒体尾巴', html.indexOf('韩联社') < 0);
has('R6 建议无【宏观】【微观】标签（第四轮：标签全删）', sec6.indexOf('【宏观】') < 0 && sec6.indexOf('【微观】') < 0);
has('R7 建议无领保口吻', !/(值班|台账|督办|上报|领保|牵头)/.test(sec6));
has('R8 建议不超过5条', (sec6.match(/（\d+）/g) || []).length <= 5);
has('R9 含案例剖析段', /一案：/.test(html));
has('R10 研判认为逗号衔接', /研判认为，/.test(html));
has('R11 无摘录从略/采集编号', html.indexOf('摘录从略') < 0 && html.indexOf('采集编号') < 0);
console.log(checks.join('\n'));
console.log('--- 建议条数:', (sec6.match(/（\d+）/g) || []).length);
console.log('=== 二节样文 ===');
console.log(plain(sec2).replace(/\n{2,}/g, '\n').slice(0, 1800));
console.log('=== 三节样文 ===');
console.log(plain(sec3).replace(/\n{2,}/g, '\n').slice(0, 1200));
console.log('=== 六节样文 ===');
console.log(plain(sec6).replace(/\n{2,}/g, '\n').slice(0, 1200));
