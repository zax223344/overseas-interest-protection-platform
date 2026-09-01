/* fixNames 规则单元验证：正例（应修）+ 反例（绝不误修） */
'use strict';
const z = require('./zh-polish');
const out = [];
const mustFix = [
  ['中国Xi访问埃及，美国制裁威胁笼罩着伊朗联系', /中国习近平访问埃及/],
  ['中国国家主席Xi近平正在埃及访问，这是一次罕见的埃及之行。', /国家主席习近平正在埃及访问/],
  ['Xi近平向唐纳德·特朗普（Donald Trump）承诺中国不会武装伊朗', /习近平向唐纳德·特朗普承诺/],
  ['Xi表示中国准备加强乌克兰，中东和阿富汗的和平努力', /习近平表示/],
  ['Xi敦促上海合作组织优先考虑安全和打击恐怖威胁', /习近平敦促/],
  ['中国Xi登陆埃及，伊朗战争重塑中东联盟', /中国领导人习近平登陆埃及/],
  ['中国媒体将Xi的埃及之行视为深化全球南方关系的推动力', /将习近平的埃及之行/],
  ['中国的Xi将参加在吉尔吉斯斯坦举行的上海合作组织峰会', /中国的习近平将参加/],
  ['Xi十年来首次访问埃及，出席吉尔吉斯斯坦峰会', /习近平十年来首次访问/],
  ['Xi信号蔑视美国威胁制裁伊朗的支持', /习近平信号蔑视/],
  ['Xi启程参加上海合作组织峰会，对吉尔吉斯斯坦，埃及进行国事访问', /习近平启程/],
  ['Xi解雇了想要"给印度一个教训"的将军', /习近平解雇/],
  ['分析：特朗普对伊朗的经济战争需要中国。祝Xi好运', /祝习近平好运/],
  ['特朗普和Xi缓和了贸易战，但中国峰会…', /特朗普和习近平缓和/],
  ['普京和Xi在北京峰会后拒绝对朝鲜…', /普京和习近平在北京峰会/],
  ['金正恩和Xi同意在各个领域加强朝中合作', /金正恩和习近平同意/],
  ['诺沃亚应Xi邀请于8月16日至23日访华', /应习近平邀请/],
  ['Xi在平壤的顺安国际机场…', /习近平在平壤/],
  ['官方媒体报道说，Xi的得力助手蔡奇…', /习近平的得力助手/],
  ['Xi即将访问朝鲜之际，中国…', /习近平即将访问朝鲜/],
  ['塞西在开罗接待Xi近平，中国国家主席开始十年来首次访问埃及', /接待习近平/],
  ['习近平出访前在金字塔报撰文盛赞埃中关系', /习近平出访前/, true],
  ['Zelensky试图通过Umerov的任命将穆斯林世界拖入乌克兰的冲突', /泽连斯基试图/],
  ['印度人在最近的俄罗斯对乌克兰的袭击中丧生：Zelenskyy', /丧生：泽连斯基/],
  ['习、莫迪、普京将在吉尔吉斯斯坦会晤：上海合作组织峰会看点', /习近平、莫迪、普京/],
  ['Xi Jinping可能会访问印度参加金砖国家峰会', /习近平可能会访问印度/],
  ['与Xi Jinping的会晤', /与习近平的会晤/],
  ['尽管Xi承诺不使用武器，中国仍帮助伊朗削弱美国的空中优势', /尽管习近平承诺/],
  ['Xi在吉尔吉斯斯坦媒体发表的署名文章全文', /习近平在吉尔吉斯斯坦媒体/],
  ['Xi结束朝鲜之行参观了友谊塔', /习近平结束朝鲜之行/],
  ['Xi乘坐的专机抵达平壤顺南国际机场', /习近平乘坐的专机/],
  ['Xi会见Kim时，李明…', /习近平会见Kim/],
  ['印度官员没有证实Xi和莫迪是否会在上海…', /证实习近平和莫迪/],
  ['在Xi预计访问美国之前，特朗普…', /在习近平预计访问/],
  ['彭博社报道，在Xi - 特朗普会谈前…', /在习近平 ?- ?特朗普会谈/],
  ['政治局会议开始时，Xi，中国国家主席、中…', /习近平，中国国家主席/],
  ['对Xi来说，特朗普专注于…', /对习近平来说/],
  ['央视报道说，Xi说，捍卫社会主义制度…', /习近平说，捍卫/],
  ["中国's Xi arrives in 吉尔吉斯斯坦", /中国的习近平/],
  /* 中英混排句式（digest 实测残留模式） */
  ["Xi calls for upgrading practical ties with 吉尔吉斯斯坦", /习近平 calls for upgrading/],
  ["Xi says 中国 ready to work with 吉尔吉斯斯坦 to enhance alignment", /习近平 says 中国/],
  ["Xi arrives in 吉尔吉斯斯坦 for SCO summit, state visit", /习近平 arrives in/],
  ["Chinese President Xi welcomed by 吉尔吉斯斯坦 counterpart in Bishkek", /President 习近平 welcomed/],
  ["普京, Xi hold talks in 吉尔吉斯斯坦 as regional summit begins", /普京, 习近平 hold talks/],
  ["普京, Xi, Pezeshkian to attend summit in 吉尔吉斯斯坦", /普京, 习近平, Pezeshkian/],
  ["Xi to Make First 埃及 Trip in Decade, Attend 吉尔吉斯斯坦 Summit", /习近平 to Make First 埃及/],
  ["Chinese media cast Xi's 埃及 visit as push for deeper Global South", /cast 习近平的 埃及 visit/],
  ["Xinhua Headlines: Xi kicks off state visit to 吉尔吉斯斯坦", /Xinhua Headlines: 习近平 kicks off/],
  ["Xi signals defiance as 美国 threatens sanctions for 伊朗 support", /习近平 signals defiance/],
  /* 中文逗号列举 / 动词补全 / 谐音错译 */
  ['普京，Xi，佩泽什基安参加在吉尔吉斯斯坦举行的峰会，巴基斯坦和印度领导人也参加了- TRT', /普京，习近平，佩泽什基安/],
  ['普京，Xi设置为中亚峰会作为俄罗斯和中国寻求对抗西方的影响-法国24', /普京，习近平设置为/],
  ['“携手共创更加繁荣的未来”：思思呼吁在习近平访问之前加强中阿关系-金字塔在线', /习近平呼吁在习近平访问之前/],
];
const mustNot = [
  ['印度VS斯里兰卡Xi热身直播，广播：何时何地观看', /习近平/],           /* 板球 XI=11人队 */
  ['印度vs斯里兰卡Xi实时比分，练习赛第1天：SL 246/3 at Tea', /习近平/],
  ['Devdutt Padikkal在印度的热身赛中抨击世纪vs SL Xi', /习近平/],
  ['中国国防部发言人陈Xi周五表示，中国在南海黄岩岛附近举行军事演习', /习近平/], /* 陈姓人名 */
  ['人类正在考虑在Xi和Fergana之间开通航线', /习近平/],                  /* 地名 Xi */
  ['学习，是为了更好地理解', /习近平/],                                  /* 常用字"习"不受影响 */
  ['The President visited Egypt yesterday', /习近平|特朗普/],            /* 纯英文不动 */
  ['Sri Lanka XI beat India by 5 wickets in Colombo', /习近平/],
  ['Xinhua Headlines: 习近平 kicks off state visit', /习近平[nN]/],   /* Xinhua 本身不得被当 Xi 误伤 */
  ['Xiamen Airlines 和 南方航空 codeshare', /习近平/],                 /* Xi+后续字母不匹配 */
  ['网红思思呼吁粉丝理性消费，并提到了习近平语录', /习近平呼吁/],        /* 普通昵称"思思"不误伤 */
];
let pass = 0, fail = 0;
out.push('== 应修正例 ==');
for (const [input, expect, exactOk] of mustFix) {
  const got = z.fixNames(input);
  const ok = expect.test(got);
  if (ok) pass++; else { fail++; out.push('  FAIL: ' + JSON.stringify(input.slice(0, 45)) + ' => ' + JSON.stringify(got.slice(0, 55))); }
}
out.push('  (' + mustFix.length + ' 例，通过 ' + (mustFix.length - (fail - Math.max(0, fail))) + ')');
let f2 = 0;
out.push('== 反例（绝不误修） ==');
for (const [input, forbid] of mustNot) {
  const got = z.fixNames(input);
  if (forbid.test(got)) { f2++; out.push('  FAIL(误修): ' + JSON.stringify(input.slice(0, 45)) + ' => ' + JSON.stringify(got.slice(0, 55))); }
  else pass++;
}
out.push('== 幂等性 ==');
let idem = true;
for (const [input] of mustFix) { const a = z.fixNames(input); if (z.fixNames(a) !== a) { idem = false; out.push('  非幂等: ' + input.slice(0, 40)); } }
if (idem) pass++; else fail++;
out.push('');
out.push('PASS=' + pass + ' FAIL=' + (fail + f2) + (idem ? '' : ' (+幂等失败)'));
require('fs').writeFileSync(__dirname + '/_names_ut_out.txt', out.join('\n'), 'utf8');
console.log('done');
