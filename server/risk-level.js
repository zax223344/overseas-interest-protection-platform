/* ============================================================
 * #724 P0-3 STEP 2 · 定级单一事实源（2026-09-09 深度问题清单整改）
 * ------------------------------------------------------------
 * 背景（_fix_plan.html 问题三）：level_norm 定级逻辑此前散在 4 个文件
 * （ai-watch.js:483 / china-terror.js:401,520 / enterprise-risk.js:287 /
 * intel-insight.js:43），同一事件在不同功能区可能得到不同级别——
 * 审计发现"态势总览与预警中心口径不一"的直接原因。
 * 本模块收敛三类口径：
 *   ① assessLevel(j, sev)  —— 消费方读取归一（level_norm 优先，severity
 *      兜底，非四色脏值回落 yellow）；四个功能区统一 require 此函数。
 *   ② red1Of / red2Of      —— 红区双条件闸（RED-1 涉华生命安全 /
 *      RED-2 重大地缘外溢），_scoreRiskItem 调用，R-Z05/R-Z06/R-Z07。
 *   ③ alertContentGate     —— 预警生成蓝区内容维度闸 + 体育文教否决，
 *      _srvAlertScore 调用（"总分≥10 且命中内容维度"才生成）。
 * 改这里 = 改全部功能区。禁止在业务文件内再写本地定级正则。
 * ============================================================ */

/* ---------- RED-1 涉华生命安全（红区准入 A 通道） ----------
 * 沿革：2026-08-27 红区铁律四类 → 08-28 扩主体/谓词 → 08-29 补英文双向分支
 * → #724 P0-3 扩"中资项目/营地/矿区遇袭、中国使领馆遇冲击"（原来此类
 * 只能封顶 60 分橙区，实战中瓜达尔港/中资矿区遇袭属"启动应急预案"级）。 */
const RED_ELIGIBLE_RE = /(?:中国公民|中方人员|中国工人|中国工程师|中国留学生|中国学生|中国游客|中国女子|中国妇女|中资企业员工|华人|华侨|华裔)[^，。；;]{0,25}(?:被袭|遭袭|受袭|遇袭|被袭击|被绑|遭绑架|被绑架|遭劫持|被劫持|被武装人员带走|被带走|被枪杀|被击毙|被杀害|遇害|被杀|遭杀害|遇刺|枪击|死亡|身亡|遇难|丧生|绑架|劫持|谋杀)|(?:遭绑架|被绑架|绑架|劫持|袭击|袭击造成|杀害|枪杀|绑架了|死亡|身亡|遇难)[^，。；;]{0,30}(?:中国公民|中方人员|中国工人|中国工程师|中国留学生|中国学生|中国游客|中国女子|中国妇女|中资企业员工|华人|华侨|华裔)|撤侨|撤离[^，。；;]{0,20}中国公民|遣返[^，。；;]{0,20}中国公民|群体开枪|大规模枪击|(?:chinese|china'?s?)[^,.!?;]{0,50}(?:nationals?|citizens?|workers?|engineers?|tourists?|students?|nationals|woman|man|people)[^,.!?;]{0,60}(?:kidnapp|abduct|attack|kill|shot|shoot|murder|dead|died|death|evacuat|injur)|(?:kidnapp|abduct|attack|kill|shot|shoot|murder|evacuat)[^,.!?;]{0,60}(?:chinese|china'?s?)[^,.!?;]{0,50}(?:nationals?|citizens?|workers?|engineers?|tourists?|students?|woman|man|people)|china[^,.!?;]{0,30}evacuat|evacuat[^,.!?;]{0,40}(?:chinese|china)|(?:中资|中方|中国)(?:项目|营地|营区|矿区|工地|公司|企业|商铺|农场)[^，。；;]{0,20}(?:遇袭|遭袭|受袭|被袭|被攻击|被袭击|被炮击|被炸|被抢劫|被闯入|遭洗劫|袭击)|(?:袭击|冲击|围困|打砸)[^，。；;]{0,25}(?:中资|中方|中国)(?:项目|营地|营区|矿区|工地|公司|企业|商铺|农场)|中国(?:驻|在)?[^，。；;]{0,8}(?:大使馆|使馆|领事馆|使领馆)[^，。；;]{0,20}(?:遇袭|遭袭|受袭|被袭|遭冲击|被冲击|被围|被砸|被掷|袭击|冲击|闯入)|(?:冲击|袭击|围困|闯入|打砸)[^，。；;]{0,20}中国(?:驻|在)?[^，。；;]{0,8}(?:大使馆|使馆|领事馆|使领馆)|chinese\s+(?:embassy|consulate|diplomatic)[^,.!?;]{0,60}(?:attack|storm|raid|vandal|mob|damaged)|(?:attack|storm|raid|vandaliz)[^,.!?;]{0,60}chinese\s+(?:embassy|consulate)/i;

/* ---------- RED-2 重大地溢（红区准入 B 通道，#724 P0-3 新增） ----------
 * 痛点：红海航运瘫痪、区域战争宣战级升级、≥20 死大规模恐袭此前全部封顶
 * 60 分橙区——重大地缘外溢事件对中资航运/项目的影响不亚于单点涉华遇袭。
 * 双条件（缺一不可）：
 *   ①烈度：≥20 死 或 战略设施/港口/国际航道受袭瘫痪；
 *   ②外溢：chinaSig ∨ TIER1 利益国 ∨ 命中海上战略通道。 */
const STRATEGIC_INFRA_RE = /(?:港口|国际机场|炼油厂|核电站|输油管道|天然气管道|变电站|电网|跨海大桥)[^，。；;]{0,25}(?:遭袭|遇袭|受袭|被袭|被炸|爆炸|瘫痪|损毁|被迫关闭)|(?:遭袭|遇袭|被袭|被炸|爆炸)[^，。；;]{0,25}(?:港口|国际机场|炼油厂|核电站|输油管道|天然气管道|变电站|电网|跨海大桥)|(?:红海|苏伊士|霍尔木兹|马六甲|曼德海峡|曼德|巴拿马运河|台湾海峡)[^，。；;]{0,40}(?:航运|航道|商船|油轮|货轮|通行|海域)?[^，。；;]{0,25}(?:瘫痪|中断|暂停|关闭|封锁|停摆|遇袭|遭袭|受袭|袭击|中断)|(?:航运|航道|海峡|运河)[^，。；;]{0,20}(?:瘫痪|全面中断|被迫暂停|全面关闭|遭封锁)|(?:red sea|suez|hormuz|malacca|bab al[- ]mandeb|panama canal|strait of hormuz|taiwan strait)[^.]{0,80}(?:attack|haltd|halt|suspend|disrupt|closed|blockade|shipping halted|shipping suspend)|(?:port|refinery|pipeline|power grid|international airport|crude terminal)[^.]{0,40}(?:attacked|bombed|shut down|crippled|halted|knocked out)/i;

/* ---------- 蓝区内容维度（预警生成准入的内容面要求） ---------- */
const CONTENT_DIM_CN_RE = /中国|中资|中企|中方|华人|华侨|华裔|一带一路|涉华|对华|撤侨|Chinese|China|Beijing|CPEC|Belt and Road/i;
const CONTENT_DIM_ASSET_RE = /瓜达尔|中巴经济走廊|汉班托塔|比雷埃夫斯|皎漂|中老铁路|雅万|蒙内|亚吉|钱凯|科伦坡港口城|中白工业园|吉布提|莱基|坦赞|西芒杜|中欧班列|China Railway Express/i;
const CONTENT_DIM_ORG_RE = /塔利班|青年党|博科圣地|伊斯兰国|基地组织|胡塞|真主党|哈马斯|俾路支|Taliban|Shabaab|Boko|ISIS|Qaeda|Houthi|BLA|TTP/i;
const CONTENT_DIM_SANCTION_RE = /实体清单|制裁清单|制裁措施|新增制裁|列入制裁|被制裁|经济制裁|SDN|OFAC|不可靠实体|sanctions?|sanctioned|entity list|export control|出口管制/i;
const DEATH_COUNT_RE = /(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:people\s+)?(?:killed|dead)|death toll[^\d]{0,10}(\d{1,4})/i;

/* ---------- 体育/文教否决正则（#724 P0-3 STEP 3 兜底） ----------
 * 实测噪音样本："国家曲棍球队输给中国队第四场练习赛"（含"中国"会命中涉华维度！
 * 故否决必须优先于维度判定）、"尼日利亚联邦政府必须解决扫盲危机"。
 * 例外：伤亡 ≥5 人的球场踩踏/骚乱是真实安全事件，不受否决。 */
const SPORTS_CULTURE_VETO_RE = /曲棍球|冰球|足球|篮球|排球|网球|棒球|联赛|锦标赛|练习赛|友谊赛|球赛|球星|球员|夺冠|世界杯|奥运会|奥运|亚运会|世乒赛|羽毛球|乒乓球|高尔夫|拳击赛|围甲|中超|英超|西甲|德甲|意甲|欧冠|美职篮|NBA|FIFA|票房|演唱会|音乐会|电视剧|综艺节目|真人秀|电影上映|扫盲|识字率|文盲率|文学|艺术展|博物馆|hockey|soccer|basketball|volleyball|tennis|cricket|league match|friendly match|world cup|olympic|box office|concert|literacy|literacy campaign/i;

function red1Of(t) {
  try { return RED_ELIGIBLE_RE.test(String(t || '')); } catch (e) { return false; }
}

/* RED-2 判定：ctx = { t(全文), deaths(伤亡数), chinaSig(涉华信号), channel_tags[], interest_tier } */
function red2Of(ctx) {
  try {
    const t = String((ctx && ctx.t) || '');
    const deaths = parseInt(ctx && ctx.deaths, 10) || 0;
    const infraHit = STRATEGIC_INFRA_RE.test(t);
    /* ① 烈度 */
    if (!(deaths >= 20 || infraHit)) return { hit: false, why: '' };
    /* ② 外溢 */
    const spillover = (ctx && ctx.chinaSig === true)
      || (ctx && ctx.interest_tier === 'TIER1')
      || (Array.isArray(ctx && ctx.channel_tags) && ctx.channel_tags.length > 0);
    if (!spillover) return { hit: false, why: '' };
    const why = (deaths >= 20 ? '重大伤亡' + deaths + '死' : '战略设施/国际航道受袭') + '+外溢通道（' +
      ((ctx && ctx.chinaSig === true) ? '涉华' : (ctx && ctx.interest_tier === 'TIER1') ? 'TIER1利益国' : '海上战略通道') + '）';
    return { hit: true, why };
  } catch (e) { return { hit: false, why: '' }; }
}

/* 预警生成内容维度闸：pass=false 则 _srvAlertScore 直接判 0 分（不生成） */
function alertContentGate(txt) {
  try {
    const t = String(txt || '');
    const dims = [];
    if (CONTENT_DIM_CN_RE.test(t)) dims.push('涉华');
    if (CONTENT_DIM_ASSET_RE.test(t)) dims.push('资产');
    if (CONTENT_DIM_ORG_RE.test(t)) dims.push('威胁组织');
    if (CONTENT_DIM_SANCTION_RE.test(t)) dims.push('制裁');
    const dm = t.match(DEATH_COUNT_RE);
    const deaths = dm ? parseInt(dm[1] || dm[2] || dm[3], 10) || 0 : 0;
    if (deaths > 0) dims.push('伤亡');
    const vetoed = deaths < 5 && SPORTS_CULTURE_VETO_RE.test(t);
    return { dims, deaths, vetoed, pass: dims.length > 0 && !vetoed };
  } catch (e) { return { dims: [], deaths: 0, vetoed: false, pass: true }; }
}

/* 消费方读取归一：level_norm 优先，severity 兜底，非四色脏值回落 yellow。
 * 四个功能区（ai-watch / china-terror / enterprise-risk / intel-insight）
 * 的本地定级逻辑统一替换为调用此函数——一处改、处处改。 */
function assessLevel(j, sev) {
  const l = String((j && j.level_norm) || sev || 'yellow').toLowerCase();
  return l === 'red' || l === 'orange' || l === 'yellow' || l === 'blue' ? l : 'yellow';
}

/* 当前定级引擎版本：#724 P0-3 红区双闸+蓝区内容闸落地 = 4。
 * 预警队列存量条目（_riskVersion<4）由 _serverAlertGen 的版本化回填机制重算。 */
const RISK_VERSION = 4;

module.exports = {
  RED_ELIGIBLE_RE, STRATEGIC_INFRA_RE, SPORTS_CULTURE_VETO_RE,
  CONTENT_DIM_CN_RE, CONTENT_DIM_ASSET_RE, CONTENT_DIM_ORG_RE, CONTENT_DIM_SANCTION_RE,
  red1Of, red2Of, alertContentGate, assessLevel, RISK_VERSION
};
