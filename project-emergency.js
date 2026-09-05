/* ============================================================
 * 中资海外项目地理档案 + 国别应急指南数据库（2026-08-26）
 * ------------------------------------------------------------
 * 用途：① 风险监测功能区「项目风险地图」实时标注（真实坐标）
 *      ② 监测中心底部「应急指南」（撤离路线/避难所/使领馆）
 * 数据口径：
 *   - 坐标为项目真实所在地（城市/场区级，WGS84）；
 *   - 机场/海港为真实运营口岸（附 IATA 三字码）；
 *   - 使领馆为真实馆舍所在地；领保电话为领事直通车公开发布号码，
 *     未公开或变动频繁的一律以 +86-10-12308 全球领保热线兜底（不编造）；
 *   - 避难所为按实战原则推定的真实场所（使领馆馆区/中企设防营地/
 *     国际连锁酒店/国际机场/联合国驻地）。
 * 前后端同源：Node require()，浏览器 window.EMERGENCY_GUIDE。
 * ============================================================ */
(function (root) {
  'use strict';

  /* 外交部全球领事保护与服务应急热线（24小时，全场景兜底，真实） */
  var HOTLINE = { name: '外交部全球领事保护与服务应急热线', phone: '+86-10-12308', alt: '+86-10-65612308', hours: '24小时' };

  /* ============================================================
   * 一、项目地理档案：id → 坐标/所在省州/最近空港/最近海港
   * ============================================================ */
  var PROJECT_GEO = {
    /* 南亚 */
    CPEC:        { lat: 30.3753, lng: 67.0011, city: '奎达（走廊锚点）', province: '俾路支省', airport: { name: '真纳国际机场', iata: 'KHI', city: '卡拉奇' }, seaport: '卡拉奇港' },
    GWADAR:      { lat: 25.1264, lng: 62.3225, city: '瓜达尔', province: '俾路支省', airport: { name: '瓜达尔国际机场', iata: 'GWD', city: '瓜达尔' }, seaport: '瓜达尔港' },
    DASU:        { lat: 35.3200, lng: 73.1900, city: '达苏', province: '开伯尔-普什图省', airport: { name: '伊斯兰堡国际机场', iata: 'ISB', city: '伊斯兰堡' }, seaport: null },
    KAROT:       { lat: 33.3500, lng: 73.6000, city: '卡洛特（杰赫勒姆河）', province: '旁遮普省', airport: { name: '伊斯兰堡国际机场', iata: 'ISB', city: '伊斯兰堡' }, seaport: null },
    CHASHMA:     { lat: 32.3900, lng: 71.4600, city: '米安瓦利', province: '旁遮普省', airport: { name: '伊斯兰堡国际机场', iata: 'ISB', city: '伊斯兰堡' }, seaport: null },
    KANUPP:      { lat: 24.8500, lng: 66.7900, city: '卡拉奇', province: '信德省', airport: { name: '真纳国际机场', iata: 'KHI', city: '卡拉奇' }, seaport: '卡拉奇港' },
    ORANGELINE:  { lat: 31.5497, lng: 74.3436, city: '拉合尔', province: '旁遮普省', airport: { name: '阿拉马·伊克巴尔国际机场', iata: 'LHE', city: '拉合尔' }, seaport: null },
    SAHIWAL:     { lat: 30.6700, lng: 73.1000, city: '萨希瓦尔', province: '旁遮普省', airport: { name: '木尔坦国际机场', iata: 'MUX', city: '木尔坦' }, seaport: null },
    THAR:        { lat: 24.7000, lng: 70.1800, city: '伊斯兰科特', province: '信德省', airport: { name: '真纳国际机场', iata: 'KHI', city: '卡拉奇' }, seaport: '卡西姆港' },
    HAMBANTOTA:  { lat: 6.1228, lng: 81.1185, city: '汉班托塔', province: '南部省', airport: { name: '马塔拉国际机场', iata: 'HRI', city: '汉班托塔' }, seaport: '汉班托塔港' },
    COLOMBOPC:   { lat: 6.9344, lng: 79.8428, city: '科伦坡', province: '西部省', airport: { name: '班达拉奈克国际机场', iata: 'CMB', city: '科伦坡' }, seaport: '科伦坡港' },
    CHITTAGONG:  { lat: 22.3569, lng: 91.7832, city: '吉大港', province: '吉大港专区', airport: { name: '沙赫阿马纳国际机场', iata: 'CGP', city: '吉大港' }, seaport: '吉大港' },
    /* 东南亚 */
    CLR:         { lat: 17.9757, lng: 102.6331, city: '万象（铁路锚点）', province: '万象市', airport: { name: '瓦岱国际机场', iata: 'VTE', city: '万象' }, seaport: null },
    JBHSR:       { lat: -6.9175, lng: 107.6191, city: '万隆（高铁锚点）', province: '西爪哇省', airport: { name: '苏加诺-哈达国际机场', iata: 'CGK', city: '雅加达' }, seaport: '丹戎不碌港' },
    MOROWALI:    { lat: -2.0500, lng: 121.3500, city: '巴霍多皮', province: '中苏拉威西省', airport: { name: '莫罗瓦利机场', iata: 'MOH', city: '莫罗瓦利' }, seaport: 'IMIP园区专用码头' },
    ECRL:        { lat: 3.8077, lng: 103.3260, city: '关丹（铁路锚点）', province: '彭亨州', airport: { name: '吉隆坡国际机场', iata: 'KUL', city: '吉隆坡' }, seaport: '关丹港' },
    SIHANOUKVILLE:{ lat: 10.6103, lng: 103.5299, city: '西哈努克市', province: '西哈努克省', airport: { name: '西哈努克国际机场', iata: 'KOS', city: '西哈努克市' }, seaport: '西哈努克港' },
    NAMOU:       { lat: 20.9600, lng: 102.4500, city: '南欧江流域', province: '琅勃拉邦省', airport: { name: '琅勃拉邦国际机场', iata: 'LPQ', city: '琅勃拉邦' }, seaport: null },
    KYAUKPHYU:   { lat: 19.4264, lng: 93.5463, city: '皎漂', province: '若开邦', airport: { name: '皎漂机场', iata: 'KYP', city: '皎漂' }, seaport: '皎漂港' },
    MMPIPE:      { lat: 21.9588, lng: 96.0891, city: '曼德勒（管道锚点）', province: '曼德勒省', airport: { name: '曼德勒国际机场', iata: 'MDL', city: '曼德勒' }, seaport: '皎漂港（起点）' },
    LETPADAUNG:  { lat: 22.1085, lng: 95.1419, city: '蒙育瓦', province: '实皆省', airport: { name: '曼德勒国际机场', iata: 'MDL', city: '曼德勒' }, seaport: null },
    THAIRAIL:    { lat: 14.9799, lng: 102.0978, city: '呵叻（铁路锚点）', province: '呵叻府', airport: { name: '素万那普国际机场', iata: 'BKK', city: '曼谷' }, seaport: '林查班港' },
    /* 中亚/俄/中东欧 */
    CAGP:        { lat: 37.5942, lng: 62.3500, city: '加尔金内什气田', province: '马雷州', airport: { name: '阿什哈巴德国际机场', iata: 'ASB', city: '阿什哈巴德' }, seaport: null },
    CKU:         { lat: 40.5139, lng: 72.8161, city: '奥什（铁路锚点）', province: '奥什州', airport: { name: '奥什国际机场', iata: 'OSS', city: '奥什' }, seaport: null },
    YAMAL:       { lat: 71.2692, lng: 72.0722, city: '萨别塔', province: '亚马尔-涅涅茨自治区', airport: { name: '萨别塔机场', iata: 'SBT', city: '萨别塔' }, seaport: '萨别塔港' },
    ARCTICLNG2:  { lat: 71.5500, lng: 79.5000, city: '格达半岛', province: '亚马尔-涅涅茨自治区', airport: { name: '萨别塔机场', iata: 'SBT', city: '萨别塔' }, seaport: '萨别塔港' },
    POWERSIBERIA:{ lat: 50.2700, lng: 127.5400, city: '布拉戈维申斯克（管道锚点）', province: '阿穆尔州', airport: { name: '海兰泡机场', iata: 'BQS', city: '布拉戈维申斯克' }, seaport: null },
    BUDBEL:      { lat: 44.7866, lng: 20.4489, city: '贝尔格莱德', province: '贝尔格莱德市', airport: { name: '尼古拉·特斯拉国际机场', iata: 'BEG', city: '贝尔格莱德' }, seaport: null },
    SMEDEREVO:   { lat: 44.6628, lng: 20.9301, city: '斯梅代雷沃', province: '波杜那瓦州', airport: { name: '尼古拉·特斯拉国际机场', iata: 'BEG', city: '贝尔格莱德' }, seaport: null },
    BOR:         { lat: 44.1303, lng: 22.0986, city: '博尔', province: '博尔州', airport: { name: '尼古拉·特斯拉国际机场', iata: 'BEG', city: '贝尔格莱德' }, seaport: null },
    PELJESAC:    { lat: 42.9467, lng: 17.5317, city: '科尔马纳', province: '杜布罗夫斯克-内雷特瓦县', airport: { name: '杜布罗夫尼克机场', iata: 'DBV', city: '杜布罗夫尼克' }, seaport: '普洛切港' },
    PIRAEUS:     { lat: 37.9475, lng: 23.6371, city: '比雷埃夫斯', province: '阿提卡大区', airport: { name: '雅典国际机场', iata: 'ATH', city: '雅典' }, seaport: '比雷埃夫斯港' },
    GREATSTONE:  { lat: 53.8800, lng: 27.7300, city: '斯莫列维奇', province: '明斯克州', airport: { name: '明斯克国际机场', iata: 'MSQ', city: '明斯克' }, seaport: null },
    CATLHU:      { lat: 47.5316, lng: 21.6273, city: '德布勒森', province: '豪伊杜-比豪尔州', airport: { name: '布达佩斯国际机场', iata: 'BUD', city: '布达佩斯' }, seaport: null },
    CRE:         { lat: 51.4344, lng: 6.7623, city: '杜伊斯堡（班列锚点）', province: '北莱茵-威斯特法伦州', airport: { name: '杜塞尔多夫国际机场', iata: 'DUS', city: '杜塞尔多夫' }, seaport: '杜伊斯堡内河港' },
    /* 非洲 */
    SGR:         { lat: -4.0435, lng: 39.6682, city: '蒙巴萨（铁路锚点）', province: '蒙巴萨郡', airport: { name: '莫伊国际机场', iata: 'MBA', city: '蒙巴萨' }, seaport: '蒙巴萨港' },
    ADDISDJIBOUTI:{ lat: 9.0054, lng: 38.7636, city: '亚的斯亚贝巴（铁路锚点）', province: '亚的斯亚贝巴市', airport: { name: '博莱国际机场', iata: 'ADD', city: '亚的斯亚贝巴' }, seaport: '吉布提港（海路）' },
    TAZARA:      { lat: -6.7924, lng: 39.2083, city: '达累斯萨拉姆（铁路锚点）', province: '达累斯萨拉姆区', airport: { name: '朱利叶斯·尼雷尔国际机场', iata: 'DAR', city: '达累斯萨拉姆' }, seaport: '达累斯萨拉姆港' },
    BENGUELA:    { lat: -12.3483, lng: 13.5455, city: '洛比托（铁路锚点）', province: '本格拉省', airport: { name: '二月四日国际机场', iata: 'LAD', city: '罗安达' }, seaport: '洛比托港' },
    LEKKI:       { lat: 6.4470, lng: 4.0750, city: '莱基', province: '拉各斯州', airport: { name: '穆尔塔拉·穆罕默德国际机场', iata: 'LOS', city: '拉各斯' }, seaport: '莱基深水港' },
    ABUJARAIL:   { lat: 9.0765, lng: 7.3986, city: '阿布贾', province: '联邦首都区', airport: { name: '纳姆迪·阿齐基韦国际机场', iata: 'ABV', city: '阿布贾' }, seaport: null },
    KAMOA:       { lat: -10.7589, lng: 25.2167, city: '科卢韦齐西郊', province: '卢阿拉巴省', airport: { name: '科卢韦齐机场', iata: 'KWZ', city: '科卢韦齐' }, seaport: null },
    TENKE:       { lat: -10.6000, lng: 26.2500, city: '丰古鲁姆', province: '卢阿拉巴省', airport: { name: '卢本巴希国际机场', iata: 'FBM', city: '卢本巴希' }, seaport: null },
    KISANFU:     { lat: -10.7000, lng: 25.4000, city: '科卢韦齐地区', province: '卢阿拉巴省', airport: { name: '科卢韦齐机场', iata: 'KWZ', city: '科卢韦齐' }, seaport: null },
    CHAMBISHI:   { lat: -12.6400, lng: 28.0600, city: '谦比希', province: '铜带省', airport: { name: '恩多拉国际机场', iata: 'NLA', city: '恩多拉' }, seaport: null },
    SIMANDOU:    { lat: 8.5500, lng: -9.1500, city: '西芒杜山区', province: '恩泽雷科雷大区', airport: { name: '科纳克里国际机场', iata: 'CKY', city: '科纳克里' }, seaport: '科纳克里港' },
    EGYPTCBD:    { lat: 30.0175, lng: 31.7478, city: '新行政首都', province: '开罗省', airport: { name: '开罗国际机场', iata: 'CAI', city: '开罗' }, seaport: '苏伊士港' },
    DJIBOUTIBASE:{ lat: 11.5890, lng: 43.1280, city: '多哈雷', province: '吉布提市', airport: { name: '安布利国际机场', iata: 'JIB', city: '吉布提市' }, seaport: '多哈雷港' },
    MOZLNG:      { lat: -10.7833, lng: 40.4667, city: '帕尔马', province: '德尔加杜角省', airport: { name: '奔巴机场', iata: 'POL', city: '奔巴' }, seaport: '帕尔马近海码头' },
    /* 中东 */
    YASREF:      { lat: 24.0896, lng: 38.0637, city: '延布', province: '麦地那省', airport: { name: '延布机场', iata: 'YNB', city: '延布' }, seaport: '延布港' },
    HASSYAN:     { lat: 24.8200, lng: 55.0700, city: '哈斯彦', province: '迪拜酋长国', airport: { name: '阿勒马克图姆国际机场', iata: 'DWC', city: '迪拜' }, seaport: '杰贝阿里港' },
    ALDUQM:      { lat: 19.6534, lng: 57.7014, city: '杜库姆', province: '中部省', airport: { name: '杜库姆机场', iata: 'DQM', city: '杜库姆' }, seaport: '杜库姆港' },
    RUMAILA:     { lat: 30.5500, lng: 47.6800, city: '鲁迈拉', province: '巴士拉省', airport: { name: '巴士拉国际机场', iata: 'BSR', city: '巴士拉' }, seaport: '乌姆盖萨尔港' },
    HALFAYA:     { lat: 31.8500, lng: 47.4500, city: '哈法亚', province: '迈桑省', airport: { name: '巴士拉国际机场', iata: 'BSR', city: '巴士拉' }, seaport: '乌姆盖萨尔港' },
    MAJNOON:     { lat: 31.9500, lng: 47.6200, city: '马吉努', province: '巴士拉省', airport: { name: '巴士拉国际机场', iata: 'BSR', city: '巴士拉' }, seaport: '乌姆盖萨尔港' },
    /* 拉美 */
    CHANCAY:     { lat: -11.5628, lng: -77.2708, city: '钱凯', province: '利马大区', airport: { name: '豪尔赫·查韦斯国际机场', iata: 'LIM', city: '利马' }, seaport: '钱凯港' },
    LASBAMBAS:   { lat: -14.0900, lng: -72.3400, city: '科塔尔班巴斯', province: '阿普里马克大区', airport: { name: '库斯科国际机场', iata: 'CUZ', city: '库斯科' }, seaport: '马塔拉尼港' },
    TOROMOCHO:   { lat: -11.6200, lng: -76.1000, city: '莫罗科查', province: '胡宁大区', airport: { name: '豪尔赫·查韦斯国际机场', iata: 'LIM', city: '利马' }, seaport: '卡亚俄港' },
    BELOMONTE:   { lat: -3.1300, lng: -51.7900, city: '阿尔塔米拉', province: '帕拉州', airport: { name: '阿尔塔米拉机场', iata: 'ATM', city: '阿尔塔米拉' }, seaport: null },
    CAUCHARI:    { lat: -23.5200, lng: -66.8500, city: '高查瑞', province: '胡胡伊省', airport: { name: '胡胡伊机场', iata: 'JUJ', city: '圣萨尔瓦多-德胡胡伊' }, seaport: null },
    SANTACRUZ:   { lat: -50.3700, lng: -70.4500, city: '拉巴兰卡', province: '圣克鲁斯省', airport: { name: '里奥加耶戈斯机场', iata: 'RGL', city: '里奥加耶戈斯' }, seaport: null },
    ECUADORCCS:  { lat: -0.2000, lng: -77.7900, city: '埃尔查科', province: '纳波省', airport: { name: '苏克雷元帅国际机场', iata: 'UIO', city: '基多' }, seaport: null }
  };

  /* ============================================================
   * 二、国别应急指南：使领馆 / 口岸 / 分场景撤离路线 / 避难所 / 第三国
   * 电话口径：领事直通车公开发布的领保（值班）电话优先；变动频繁的馆
   * 不编造号码，统一以 +86-10-12308 兜底并注明。
   * ============================================================ */
  var COUNTRY_EMERGENCY = {
    '巴基斯坦': {
      embassy: { name: '中国驻巴基斯坦大使馆', city: '伊斯兰堡', addr: '伊斯兰堡外交使馆区', phone: '+92-315-6060000（领保热线）' },
      consulates: [
        { name: '驻卡拉奇总领事馆', city: '卡拉奇', phone: '+86-10-12308 转接' },
        { name: '驻拉合尔总领事馆', city: '拉合尔', phone: '+86-10-12308 转接' }
      ],
      airports: [
        { name: '伊斯兰堡国际机场', iata: 'ISB' }, { name: '真纳国际机场（卡拉奇）', iata: 'KHI' },
        { name: '阿拉马·伊克巴尔国际机场（拉合尔）', iata: 'LHE' }, { name: '瓜达尔国际机场', iata: 'GWD' }
      ],
      seaports: [{ name: '卡拉奇港' }, { name: '卡西姆港' }, { name: '瓜达尔港' }],
      routes: [
        { scene: '俾路支省安全恶化（瓜达尔/塔尔方向）', steps: ['项目营地集结点集中清点人员', '护卫车队沿 M-8/N-10 公路机动至卡拉奇（避免夜间行车）', '真纳国际机场（KHI）包机或商业航班撤离'], third: '阿联酋（迪拜）/ 卡塔尔（多哈）', note: '俾路支省空域受扰时以陆路进卡拉奇为主；必要时瓜达尔港海上撤至阿曼湾' },
        { scene: '开伯尔-普什图省冲突（达苏方向）', steps: ['营地就地避险，切断与外界非必要接触', '护卫车队经喀喇昆仑公路南下伊斯兰堡', '伊斯兰堡国际机场（ISB）撤离'], third: '阿联酋（迪拜）', note: '山区道路单一，出发前须巴军方安全走廊确认' },
        { scene: '信德省/旁遮普省大规模骚乱', steps: ['人员向使领馆馆区集中', '视情经拉合尔（LHE）或伊斯兰堡（ISB）机场撤离', '陆路通道中断时经卡拉奇港海上疏散'], third: '阿曼（马斯喀特）', note: '' }
      ],
      shelters: [
        { name: '中国驻巴使馆馆区（伊斯兰堡外交区）', note: '24小时武装警卫，可临时安置' },
        { name: '驻卡拉奇总领馆馆区', note: '信德省方向人员就近集结' },
        { name: '中资企业设防营地（瓜达尔港区/达苏营地）', note: '就地避险首选，储备72小时物资' },
        { name: '伊斯兰堡万豪酒店', note: '市中心安保最强国际酒店，过渡安置' }
      ],
      transit: ['阿联酋（迪拜）', '卡塔尔（多哈）', '阿曼（马斯喀特）'],
      note: '巴境内恐袭高发区为俾路支省与开伯尔-普什图省，中方人员出行须报备并配置安保护卫。'
    },
    '斯里兰卡': {
      embassy: { name: '中国驻斯里兰卡大使馆', city: '科伦坡', addr: '科伦坡7区', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '班达拉奈克国际机场（科伦坡）', iata: 'CMB' }, { name: '马塔拉国际机场（汉班托塔）', iata: 'HRI' }],
      seaports: [{ name: '科伦坡港' }, { name: '汉班托塔港' }],
      routes: [
        { scene: '南部省安全事件（汉班托塔方向）', steps: ['港区人员集中至港区办公楼/中方营地', '高速公路（E01）北上科伦坡', '班达拉奈克机场（CMB）撤离'], third: '新加坡 / 马来西亚（吉隆坡）', note: '汉班托塔机场（HRI）运力有限，仅作应急起降' },
        { scene: '全岛骚乱/宵禁', steps: ['就地避险并储备物资', '使馆统一协调下分批赴 CMB 机场', '海上通道：科伦坡港/汉班托塔港商船疏散'], third: '印度（金奈）', note: '' }
      ],
      shelters: [
        { name: '中国驻斯使馆馆区（科伦坡7区）', note: '' },
        { name: '汉班托塔港中方港区营地', note: '就地避险' },
        { name: '科伦坡香格里拉/肉桂湖畔酒店', note: '过渡安置' }
      ],
      transit: ['新加坡', '马来西亚（吉隆坡）', '印度（金奈）'],
      note: ''
    },
    '孟加拉国': {
      embassy: { name: '中国驻孟加拉国大使馆', city: '达卡', addr: '达卡巴里达拉外交区', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '沙阿贾拉勒国际机场（达卡）', iata: 'DAC' }, { name: '沙赫阿马纳国际机场（吉大港）', iata: 'CGP' }],
      seaports: [{ name: '吉大港' }, { name: '蒙格拉港' }],
      routes: [
        { scene: '吉大港方向安全事件', steps: ['隧道项目营地集中', 'N1 公路返回达卡或就近吉大港机场（CGP）', '经达卡（DAC）出境'], third: '泰国（曼谷）/ 新加坡', note: '' },
        { scene: '达卡大规模骚乱/政治动荡', steps: ['避开集会区域，进入使馆馆区', '视情陆路赴吉大港', '海路经吉大港出境'], third: '缅甸（仰光，陆路备选）', note: '边境口岸开放状态需实时确认' }
      ],
      shelters: [
        { name: '中国驻孟使馆馆区（巴里达拉外交区）', note: '' },
        { name: '达卡洲际酒店', note: '过渡安置' },
        { name: '吉大港项目中方营地', note: '就地避险' }
      ],
      transit: ['泰国（曼谷）', '新加坡', '马来西亚（吉隆坡）'],
      note: ''
    },
    '老挝': {
      embassy: { name: '中国驻老挝大使馆', city: '万象', addr: '万象市赛色塔县', phone: '+856-21-315100（使馆总机）' },
      consulates: [{ name: '驻琅勃拉邦总领事馆', city: '琅勃拉邦', phone: '+86-10-12308 转接' }],
      airports: [{ name: '瓦岱国际机场（万象）', iata: 'VTE' }, { name: '琅勃拉邦国际机场', iata: 'LPQ' }],
      seaports: [],
      routes: [
        { scene: '北部山区安全事件（南欧江/中老铁路北段）', steps: ['人员向最近铁路车站集中', '中老铁路动车组南下万象（铁路即撤离通道）', '瓦岱机场（VTE）出境'], third: '泰国（曼谷）/ 云南（磨憨口岸陆路回国）', note: '老挝局势总体稳定，陆路回国通道可靠' },
        { scene: '万象市区突发事件', steps: ['进入使馆馆区', '瓦岱机场（VTE）出境', '备选：友谊大桥陆路入泰国廊开'], third: '泰国（廊开/曼谷）', note: '' }
      ],
      shelters: [
        { name: '中国驻老使馆馆区（万象）', note: '' },
        { name: '驻琅勃拉邦总领馆馆区', note: '北部方向人员就近集结' },
        { name: '中老铁路万象站/车站设施', note: '铁路单位设防场所' }
      ],
      transit: ['泰国（曼谷）', '中国云南（磨憨口岸陆路）'],
      note: ''
    },
    '印度尼西亚': {
      embassy: { name: '中国驻印度尼西亚大使馆', city: '雅加达', addr: '雅加达南区', phone: '+62-21-5764135（使馆总机）' },
      consulates: [
        { name: '驻泗水总领事馆', city: '泗水', phone: '+86-10-12308 转接' },
        { name: '驻棉兰总领事馆', city: '棉兰', phone: '+86-10-12308 转接' },
        { name: '驻登巴萨总领事馆', city: '登巴萨', phone: '+86-10-12308 转接' }
      ],
      airports: [{ name: '苏加诺-哈达国际机场（雅加达）', iata: 'CGK' }, { name: '朱安达国际机场（泗水）', iata: 'SUB' }, { name: '莫罗瓦利机场', iata: 'MOH' }],
      seaports: [{ name: '丹戎不碌港（雅加达）' }, { name: '泗水丹戎佩拉港' }],
      routes: [
        { scene: '苏拉威西园区安全事件（青山园区方向）', steps: ['园区设防区域集中（IMIP园区有自备安保）', '园区专用机场/莫罗瓦利机场（MOH）包机', '经望加锡或直飞雅加达（CGK）出境'], third: '新加坡', note: 'IMIP 园区远离省会，撤离以空中通道为主' },
        { scene: '爪哇岛大规模骚乱（雅万高铁方向）', steps: ['人员向雅加达使领馆方向集中', '苏加诺-哈达机场（CGK）出境', '备选：爪哇岛东部经泗水（SUB）出境'], third: '新加坡 / 马来西亚（吉隆坡）', note: '' }
      ],
      shelters: [
        { name: '中国驻印尼使馆馆区（雅加达）', note: '' },
        { name: 'IMIP 园区中方管理区', note: '设防园区，就地避险' },
        { name: '雅加达香格里拉/丽思卡尔顿酒店', note: '过渡安置' }
      ],
      transit: ['新加坡', '马来西亚（吉隆坡）'],
      note: ''
    },
    '马来西亚': {
      embassy: { name: '中国驻马来西亚大使馆', city: '吉隆坡', addr: '吉隆坡安邦路使馆区', phone: '+60-3-21636853（领保热线）' },
      consulates: [
        { name: '驻槟城总领事馆', city: '槟城', phone: '+86-10-12308 转接' },
        { name: '驻哥打基纳巴卢总领事馆', city: '哥打基纳巴卢', phone: '+86-10-12308 转接' },
        { name: '驻古晋总领事馆', city: '古晋', phone: '+86-10-12308 转接' }
      ],
      airports: [{ name: '吉隆坡国际机场', iata: 'KUL' }, { name: '槟城国际机场', iata: 'PEN' }],
      seaports: [{ name: '巴生港' }, { name: '关丹港' }, { name: '槟城港' }],
      routes: [
        { scene: '东海岸铁路沿线安全事件', steps: ['工地人员向关丹/吉隆坡方向集中', '吉隆坡国际机场（KUL）出境', '备选：新山陆路入新加坡'], third: '新加坡', note: '马新第二通道/长堤陆路口岸24小时通行' }
      ],
      shelters: [
        { name: '中国驻马使馆馆区（吉隆坡安邦路）', note: '' },
        { name: '吉隆坡市中心国际酒店群（双子塔周边）', note: '过渡安置' },
        { name: '东铁项目各标段中方营地', note: '就地避险' }
      ],
      transit: ['新加坡', '泰国（曼谷）'],
      note: ''
    },
    '柬埔寨': {
      embassy: { name: '中国驻柬埔寨大使馆', city: '金边', addr: '金边市毛泽东大道', phone: '+855-23-720920（使馆总机）' },
      consulates: [{ name: '驻西哈努克领事办公室', city: '西哈努克市', phone: '+86-10-12308 转接' }],
      airports: [{ name: '金边国际机场', iata: 'PNH' }, { name: '西哈努克国际机场', iata: 'KOS' }],
      seaports: [{ name: '西哈努克港' }],
      routes: [
        { scene: '西港特区安全事件', steps: ['特区园区集中清点', '4号公路返回金边（约3小时车程）', '金边机场（PNH）出境'], third: '泰国（曼谷）/ 越南（胡志明市）', note: '西港机场（KOS）航班少，仅作应急起降' }
      ],
      shelters: [
        { name: '中国驻柬使馆馆区（金边）', note: '' },
        { name: '西港特区中方园区管理区', note: '就地避险' },
        { name: '金边索菲特/洲际酒店', note: '过渡安置' }
      ],
      transit: ['泰国（曼谷）', '越南（胡志明市）'],
      note: ''
    },
    '缅甸': {
      embassy: { name: '中国驻缅甸大使馆', city: '仰光', addr: '仰光市', phone: '+95-9-43209657（领保热线）' },
      consulates: [{ name: '驻曼德勒总领事馆', city: '曼德勒', phone: '+86-10-12308 转接' }],
      airports: [{ name: '仰光国际机场', iata: 'RGN' }, { name: '曼德勒国际机场', iata: 'MDL' }, { name: '皎漂机场', iata: 'KYP' }],
      seaports: [{ name: '仰光港' }, { name: '皎漂港' }],
      routes: [
        { scene: '若开邦冲突（皎漂方向）', steps: ['皎漂项目区人员就地设防避险', '皎漂机场（KYP）包机飞仰光', '仰光机场（RGN）出境'], third: '泰国（曼谷）', note: '若开陆路（安隘）通行受战事影响大，以空中为主' },
        { scene: '缅北战事外溢（中缅管道/莱比塘方向）', steps: ['人员向曼德勒集中', '曼德勒机场（MDL）出境', '紧急时经瑞丽/畹町口岸陆路回国（须缅方通行许可）'], third: '中国云南（瑞丽口岸陆路）', note: '木姐-瑞丽通道受战事影响时断时续，出发前必须核实' }
      ],
      shelters: [
        { name: '中国驻缅使馆馆区（仰光）', note: '' },
        { name: '驻曼德勒总领馆馆区', note: '中北部人员就近集结' },
        { name: '中缅油气管道沿线中方站场营地', note: '设防站场，就地避险' }
      ],
      transit: ['泰国（曼谷）', '中国云南（瑞丽/畹町口岸）'],
      note: '缅北、若开邦、掸邦为冲突高发区，人员出行须经安全评估并报使馆备案。'
    },
    '泰国': {
      embassy: { name: '中国驻泰国大使馆', city: '曼谷', addr: '曼谷拉差达披色路', phone: '+66-2-245-7010（使馆/领保）' },
      consulates: [
        { name: '驻清迈总领事馆', city: '清迈', phone: '+86-10-12308 转接' },
        { name: '驻孔敬总领事馆', city: '孔敬', phone: '+86-10-12308 转接' },
        { name: '驻宋卡总领事馆', city: '宋卡', phone: '+86-10-12308 转接' }
      ],
      airports: [{ name: '素万那普国际机场（曼谷）', iata: 'BKK' }, { name: '廊曼国际机场（曼谷）', iata: 'DMK' }],
      seaports: [{ name: '林查班港' }, { name: '曼谷港' }],
      routes: [
        { scene: '中泰铁路沿线突发事件', steps: ['工地人员向呵叻/曼谷集中', '公路返曼谷', '素万那普机场（BKK）出境'], third: '新加坡 / 马来西亚（吉隆坡）', note: '泰南三府（也拉/北大年/陶公）为分离主义冲突区，避免前往' }
      ],
      shelters: [
        { name: '中国驻泰使馆馆区（曼谷）', note: '' },
        { name: '曼谷市中心国际酒店群（素坤逸/是隆）', note: '过渡安置' },
        { name: '中泰铁路各标段中方营地', note: '就地避险' }
      ],
      transit: ['新加坡', '马来西亚（吉隆坡）', '老挝（万象，陆路）'],
      note: ''
    },
    '土库曼斯坦': {
      embassy: { name: '中国驻土库曼斯坦大使馆', city: '阿什哈巴德', addr: '阿什哈巴德市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '阿什哈巴德国际机场', iata: 'ASB' }, { name: '土库曼纳巴德机场', iata: 'TAZ' }],
      seaports: [{ name: '土库曼巴希港（里海）' }],
      routes: [
        { scene: '气田区安全事件（马雷州方向）', steps: ['气田营地集中（CNPC站场有自备安保）', '陆路赴阿什哈巴德', '阿什哈巴德机场（ASB）出境'], third: '阿联酋（迪拜）/ 土耳其（伊斯坦布尔）', note: '土签证管制严格，离境手续须提前经使馆协调' }
      ],
      shelters: [
        { name: '中国驻土使馆馆区（阿什哈巴德）', note: '' },
        { name: '中亚天然气管道沿线中方站场', note: '设防站场，就地避险' }
      ],
      transit: ['阿联酋（迪拜）', '土耳其（伊斯坦布尔）'],
      note: ''
    },
    '吉尔吉斯斯坦': {
      embassy: { name: '中国驻吉尔吉斯斯坦大使馆', city: '比什凯克', addr: '比什凯克市', phone: '+86-10-12308 转接' },
      consulates: [{ name: '驻奥什领事办公室', city: '奥什', phone: '+86-10-12308 转接' }],
      airports: [{ name: '玛纳斯国际机场（比什凯克）', iata: 'FRU' }, { name: '奥什国际机场', iata: 'OSS' }],
      seaports: [],
      routes: [
        { scene: '南部安全事件（中吉乌铁路奥什方向）', steps: ['人员向奥什市区集中', '奥什机场（OSS）飞比什凯克或直接出境', '备选：陆路经伊尔克什坦口岸回国'], third: '中国新疆（伊尔克什坦/吐尔尕特口岸陆路）', note: '中吉陆路口岸为可靠回国通道' },
        { scene: '比什凯德政局动荡', steps: ['进入使馆馆区', '玛纳斯机场（FRU）出境', '备选：陆路经哈萨克斯坦赴阿拉木图'], third: '哈萨克斯坦（阿拉木图）', note: '' }
      ],
      shelters: [
        { name: '中国驻吉使馆馆区（比什凯克）', note: '' },
        { name: '驻奥什领事办公室', note: '南部人员就近集结' }
      ],
      transit: ['中国新疆（陆路口岸）', '哈萨克斯坦（阿拉木图）'],
      note: ''
    },
    '俄罗斯': {
      embassy: { name: '中国驻俄罗斯大使馆', city: '莫斯科', addr: '莫斯科拉缅基区', phone: '+7-495-938-2006（领保热线）' },
      consulates: [
        { name: '驻圣彼得堡总领事馆', city: '圣彼得堡', phone: '+86-10-12308 转接' },
        { name: '驻哈巴罗夫斯克总领事馆', city: '哈巴罗夫斯克', phone: '+86-10-12308 转接' },
        { name: '驻符拉迪沃斯托克总领事馆', city: '符拉迪沃斯托克', phone: '+86-10-12308 转接' },
        { name: '驻叶卡捷琳堡总领事馆', city: '叶卡捷琳堡', phone: '+86-10-12308 转接' },
        { name: '驻伊尔库茨克总领事馆', city: '伊尔库茨克', phone: '+86-10-12308 转接' }
      ],
      airports: [{ name: '谢列梅捷沃国际机场（莫斯科）', iata: 'SVO' }, { name: '萨别塔机场（亚马尔）', iata: 'SBT' }, { name: '海兰泡机场', iata: 'BQS' }],
      seaports: [{ name: '萨别塔港' }, { name: '符拉迪沃斯托克港' }],
      routes: [
        { scene: '北极项目极端事件（亚马尔/LNG2方向）', steps: ['项目营地集中（极地封闭营地）', '萨别塔机场（SBT）包机飞莫斯科/新乌连戈伊', '莫斯科谢列梅捷沃（SVO）出境'], third: '土耳其（伊斯坦布尔）', note: '极地冬季撤离窗口受气象限制，预案须含48-72小时就地等待方案' },
        { scene: '远东管道沿线事件', steps: ['人员向布拉戈维申斯克集中', '海兰泡机场（BQS）或陆路黑河口岸回国', '备选：哈巴罗夫斯克出境'], third: '中国黑龙江（黑河口岸陆路）', note: '' }
      ],
      shelters: [
        { name: '中国驻俄使馆馆区（莫斯科）', note: '' },
        { name: '各总领馆馆区', note: '就近集结' },
        { name: '亚马尔项目封闭营地', note: '极地就地避险' }
      ],
      transit: ['土耳其（伊斯坦布尔）', '中国（黑河/满洲里口岸）'],
      note: ''
    },
    '塞尔维亚': {
      embassy: { name: '中国驻塞尔维亚大使馆', city: '贝尔格莱德', addr: '贝尔格莱德新贝区', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '尼古拉·特斯拉国际机场（贝尔格莱德）', iata: 'BEG' }],
      seaports: [],
      routes: [
        { scene: '局部安全事件（钢厂/铜矿方向）', steps: ['厂区人员集中', '公路返贝尔格莱德（斯梅代雷沃约1小时、博尔约3小时）', '尼古拉·特斯拉机场（BEG）出境'], third: '匈牙利（布达佩斯）/ 奥地利（维也纳）', note: '' }
      ],
      shelters: [
        { name: '中国驻塞使馆馆区（贝尔格莱德新贝区）', note: '' },
        { name: '斯梅代雷沃钢厂/博尔铜矿中方厂区', note: '就地避险' }
      ],
      transit: ['匈牙利（布达佩斯）', '奥地利（维也纳）'],
      note: ''
    },
    '克罗地亚': {
      embassy: { name: '中国驻克罗地亚大使馆', city: '萨格勒布', addr: '萨格勒布市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '萨格勒布机场', iata: 'ZAG' }, { name: '杜布罗夫尼克机场', iata: 'DBV' }, { name: '斯普利特机场', iata: 'SPU' }],
      seaports: [{ name: '普洛切港' }, { name: '里耶卡港' }],
      routes: [
        { scene: '大桥项目区突发事件', steps: ['工地人员集中', '沿海公路赴斯普利特（SPU）或杜布罗夫尼克（DBV）机场', '经萨格勒布（ZAG）出境'], third: '奥地利（维也纳）/ 德国（法兰克福）', note: '' }
      ],
      shelters: [
        { name: '中国驻克使馆馆区（萨格勒布）', note: '' },
        { name: '斯普利特/杜布罗夫尼克市区国际酒店', note: '过渡安置' }
      ],
      transit: ['奥地利（维也纳）', '德国（法兰克福）'],
      note: ''
    },
    '希腊': {
      embassy: { name: '中国驻希腊大使馆', city: '雅典', addr: '雅典市', phone: '+30-210-6723282（使馆总机）' },
      consulates: [],
      airports: [{ name: '雅典国际机场', iata: 'ATH' }, { name: '塞萨洛尼基机场', iata: 'SKG' }],
      seaports: [{ name: '比雷埃夫斯港' }, { name: '塞萨洛尼基港' }],
      routes: [
        { scene: '比港罢工/骚乱升级', steps: ['港区人员撤至港区中方办公楼', '雅典国际机场（ATH）出境', '备选：渡轮/商船赴意大利'], third: '意大利（罗马）/ 土耳其（伊斯坦布尔）', note: '' }
      ],
      shelters: [
        { name: '中国驻希使馆馆区（雅典）', note: '' },
        { name: '比雷埃夫斯港中方港区办公楼', note: '就地避险' }
      ],
      transit: ['意大利（罗马）', '土耳其（伊斯坦布尔）'],
      note: ''
    },
    '白俄罗斯': {
      embassy: { name: '中国驻白俄罗斯大使馆', city: '明斯克', addr: '明斯克市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '明斯克国际机场', iata: 'MSQ' }],
      seaports: [],
      routes: [
        { scene: '政局动荡/制裁升级', steps: ['园区人员向明斯克集中', '明斯克机场（MSQ）出境（注意欧盟空域限制，优先直飞国内航线）', '备选：陆路经俄罗斯赴莫斯科'], third: '俄罗斯（莫斯科）', note: '欧盟对白航权限制多，撤离航线须实时核实' }
      ],
      shelters: [
        { name: '中国驻白使馆馆区（明斯克）', note: '' },
        { name: '中白工业园中方管理区', note: '就地避险' }
      ],
      transit: ['俄罗斯（莫斯科）', '土耳其（伊斯坦布尔）'],
      note: ''
    },
    '匈牙利': {
      embassy: { name: '中国驻匈牙利大使馆', city: '布达佩斯', addr: '布达佩斯市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '布达佩斯李斯特国际机场', iata: 'BUD' }, { name: '德布勒森机场', iata: 'DEB' }],
      seaports: [],
      routes: [
        { scene: '局部安全事件', steps: ['厂区人员集中', 'M35 高速返布达佩斯（约2.5小时）', '布达佩斯机场（BUD）出境'], third: '奥地利（维也纳）', note: '' }
      ],
      shelters: [
        { name: '中国驻匈使馆馆区（布达佩斯）', note: '' },
        { name: '德布勒森工厂中方管理区', note: '就地避险' }
      ],
      transit: ['奥地利（维也纳）', '德国（法兰克福）'],
      note: ''
    },
    '德国': {
      embassy: { name: '中国驻德国大使馆', city: '柏林', addr: '柏林市', phone: '+86-10-12308 转接' },
      consulates: [
        { name: '驻汉堡总领事馆', city: '汉堡', phone: '+86-10-12308 转接' },
        { name: '驻慕尼黑总领事馆', city: '慕尼黑', phone: '+86-10-12308 转接' },
        { name: '驻法兰克福总领事馆', city: '法兰克福', phone: '+86-10-12308 转接' },
        { name: '驻杜塞尔多夫总领事馆', city: '杜塞尔多夫', phone: '+86-10-12308 转接' }
      ],
      airports: [{ name: '法兰克福国际机场', iata: 'FRA' }, { name: '杜塞尔多夫国际机场', iata: 'DUS' }],
      seaports: [{ name: '汉堡港' }, { name: '杜伊斯堡内河港' }],
      routes: [
        { scene: '班列枢纽突发事件（杜伊斯堡方向）', steps: ['人员向杜塞尔多夫集中', '杜塞尔多夫（DUS）或法兰克福（FRA）机场出境'], third: '荷兰（阿姆斯特丹）', note: '' }
      ],
      shelters: [
        { name: '驻杜塞尔多夫总领馆馆区', note: '就近集结' },
        { name: '中国驻德使馆馆区（柏林）', note: '' }
      ],
      transit: ['荷兰（阿姆斯特丹）', '法国（巴黎）'],
      note: ''
    },
    '肯尼亚': {
      embassy: { name: '中国驻肯尼亚大使馆', city: '内罗毕', addr: '内罗毕市', phone: '+254-20-2726851（使馆总机）' },
      consulates: [],
      airports: [{ name: '乔莫·肯雅塔国际机场（内罗毕）', iata: 'NBO' }, { name: '莫伊国际机场（蒙巴萨）', iata: 'MBA' }],
      seaports: [{ name: '蒙巴萨港' }],
      routes: [
        { scene: '沿海安全事件（蒙内铁路蒙巴萨端）', steps: ['车站/营地人员集中', '蒙内铁路动车组返回内罗毕（铁路即撤离通道）', '乔莫·肯雅塔机场（NBO）出境'], third: '埃塞俄比亚（亚的斯亚贝巴）/ 阿联酋（迪拜）', note: '' },
        { scene: '内罗毕市区骚乱/恐袭', steps: ['进入使馆馆区或设防酒店', 'NBO 机场出境', '备选：蒙巴萨港海上疏散'], third: '坦桑尼亚（达累斯萨拉姆）', note: '' }
      ],
      shelters: [
        { name: '中国驻肯使馆馆区（内罗毕）', note: '' },
        { name: '内罗毕 Serena/洲际酒店', note: '设防国际酒店' },
        { name: '蒙内铁路沿线中方站区', note: '就地避险' }
      ],
      transit: ['埃塞俄比亚（亚的斯亚贝巴）', '阿联酋（迪拜）', '卡塔尔（多哈）'],
      note: ''
    },
    '埃塞俄比亚': {
      embassy: { name: '中国驻埃塞俄比亚大使馆', city: '亚的斯亚贝巴', addr: '亚的斯亚贝巴市', phone: '+251-911-686-415（领保热线）' },
      consulates: [],
      airports: [{ name: '博莱国际机场（亚的斯亚贝巴）', iata: 'ADD' }],
      seaports: [{ name: '吉布提港（经亚吉铁路）' }],
      routes: [
        { scene: '地区冲突外溢（亚吉铁路方向）', steps: ['人员向亚的斯亚贝巴集中', '博莱机场（ADD）出境（埃塞航枢纽，非洲航线最全）', '备选：亚吉铁路赴吉布提出境'], third: '吉布提 / 阿联酋（迪拜）', note: '提格雷/阿姆哈拉方向冲突区严禁前往' }
      ],
      shelters: [
        { name: '中国驻埃塞使馆馆区（亚的斯亚贝巴）', note: '' },
        { name: '亚的斯亚贝巴喜来登/丽笙酒店', note: '设防国际酒店' },
        { name: '非盟会议中心周边国际机构区', note: '安保等级高' }
      ],
      transit: ['吉布提', '阿联酋（迪拜）', '肯尼亚（内罗毕）'],
      note: ''
    },
    '坦桑尼亚': {
      embassy: { name: '中国驻坦桑尼亚大使馆', city: '达累斯萨拉姆', addr: '达累斯萨拉姆市', phone: '+86-10-12308 转接' },
      consulates: [{ name: '驻桑给巴尔总领事馆', city: '桑给巴尔', phone: '+86-10-12308 转接' }],
      airports: [{ name: '朱利叶斯·尼雷尔国际机场（达市）', iata: 'DAR' }],
      seaports: [{ name: '达累斯萨拉姆港' }, { name: '坦噶港' }],
      routes: [
        { scene: '坦赞铁路沿线突发事件', steps: ['沿线人员向达市方向集中', '尼雷尔机场（DAR）出境', '备选：达市港海上疏散'], third: '肯尼亚（内罗毕）/ 埃塞俄比亚（亚的斯亚贝巴）', note: '' }
      ],
      shelters: [
        { name: '中国驻坦使馆馆区（达市）', note: '' },
        { name: '达市 Serena/万豪酒店', note: '过渡安置' },
        { name: '坦赞铁路中方站区', note: '就地避险' }
      ],
      transit: ['肯尼亚（内罗毕）', '埃塞俄比亚（亚的斯亚贝巴）', '阿联酋（迪拜）'],
      note: ''
    },
    '安哥拉': {
      embassy: { name: '中国驻安哥拉大使馆', city: '罗安达', addr: '罗安达市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '二月四日国际机场（罗安达）', iata: 'LAD' }, { name: '本格拉机场', iata: 'BUG' }],
      seaports: [{ name: '罗安达港' }, { name: '洛比托港' }],
      routes: [
        { scene: '本格拉铁路沿线安全事件', steps: ['沿线人员向洛比托/本格拉集中', '本格拉机场（BUG）飞罗安达', '罗安达（LAD）出境'], third: '葡萄牙（里斯本）/ 阿联酋（迪拜）', note: '' }
      ],
      shelters: [
        { name: '中国驻安使馆馆区（罗安达）', note: '' },
        { name: '罗安达中资企业基地（设防营地）', note: '就地避险' }
      ],
      transit: ['葡萄牙（里斯本）', '阿联酋（迪拜）', '埃塞俄比亚（亚的斯亚贝巴）'],
      note: ''
    },
    '尼日利亚': {
      embassy: { name: '中国驻尼日利亚大使馆', city: '阿布贾', addr: '阿布贾中央区', phone: '+234-806-584-2688（领保热线）' },
      consulates: [{ name: '驻拉各斯总领事馆', city: '拉各斯', phone: '+86-10-12308 转接' }],
      airports: [{ name: '纳姆迪·阿齐基韦国际机场（阿布贾）', iata: 'ABV' }, { name: '穆尔塔拉·穆罕默德国际机场（拉各斯）', iata: 'LOS' }],
      seaports: [{ name: '莱基深水港' }, { name: '阿帕帕港' }, { name: '哈科特港' }],
      routes: [
        { scene: '拉各斯方向安全事件（莱基港）', steps: ['港区人员撤至港区设防管理区', '穆尔塔拉机场（LOS）出境', '备选：莱基港海上疏散'], third: '加纳（阿克拉）/ 阿联酋（迪拜）', note: '' },
        { scene: '北部绑架高发区外溢', steps: ['严禁前往博尔诺/约贝/卡杜纳州', '阿布贾人员向使馆区集中', '阿布贾机场（ABV）出境'], third: '埃塞俄比亚（亚的斯亚贝巴）', note: '尼北部绑架高发，中方人员原则上不进入北部各州' }
      ],
      shelters: [
        { name: '中国驻尼使馆馆区（阿布贾）', note: '' },
        { name: '驻拉各斯总领馆馆区', note: '南部人员就近集结' },
        { name: '莱基自贸区中方设防营地', note: '就地避险' }
      ],
      transit: ['加纳（阿克拉）', '埃塞俄比亚（亚的斯亚贝巴）', '阿联酋（迪拜）'],
      note: ''
    },
    '刚果（金）': {
      embassy: { name: '中国驻刚果（金）大使馆', city: '金沙萨', addr: '金沙萨市', phone: '+243-851-474-669（领保热线）' },
      consulates: [],
      airports: [{ name: '恩吉利国际机场（金沙萨）', iata: 'FIH' }, { name: '卢本巴希国际机场', iata: 'FBM' }, { name: '科卢韦齐机场', iata: 'KWZ' }],
      seaports: [{ name: '马塔迪港' }],
      routes: [
        { scene: '卢阿拉巴省治安恶化（卡莫阿/TFM/KFM矿区方向）', steps: ['矿区设防营地集中（矿区自备安保与直升机起降条件）', '科卢韦齐机场（KWZ）包机飞卢本巴希', '卢本巴希（FBM）出境，或陆路入赞比亚'], third: '赞比亚（恩多拉/卢萨卡）', note: '上加丹加/卢阿拉巴武装拦路频发，陆路机动必须护卫车队+白天行车' },
        { scene: '东部战事（北基伍/伊图里方向）', steps: ['严禁前往东部各省', '东部人员经戈马机场或陆路入卢旺达/乌干达撤离', '金沙萨方向人员经恩吉利机场（FIH）出境'], third: '卢旺达（基加利）/ 肯尼亚（内罗毕）', note: '' },
        { scene: '金沙萨政局动荡', steps: ['进入使馆馆区', '恩吉利机场（FIH）出境', '备选：陆路/渡轮赴刚果（布）布拉柴维尔'], third: '刚果（布）（布拉柴维尔）', note: '' }
      ],
      shelters: [
        { name: '中国驻刚使馆馆区（金沙萨）', note: '' },
        { name: '卡莫阿/TFM 矿区设防营地', note: '就地避险首选，有医务室与直升机坪' },
        { name: '卢本巴希市区国际酒店', note: '过渡安置' }
      ],
      transit: ['赞比亚（恩多拉/卢萨卡）', '卢旺达（基加利）', '埃塞俄比亚（亚的斯亚贝巴）'],
      note: '2026年以来上加丹加省针对矿区的武装拦截、绑架事件高发，人员外出须双人双车并报备行程。'
    },
    '赞比亚': {
      embassy: { name: '中国驻赞比亚大使馆', city: '卢萨卡', addr: '卢萨卡市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '肯尼思·卡翁达国际机场（卢萨卡）', iata: 'LUN' }, { name: '恩多拉国际机场', iata: 'NLA' }],
      seaports: [],
      routes: [
        { scene: '铜带省安全事件（谦比希方向）', steps: ['矿区人员集中', '恩多拉机场（NLA）飞卢萨卡或直接出境', '卢萨卡（LUN）出境'], third: '南非（约翰内斯堡）/ 埃塞俄比亚（亚的斯亚贝巴）', note: '' }
      ],
      shelters: [
        { name: '中国驻赞使馆馆区（卢萨卡）', note: '' },
        { name: '谦比希铜矿中方矿区营地', note: '就地避险' }
      ],
      transit: ['南非（约翰内斯堡）', '埃塞俄比亚（亚的斯亚贝巴）'],
      note: ''
    },
    '几内亚': {
      embassy: { name: '中国驻几内亚大使馆', city: '科纳克里', addr: '科纳克里市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '科纳克里国际机场', iata: 'CKY' }],
      seaports: [{ name: '科纳克里港' }, { name: '西芒杜配套出海港（马瑞巴亚，在建）' }],
      routes: [
        { scene: '矿区/政局突发事件（西芒杜方向）', steps: ['矿区营地集中', '陆路/项目铁路赴科纳克里方向（视安全走廊）', '科纳克里机场（CKY）出境'], third: '塞内加尔（达喀尔）/ 科特迪瓦（阿比让）', note: '几政局多变，军事管制期机场可能关闭，须准备72小时就地避险物资' }
      ],
      shelters: [
        { name: '中国驻几使馆馆区（科纳克里）', note: '' },
        { name: '西芒杜项目中方矿区营地', note: '就地避险' }
      ],
      transit: ['塞内加尔（达喀尔）', '科特迪瓦（阿比让）', '摩洛哥（卡萨布兰卡）'],
      note: ''
    },
    '埃及': {
      embassy: { name: '中国驻埃及大使馆', city: '开罗', addr: '开罗扎马雷克区', phone: '+20-2-27363219（使馆总机）' },
      consulates: [{ name: '驻亚历山大总领事馆', city: '亚历山大', phone: '+86-10-12308 转接' }],
      airports: [{ name: '开罗国际机场', iata: 'CAI' }, { name: '新首都机场（在建/部分启用）', iata: '—' }],
      seaports: [{ name: '苏伊士港' }, { name: '亚历山大港' }, { name: '塞得港' }],
      routes: [
        { scene: '安全事件（新首都CBD方向）', steps: ['工地人员撤至中方营地', '开罗国际机场（CAI）出境', '备选：亚历山大机场（HBE）'], third: '阿联酋（迪拜）/ 卡塔尔（多哈）', note: '西奈半岛北部为禁入区' }
      ],
      shelters: [
        { name: '中国驻埃使馆馆区（开罗扎马雷克区）', note: '' },
        { name: '新首都CBD项目中方营地', note: '就地避险' }
      ],
      transit: ['阿联酋（迪拜）', '卡塔尔（多哈）', '土耳其（伊斯坦布尔）'],
      note: ''
    },
    '吉布提': {
      embassy: { name: '中国驻吉布提大使馆', city: '吉布提市', addr: '吉布提市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '安布利国际机场', iata: 'JIB' }],
      seaports: [{ name: '多哈雷港' }, { name: '吉布提老港' }],
      routes: [
        { scene: '地区局势外溢（红海危机波及）', steps: ['基地/港区人员就地设防', '安布利机场（JIB）出境', '备选：多哈雷港海上疏散（护航编队联络机制）'], third: '埃塞俄比亚（亚的斯亚贝巴）/ 阿联酋（迪拜）', note: '我驻吉布提保障基地具备应急支援能力，须建立通联' }
      ],
      shelters: [
        { name: '中国驻吉使馆馆区（吉布提市）', note: '' },
        { name: '吉布提保障基地区（须军方协调进入）', note: '最高安保等级' },
        { name: '吉布提凯宾斯基酒店', note: '过渡安置' }
      ],
      transit: ['埃塞俄比亚（亚的斯亚贝巴）', '阿联酋（迪拜）'],
      note: ''
    },
    '莫桑比克': {
      embassy: { name: '中国驻莫桑比克大使馆', city: '马普托', addr: '马普托市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '马普托国际机场', iata: 'MPM' }, { name: '奔巴机场', iata: 'POL' }],
      seaports: [{ name: '马普托港' }, { name: '纳卡拉港' }, { name: '奔巴港' }],
      routes: [
        { scene: '德尔加杜角省恐袭（LNG项目方向）', steps: ['项目营地就地设防（阿丰吉园区封闭管理）', '奔巴机场（POL）包机飞马普托', '马普托（MPM）出境'], third: '南非（约翰内斯堡）', note: '德尔加杜角省为极端组织活跃区，陆上行程禁止，人员调动全部空中' }
      ],
      shelters: [
        { name: '中国驻莫使馆馆区（马普托）', note: '' },
        { name: 'LNG项目阿丰吉封闭营地', note: '就地避险' }
      ],
      transit: ['南非（约翰内斯堡）', '埃塞俄比亚（亚的斯亚贝巴）'],
      note: ''
    },
    '沙特阿拉伯': {
      embassy: { name: '中国驻沙特阿拉伯大使馆', city: '利雅得', addr: '利雅得外交区', phone: '+966-11-483-2126（使馆总机）' },
      consulates: [{ name: '驻吉达总领事馆', city: '吉达', phone: '+86-10-12308 转接' }],
      airports: [{ name: '哈立德国王国际机场（利雅得）', iata: 'RUH' }, { name: '阿卜杜勒-阿齐兹国王国际机场（吉达）', iata: 'JED' }, { name: '延布机场', iata: 'YNB' }],
      seaports: [{ name: '吉达港' }, { name: '延布港' }, { name: '朱拜勒港' }],
      routes: [
        { scene: '延布方向安全事件', steps: ['厂区人员集中', '延布机场（YNB）飞吉达/利雅得', '吉达（JED）出境'], third: '阿联酋（迪拜）', note: '' }
      ],
      shelters: [
        { name: '中国驻沙使馆馆区（利雅得外交区）', note: '' },
        { name: '驻吉达总领馆馆区', note: '西部人员就近集结' },
        { name: '延布炼厂中方管理区', note: '就地避险' }
      ],
      transit: ['阿联酋（迪拜）', '卡塔尔（多哈）'],
      note: ''
    },
    '阿联酋': {
      embassy: { name: '中国驻阿联酋大使馆', city: '阿布扎比', addr: '阿布扎比市', phone: '+971-2-443-4276（使馆总机）' },
      consulates: [{ name: '驻迪拜总领事馆', city: '迪拜', phone: '+86-10-12308 转接' }],
      airports: [{ name: '迪拜国际机场', iata: 'DXB' }, { name: '阿勒马克图姆国际机场', iata: 'DWC' }, { name: '阿布扎比国际机场', iata: 'AUH' }],
      seaports: [{ name: '杰贝阿里港' }, { name: '哈利法港' }],
      routes: [
        { scene: '地区冲突外溢（哈斯彦方向）', steps: ['厂区人员集中', '阿勒马克图姆机场（DWC）或迪拜机场（DXB）出境'], third: '阿曼（马斯喀特）/ 卡塔尔（多哈）', note: '阿联酋为中东中转枢纽，航线密集' }
      ],
      shelters: [
        { name: '驻迪拜总领馆馆区', note: '' },
        { name: '中国驻阿使馆馆区（阿布扎比）', note: '' }
      ],
      transit: ['阿曼（马斯喀特）', '卡塔尔（多哈）'],
      note: ''
    },
    '阿曼': {
      embassy: { name: '中国驻阿曼大使馆', city: '马斯喀特', addr: '马斯喀特市', phone: '+86-10-12308 转接' },
      consulates: [],
      airports: [{ name: '马斯喀特国际机场', iata: 'MCT' }, { name: '杜库姆机场', iata: 'DQM' }],
      seaports: [{ name: '杜库姆港' }, { name: '苏哈尔港' }, { name: '塞拉莱港' }],
      routes: [
        { scene: '杜库姆园区突发事件', steps: ['园区人员集中', '杜库姆机场（DQM）飞马斯喀特', '马斯喀特（MCT）出境'], third: '阿联酋（迪拜）', note: '' }
      ],
      shelters: [
        { name: '中国驻阿使馆馆区（马斯喀特）', note: '' },
        { name: '杜库姆产业园中方管理区', note: '就地避险' }
      ],
      transit: ['阿联酋（迪拜）', '卡塔尔（多哈）'],
      note: ''
    },
    '伊拉克': {
      embassy: { name: '中国驻伊拉克大使馆', city: '巴格达', addr: '巴格达市', phone: '+964-790-191-2315（领保热线）' },
      consulates: [{ name: '驻埃尔比勒总领事馆', city: '埃尔比勒', phone: '+86-10-12308 转接' }],
      airports: [{ name: '巴格达国际机场', iata: 'BGW' }, { name: '巴士拉国际机场', iata: 'BSR' }, { name: '埃尔比勒国际机场', iata: 'EBL' }],
      seaports: [{ name: '乌姆盖萨尔港' }],
      routes: [
        { scene: '南部油区安全恶化（鲁迈拉/哈法亚/马吉努方向）', steps: ['油田营地设防集中（各油区有封闭营地）', '巴士拉机场（BSR）出境', '备选：陆路赴科威特出境'], third: '科威特 / 阿联酋（迪拜）', note: '' },
        { scene: '巴格达绿区外冲突', steps: ['人员向绿区/使馆方向集中', '巴格达机场（BGW）出境', '备选：北上库区经埃尔比勒（EBL）出境'], third: '土耳其（伊斯坦布尔）', note: '' }
      ],
      shelters: [
        { name: '中国驻伊使馆馆区（巴格达）', note: '' },
        { name: '各油田中方封闭营地', note: '就地避险首选' },
        { name: '埃尔比勒总领馆馆区', note: '库区方向' }
      ],
      transit: ['科威特', '阿联酋（迪拜）', '土耳其（伊斯坦布尔）'],
      note: ''
    },
    '秘鲁': {
      embassy: { name: '中国驻秘鲁大使馆', city: '利马', addr: '利马市', phone: '+51-1-442-9466（使馆总机）' },
      consulates: [],
      airports: [{ name: '豪尔赫·查韦斯国际机场（利马）', iata: 'LIM' }, { name: '库斯科国际机场', iata: 'CUZ' }],
      seaports: [{ name: '钱凯港' }, { name: '卡亚俄港' }, { name: '马塔拉尼港' }],
      routes: [
        { scene: '钱凯港方向突发事件', steps: ['港区人员集中', '泛美公路返利马（约1.5小时）', '利马机场（LIM）出境'], third: '智利（圣地亚哥）', note: '' },
        { scene: '矿区社区冲突（拉斯邦巴斯/特罗莫克方向）', steps: ['矿区设防营地集中', '库斯科（CUZ）/地面护卫车队赴利马', '利马机场（LIM）出境', '备选：马塔拉尼港海上疏散'], third: '智利（圣地亚哥）/ 巴拿马（巴拿马城）', note: '矿区道路常被社区封堵，须与警方确认走廊后机动' }
      ],
      shelters: [
        { name: '中国驻秘使馆馆区（利马）', note: '' },
        { name: '拉斯邦巴斯/特罗莫克矿区营地', note: '就地避险' },
        { name: '利马米拉弗洛雷斯区国际酒店', note: '过渡安置' }
      ],
      transit: ['智利（圣地亚哥）', '巴拿马（巴拿马城）'],
      note: ''
    },
    '巴西': {
      embassy: { name: '中国驻巴西大使馆', city: '巴西利亚', addr: '巴西利亚市', phone: '+55-61-2198-2000（使馆总机）' },
      consulates: [
        { name: '驻圣保罗总领事馆', city: '圣保罗', phone: '+86-10-12308 转接' },
        { name: '驻里约热内卢总领事馆', city: '里约热内卢', phone: '+86-10-12308 转接' },
        { name: '驻累西腓总领事馆', city: '累西腓', phone: '+86-10-12308 转接' }
      ],
      airports: [{ name: '圣保罗瓜鲁柳斯国际机场', iata: 'GRU' }, { name: '巴西利亚国际机场', iata: 'BSB' }, { name: '阿尔塔米拉机场', iata: 'ATM' }],
      seaports: [{ name: '桑托斯港' }, { name: '里约港' }],
      routes: [
        { scene: '美丽山项目沿线突发事件', steps: ['工地人员向阿尔塔米拉集中', '阿尔塔米拉机场（ATM）飞巴西利亚/圣保罗', '圣保罗（GRU）出境'], third: '巴拿马（巴拿马城）/ 美国（迈阿密）', note: '亚马逊地区交通以航空为主' }
      ],
      shelters: [
        { name: '中国驻巴使馆馆区（巴西利亚）', note: '' },
        { name: '驻圣保罗总领馆馆区', note: '就近集结' },
        { name: '美丽山项目中方营地', note: '就地避险' }
      ],
      transit: ['巴拿马（巴拿马城）', '美国（迈阿密）', '葡萄牙（里斯本）'],
      note: ''
    },
    '阿根廷': {
      embassy: { name: '中国驻阿根廷大使馆', city: '布宜诺斯艾利斯', addr: '布市贝尔格拉诺区', phone: '+54-11-4547-8100（使馆总机）' },
      consulates: [],
      airports: [{ name: '埃塞萨国际机场（布市）', iata: 'EZE' }, { name: '胡胡伊机场', iata: 'JUJ' }, { name: '里奥加耶戈斯机场', iata: 'RGL' }],
      seaports: [{ name: '布宜诺斯艾利斯港' }],
      routes: [
        { scene: '高原项目突发事件（高查瑞方向）', steps: ['工地人员向胡胡伊集中', '胡胡伊机场（JUJ）飞布市', '埃塞萨机场（EZE）出境'], third: '智利（圣地亚哥）', note: '' },
        { scene: '南部水电项目突发事件（圣克鲁斯方向）', steps: ['工地人员向里奥加耶戈斯集中', '里奥加耶戈斯机场（RGL）飞布市', '埃塞萨机场（EZE）出境'], third: '智利（蓬塔阿雷纳斯，陆路备选）', note: '' }
      ],
      shelters: [
        { name: '中国驻阿使馆馆区（布市）', note: '' },
        { name: '高查瑞/圣克鲁斯项目中方营地', note: '就地避险' }
      ],
      transit: ['智利（圣地亚哥）', '巴西（圣保罗）'],
      note: ''
    },
    '厄瓜多尔': {
      embassy: { name: '中国驻厄瓜多尔大使馆', city: '基多', addr: '基多市', phone: '+86-10-12308 转接' },
      consulates: [{ name: '驻瓜亚基尔总领事馆', city: '瓜亚基尔', phone: '+86-10-12308 转接' }],
      airports: [{ name: '苏克雷元帅国际机场（基多）', iata: 'UIO' }, { name: '瓜亚基尔国际机场', iata: 'GYE' }],
      seaports: [{ name: '瓜亚基尔港' }],
      routes: [
        { scene: '纳波省安全事件（科卡科多方向）', steps: ['电站人员集中', '公路返基多（约3.5小时）', '基多机场（UIO）出境'], third: '巴拿马（巴拿马城）/ 秘鲁（利马）', note: '' }
      ],
      shelters: [
        { name: '中国驻厄使馆馆区（基多）', note: '' },
        { name: '科卡科多电站中方营地', note: '就地避险' }
      ],
      transit: ['巴拿马（巴拿马城）', '秘鲁（利马）'],
      note: ''
    }
  };

  /* ============================================================
   * 三、查询接口
   * ============================================================ */
  function geoOf(pid) { return PROJECT_GEO[pid] || null; }
  function guideOf(country) { return COUNTRY_EMERGENCY[country] || null; }
  /* 项目 → 国别指南（CRE 中欧班列 country=欧洲 → 德国） */
  function guideForProject(pid, country) {
    if (country && COUNTRY_EMERGENCY[country]) return COUNTRY_EMERGENCY[country];
    if (country === '欧洲') return COUNTRY_EMERGENCY['德国'];
    return null;
  }
  function countries() { return Object.keys(COUNTRY_EMERGENCY); }

  var api = {
    HOTLINE: HOTLINE,
    PROJECT_GEO: PROJECT_GEO,
    COUNTRY_EMERGENCY: COUNTRY_EMERGENCY,
    geoOf: geoOf,
    guideOf: guideOf,
    guideForProject: guideForProject,
    countries: countries
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EMERGENCY_GUIDE = api;
})(typeof window !== 'undefined' ? window : null);
