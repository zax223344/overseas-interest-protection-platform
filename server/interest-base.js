/* interest-base.js — 中国海外利益底数库（2026-08-28 建设依据）
 * ================================================================
 * 依据官方框架（《国家安全法》第三十三条三大支柱 + 《总体国家安全观学习纲要》扩展 +
 * 《中国海外安全风险蓝皮书》COSRI 指标体系 + 2024年度中国对外直接投资统计公报）：
 *   ① 国家梯队分层：利益密度 × 风险等级 双维度（三层梯队）
 *   ② 重点项目库：六大类标志性工程全覆盖（铁路通道/港口节点/能源管道/清洁电力/民生工程/产业园区+新兴矿产）
 *   ③ 海上战略通道清单：咽喉点 + 中国依赖度
 * 用途：
 *   - server.js 采集分层调度：第一梯队国家更高频监测、通道事件专项归类
 *   - _tagAssets 锚定：每条安全事件自动关联「国家梯队+项目+通道」利益标签
 *   - 风险研判：事件落在哪个梯队国家/哪个项目/哪条通道 = 预警加权依据
 * 铁律：本文件是【底数档案】不是情报内容；数据来自公开统计口径，零虚构。
 * ================================================================ */

/* ============ 一、国家梯队（利益密度 × 风险等级） ============
 * TIER1 利益极重+风险极高：核心守护对象，采集最高频
 * TIER2 利益重大+风险中等：精细化运营
 * TIER3 经济利益为主+风险可控：常规监测
 * interests: 核心利益锚点；risks: 主要威胁（用于事件→风险关联研判） */
const COUNTRY_TIERS = {
  TIER1: [
    { cn: '巴基斯坦', iso: 'PK', interests: ['中巴经济走廊CPEC', '瓜达尔港', '能源电站集群', '默拉直流输电'], risks: ['恐怖袭击BLA/TTP/ISIS-K', '政局动荡', '印巴对峙'] },
    { cn: '俄罗斯', iso: 'RU', interests: ['亚马尔LNG', '中俄东线天然气管道', '欧亚战略支点'], risks: ['乌克兰危机外溢', '西方制裁'] },
    { cn: '哈萨克斯坦', iso: 'KZ', interests: ['2025最大投资接收国258亿美元', '铝铜项目', '中欧班列枢纽'], risks: ['中亚地缘博弈', '资源国有化'] },
    { cn: '沙特阿拉伯', iso: 'SA', interests: ['延布炼厂', '2030愿景对接', '中东能源枢纽'], risks: ['中东局势', '油价波动'] },
    { cn: '印度尼西亚', iso: 'ID', interests: ['雅万高铁', '青山工业园镍产业链', '东南亚最大经济体'], risks: ['资源民族主义', '南海争议'] }
  ],
  TIER2: [
    { cn: '印度', iso: 'IN', interests: ['边境贸易', '蓝皮书十大热点国', '中企合规陷阱高发区'], risks: ['边境对峙', '对华审查', '投资陷阱（赢了仲裁难执行）'] },
    { cn: '阿富汗', iso: 'AF', interests: ['CPEC 延伸安全关联', '矿产合作意向'], risks: ['塔利班政权', 'ISIS-K 恐袭', '中方人员遇袭史'] },
    { cn: '尼日利亚', iso: 'NG', interests: ['莱基深水港', '锂加工厂', '200家中资采矿企业'], risks: ['几内亚湾海盗', '北部恐袭', '矿区绑架'] },
    { cn: '刚果（金）', iso: 'CD', interests: ['卡莫阿铜矿', '钴矿供应链', '上加丹加矿业带'], risks: ['东部武装冲突', '治安事件'] },
    { cn: '伊朗', iso: 'IR', interests: ['能源贸易', '恰巴哈尔港衔接'], risks: ['制裁升级', '地区冲突'] },
    { cn: '伊拉克', iso: 'IQ', interests: ['油田服务', '重建工程'], risks: ['民兵袭击', '政局动荡'] },
    { cn: '越南', iso: 'VN', interests: ['制造业集群', '跨境铁路'], risks: ['南海摩擦', '政策变动'] },
    { cn: '泰国', iso: 'TH', interests: ['罗勇工业园', '中泰铁路'], risks: ['政治周期', '南部动荡'] },
    { cn: '马来西亚', iso: 'MY', interests: ['东海岸铁路ECRL', '关丹产业园'], risks: ['政局更迭', '汇率波动'] },
    { cn: '缅甸', iso: 'MM', interests: ['皎漂港', '中缅油气管道'], risks: ['内战冲突', '军政府管制'] },
    { cn: '斯里兰卡', iso: 'LK', interests: ['汉班托塔港', '科伦坡港口城'], risks: ['债务危机', '政局变动'] },
    { cn: '吉布提', iso: 'DJ', interests: ['保障基地', '吉布提港通道节点'], risks: ['地区冲突外溢'] },
    { cn: '埃及', iso: 'EG', interests: ['苏伊士经贸合作区', '苏伊士通道'], risks: ['汇率危机', '西奈恐袭'] },
    { cn: '埃塞俄比亚', iso: 'ET', interests: ['亚吉铁路', '工业园群'], risks: ['国内冲突', '族群紧张'] },
    { cn: '肯尼亚', iso: 'KE', interests: ['蒙内铁路', '东非枢纽'], risks: ['青年党恐袭外溢'] },
    { cn: '几内亚', iso: 'GN', interests: ['西芒杜铁矿', '凯乐塔水电'], risks: ['政变风险', '矿业政策'] },
    { cn: '秘鲁', iso: 'PE', interests: ['钱凯港', '矿业投资'], risks: ['社区抗议', '政策左转'] },
    { cn: '巴西', iso: 'BR', interests: ['美丽山特高压', '铁矿大豆贸易'], risks: ['环保合规', '汇率波动'] },
    { cn: '阿根廷', iso: 'AR', interests: ['锂矿投资', '水电工程'], risks: ['债务危机', '汇兑限制'] },
    { cn: '老挝', iso: 'LA', interests: ['中老铁路', '水电站群'], risks: ['债务压力', '治安薄弱'] },
    { cn: '柬埔寨', iso: 'KH', interests: ['西哈努克港经济特区'], risks: [' scam 园区治理', '大国博弈'] },
    { cn: '孟加拉国', iso: 'BD', interests: ['帕德玛大桥', '成衣供应链'], risks: ['政局动荡', '恐怖活动'] },
    { cn: '阿尔及利亚', iso: 'DZ', interests: ['光伏电站', '油气合作'], risks: ['汇率管制', '北部恐袭'] },
    { cn: '阿联酋', iso: 'AE', interests: ['马克图姆太阳能公园', '转口枢纽'], risks: ['地区冲突外溢'] },
    { cn: '希腊', iso: 'GR', interests: ['比雷埃夫斯港'], risks: ['劳工纠纷', '欧盟审查'] },
    { cn: '巴拿马', iso: 'PA', interests: ['巴拿马运河通道'], risks: ['运河当局仲裁', '外交转向'] },
    { cn: '乌兹别克斯坦', iso: 'UZ', interests: ['鹏盛工业园', '天然气合作'], risks: ['汇率波动'] },
    { cn: '塔吉克斯坦', iso: 'TJ', interests: ['农业纺织产业园'], risks: ['边境冲突', '恐怖渗透'] }
  ],
  TIER3: [
    { cn: '美国', iso: 'US', interests: ['海外公民机构', '金融投资', '上市企业'], risks: ['投资审查CFIUS', '对华脱钩', '制裁'] },
    { cn: '英国', iso: 'GB', interests: ['金融投资', '使馆经贸'], risks: ['对华审查', '舆论抹黑'] },
    { cn: '德国', iso: 'DE', interests: ['并购投资', '工业合作'], risks: ['欧盟审查', '去风险'] },
    { cn: '法国', iso: 'FR', interests: ['商贸投资'], risks: ['欧盟对华政策'] },
    { cn: '意大利', iso: 'IT', interests: ['经贸合作'], risks: ['一带一路立场反复'] },
    { cn: '荷兰', iso: 'NL', interests: ['转口投资', '半导体设备'], risks: ['出口管制'] },
    { cn: '加拿大', iso: 'CA', interests: ['矿业投资', '能源合作'], risks: ['对华审查', '锂矿政策'] },
    { cn: '澳大利亚', iso: 'AU', interests: ['铁矿锂矿', '达尔文港'], risks: ['安全审查', '中澳摩擦'] },
    { cn: '日本', iso: 'JP', interests: ['商贸', '金融投资'], risks: ['对华遏制跟随'] },
    { cn: '新加坡', iso: 'SG', interests: ['金融枢纽', '转口贸易'], risks: ['大国博弈选边'] },
    { cn: '塞尔维亚', iso: 'RS', interests: ['匈塞铁路', '钢厂合作'], risks: ['政局抗议', '欧盟压力'] },
    { cn: '匈牙利', iso: 'HU', interests: ['匈塞铁路', '新能源工厂'], risks: ['欧盟摩擦'] },
    { cn: '新西兰', iso: 'NZ', interests: ['农牧投资'], risks: ['五眼联盟对华政策'] },
    { cn: '智利', iso: 'CL', interests: ['锂铜矿', '高压输电'], risks: ['矿业政策', '社区抗议'] },
    { cn: '墨西哥', iso: 'MX', interests: ['制造业转移承接'], risks: ['治安犯罪', 'USMCA合规'] },
    { cn: '蒙古', iso: 'MN', interests: ['煤矿贸易', '铁路连接'], risks: ['政策摇摆'] },
    { cn: '莫桑比克', iso: 'MZ', interests: ['马普托大桥', ' LNG 项目'], risks: ['北部叛乱'] },
    { cn: '南非', iso: 'ZA', interests: ['德阿风电', '金融投资'], risks: ['电力危机', '治安犯罪'] },
    { cn: '安哥拉', iso: 'AO', interests: ['卡古路水电站', '石油贸易'], risks: ['汇率危机', '债务'] },
    { cn: '苏丹', iso: 'SD', interests: ['石油合作'], risks: ['内战', '撤离风险'] }
  ]
};

/* ============ 二、重点项目库（六大类全覆盖） ============
 * 依据：中科院《中国境外工程项目名录》+ AEI 中国全球投资追踪 + 材料中标志性工程。
 * 每条：名称 / 国别 / 类别 / 识别正则（中英文别名）。 */
const KEY_PROJECTS = [
  /* —— 1. 铁路与陆海通道 —— */
  { name: '中老铁路', country: '老挝', cat: 'rail', re: /中老铁路|中老昆万|china-laos railway|boten-vientiane/i },
  { name: '雅万高铁', country: '印度尼西亚', cat: 'rail', re: /雅万高铁|雅加达-万隆|jakarta-bandung|whoosh/i },
  { name: '匈塞铁路', country: '塞尔维亚', cat: 'rail', re: /匈塞铁路|belgrade-budapest|诺维萨德.*铁路/i },
  { name: '中吉乌铁路', country: '吉尔吉斯斯坦', cat: 'rail', re: /中吉乌铁路|china-kyrgyzstan-uzbekistan rail/i },
  { name: '中越跨境铁路', country: '越南', cat: 'rail', re: /中越.*铁路|越南.*跨境铁路/i },
  { name: '马来西亚东海岸铁路', country: '马来西亚', cat: 'rail', re: /东海岸铁路|东铁|ecrl|east coast rail/i },
  { name: '蒙内铁路', country: '肯尼亚', cat: 'rail', re: /蒙内铁路|mombasa-nairobi|肯尼亚.*sgr/i },
  { name: '亚吉铁路', country: '埃塞俄比亚', cat: 'rail', re: /亚吉铁路|addis ababa-djibouti railway/i },
  { name: '坦赞铁路', country: '坦桑尼亚', cat: 'rail', re: /坦赞铁路|tazara/i },
  { name: '中尼铁路', country: '尼泊尔', cat: 'rail', re: /中尼铁路|跨喜马拉雅/i },
  /* —— 2. 港口与海上战略节点 —— */
  { name: '瓜达尔港', country: '巴基斯坦', cat: 'port', re: /瓜达尔|gwadar/i },
  { name: '汉班托塔港', country: '斯里兰卡', cat: 'port', re: /汉班托塔|hambantota/i },
  { name: '皎漂港', country: '缅甸', cat: 'port', re: /皎漂|kyaukpyu/i },
  { name: '钱凯港', country: '秘鲁', cat: 'port', re: /钱凯|chancay/i },
  { name: '科伦坡港口城', country: '斯里兰卡', cat: 'port', re: /科伦坡港口城|colombo port city/i },
  { name: '比雷埃夫斯港', country: '希腊', cat: 'port', re: /比雷埃夫斯|piraeus/i },
  { name: '吉布提港', country: '吉布提', cat: 'port', re: /吉布提港|djibouti.*(port|base)|多哈雷/i },
  { name: '莱基深水港', country: '尼日利亚', cat: 'port', re: /莱基港|lekki (deep )?port/i },
  { name: '克里比深水港', country: '喀麦隆', cat: 'port', re: /克里比|kribi/i },
  { name: '达尔文港', country: '澳大利亚', cat: 'port', re: /达尔文港|darwin port/i },
  /* —— 3. 能源与跨境管道 —— */
  { name: '亚马尔LNG', country: '俄罗斯', cat: 'energy', re: /亚马尔|yamal lng/i },
  { name: '阿姆河天然气项目', country: '土库曼斯坦', cat: 'energy', re: /阿姆河天然气|amudarya gas/i },
  { name: '延布炼厂', country: '沙特阿拉伯', cat: 'energy', re: /延布炼厂|yanbu refinery/i },
  { name: '中俄东线天然气管道', country: '俄罗斯', cat: 'energy', re: /中俄东线|power of siberia|西伯利亚力量/i },
  { name: '中亚天然气管道', country: '乌兹别克斯坦', cat: 'energy', re: /中亚天然气管道|central asia.*gas pipeline|abc线/i },
  { name: '中缅油气管道', country: '缅甸', cat: 'energy', re: /中缅油气|中缅天然气|myanmar.*pipeline|皎漂.*管道/i },
  { name: '萨希瓦尔电站', country: '巴基斯坦', cat: 'energy', re: /萨希瓦尔|sahiwal/i },
  { name: '卡西姆港电站', country: '巴基斯坦', cat: 'energy', re: /卡西姆港|qasim.*power|port qasim/i },
  { name: '塔尔煤电', country: '巴基斯坦', cat: 'energy', re: /塔尔煤电|thar coal/i },
  { name: '达苏水电站', country: '巴基斯坦', cat: 'energy', re: /达苏|dasu (dam|hydropower)/i },
  { name: '默拉直流输电', country: '巴基斯坦', cat: 'energy', re: /默拉直流|matiari-lahore|ml-1.*输电/i },
  /* —— 4. 清洁电力与特高压 —— */
  { name: '美丽山特高压', country: '巴西', cat: 'power', re: /美丽山|belo monte.*(uhv|hvdc|transmission)/i },
  { name: '卡洛特水电站', country: '巴基斯坦', cat: 'power', re: /卡洛特|karot/i },
  { name: '卡拉奇K-2K-3核电', country: '巴基斯坦', cat: 'power', re: /k-2|k-3|卡拉奇核电|k2k3 nuclear/i },
  { name: '马克图姆太阳能公园', country: '阿联酋', cat: 'power', re: /马克图姆太阳能|mohammed bin rashid solar/i },
  { name: '德阿风电', country: '南非', cat: 'power', re: /德阿风电|de aar wind/i },
  { name: '苏阿皮蒂水电站', country: '几内亚', cat: 'power', re: /苏阿皮蒂|souapiti/i },
  { name: '凯乐塔水电站', country: '几内亚', cat: 'power', re: /凯乐塔|kaleta/i },
  { name: '卡古路卡巴萨水电站', country: '安哥拉', cat: 'power', re: /卡古路|caculo cabaca/i },
  { name: '智利高压直流线路', country: '智利', cat: 'power', re: /智利.*高压直流|kimal-lo agregado/i },
  /* —— 5. 桥梁与民生工程 —— */
  { name: '帕德玛大桥', country: '孟加拉国', cat: 'civic', re: /帕德玛大桥|padma bridge/i },
  { name: '佩列沙茨大桥', country: '克罗地亚', cat: 'civic', re: /佩列沙茨|peljesac bridge/i },
  { name: '中马友谊大桥', country: '马尔代夫', cat: 'civic', re: /中马友谊大桥|sinamale bridge/i },
  { name: '马普托大桥', country: '莫桑比克', cat: 'civic', re: /马普托大桥|maputo bridge|马普托-卡腾贝/i },
  { name: '阿达玛风电场', country: '埃塞俄比亚', cat: 'civic', re: /阿达玛风电|adama wind/i },
  { name: '阿尔及利亚光伏电站', country: '阿尔及利亚', cat: 'civic', re: /阿尔及利亚.*光伏/i },
  /* —— 6. 产业园区与经贸合作区 —— */
  { name: '中白工业园', country: '白俄罗斯', cat: 'park', re: /中白工业园|great stone|巨石工业园/i },
  { name: '泰中罗勇工业园', country: '泰国', cat: 'park', re: /罗勇工业园|rayong industrial/i },
  { name: '印尼青山工业园', country: '印度尼西亚', cat: 'park', re: /青山工业园|青山园区|tsingshan.*indonesia/i },
  { name: '鹏盛工业园', country: '乌兹别克斯坦', cat: 'park', re: /鹏盛工业园|pengsheng/i },
  { name: '中泰新丝路产业园', country: '塔吉克斯坦', cat: 'park', re: /新丝路.*产业园|塔吉克.*纺织园/i },
  { name: '马中关丹产业园', country: '马来西亚', cat: 'park', re: /关丹产业园|kuantan industrial/i },
  { name: '西哈努克港经济特区', country: '柬埔寨', cat: 'park', re: /西哈努克.*特区|sihanoukville special/i },
  { name: '苏伊士经贸合作区', country: '埃及', cat: 'park', re: /苏伊士.*经贸|teda egypt/i },
  { name: '拉沙卡伊经济区', country: '巴基斯坦', cat: 'park', re: /拉沙卡伊|rashakai/i },
  { name: '凤凰工业园', country: '特立尼达和多巴哥', cat: 'park', re: /特多.*凤凰|phoenix park/i },
  { name: '穆通钢厂', country: '玻利维亚', cat: 'park', re: /穆通钢厂|mutun steel/i },
  /* —— 7. 新兴战略资源 —— */
  { name: '西芒杜铁矿', country: '几内亚', cat: 'mineral', re: /西芒杜|simandou/i },
  { name: '卡莫阿铜矿', country: '刚果（金）', cat: 'mineral', re: /卡莫阿|kamoa/i },
  { name: '拉姆镍矿', country: '巴布亚新几内亚', cat: 'mineral', re: /拉姆镍|ramu nickel/i },
  { name: '尼日利亚锂加工厂', country: '尼日利亚', cat: 'mineral', re: /尼日利亚.*锂加工|nigeria.*lithium.*(plant|process)/i },
  { name: '哈萨克斯坦铝铜项目', country: '哈萨克斯坦', cat: 'mineral', re: /哈萨克.*(铝|铜)项目|kazakhstan.*(aluminium|copper) (project|mine)/i },
  { name: '中欧班列', country: '多国', cat: 'corridor', re: /中欧班列|china-europe freight|跨里海.*班列/i }
];

/* ============ 三、海上战略通道清单（咽喉点+依赖度） ============ */
const STRAIT_CHANNELS = [
  { name: '马六甲海峡', re: /马六甲|malacca/i, note: '中国石油运输必经，控制力有限' },
  { name: '霍尔木兹海峡', re: /霍尔木兹|hormuz/i, note: '中国约1/3进口原油经此' },
  { name: '曼德海峡-红海', re: /曼德|红海|bab el-mandeb|red sea/i, note: '中欧贸易大动脉（1600亿美元出口）' },
  { name: '苏伊士运河', re: /苏伊士运河|suez canal/i, note: '欧亚航运节点' },
  { name: '巴拿马运河', re: /巴拿马运河|panama canal/i, note: '中拉贸易通道' },
  { name: '台湾海峡', re: /台湾海峡|taiwan strait/i, note: '能源与贸易生命线' },
  { name: '几内亚湾', re: /几内亚湾|gulf of guinea/i, note: '西非油区海盗高发' },
  { name: '亚丁湾', re: /亚丁湾|gulf of aden/i, note: '护航行动区' }
];

/* ============ 四、海外经济利益底数（维度①）============
 * 数据口径：《2024年度中国对外直接投资统计公报》（商务部/统计局/外汇局）。
 * 用途：事件发生国 → 自动挂经济利益暴露标签（ODI存量级别/区域占比），研判"这事砸到我们多少利益"。 */
const ECONOMIC_BASE = {
  asOf: '2024年末',
  odiStockTotal: '3.14万亿美元（连续8年全球前三）',
  overseasEnterprises: '约5.2万家（190国），其中一带一路共建国1.9万家',
  regions: [
    { name: '亚洲', stock: '22044.8亿美元', share: '70.2%', key: ['中国香港(占亚洲87.1%)', '新加坡', '印度尼西亚', '泰国', '越南', '马来西亚', '老挝'] },
    { name: '拉丁美洲', stock: '5677.1亿美元', share: '18.1%', key: ['英属维尔京/开曼(合计96.3%)', '墨西哥', '秘鲁', '巴西', '阿根廷', '智利'] },
    { name: '欧洲', stock: '1691.8亿美元', share: '5.4%', key: ['荷兰', '英国', '德国', '俄罗斯', '匈牙利', '塞尔维亚'] },
    { name: '北美洲', stock: '1162.4亿美元', share: '3.7%', key: ['美国', '加拿大'] },
    { name: '非洲', stock: '438亿美元', share: '1.4%', key: ['南非', '刚果（金）', '尼日利亚', '埃塞俄比亚', '肯尼亚', '阿尔及利亚'] },
    { name: '大洋洲', stock: '385.2亿美元', share: '1.2%', key: ['澳大利亚', '巴布亚新几内亚'] }
  ],
  /* 2025 动向（官方发布口径）：投资重心转向非洲/中亚/中东 */
  trends2025: [
    { metric: '对非洲建设合同', change: '+283%' },
    { metric: '对中亚直接投资', change: '+375%' },
    { metric: '对东盟投资(2024)', change: '343.6亿美元 +36.8%' },
    { metric: '对欧洲投资(2024)', change: '+25.3%' },
    { metric: '对拉美投资(2024)', change: '+15.4%' }
  ],
  /* 国家→区域经济暴露映射（事件标注用） */
  /* 国家→区域经济暴露映射（显式表，防"几内亚"子串误中"巴布亚新几内亚"） */
  _countryRegion: {
    '中国香港': '亚洲', '新加坡': '亚洲', '印度尼西亚': '亚洲', '泰国': '亚洲', '越南': '亚洲', '马来西亚': '亚洲', '老挝': '亚洲', '中国澳门': '亚洲', '柬埔寨': '亚洲', '缅甸': '亚洲', '菲律宾': '亚洲', '孟加拉国': '亚洲', '斯里兰卡': '亚洲', '尼泊尔': '亚洲', '巴基斯坦': '亚洲', '阿富汗': '亚洲', '印度': '亚洲', '哈萨克斯坦': '亚洲', '乌兹别克斯坦': '亚洲', '吉尔吉斯斯坦': '亚洲', '塔吉克斯坦': '亚洲', '土库曼斯坦': '亚洲', '蒙古': '亚洲', '伊朗': '亚洲', '伊拉克': '亚洲', '沙特阿拉伯': '亚洲', '阿联酋': '亚洲', '卡塔尔': '亚洲', '科威特': '亚洲', '阿曼': '亚洲', '巴林': '亚洲', '也门': '亚洲', '以色列': '亚洲', '巴勒斯坦': '亚洲', '约旦': '亚洲', '黎巴嫩': '亚洲', '叙利亚': '亚洲', '土耳其': '亚洲', '日本': '亚洲', '韩国': '亚洲', '朝鲜': '亚洲', '文莱': '亚洲', '马尔代夫': '亚洲',
    '墨西哥': '拉丁美洲', '秘鲁': '拉丁美洲', '巴西': '拉丁美洲', '阿根廷': '拉丁美洲', '巴拿马': '拉丁美洲', '智利': '拉丁美洲', '哥伦比亚': '拉丁美洲', '厄瓜多尔': '拉丁美洲', '玻利维亚': '拉丁美洲', '委内瑞拉': '拉丁美洲', '古巴': '拉丁美洲', '乌拉圭': '拉丁美洲', '巴拉圭': '拉丁美洲', '特立尼达和多巴哥': '拉丁美洲', '英属维尔京群岛': '拉丁美洲', '开曼群岛': '拉丁美洲',
    '荷兰': '欧洲', '英国': '欧洲', '卢森堡': '欧洲', '德国': '欧洲', '瑞典': '欧洲', '俄罗斯': '欧洲', '法国': '欧洲', '爱尔兰': '欧洲', '意大利': '欧洲', '瑞士': '欧洲', '西班牙': '欧洲', '匈牙利': '欧洲', '塞尔维亚': '欧洲', '波兰': '欧洲', '希腊': '欧洲', '克罗地亚': '欧洲', '罗马尼亚': '欧洲', '保加利亚': '欧洲', '捷克': '欧洲', '白俄罗斯': '欧洲', '乌克兰': '欧洲', '奥地利': '欧洲', '比利时': '欧洲', '葡萄牙': '欧洲', '挪威': '欧洲', '芬兰': '欧洲', '丹麦': '欧洲',
    '美国': '北美洲', '加拿大': '北美洲', '百慕大群岛': '北美洲',
    '南非': '非洲', '刚果（金）': '非洲', '刚果': '非洲', '尼日利亚': '非洲', '尼日尔': '非洲', '莫桑比克': '非洲', '安哥拉': '非洲', '毛里求斯': '非洲', '埃塞俄比亚': '非洲', '肯尼亚': '非洲', '阿尔及利亚': '非洲', '赞比亚': '非洲', '坦桑尼亚': '非洲', '埃及': '非洲', '加纳': '非洲', '几内亚': '非洲', '苏丹': '非洲', '南苏丹': '非洲', '索马里': '非洲', '马里': '非洲', '布基纳法索': '非洲', '乍得': '非洲', '喀麦隆': '非洲', '塞内加尔': '非洲', '摩洛哥': '非洲', '突尼斯': '非洲', '利比亚': '非洲', '中非': '非洲', '吉布提': '非洲', '卢旺达': '非洲', '乌干达': '非洲', '津巴布韦': '非洲', '刚果共和国': '非洲',
    '澳大利亚': '大洋洲', '新西兰': '大洋洲', '巴布亚新几内亚': '大洋洲', '萨摩亚': '大洋洲', '斐济': '大洋洲', '马绍尔群岛': '大洋洲', '所罗门群岛': '大洋洲'
  },
  countryExposure(cn) {
    const c = String(cn || '');
    const rn = this._countryRegion[c];
    if (!rn) return null;
    const r = this.regions.find(x => x.name === rn);
    return r || null;
  }
};

/* ============ 五、海外人员与机构底数（维度②）============
 * 口径：外交部/教育部/商务部公开统计 + 使领馆公开名录。
 * 用途：事件国 → 人员机构暴露标签（有多少同胞/企业/使领馆在该国）。 */
const PERSONNEL_BASE = {
  asOf: '2024-2025公开口径',
  totals: {
    overseasEnterprises: '约5.2万家境外企业',
    beltRoadEnterprises: '一带一路共建国1.9万家',
    chineseStudents: '海外留学人员超百万（教育部口径）',
    outboundTourists: '年度出境游客1.46亿人次级（2019峰值口径）',
    embassiesConsulates: '全球170+驻外使领馆',
    cooperationZones: '46国100+境外经贸合作区，上缴东道国税费超133亿美元'
  },
  /* 重点国人员机构暴露（公开报道口径，供研判参考） */
  countryFootprint: {
    '巴基斯坦': ['CPEC直接投资250亿美元+', '创造就业23万+', '中方人员密集'],
    '尼日利亚': ['约200家中资采矿企业', '中北部矿区中方人员集中'],
    '俄罗斯': ['能源项目中方工程人员', '中资贸易企业密集'],
    '印度尼西亚': ['青山园区产业链中方员工', '雅万高铁运营人员'],
    '哈萨克斯坦': ['258亿美元项目包中方工程人员'],
    '刚果（金）': ['矿业中方人员（上加丹加/东部风险区）'],
    '泰国': ['罗勇工业园中资企业+', '旅游业中国游客密集'],
    '法国': ['留学生与游客密集（2024袭击案多发）'],
    '韩国': ['中国留学生约7万'],
    '美国': ['留学生最密集目的地', '上市中概股企业'],
    '澳大利亚': ['留学生与矿业投资人员'],
    '南非': ['中资企业密集（约翰内斯堡治安高风险）'],
    '安哥拉': ['中资工程人员密集'],
    '苏丹': ['内战撤离高风险国']
  },
  footprintOf(cn) {
    return this.countryFootprint[String(cn || '')] || null;
  }
};

/* ============ 六、东道国风险指标底数（维度④）============
 * 口径：参照《中国海外安全风险蓝皮书》COSRI 四维框架（政治/经济/社会/公共安全），
 * 分值 1-10（10 为最高风险），为公开研判口径的综合评级，非实时数据。
 * 用途：事件国风险背景叠加 + 前端国家风险档案展示。 */
const COUNTRY_RISK_INDICATORS = {
  asOf: '2025研判口径',
  dims: ['political', 'economic', 'social', 'security'],
  dimNames: { political: '政治风险', economic: '经济风险', social: '社会风险', security: '公共安全' },
  scores: {
    '巴基斯坦': { political: 8, economic: 7, social: 8, security: 9 },
    '阿富汗': { political: 9, economic: 9, social: 9, security: 10 },
    '俄罗斯': { political: 8, economic: 7, social: 6, security: 7 },
    '哈萨克斯坦': { political: 5, economic: 5, social: 4, security: 4 },
    '沙特阿拉伯': { political: 5, economic: 4, social: 5, security: 6 },
    '印度尼西亚': { political: 5, economic: 5, social: 5, security: 5 },
    '尼日利亚': { political: 7, economic: 7, social: 7, security: 9 },
    '刚果（金）': { political: 8, economic: 8, social: 8, security: 10 },
    '苏丹': { political: 9, economic: 9, social: 9, security: 10 },
    '缅甸': { political: 9, economic: 8, social: 8, security: 8 },
    '伊朗': { political: 7, economic: 8, social: 7, security: 7 },
    '伊拉克': { political: 7, economic: 6, social: 7, security: 8 },
    '叙利亚': { political: 9, economic: 9, social: 9, security: 10 },
    '也门': { political: 9, economic: 9, social: 9, security: 10 },
    '索马里': { political: 9, economic: 9, social: 9, security: 10 },
    '马里': { political: 8, economic: 7, social: 8, security: 9 },
    '布基纳法索': { political: 8, economic: 7, social: 8, security: 9 },
    '尼日尔': { political: 8, economic: 7, social: 7, security: 8 },
    '埃塞俄比亚': { political: 7, economic: 7, social: 7, security: 7 },
    '海地': { political: 9, economic: 9, social: 8, security: 10 },
    '委内瑞拉': { political: 8, economic: 9, social: 8, security: 8 },
    '孟加拉国': { political: 7, economic: 6, social: 7, security: 6 },
    '斯里兰卡': { political: 6, economic: 7, social: 6, security: 5 },
    '埃及': { political: 6, economic: 6, social: 6, security: 6 },
    '阿尔及利亚': { political: 5, economic: 5, social: 5, security: 6 },
    '越南': { political: 4, economic: 4, social: 4, security: 4 },
    '泰国': { political: 6, economic: 4, social: 5, security: 5 },
    '马来西亚': { political: 4, economic: 4, social: 4, security: 4 },
    '菲律宾': { political: 5, economic: 5, social: 5, security: 6 },
    '柬埔寨': { political: 5, economic: 5, social: 5, security: 5 },
    '老挝': { political: 4, economic: 5, social: 4, security: 4 },
    '肯尼亚': { political: 5, economic: 5, social: 5, security: 6 },
    '坦桑尼亚': { political: 4, economic: 5, social: 4, security: 5 },
    '几内亚': { political: 7, economic: 6, social: 6, security: 6 },
    '莫桑比克': { political: 6, economic: 6, social: 6, security: 7 },
    '秘鲁': { political: 6, economic: 5, social: 6, security: 6 },
    '巴西': { political: 5, economic: 5, social: 6, security: 6 },
    '阿根廷': { political: 6, economic: 8, social: 6, security: 5 },
    '墨西哥': { political: 6, economic: 5, social: 6, security: 8 },
    '美国': { political: 5, economic: 3, social: 5, security: 5 },
    '英国': { political: 4, economic: 3, social: 4, security: 4 },
    '德国': { political: 4, economic: 3, social: 4, security: 4 },
    '法国': { political: 4, economic: 4, social: 5, security: 5 },
    '塞尔维亚': { political: 5, economic: 5, social: 4, security: 4 },
    '吉布提': { political: 4, economic: 5, social: 4, security: 5 },
    '澳大利亚': { political: 4, economic: 3, social: 3, security: 3 },
    '南非': { political: 6, economic: 6, social: 7, security: 8 },
    '安哥拉': { political: 6, economic: 7, social: 6, security: 6 },
    '乌兹别克斯坦': { political: 4, economic: 5, social: 4, security: 4 },
    '塔吉克斯坦': { political: 5, economic: 6, social: 5, security: 5 }
  },
  riskOf(cn) {
    return this.scores[String(cn || '')] || null;
  }
};

/* ============ 七、检索辅助 ============ */
function getTier(countryCn) {
  const c = String(countryCn || '');
  for (const t of ['TIER1', 'TIER2', 'TIER3']) {
    if (COUNTRY_TIERS[t].some(x => c.indexOf(x.cn) >= 0 || x.cn.indexOf(c) >= 0)) return t;
  }
  return null;
}
function matchProjects(text) {
  const t = String(text || '');
  return KEY_PROJECTS.filter(p => p.re.test(t));
}
function matchChannels(text) {
  const t = String(text || '');
  return STRAIT_CHANNELS.filter(s => s.re.test(t));
}

module.exports = { COUNTRY_TIERS, KEY_PROJECTS, STRAIT_CHANNELS, ECONOMIC_BASE, PERSONNEL_BASE, COUNTRY_RISK_INDICATORS, getTier, matchProjects, matchChannels };
