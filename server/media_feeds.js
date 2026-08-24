/**
 * server/media_feeds.js — 全球新闻媒体与智库研究机构数据源注册表
 *
 * 设计目标：
 *   1. 把「全数据源抓取涉华/中国海外利益信息」作为核心优先级。
 *   2. 大量增加全球新闻媒体：覆盖欧美、东亚、中亚、东南亚、南亚、拉美、非洲、
 *      东北亚、中东、西非、北非、西亚、北亚、大洋洲等全部区域。
 *   3. 将全球主要智库、研究机构、大学研究中心纳入数据源库，重点抓取涉华政策分析、
 *      地缘经济、安全风险评估、一带一路、供应链等研究成果。
 *
 * 铁律一（零模拟数据）：本文件只登记数据源通道。不可达源在抓取时自然失败，
 * 系统如实返回 0 条，绝不伪造。
 *
 * 数据结构：
 *   { cn, iso, region, name, url, type:'media'|'think_tank'|'research', lang, focus }
 *
 * 暴露：DIRECT_RSS, THINK_TANK_FEEDS, CHINA_FOCUS_SOURCES, REGIONS
 */
'use strict';

const REGIONS = {
  EAST_ASIA: '东亚',
  SOUTHEAST_ASIA: '东南亚',
  SOUTH_ASIA: '南亚',
  CENTRAL_ASIA: '中亚',
  WEST_ASIA: '西亚',
  MIDDLE_EAST: '中东',
  NORTH_AFRICA: '北非',
  WEST_AFRICA: '西非',
  EAST_AFRICA: '东非',
  SOUTHERN_AFRICA: '南部非洲',
  EUROPE: '欧洲',
  NORTH_AMERICA: '北美',
  LATIN_AMERICA: '拉美',
  OCEANIA: '大洋洲',
  NORTH_ASIA: '北亚',
  RUSSIA_CIS: '俄罗斯与独联体'
};

/* ===== 区域聚合别名（便于统计与前端展示）===== */
const REGION_GROUP = {
  '欧美': [REGIONS.EUROPE, REGIONS.NORTH_AMERICA],
  '东亚': [REGIONS.EAST_ASIA],
  '中亚': [REGIONS.CENTRAL_ASIA],
  '东南亚': [REGIONS.SOUTHEAST_ASIA],
  '南亚': [REGIONS.SOUTH_ASIA],
  '拉美': [REGIONS.LATIN_AMERICA],
  '非洲': [REGIONS.NORTH_AFRICA, REGIONS.WEST_AFRICA, REGIONS.EAST_AFRICA, REGIONS.SOUTHERN_AFRICA],
  '东北亚': [REGIONS.EAST_ASIA, REGIONS.NORTH_ASIA],
  '中东': [REGIONS.MIDDLE_EAST],
  '西非': [REGIONS.WEST_AFRICA],
  '北非': [REGIONS.NORTH_AFRICA],
  '西亚': [REGIONS.WEST_ASIA, REGIONS.MIDDLE_EAST],
  '北亚': [REGIONS.NORTH_ASIA, REGIONS.RUSSIA_CIS]
};

/* ===== 辅助：批量生成新闻源模板 ===== */
function _m(cn, iso, region, name, url, lang, focus) {
  return { cn, iso, region, name, url, type: 'media', lang: lang || 'en', focus: focus || '' };
}
function _t(cn, iso, region, name, url, lang, focus) {
  return { cn, iso, region, name, url, type: 'think_tank', lang: lang || 'en', focus: focus || '' };
}
function _r(cn, iso, region, name, url, lang, focus) {
  return { cn, iso, region, name, url, type: 'research', lang: lang || 'en', focus: focus || '' };
}

/* ============================================================
   一、全球新闻媒体 RSS 数据源（按区域/国家组织）
   ============================================================ */
const DIRECT_RSS = [
  /* ---------------- 全球/国际通用通讯社与英语媒体 ---------------- */
  _m('国际', 'INT', REGIONS.EUROPE, 'Reuters World', 'https://news.google.com/rss/search?q=site:reuters.com+world&hl=en-US&gl=US&ceid=US:en', 'en', '全球财经、地缘'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Associated Press World', 'https://news.google.com/rss/search?q=site:apnews.com&hl=en-US&gl=US&ceid=US:en', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.EUROPE, 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'CNN World', 'https://rss.cnn.com/rss/edition_world.rss', 'en', '全球新闻'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.EUROPE, 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', '中东、全球南方'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Deutsche Welle', 'https://rss.dw.com/rdf/rss-en-all', 'en', '欧洲、全球'),
  _m('国际', 'INT', REGIONS.FRANCE, 'France 24', 'https://www.france24.com/en/rss', 'en', '法国视角国际'),
  _m('国际', 'INT', REGIONS.EUROPE, 'The Guardian World', 'https://www.theguardian.com/world/rss', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Foreign Policy', 'https://foreignpolicy.com/feed/', 'en', '外交、安全'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Voice of America', 'https://www.voanews.com/api/zt$gteitim', 'en', '美国对外广播'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Radio Free Europe', 'https://www.rferl.org/api/zv$gteitim', 'en', '欧亚、人权'),
  _m('国际', 'INT', REGIONS.HONG_KONG, 'South China Morning Post', 'https://www.scmp.com/rss/91/feed', 'en', '中国、亚太'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.SINGAPORE, 'Channel NewsAsia', 'https://www.channelnewsasia.com/rss', 'en', '东南亚、亚太'),
  _m('国际', 'INT', REGIONS.QATAR, 'Al Jazeera China', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', '中国相关'),
  _m('国际', 'INT', REGIONS.UNITED_KINGDOM, 'The Economist', 'https://www.economist.com/latest/rss.xml', 'en', '全球经济政治'),
  _m('国际', 'INT', REGIONS.UNITED_KINGDOM, 'Financial Times World', 'https://www.ft.com/world?format=rss', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.UNITED_STATES, 'Wall Street Journal World', 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.UNITED_STATES, 'New York Times World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.UNITED_STATES, 'Washington Post World', 'https://www.washingtonpost.com/arcio/rss/category/world/?itid=lk_inline_manual_33', 'en', '全球新闻'),

  /* ---------------- 北美 ---------------- */
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Politico', 'https://www.politico.com/rss/politics08.xml', 'en', '美国政治'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'The Hill', 'https://thehill.com/rss/syndicator/19110', 'en', '美国政治'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'NPR World', 'https://feeds.npr.org/1004/rss.xml', 'en', '全球新闻'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'CBS News World', 'https://www.cbsnews.com/latest/rss/world', 'en', '全球新闻'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'ABC News International', 'https://abcnews.go.com/abcnews/internationalheadlines', 'en', '全球新闻'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'USA Today World', 'https://www.usatoday.com/news/world/rss/', 'en', '全球新闻'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Newsweek', 'https://www.newsweek.com/rss', 'en', '国际时事'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'The Diplomat', 'https://thediplomat.com/feed/', 'en', '亚太外交'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'War on the Rocks', 'https://warontherocks.com/feed/', 'en', '安全防务'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Defense News', 'https://www.defensenews.com/arc/outboundfeeds/rss/category/news/?outputType=xml', 'en', '防务'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Breaking Defense', 'https://breakingdefense.com/feed/', 'en', '防务'),
  _m('加拿大', 'CAN', REGIONS.NORTH_AMERICA, 'CBC World', 'https://www.cbc.ca/cmlink/rss-world', 'en', '全球新闻'),
  _m('加拿大', 'CAN', REGIONS.NORTH_AMERICA, 'Global News Canada', 'https://globalnews.ca/feed/', 'en', '加拿大国际'),
  _m('加拿大', 'CAN', REGIONS.NORTH_AMERICA, 'National Post', 'https://nationalpost.com/feed/', 'en', '加拿大新闻'),
  _m('墨西哥', 'MEX', REGIONS.LATIN_AMERICA, 'Mexico News Daily', 'https://mexiconewsdaily.com/feed/', 'en', '墨西哥'),
  _m('墨西哥', 'MEX', REGIONS.LATIN_AMERICA, 'El Financiero', 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/', 'es', '墨西哥财经'),

  /* ---------------- 欧洲 ---------------- */
  _m('英国', 'GBR', REGIONS.EUROPE, 'BBC UK', 'https://feeds.bbci.co.uk/news/uk/rss.xml', 'en', '英国'),
  _m('英国', 'GBR', REGIONS.EUROPE, 'The Telegraph World', 'https://www.telegraph.co.uk/world/rss.xml', 'en', '国际'),
  _m('英国', 'GBR', REGIONS.EUROPE, 'The Independent World', 'https://www.independent.co.uk/news/world/rss', 'en', '国际'),
  _m('英国', 'GBR', REGIONS.EUROPE, 'Times World', 'https://www.thetimes.co.uk/?format=rss', 'en', '国际'),
  _m('法国', 'FRA', REGIONS.EUROPE, 'Le Monde World', 'https://www.lemonde.fr/en/international/rss_full.xml', 'en', '国际'),
  _m('法国', 'FRA', REGIONS.EUROPE, 'Le Figaro International', 'https://www.lefigaro.fr/rss/figaro_international.xml', 'fr', '国际'),
  _m('德国', 'DEU', REGIONS.EUROPE, 'Der Spiegel International', 'https://www.spiegel.de/international/index.rss', 'en', '国际'),
  _m('德国', 'DEU', REGIONS.EUROPE, 'DW News Asia', 'https://rss.dw.com/rdf/rss-en-asia', 'en', '亚洲'),
  _m('德国', 'DEU', REGIONS.EUROPE, 'DW News Africa', 'https://rss.dw.com/rdf/rss-en-africa', 'en', '非洲'),
  _m('德国', 'DEU', REGIONS.EUROPE, 'DW News Middle East', 'https://rss.dw.com/rdf/rss-en-middle-east', 'en', '中东'),
  _m('意大利', 'ITA', REGIONS.EUROPE, 'La Repubblica Mondo', 'https://www.repubblica.it/rss/esteri/rss2.0.xml', 'it', '国际'),
  _m('西班牙', 'ESP', REGIONS.EUROPE, 'El Mundo', 'https://www.elmundo.es/rss/internacional.xml', 'es', '欧洲'),
  _m('荷兰', 'NLD', REGIONS.EUROPE, 'Dutch News', 'https://dutchnews.nl/feed/', 'en', '荷兰'),
  _m('比利时', 'BEL', REGIONS.EUROPE, 'Brussels Times', 'https://www.brusselstimes.com/feed/', 'en', '比利时/欧盟'),
  _m('芬兰', 'FIN', REGIONS.EUROPE, 'Yle News', 'https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss', 'en', '芬兰'),
  _m('波兰', 'POL', REGIONS.EUROPE, 'Notes from Poland', 'https://notesfrompoland.com/feed/', 'en', '波兰'),
  _m('波兰', 'POL', REGIONS.EUROPE, 'Poland In', 'https://polandin.com/RSS', 'en', '波兰'), // 本地不可达（待云机恢复）
  _m('捷克', 'CZE', REGIONS.EUROPE, 'Prague Morning', 'https://praguemorning.cz/feed/', 'en', '捷克'),
  _m('匈牙利', 'HUN', REGIONS.EUROPE, 'Hungary Today', 'https://hungarytoday.hu/feed/', 'en', '匈牙利'),
  _m('葡萄牙', 'PRT', REGIONS.EUROPE, 'The Portugal News', 'https://www.theportugalnews.com/rss', 'en', '葡萄牙'),
  _m('希腊', 'GRC', REGIONS.EUROPE, 'Greek Reporter', 'https://greekreporter.com/feed/', 'en', '希腊'),
  _m('塞尔维亚', 'SRB', REGIONS.EUROPE, 'Balkan Insight', 'https://balkaninsight.com/feed/', 'en', '巴尔干'),
  _m('罗马尼亚', 'ROU', REGIONS.EUROPE, 'Romania Insider', 'https://www.romania-insider.com/feed', 'en', '罗马尼亚'),
  _m('保加利亚', 'BGR', REGIONS.EUROPE, 'Sofia Globe', 'https://sofiaglobe.com/feed/', 'en', '保加利亚'), // 本地不可达（待云机恢复）
  _m('乌克兰', 'UKR', REGIONS.EUROPE, 'Kyiv Post', 'https://www.kyivpost.com/feed/', 'en', '乌克兰'),
  _m('乌克兰', 'UKR', REGIONS.EUROPE, 'Euromaidan Press', 'https://euromaidanpress.com/feed/', 'en', '乌克兰'),
  _m('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'The Moscow Times', 'https://www.themoscowtimes.com/rss/news', 'en', '俄罗斯'),
  _m('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'TASS', 'https://tass.com/rss/v2.xml', 'en', '俄罗斯官方'),
  _m('白俄罗斯', 'BLR', REGIONS.RUSSIA_CIS, 'Belarus in Focus', 'https://belarusinfocus.info/feed/', 'en', '白俄罗斯'),

  /* ---------------- 东亚 ---------------- */
  _m('中国', 'CHN', REGIONS.EAST_ASIA, 'Global Times', 'https://www.globaltimes.cn/rss/outbrain.xml', 'en', '中国国际评论'),
  _m('中国香港', 'HKG', REGIONS.EAST_ASIA, 'Hong Kong Free Press', 'https://hongkongfp.com/feed/', 'en', '香港'),
  _m('中国澳门', 'MAC', REGIONS.EAST_ASIA, 'Macau News', 'https://macaonews.org/feed/', 'en', '澳门'),
  _m('中国台湾', 'TWN', REGIONS.EAST_ASIA, 'Taiwan News', 'https://www.taiwannews.com.tw/en/rss/headlines', 'en', '台湾'),
  _m('日本', 'JPN', REGIONS.EAST_ASIA, 'Japan Times', 'https://www.japantimes.co.jp/feed/', 'en', '日本'),
  _m('日本', 'JPN', REGIONS.EAST_ASIA, 'Mainichi Japan', 'https://mainichi.jp/english/rss/', 'en', '日本'),
  _m('韩国', 'KOR', REGIONS.EAST_ASIA, 'Korea Herald', 'http://www.koreaherald.com/rss/020000000000.xml', 'en', '韩国'),
  _m('韩国', 'KOR', REGIONS.EAST_ASIA, 'Korea Times', 'https://www.koreatimes.co.kr/www/rss/nation.xml', 'en', '韩国'),
  _m('韩国', 'KOR', REGIONS.EAST_ASIA, 'NK News', 'https://www.nknews.org/feed/', 'en', '朝鲜'),
  _m('蒙古', 'MNG', REGIONS.EAST_ASIA, 'The UB Post', 'https://theubposts.com/feed/', 'en', '蒙古'),

  /* ---------------- 东南亚 ---------------- */
  _m('印度尼西亚', 'IDN', REGIONS.SOUTHEAST_ASIA, 'Antara News', 'https://www.antaranews.com/en/rss', 'en', '印尼'),
  _m('马来西亚', 'MYS', REGIONS.SOUTHEAST_ASIA, 'Malay Mail', 'https://www.malaymail.com/feed/rss/malaysia', 'en', '马来西亚'),
  _m('马来西亚', 'MYS', REGIONS.SOUTHEAST_ASIA, 'Free Malaysia Today', 'https://www.freemalaysiatoday.com/feed/', 'en', '马来西亚'),
  _m('菲律宾', 'PHL', REGIONS.SOUTHEAST_ASIA, 'Rappler', 'https://www.rappler.com/feed/', 'en', '菲律宾'),
  _m('菲律宾', 'PHL', REGIONS.SOUTHEAST_ASIA, 'Philippine Daily Inquirer', 'https://newsinfo.inquirer.net/feed', 'en', '菲律宾'),
  _m('泰国', 'THA', REGIONS.SOUTHEAST_ASIA, 'Bangkok Post', 'https://www.bangkokpost.com/rss/data/most-recent.xml', 'en', '泰国'),
  _m('泰国', 'THA', REGIONS.SOUTHEAST_ASIA, 'The Nation Thailand', 'https://www.nationthailand.com/rss', 'en', '泰国'),
  _m('越南', 'VNM', REGIONS.SOUTHEAST_ASIA, 'VNExpress International', 'https://e.vnexpress.net/rss/world.rss', 'en', '越南'),
  _m('越南', 'VNM', REGIONS.SOUTHEAST_ASIA, 'VietnamNet', 'https://english.vietnamnet.vn/rss/index.html', 'en', '越南'), // 本地不可达（待云机恢复）
  _m('新加坡', 'SGP', REGIONS.SOUTHEAST_ASIA, 'Straits Times World', 'https://www.straitstimes.com/news/world/rss.xml', 'en', '新加坡'),
  _m('新加坡', 'SGP', REGIONS.SOUTHEAST_ASIA, 'Channel NewsAsia', 'https://www.channelnewsasia.com/rss', 'en', '东南亚'),
  _m('缅甸', 'MMR', REGIONS.SOUTHEAST_ASIA, 'Myanmar Now', 'https://myanmar-now.org/en/feed/', 'en', '缅甸'),
  _m('缅甸', 'MMR', REGIONS.SOUTHEAST_ASIA, 'The Irrawaddy', 'https://www.irrawaddy.com/feed/', 'en', '缅甸'),
  _m('柬埔寨', 'KHM', REGIONS.SOUTHEAST_ASIA, 'The Cambodia Daily', 'https://english.cambodiadaily.com/feed/', 'en', '柬埔寨'),
  _m('柬埔寨', 'KHM', REGIONS.SOUTHEAST_ASIA, 'Khmer Times', 'https://www.khmertimeskh.com/feed/', 'en', '柬埔寨'),
  _m('老挝', 'LAO', REGIONS.SOUTHEAST_ASIA, 'Laotian Times', 'https://laotiantimes.com/feed/', 'en', '老挝'),
  _m('文莱', 'BRN', REGIONS.SOUTHEAST_ASIA, 'Borneo Bulletin', 'https://borneobulletin.com.bn/feed/', 'en', '文莱'),
  _m('东帝汶', 'TLS', REGIONS.SOUTHEAST_ASIA, 'Timor News', 'https://timornews.com/feed/', 'en', '东帝汶'),

  /* ---------------- 南亚 ---------------- */
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Indian Express', 'https://indianexpress.com/feed/', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'India.com', 'https://www.india.com/feed/', 'en', '印度安全/反恐'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Hindu', 'https://www.thehindu.com/news/?service=rss', 'en', '印度'),
  /* ===== 专项补强源（2026-08-12：恐袭/绑架/关键矿产/外资合规主题覆盖） ===== */
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'PM News Nigeria', 'https://pmnewsnigeria.com/feed/', 'en', '尼日利亚安全/绑架'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'The Defense Post', 'https://www.thedefensepost.com/feed/', 'en', '全球防务/反恐'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'SecurityWeek', 'https://www.securityweek.com/feed/', 'en', '网络安全'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Military Times', 'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml', 'en', '军事冲突'),
  _m('加拿大', 'CAN', REGIONS.NORTH_AMERICA, 'MINING.COM', 'https://www.mining.com/feed/', 'en', '关键矿产/资源'),
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'Mining Weekly', 'https://www.miningweekly.com/page/rss', 'en', '关键矿产/非洲矿业'),
  _m('泛非', 'AFR', REGIONS.WEST_AFRICA, 'Africanews', 'https://www.africanews.com/feed/rss', 'en', '非洲全景'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Daily Trust', 'https://dailytrust.com/feed/', 'en', '尼日利亚安全'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'The Cable', 'https://www.thecable.ng/feed', 'en', '尼日利亚'),
  _m('索马里', 'SOM', REGIONS.EAST_AFRICA, 'Hiiraan Online', 'https://hiiraan.com/rss.xml', 'en', '索马里/青年党'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Long War Journal', 'https://www.longwarjournal.org/feed', 'en', '全球反恐/武装组织'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'The Soufan Center', 'https://thesoufancenter.org/feed/', 'en', '恐怖主义研究'),
  /* ===== 反恐/武装动态专业源（2026-08-13 用户指令：全球武装组织动态类情报扩展采集） ===== */
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'Jamestown Foundation', 'https://jamestown.org/feed/', 'en', '恐怖主义研究/欧亚安全'),
  _m('美国', 'USA', REGIONS.NORTH_AMERICA, 'CTC Sentinel', 'https://ctc.westpoint.edu/feed/', 'en', '西点反恐中心'), // 本地不可达（待云机恢复）
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Afghanistan International', 'https://afintl.com/en/rss', 'en', '阿富汗安全'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Amu TV', 'https://amu.tv/feed/', 'en', '阿富汗新闻'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Kabul Now', 'https://kabulnow.com/feed/', 'en', '喀布尔动态'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The Friday Times', 'https://thefridaytimes.com/feed/', 'en', '巴基斯坦安全分析'),
  /* ===== 非洲安全/恐袭专业源（2026-08-13 用户指令：非洲恐袭采集太少，每日大量事件） ===== */
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'HumAngle', 'https://humanglemedia.com/feed/', 'en', '西非冲突/恐袭追踪'),
  _m('苏丹', 'SDN', REGIONS.NORTH_AFRICA, 'Sudan Tribune', 'https://sudantribune.com/feed/', 'en', '苏丹冲突'),
  _m('苏丹', 'SDN', REGIONS.NORTH_AFRICA, 'Radio Dabanga', 'https://www.dabangasudan.org/en/all-news/rss', 'en', '苏丹达尔富尔'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'The East African', 'https://www.theeastafrican.co.ke/rss', 'en', '东非共同体'),
  _m('莫桑比克', 'MOZ', REGIONS.SOUTHERN_AFRICA, 'Zitamar News', 'https://zitamar.com/feed/', 'en', '莫桑比克德尔加杜角叛乱'),
  _m('索马里', 'SOM', REGIONS.EAST_AFRICA, 'Garowe Online', 'https://www.garoweonline.com/en/rss', 'en', '索马里/青年党'),
  _m('中非', 'CAF', REGIONS.WEST_AFRICA, 'Corbeau News', 'https://corbeaunews-centrafrique.com/feed/', 'fr', '中非共和国冲突'), // 本地不可达（待云机恢复）
  _m('刚果（金）', 'COD', REGIONS.EAST_AFRICA, 'Actualite.cd', 'https://actualite.cd/rss.xml', 'fr', '刚果金东部冲突'),

  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Times of India', 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Wire', 'https://thewire.in/rss', 'en', '印度'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The News International', 'https://www.thenews.com.pk/rss/1/1', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Dawn', 'https://www.dawn.com/feeds/home', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Pak Observer', 'https://pakobserver.net/feed/', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Daily Pakistan', 'https://en.dailypakistan.com.pk/feed/', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'ProPakistani', 'https://propakistani.pk/feed/', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The Balochistan Post', 'https://thebalochistanpost.com/feed/', 'en', '俾路支'),
  _m('孟加拉国', 'BGD', REGIONS.SOUTH_ASIA, 'Prothom Alo', 'https://en.prothomalo.com/feed', 'en', '孟加拉国'),
  _m('斯里兰卡', 'LKA', REGIONS.SOUTH_ASIA, 'Daily Mirror', 'https://www.dailymirror.lk/rss', 'en', '斯里兰卡'),
  _m('尼泊尔', 'NPL', REGIONS.SOUTH_ASIA, 'The Kathmandu Post', 'https://kathmandupost.com/rss', 'en', '尼泊尔'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Khaama Press', 'https://www.khaama.com/feed/', 'en', '阿富汗'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'TOLOnews', 'https://tolonews.com/feed/', 'en', '阿富汗'),

  /* ---------------- 中亚 ---------------- */
  _m('哈萨克斯坦', 'KAZ', REGIONS.CENTRAL_ASIA, 'Astana Times', 'https://astanatimes.com/feed/', 'en', '哈萨克斯坦'),
  _m('乌兹别克斯坦', 'UZB', REGIONS.CENTRAL_ASIA, 'UzDaily', 'https://uza.uz/en/rss', 'en', '乌兹别克斯坦'),
  _m('乌兹别克斯坦', 'UZB', REGIONS.CENTRAL_ASIA, 'Gazeta.uz', 'https://www.gazeta.uz/en/rss/', 'en', '乌兹别克斯坦'),
  _m('吉尔吉斯斯坦', 'KGZ', REGIONS.CENTRAL_ASIA, '24.kg', 'https://24.kg/rss/', 'en', '吉尔吉斯斯坦'),
  _m('塔吉克斯坦', 'TJK', REGIONS.CENTRAL_ASIA, 'Asia-Plus', 'https://asiaplustj.info/en/feed', 'en', '塔吉克斯坦'),
  _m('土库曼斯坦', 'TKM', REGIONS.CENTRAL_ASIA, 'Turkmen News', 'https://en.turkmen.news/feed/', 'en', '土库曼斯坦'),

  /* ---------------- 西亚/中东 ---------------- */
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Iran International', 'https://www.iranintl.com/en/feed', 'en', '伊朗'),
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Tehran Times', 'https://www.tehrantimes.com/rss', 'en', '伊朗'),
  _m('伊拉克', 'IRQ', REGIONS.MIDDLE_EAST, 'Al-Monitor', 'https://www.al-monitor.com/rss', 'en', '中东'),
  _m('伊拉克', 'IRQ', REGIONS.MIDDLE_EAST, 'Iraq News', 'https://www.iraqinews.com/feed/', 'en', '伊拉克'),
  _m('叙利亚', 'SYR', REGIONS.MIDDLE_EAST, 'Syria Direct', 'https://syriadirect.org/feed/', 'en', '叙利亚'),
  _m('叙利亚', 'SYR', REGIONS.MIDDLE_EAST, 'Syria Report', 'https://syria-report.com/feed/', 'en', '叙利亚'),
  _m('也门', 'YEM', REGIONS.MIDDLE_EAST, 'Yemen Times', 'https://yementimes.com/feed/', 'en', '也门'),
  _m('黎巴嫩', 'LBN', REGIONS.MIDDLE_EAST, 'L Orient Today', 'https://today.lorientlejour.com/feed', 'en', '黎巴嫩'),
  _m('约旦', 'JOR', REGIONS.MIDDLE_EAST, 'Jordan Times', 'http://jordantimes.com/rss', 'en', '约旦'), // 本地不可达（待云机恢复）
  _m('以色列', 'ISR', REGIONS.MIDDLE_EAST, 'Jerusalem Post', 'https://www.jpost.com/Rss/RssFeedsHeadlines.aspx', 'en', '以色列'),
  _m('沙特阿拉伯', 'SAU', REGIONS.MIDDLE_EAST, 'Arab News', 'https://www.arabnews.com/rss', 'en', '沙特/中东'),
  _m('卡塔尔', 'QAT', REGIONS.MIDDLE_EAST, 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', '卡塔尔/中东'),
  _m('卡塔尔', 'QAT', REGIONS.MIDDLE_EAST, 'Doha News', 'https://dohanews.co/feed/', 'en', '卡塔尔'),
  _m('阿曼', 'OMN', REGIONS.MIDDLE_EAST, 'Times of Oman', 'https://timesofoman.com/feed', 'en', '阿曼'),
  _m('土耳其', 'TUR', REGIONS.WEST_ASIA, 'Daily Sabah', 'https://www.dailysabah.com/rss', 'en', '土耳其'),
  _m('土耳其', 'TUR', REGIONS.WEST_ASIA, 'Hurriyet Daily News', 'https://www.hurriyetdailynews.com/rss', 'en', '土耳其'),
  _m('格鲁吉亚', 'GEO', REGIONS.WEST_ASIA, 'Civil Georgia', 'https://civil.ge/feed/', 'en', '格鲁吉亚'),
  _m('亚美尼亚', 'ARM', REGIONS.WEST_ASIA, 'Armenpress', 'https://armenpress.am/eng/rss/', 'en', '亚美尼亚'),
  _m('阿塞拜疆', 'AZE', REGIONS.WEST_ASIA, 'Trend News Agency', 'https://en.trend.az/rss', 'en', '阿塞拜疆'),
  _m('塞浦路斯', 'CYP', REGIONS.WEST_ASIA, 'Cyprus Mail', 'https://cyprus-mail.com/feed/', 'en', '塞浦路斯'),

  /* ---------------- 北非 ---------------- */
  _m('埃及', 'EGY', REGIONS.NORTH_AFRICA, 'Egypt Independent', 'https://www.egyptindependent.com/feed/', 'en', '埃及'),
  _m('埃及', 'EGY', REGIONS.NORTH_AFRICA, 'Ahram Online', 'http://english.ahram.org.eg/rss', 'en', '埃及'), // 本地不可达（待云机恢复）
  _m('利比亚', 'LBY', REGIONS.NORTH_AFRICA, 'Libya Herald', 'https://libyaherald.com/feed/', 'en', '利比亚'),
  _m('摩洛哥', 'MAR', REGIONS.NORTH_AFRICA, 'Morocco World News', 'https://www.moroccoworldnews.com/feed', 'en', '摩洛哥'),
  _m('突尼斯', 'TUN', REGIONS.NORTH_AFRICA, 'Tunisia Live', 'https://www.tunisia-live.net/feed/', 'en', '突尼斯'),
  _m('苏丹', 'SDN', REGIONS.NORTH_AFRICA, 'Sudan Tribune', 'https://sudantribune.com/feed/', 'en', '苏丹'),
  _m('南苏丹', 'SSD', REGIONS.NORTH_AFRICA, 'Sudan War Monitor', 'https://sudanwarmonitor.com/feed/', 'en', '南苏丹/苏丹'),

  /* ---------------- 西非 ---------------- */
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Vanguard', 'https://www.vanguardngr.com/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Premium Times', 'https://www.premiumtimesng.com/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Sahara Reporters', 'https://saharareporters.com/rss.xml', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'The Cable', 'https://www.thecable.ng/feed', 'en', '尼日利亚'),
  _m('加纳', 'GHA', REGIONS.WEST_AFRICA, 'Joy News', 'https://www.myjoyonline.com/feed/', 'en', '加纳'),
  _m('科特迪瓦', 'CIV', REGIONS.WEST_AFRICA, 'Abidjan.net', 'https://news.abidjan.net/rss', 'fr', '科特迪瓦'),
  _m('塞内加尔', 'SEN', REGIONS.WEST_AFRICA, 'Seneweb', 'https://www.seneweb.com/feed', 'fr', '塞内加尔'),
  _m('马里', 'MLI', REGIONS.WEST_AFRICA, 'Maliweb', 'https://www.maliweb.net/feed/', 'fr', '马里'),
  _m('布基纳法索', 'BFA', REGIONS.WEST_AFRICA, 'Faso7', 'https://faso7.com/feed/', 'fr', '布基纳法索'),
  _m('毛里塔尼亚', 'MRT', REGIONS.WEST_AFRICA, 'Mauriweb', 'https://mauriweb.info/feed', 'fr', '毛里塔尼亚'), // 本地不可达（待云机恢复）
  _m('几内亚', 'GIN', REGIONS.WEST_AFRICA, 'Guineenews', 'https://guineenews.org/feed/', 'fr', '几内亚'),
  _m('塞拉利昂', 'SLE', REGIONS.WEST_AFRICA, 'Sierra Leone Telegraph', 'https://www.thesierraleonetelegraph.com/feed/', 'en', '塞拉利昂'),
  _m('利比里亚', 'LBR', REGIONS.WEST_AFRICA, 'Front Page Africa', 'https://frontpageafricaonline.com/feed/', 'en', '利比里亚'),
  _m('贝宁', 'BEN', REGIONS.WEST_AFRICA, '24h au Benin', 'https://24haubenin.info/feed/', 'fr', '贝宁'),

  /* ---------------- 东非 ---------------- */
  _m('埃塞俄比亚', 'ETH', REGIONS.EAST_AFRICA, 'Ethiopia Observer', 'https://www.ethiopiaobserver.com/feed', 'en', '埃塞俄比亚'),
  _m('埃塞俄比亚', 'ETH', REGIONS.EAST_AFRICA, 'Addis Standard', 'https://addisstandard.com/feed/', 'en', '埃塞俄比亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'Daily Nation', 'https://nation.africa/kenya/rss.xml', 'en', '肯尼亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'The Standard', 'https://www.standardmedia.co.ke/rss/kenya.php', 'en', '肯尼亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'The EastAfrican', 'https://www.theeastafrican.co.ke/rss.xml', 'en', '东非'),
  _m('坦桑尼亚', 'TZA', REGIONS.EAST_AFRICA, 'The Citizen', 'https://www.thecitizen.co.tz/rss.xml', 'en', '坦桑尼亚'),
  _m('坦桑尼亚', 'TZA', REGIONS.EAST_AFRICA, 'Daily News Tanzania', 'https://dailynews.co.tz/feed/', 'en', '坦桑尼亚'),
  _m('乌干达', 'UGA', REGIONS.EAST_AFRICA, 'Daily Monitor', 'https://www.monitor.co.ug/rss', 'en', '乌干达'),
  _m('卢旺达', 'RWA', REGIONS.EAST_AFRICA, 'The New Times', 'https://www.newtimes.co.rw/rss', 'en', '卢旺达'),
  _m('布隆迪', 'BDI', REGIONS.EAST_AFRICA, 'Iwacu', 'https://www.iwacu-burundi.org/feed/', 'fr', '布隆迪'),
  _m('厄立特里亚', 'ERI', REGIONS.EAST_AFRICA, 'Eritrea Hub', 'https://eritreahub.org/feed/', 'en', '厄立特里亚'), // 本地不可达（待云机恢复）

  /* ---------------- 南部非洲 ---------------- */
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'News24', 'https://feeds.capi24.com/v1/Search/articles/news24/TopStories/rss', 'en', '南非'),
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'Daily Maverick', 'https://www.dailymaverick.co.za/rss/', 'en', '南非'),
  _m('津巴布韦', 'ZWE', REGIONS.SOUTHERN_AFRICA, 'NewsDay Zimbabwe', 'https://www.newsday.co.zw/feed/', 'en', '津巴布韦'),
  _m('津巴布韦', 'ZWE', REGIONS.SOUTHERN_AFRICA, 'Zimbabwe Independent', 'https://www.theindependent.co.zw/feed/', 'en', '津巴布韦'),
  _m('赞比亚', 'ZMB', REGIONS.SOUTHERN_AFRICA, 'Lusaka Times', 'https://www.lusakatimes.com/feed/', 'en', '赞比亚'),
  _m('赞比亚', 'ZMB', REGIONS.SOUTHERN_AFRICA, 'Zambia Reports', 'https://zambiareports.com/feed/', 'en', '赞比亚'),
  _m('纳米比亚', 'NAM', REGIONS.SOUTHERN_AFRICA, 'Namibian', 'https://www.namibian.com.na/feed/', 'en', '纳米比亚'),
  _m('莫桑比克', 'MOZ', REGIONS.SOUTHERN_AFRICA, 'Club of Mozambique', 'https://clubofmozambique.com/feed/', 'en', '莫桑比克'),
  _m('安哥拉', 'AGO', REGIONS.SOUTHERN_AFRICA, 'Angola Press', 'https://www.angop.ao/en/rss', 'pt', '安哥拉'),
  _m('马拉维', 'MWI', REGIONS.SOUTHERN_AFRICA, 'Malawi24', 'https://malawi24.com/feed/', 'en', '马拉维'),
  _m('马达加斯加', 'MDG', REGIONS.SOUTHERN_AFRICA, 'Madagascar Independent', 'https://madagascar-independent.com/feed/', 'en', '马达加斯加'), // 本地不可达（待云机恢复）

  /* ---------------- 拉美 ---------------- */
  _m('巴西', 'BRA', REGIONS.LATIN_AMERICA, 'Folha de S.Paulo', 'https://feeds.folha.uol.com.br/poder/rss091.xml', 'pt', '巴西'),
  _m('巴西', 'BRA', REGIONS.LATIN_AMERICA, 'O Globo', 'https://oglobo.globo.com/rss.xml', 'pt', '巴西'),
  _m('巴西', 'BRA', REGIONS.LATIN_AMERICA, 'BBC Brasil', 'https://feeds.bbci.co.uk/portuguese/rss.xml', 'pt', '巴西/拉美'),
  _m('墨西哥', 'MEX', REGIONS.LATIN_AMERICA, 'El Financiero', 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/', 'es', '墨西哥财经'),
  _m('墨西哥', 'MEX', REGIONS.LATIN_AMERICA, 'Reforma', 'https://www.reforma.com/rss/', 'es', '墨西哥'),
  _m('阿根廷', 'ARG', REGIONS.LATIN_AMERICA, 'Buenos Aires Times', 'https://www.batimes.com.ar/feed/', 'en', '阿根廷'), // 本地不可达（待云机恢复）
  _m('阿根廷', 'ARG', REGIONS.LATIN_AMERICA, 'Clarín', 'https://www.clarin.com/rss/lo-ultimo/', 'es', '阿根廷'),
  _m('哥伦比亚', 'COL', REGIONS.LATIN_AMERICA, 'Colombia Reports', 'https://colombiareports.com/feed/', 'en', '哥伦比亚'),
  _m('哥伦比亚', 'COL', REGIONS.LATIN_AMERICA, 'El Tiempo', 'https://www.eltiempo.com/rss', 'es', '哥伦比亚'),
  _m('智利', 'CHL', REGIONS.LATIN_AMERICA, 'Santiago Times', 'https://santiagotimes.cl/feed/', 'en', '智利'),
  _m('秘鲁', 'PER', REGIONS.LATIN_AMERICA, 'Peru Reports', 'https://perureports.com/feed/', 'en', '秘鲁'),
  _m('秘鲁', 'PER', REGIONS.LATIN_AMERICA, 'El Comercio', 'https://elcomercio.pe/feed/', 'es', '秘鲁'),
  _m('委内瑞拉', 'VEN', REGIONS.LATIN_AMERICA, 'Caracas Chronicles', 'https://www.caracaschronicles.com/feed/', 'en', '委内瑞拉'),
  _m('委内瑞拉', 'VEN', REGIONS.LATIN_AMERICA, 'El Nacional', 'https://www.elnacional.com/feed/', 'es', '委内瑞拉'),
  _m('厄瓜多尔', 'ECU', REGIONS.LATIN_AMERICA, 'Ecuador Times', 'https://www.ecuadortimes.net/feed/', 'en', '厄瓜多尔'),
  _m('乌拉圭', 'URY', REGIONS.LATIN_AMERICA, 'MercoPress', 'https://en.mercopress.com/rss', 'en', '南锥体'),
  _m('玻利维亚', 'BOL', REGIONS.LATIN_AMERICA, 'Pagina Siete', 'https://www.paginasiete.bo/rss', 'es', '玻利维亚'),
  _m('危地马拉', 'GTM', REGIONS.LATIN_AMERICA, 'Prensa Libre', 'https://www.prensalibre.com/rss/', 'es', '危地马拉'),
  _m('萨尔瓦多', 'SLV', REGIONS.LATIN_AMERICA, 'El Salvador Times', 'https://www.elsalvador.com/feed/', 'es', '萨尔瓦多'),
  _m('尼加拉瓜', 'NIC', REGIONS.LATIN_AMERICA, 'Confidencial', 'https://confidencial.digital/feed/', 'es', '尼加拉瓜'),
  _m('哥斯达黎加', 'CRI', REGIONS.LATIN_AMERICA, 'Tico Times', 'https://ticotimes.net/feed/', 'en', '哥斯达黎加'),
  _m('巴拿马', 'PAN', REGIONS.LATIN_AMERICA, 'Newsroom Panama', 'https://newsroompanama.com/feed/', 'en', '巴拿马'),
  _m('古巴', 'CUB', REGIONS.LATIN_AMERICA, 'Havana Times', 'https://havanatimes.org/feed/', 'en', '古巴'),
  _m('多米尼加', 'DOM', REGIONS.LATIN_AMERICA, 'Dominican Today', 'https://dominicantoday.com/feed/', 'en', '多米尼加'),
  _m('海地', 'HTI', REGIONS.LATIN_AMERICA, 'Haiti Libre', 'https://www.haitilibre.com/feed/', 'fr', '海地'), // 本地不可达（待云机恢复）
  _m('牙买加', 'JAM', REGIONS.LATIN_AMERICA, 'Jamaica Observer', 'https://www.jamaicaobserver.com/feed/', 'en', '牙买加'), // 本地不可达（待云机恢复）

  /* ---------------- 大洋洲 ---------------- */
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'SBS News', 'https://www.sbs.com.au/news/feed', 'en', '澳大利亚'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'ABC News', 'https://www.abc.net.au/news/feed/51120/rss.xml', 'en', '澳大利亚'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'The Australian', 'https://www.theaustralian.com.au/feed/', 'en', '澳大利亚'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'Lowy Interpreter', 'https://www.lowyinstitute.org/the-interpreter/feed', 'en', '澳大利亚外交'),
  _m('新西兰', 'NZL', REGIONS.OCEANIA, 'RNZ', 'https://www.rnz.co.nz/rss', 'en', '新西兰'),
  _m('新西兰', 'NZL', REGIONS.OCEANIA, 'Stuff', 'https://www.stuff.co.nz/rss', 'en', '新西兰'),

  /* ---------------- 北亚/俄罗斯 ---------------- */
  _m('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'The Moscow Times', 'https://www.themoscowtimes.com/rss/news', 'en', '俄罗斯'),
  _m('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'TASS', 'https://tass.com/rss/v2.xml', 'en', '俄罗斯官方'),
  _m('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'RIA Novosti', 'https://ria.ru/export/rss2/index.xml', 'ru', '俄罗斯'),
  _m('乌克兰', 'UKR', REGIONS.RUSSIA_CIS, 'Kyiv Post', 'https://www.kyivpost.com/feed/', 'en', '乌克兰'),
  _m('乌克兰', 'UKR', REGIONS.RUSSIA_CIS, 'Euromaidan Press', 'https://euromaidanpress.com/feed/', 'en', '乌克兰'),
  _m('哈萨克斯坦', 'KAZ', REGIONS.CENTRAL_ASIA, 'Tengrinews', 'https://tengrinews.kz/feed/', 'en', '哈萨克斯坦')
];

/* ============================================================
   二、全球智库与研究机构数据源
   ============================================================ */
const THINK_TANK_FEEDS = [
  /* ---------------- 美国 ---------------- */
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Brookings Order from Chaos', 'https://www.brookings.edu/feed/', 'en', '外交政策'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Carnegie Endowment', 'https://carnegieendowment.org/rss/solr/all', 'en', '国际关系'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'RAND Blog', 'https://www.rand.org/blog.xml', 'en', '防务安全'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Heritage Foundation', 'https://www.heritage.org/rss', 'en', '保守派智库'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Atlantic Council', 'https://www.atlanticcouncil.org/feed/', 'en', '大西洋主义'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'New America', 'https://www.newamerica.org/rss/', 'en', '政策研究'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'PIIE', 'https://www.piie.com/research/all/rss.xml', 'en', '国际经济'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'USIP', 'https://www.usip.org/publications/rss', 'en', '和平研究'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Stimson Center', 'https://www.stimson.org/feed/', 'en', '安全研究'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Center for American Progress', 'https://www.americanprogress.org/feed/', 'en', '进步派智库'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'AEI Ideas', 'https://www.aei.org/feed/', 'en', '企业研究所'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Peterson Institute', 'https://www.piie.com/research/all/rss.xml', 'en', '国际经济'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'CSIS China Power', 'https://chinapower.csis.org/feed/', 'en', '中国力量'),
  _t('美国', 'USA', REGIONS.NORTH_AMERICA, 'Brookings China', 'https://www.brookings.edu/topic/china/feed/', 'en', '中国研究'),

  /* ---------------- 英国 ---------------- */
  _t('英国', 'GBR', REGIONS.EUROPE, 'Chatham House', 'https://www.chathamhouse.org/feed', 'en', '国际事务'),
  _t('英国', 'GBR', REGIONS.EUROPE, 'IISS', 'https://www.iiss.org/feed', 'en', '战略研究'),
  _t('英国', 'GBR', REGIONS.EUROPE, 'ODI', 'https://odi.org/en/insights/feed/', 'en', '发展研究'),
  _t('英国', 'GBR', REGIONS.EUROPE, 'Overseas Development Institute', 'https://odi.org/en/insights/feed/', 'en', '发展研究'),

  /* ---------------- 法国 ---------------- */
  _t('法国', 'FRA', REGIONS.EUROPE, 'IRIS', 'https://www.iris-france.org/feed/', 'fr', '国际关系'),
  _t('法国', 'FRA', REGIONS.EUROPE, 'Institut Montaigne', 'https://www.institutmontaigne.org/en/rss', 'en', '政策'),
  _t('法国', 'FRA', REGIONS.EUROPE, 'Asia Centre', 'https://asiacentre.fr/feed/', 'en', '亚洲研究'), // 本地不可达（待云机恢复）

  /* ---------------- 德国 ---------------- */
  _t('德国', 'DEU', REGIONS.EUROPE, 'MERICS', 'https://merics.org/en/rss', 'en', '中国研究'),

  /* ---------------- 欧盟/欧洲其他 ---------------- */
  _t('欧盟', 'EUE', REGIONS.EUROPE, 'ECFR', 'https://ecfr.eu/feed/', 'en', '欧洲对外关系'),
  _t('意大利', 'ITA', REGIONS.EUROPE, 'ISPI', 'https://www.ispionline.it/en/rss', 'en', '国际关系'),
  _t('荷兰', 'NLD', REGIONS.EUROPE, 'Clingendael', 'https://www.clingendael.org/feed', 'en', '国际关系'),
  _t('瑞典', 'SWE', REGIONS.EUROPE, 'SIPRI', 'https://www.sipri.org/rss', 'en', '和平研究'),
  _t('比利时', 'BEL', REGIONS.EUROPE, 'EGMONT', 'https://www.egmontinstitute.be/feed/', 'en', '欧洲'),
  _t('捷克', 'CZE', REGIONS.EUROPE, 'Association for International Affairs', 'https://www.amo.cz/en/rss', 'en', '国际事务'), // 本地不可达（待云机恢复）
  _t('西班牙', 'ESP', REGIONS.EUROPE, 'Elcano Royal Institute', 'https://www.realinstitutoelcano.org/en/feed/', 'en', '国际关系'),

  /* ---------------- 俄罗斯/独联体 ---------------- */
  _t('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'IMEMO', 'https://imemo.ru/en/rss', 'en', '世界经济与国际关系'),

  /* ---------------- 中国 ---------------- */
  _t('中国', 'CHN', REGIONS.EAST_ASIA, 'CIIS', 'http://www.ciis.org.cn/english/rss', 'en', '中国国际问题研究院'), // 本地不可达（待云机恢复）
  _t('中国', 'CHN', REGIONS.EAST_ASIA, 'CICIR', 'http://www.cicir.ac.cn/rss', 'en', '现代国际关系研究院'), // 本地不可达（待云机恢复）
  _t('中国', 'CHN', REGIONS.EAST_ASIA, 'Pangoal', 'http://www.pangoal.cn/rss', 'zh', '盘古智库'), // 本地不可达（待云机恢复）
  _t('中国', 'CHN', REGIONS.EAST_ASIA, 'CF40', 'https://www.cf40.com.cn/rss', 'zh', '金融四十人论坛'), // 本地不可达（待云机恢复）
  _t('中国', 'CHN', REGIONS.EAST_ASIA, 'CASS', 'http://cass.cssn.cn/rss', 'zh', '中国社会科学院'), // 本地不可达（待云机恢复）

  /* ---------------- 日本 ---------------- */
  _t('日本', 'JPN', REGIONS.EAST_ASIA, 'Tokyo Foundation', 'https://www.tkfd.or.jp/feed', 'en', '政策研究'), // 本地不可达（待云机恢复）

  /* ---------------- 韩国 ---------------- */
  _t('韩国', 'KOR', REGIONS.EAST_ASIA, 'KIDA', 'https://www.kida.re.kr/english/rss', 'en', '国防分析'), // 本地不可达（待云机恢复）
  _t('韩国', 'KOR', REGIONS.EAST_ASIA, 'Asan Institute', 'https://www.asaninst.org/feed/', 'en', '亚洲政策'),

  /* ---------------- 印度 ---------------- */
  _t('印度', 'IND', REGIONS.SOUTH_ASIA, 'IDSA', 'https://idsa.in/rss', 'en', '国防研究与分析所'), // 本地不可达（待云机恢复）
  _t('印度', 'IND', REGIONS.SOUTH_ASIA, 'CSDS', 'https://www.csds.in/feed', 'en', '社会研究中心'),
  _t('印度', 'IND', REGIONS.SOUTH_ASIA, 'CPR', 'https://cprindia.org/feed/', 'en', '政策研究'),

  /* ---------------- 巴基斯坦/南亚 ---------------- */
  _t('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'ISSI', 'https://issi.org.pk/feed/', 'en', '战略研究'),
  _t('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'PIPS', 'https://pips.com.pk/feed/', 'en', '和平研究'),

  /* ---------------- 东南亚 ---------------- */
  _t('新加坡', 'SGP', REGIONS.SOUTHEAST_ASIA, 'ISEAS', 'https://www.iseas.edu.sg/feed/', 'en', '东南亚研究'),
  _t('新加坡', 'SGP', REGIONS.SOUTHEAST_ASIA, 'RSIS', 'https://www.rsis.edu.sg/feed/', 'en', '战略研究'),
  _t('泰国', 'THA', REGIONS.SOUTHEAST_ASIA, 'ISEAS Thailand', 'https://www.iseas.edu.sg/feed/', 'en', '泰国研究'),
  _t('越南', 'VNM', REGIONS.SOUTHEAST_ASIA, 'Vietnam Institute for Economics', 'https://vepr.org.vn/en/rss', 'en', '经济'), // 本地不可达（待云机恢复）
  _t('菲律宾', 'PHL', REGIONS.SOUTHEAST_ASIA, 'Stratbase ADR', 'https://stratbaseadr.org/feed/', 'en', '战略'), // 本地不可达（待云机恢复）
  _t('马来西亚', 'MYS', REGIONS.SOUTHEAST_ASIA, 'IDEAS Malaysia', 'https://ideas.org.my/feed/', 'en', '公共政策'),

  /* ---------------- 中亚 ---------------- */

  /* ---------------- 澳大利亚/大洋洲 ---------------- */
  _t('澳大利亚', 'AUS', REGIONS.OCEANIA, 'Lowy Institute', 'https://www.lowyinstitute.org/the-interpreter/feed', 'en', '国际关系'),
  _t('澳大利亚', 'AUS', REGIONS.OCEANIA, 'ASPI', 'https://www.aspi.org.au/rss', 'en', '战略政策'),
  _t('澳大利亚', 'AUS', REGIONS.OCEANIA, 'ANU East Asia Forum', 'https://www.eastasiaforum.org/feed/', 'en', '东亚研究'),

  /* ---------------- 非洲 ---------------- */
  _t('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'SAIIA', 'https://saiia.org.za/feed/', 'en', '国际事务'),
  _t('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'IEA Kenya', 'https://ieakenya.or.ke/feed/', 'en', '经济事务'),
  _t('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'NIIA', 'https://niia.gov.ng/feed/', 'en', '国际事务'),
  _t('塞内加尔', 'SEN', REGIONS.WEST_AFRICA, 'CODESRIA', 'https://codesria.org/feed/', 'en', '非洲社科'),

  /* ---------------- 中东 ---------------- */
  _t('以色列', 'ISR', REGIONS.MIDDLE_EAST, 'INSS', 'https://www.inss.org.il/feed/', 'en', '国家安全'),
  _t('阿联酋', 'ARE', REGIONS.MIDDLE_EAST, 'ECSSR', 'https://www.ecssr.ae/en/feed', 'en', '战略研究'),
  _t('土耳其', 'TUR', REGIONS.WEST_ASIA, 'EDAM', 'https://edam.org.tr/en/feed/', 'en', '外交政策'),
  _t('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'IRIS', 'https://www.iris.org.ir/feed/', 'en', '国际研究'), // 本地不可达（待云机恢复）

  /* ---------------- 拉美 ---------------- */
  _t('巴西', 'BRA', REGIONS.LATIN_AMERICA, 'Fundação Getulio Vargas', 'https://portal.fgv.br/en/rss', 'pt', '巴西智库'),
  _t('智利', 'CHL', REGIONS.LATIN_AMERICA, 'CIEPLAN', 'https://www.cieplan.org/feed/', 'es', '经济'),
];

/* ============================================================
   三、涉华专项采集源（高命中中文媒体 + 涉华外媒，每轮必抓）
   ============================================================ */
const CHINA_FOCUS_SOURCES = [
  /* 中文/中国官方与主流英文媒体 */
  _m('中国', 'CHN', REGIONS.EAST_ASIA, '中国日报', 'https://www.chinadaily.com.cn/rss/world_rss.xml', 'en', '中国对外新闻'),
  _m('中国', 'CHN', REGIONS.EAST_ASIA, '中国新闻社', 'https://www.ecns.cn/rss/rss.xml', 'en', '中国新闻'),
  _m('中国', 'CHN', REGIONS.EAST_ASIA, '上海日报', 'https://www.shine.cn/rss/news.xml', 'en', '上海英文新闻'),
  _m('中国', 'CHN', REGIONS.EAST_ASIA, 'Sixth Tone', 'https://www.sixthtone.com/rss', 'en', '中国叙事'),

  /* 中国香港/中国台湾 */
  _m('中国香港', 'HKG', REGIONS.EAST_ASIA, 'South China Morning Post', 'https://www.scmp.com/rss/91/feed', 'en', '香港视角中国'), // 本地不可达（待云机恢复）
  _m('中国香港', 'HKG', REGIONS.EAST_ASIA, 'SCMP China', 'https://www.scmp.com/rss/95/feed', 'en', '香港视角中国'), // 本地不可达（待云机恢复）
  _m('中国香港', 'HKG', REGIONS.EAST_ASIA, 'SCMP Asia', 'https://www.scmp.com/rss/5/feed', 'en', '香港视角亚太'), // 本地不可达（待云机恢复）
  _m('中国香港', 'HKG', REGIONS.EAST_ASIA, 'HKFP', 'https://hongkongfp.com/feed/', 'en', '香港新闻'),
  _m('中国台湾', 'TWN', REGIONS.EAST_ASIA, 'Taiwan News', 'https://www.taiwannews.com.tw/en/rss/headlines', 'en', '台湾英文新闻'),

  /* 国际主流媒体涉华/亚太频道 */
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'The Diplomat', 'https://thediplomat.com/feed/', 'en', '亚太外交涉华'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', '中国相关'),
  _m('国际', 'INT', REGIONS.EUROPE, 'BBC China', 'https://feeds.bbci.co.uk/news/world/asia/china/rss.xml', 'en', 'BBC中国'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Reuters China', 'https://news.google.com/rss/search?q=site:reuters.com+china&hl=en-US&gl=US&ceid=US:en', 'en', '路透中国'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'VOA News', 'https://www.voanews.com/api/zt$gteitim', 'en', '美国之音'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'RFA Chinese', 'https://www.rfa.org/mandarin/rss2.xml', 'zh', '自由亚洲中文'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Radio Free Asia', 'https://www.rfa.org/english/rss2.xml', 'en', '自由亚洲英文'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Foreign Policy', 'https://foreignpolicy.com/feed/', 'en', '外交政策涉华'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'War on the Rocks', 'https://warontherocks.com/feed/', 'en', '安全防务涉华'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Defense News', 'https://www.defensenews.com/arc/outboundfeeds/rss/category/news/?outputType=xml', 'en', '防务新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Breaking Defense', 'https://breakingdefense.com/feed/', 'en', '防务'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Brookings', 'https://www.brookings.edu/feed/', 'en', '美国布鲁金斯'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Carnegie Endowment', 'https://carnegieendowment.org/rss/solr/all', 'en', '卡内基国际和平基金会'),

  /* 国际财经/科技媒体（涉华经贸、科技、供应链信号） */
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'CNBC World', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'MarketWatch Top Stories', 'https://www.marketwatch.com/rss/topstories', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Quartz', 'https://qz.com/feed', 'en', '全球商业'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'TechCrunch', 'https://techcrunch.com/feed/', 'en', '科技'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Ars Technica', 'https://arstechnica.com/feed/', 'en', '科技政策'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'The Register', 'https://www.theregister.com/headlines.atom', 'en', '科技监管'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Rest of World', 'https://restofworld.org/feed/', 'en', '全球科技商业'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Asia Times', 'https://asiatimes.com/feed/', 'en', '亚太'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Japan Times', 'https://www.japantimes.co.jp/feed/', 'en', '日本亚太'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Mainichi Japan', 'https://mainichi.jp/english/rss/', 'en', '日本'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Financial Times World', 'https://www.ft.com/world?format=rss', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Wall Street Journal World', 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'New York Times World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Washington Post World', 'https://www.washingtonpost.com/arcio/rss/category/world/?itid=lk_inline_manual_33', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'NPR World', 'https://feeds.npr.org/1004/rss.xml', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'ABC News International', 'https://abcnews.go.com/abcnews/internationalheadlines', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'CBS News World', 'https://www.cbsnews.com/latest/rss/world', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'USA Today World', 'https://www.usatoday.com/news/world/rss/', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Newsweek', 'https://www.newsweek.com/rss', 'en', '国际时事'),

  /* 区域重要英文媒体（一带一路/中资密集国） */
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Dawn', 'https://www.dawn.com/feeds/home', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The News International', 'https://www.thenews.com.pk/rss/1/1', 'en', '巴基斯坦'),
  _m('马来西亚', 'MYS', REGIONS.SOUTHEAST_ASIA, 'Straits Times World', 'https://www.straitstimes.com/news/world/rss.xml', 'en', '新加坡'),
  _m('泰国', 'THA', REGIONS.SOUTHEAST_ASIA, 'Bangkok Post', 'https://www.bangkokpost.com/rss/data/most-recent.xml', 'en', '泰国'),
  _m('越南', 'VNM', REGIONS.SOUTHEAST_ASIA, 'VNExpress International', 'https://e.vnexpress.net/rss/world.rss', 'en', '越南'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Hindu', 'https://www.thehindu.com/news/?service=rss', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Times of India', 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', 'en', '印度'),
  _m('斯里兰卡', 'LKA', REGIONS.SOUTH_ASIA, 'Daily Mirror', 'https://www.dailymirror.lk/rss', 'en', '斯里兰卡'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'The EastAfrican', 'https://www.theeastafrican.co.ke/rss.xml', 'en', '东非'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'The Australian', 'https://www.theaustralian.com.au/feed/', 'en', '澳大利亚'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'Lowy Interpreter', 'https://www.lowyinstitute.org/the-interpreter/feed', 'en', '澳大利亚外交')
];

/* ============================================================
   四、涉华专项采集关键词（供 GDELT/搜索引擎/本地过滤使用）
   ============================================================ */
const CHINA_FOCUS_QUERIES = [
  'China', 'Chinese', 'Beijing', 'Shanghai', 'Shenzhen', 'Xi Jinping',
  'Belt and Road', 'BRI', 'One Belt One Road', '一带一路', '中资',
  'Chinese company', 'Chinese investment', 'Chinese workers', 'Chinese nationals',
  'China-Pakistan Economic Corridor', 'CPEC', 'Gwadar', 'Karakoram',
  'China-Laos Railway', 'Jakarta-Bandung', 'Hambantota', 'Piraeus',
  'rare earth', 'lithium', 'cobalt', 'copper', 'iron ore', 'critical minerals',
  'South China Sea', 'Taiwan Strait', 'Hong Kong', 'Uyghur', 'Xinjiang',
  'Tibet', 'Huawei', 'ZTE', 'BYD', 'CATL', 'Sinopharm', 'COVAX China',
  'Yuan', 'RMB internationalization', 'BRICS', 'AIIB', 'Shanghai Cooperation',
  'China-ASEAN', 'China-Africa', 'China-Europe', 'China-Latin America',
  'embassy', 'consulate', 'diplomat', 'Chinese ambassador',
  'overseas Chinese', '华侨', '华人', '华裔', '中国留学生'
];

/* ============================================================
   四（附）、境外涉华负面数据专项源（境外媒体/智库，聚焦涉华负面信号）
   说明：与 CHINA_FOCUS_SOURCES 可有部分重叠；本通道独立调度，专门抓取
   制裁、限制、冲突、袭击、事故、撤资、歧视、反华、维权等负面信息。
   ============================================================ */
const CHINA_NEGATIVE_SOURCES = [
  /* 国际主流媒体涉华/亚太频道 */
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'RFA English', 'https://www.rfa.org/english/rss2.xml', 'en', '境外涉华'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'VOA News', 'https://www.voanews.com/api/zt$gteitim', 'en', '境外涉华'), // 本地不可达（待云机恢复）
  _m('国际', 'INT', REGIONS.EUROPE, 'BBC China', 'https://feeds.bbci.co.uk/news/world/asia/china/rss.xml', 'en', 'BBC中国'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Reuters China', 'https://news.google.com/rss/search?q=site:reuters.com+china&hl=en-US&gl=US&ceid=US:en', 'en', '路透中国'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'The Diplomat', 'https://thediplomat.com/feed/', 'en', '亚太外交涉华'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Foreign Policy', 'https://foreignpolicy.com/feed/', 'en', '外交安全涉华'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'War on the Rocks', 'https://warontherocks.com/feed/', 'en', '安全防务涉华'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Brookings', 'https://www.brookings.edu/feed/', 'en', '美国布鲁金斯'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Carnegie Endowment', 'https://carnegieendowment.org/rss/solr/all', 'en', '卡内基国际和平基金会'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'AP World', 'https://news.google.com/rss/search?q=site:apnews.com+world&hl=en-US&gl=US&ceid=US:en', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.EUROPE, 'The Guardian World', 'https://www.theguardian.com/world/rss', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.EUROPE, 'DW News', 'https://rss.dw.com/rdf/rss-en-all', 'en', '欧洲全球'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', '中东全球南方'),
  _m('国际', 'INT', REGIONS.SINGAPORE, 'Channel NewsAsia', 'https://www.channelnewsasia.com/rss', 'en', '东南亚亚太'),
  _m('国际', 'INT', REGIONS.SINGAPORE, 'Straits Times World', 'https://www.straitstimes.com/news/world/rss.xml', 'en', '新加坡'),
  _m('国际', 'INT', REGIONS.HONG_KONG, 'SCMP China', 'https://www.scmp.com/rss/95/feed', 'en', '香港视角中国'), // 本地不可达（待云机恢复）

  /* 重点国家/地区英文媒体（易发中资/华人安全/负面事件） */
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Wire', 'https://thewire.in/rss', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Indian Express', 'https://indianexpress.com/feed/', 'en', '印度'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'SBS News', 'https://www.sbs.com.au/news/feed', 'en', '澳大利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Sahara Reporters', 'https://saharareporters.com/rss.xml', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Premium Times', 'https://www.premiumtimesng.com/feed/', 'en', '尼日利亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'Daily Nation', 'https://nation.africa/kenya/rss.xml', 'en', '肯尼亚'),
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'News24 Top Stories', 'https://feeds.capi24.com/v1/Search/articles/news24/TopStories/rss', 'en', '南非'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The News International', 'https://www.thenews.com.pk/rss/1/1', 'en', '巴基斯坦'),
  _m('缅甸', 'MMR', REGIONS.SOUTHEAST_ASIA, 'Myanmar Now', 'https://myanmar-now.org/en/feed/', 'en', '缅甸'),
  _m('菲律宾', 'PHL', REGIONS.SOUTHEAST_ASIA, 'Rappler', 'https://www.rappler.com/feed/', 'en', '菲律宾'),
  _m('巴西', 'BRA', REGIONS.LATIN_AMERICA, 'Folha', 'https://feeds.folha.uol.com.br/poder/rss091.xml', 'pt', '巴西'),
  _m('俄罗斯', 'RUS', REGIONS.RUSSIA_CIS, 'The Moscow Times', 'https://www.themoscowtimes.com/rss/news', 'en', '俄罗斯'),
  _m('乌克兰', 'UKR', REGIONS.EUROPE, 'Kyiv Post', 'https://www.kyivpost.com/feed/', 'en', '乌克兰'),
  _m('波兰', 'POL', REGIONS.EUROPE, 'Notes from Poland', 'https://notesfrompoland.com/feed/', 'en', '波兰'),
  _m('塞尔维亚', 'SRB', REGIONS.EUROPE, 'Balkan Insight', 'https://balkaninsight.com/feed/', 'en', '巴尔干'),
  _m('以色列', 'ISR', REGIONS.MIDDLE_EAST, 'INSS', 'https://www.inss.org.il/feed/', 'en', '国家安全'),

  /* 国际财经/科技/监管媒体（制裁、出口管制、调查、反华、供应链） */
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'CNBC World', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'MarketWatch', 'https://www.marketwatch.com/rss/topstories', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Quartz', 'https://qz.com/feed', 'en', '全球商业'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'TechCrunch', 'https://techcrunch.com/feed/', 'en', '科技监管'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Ars Technica', 'https://arstechnica.com/feed/', 'en', '科技政策'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'The Register', 'https://www.theregister.com/headlines.atom', 'en', '科技监管'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Rest of World', 'https://restofworld.org/feed/', 'en', '全球科技商业'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Politico', 'https://www.politico.com/rss/politics08.xml', 'en', '美国政治'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'The Hill', 'https://thehill.com/rss/syndicator/19110', 'en', '美国政治'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Financial Times World', 'https://www.ft.com/world?format=rss', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Wall Street Journal World', 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'en', '全球财经'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'New York Times World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.NORTH_AMERICA, 'Washington Post World', 'https://www.washingtonpost.com/arcio/rss/category/world/?itid=lk_inline_manual_33', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.EUROPE, 'The Guardian World', 'https://www.theguardian.com/world/rss', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.EUROPE, 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'en', '全球新闻'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Le Monde World', 'https://www.lemonde.fr/en/international/rss_full.xml', 'en', '国际'),
  _m('国际', 'INT', REGIONS.EUROPE, 'Der Spiegel International', 'https://www.spiegel.de/international/index.rss', 'en', '国际'),

  /* 重点国家英文媒体（中资/华人安全/负面事件高发地） */
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Dawn', 'https://www.dawn.com/feeds/home', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The News International', 'https://www.thenews.com.pk/rss/1/1', 'en', '巴基斯坦'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Khaama Press', 'https://www.khaama.com/feed/', 'en', '阿富汗'),
  _m('缅甸', 'MMR', REGIONS.SOUTHEAST_ASIA, 'The Irrawaddy', 'https://www.irrawaddy.com/feed/', 'en', '缅甸'),
  _m('菲律宾', 'PHL', REGIONS.SOUTHEAST_ASIA, 'Philippine Daily Inquirer', 'https://newsinfo.inquirer.net/feed', 'en', '菲律宾'),
  _m('马来西亚', 'MYS', REGIONS.SOUTHEAST_ASIA, 'Malay Mail', 'https://www.malaymail.com/feed/rss/malaysia', 'en', '马来西亚'),
  _m('泰国', 'THA', REGIONS.SOUTHEAST_ASIA, 'The Nation Thailand', 'https://www.nationthailand.com/rss', 'en', '泰国'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Hindu', 'https://www.thehindu.com/news/?service=rss', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Wire', 'https://thewire.in/rss', 'en', '印度'),

  /* ===== 新增：南亚区域媒体（巴基斯坦、印度重点补充）===== */
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Dawn', 'https://www.dawn.com/feeds/home', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'The News International', 'https://www.thenews.com.pk/rss/1/1', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Express Tribune', 'https://tribune.com.pk/rss', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'ARY News', 'https://arynews.tv/feed/', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Geo News', 'https://www.geo.tv/rss', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Dunya News', 'https://dunyanews.tv/en/rss.xml', 'en', '巴基斯坦'),
  _m('巴基斯坦', 'PAK', REGIONS.SOUTH_ASIA, 'Business Recorder', 'https://www.brecorder.com/rss', 'en', '巴基斯坦财经'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Times of India', 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Hindustan Times', 'https://www.hindustantimes.com/rss/topnews/rssfeed.xml', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Indian Express', 'https://indianexpress.com/feed/', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'NDTV', 'https://feeds.feedburner.com/ndtvnews-top-stories', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'India Today', 'https://www.indiatoday.in/rss/home', 'en', '印度'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'The Economic Times', 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', 'en', '印度财经'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Business Standard', 'https://www.business-standard.com/rss/home_page_top_stories.rss', 'en', '印度财经'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Mint', 'https://www.livemint.com/rss/news', 'en', '印度财经'),
  _m('印度', 'IND', REGIONS.SOUTH_ASIA, 'Firstpost', 'https://www.firstpost.com/rss', 'en', '印度'),
  _m('斯里兰卡', 'LKA', REGIONS.SOUTH_ASIA, 'Daily Mirror Sri Lanka', 'https://www.dailymirror.lk/rss', 'en', '斯里兰卡'),
  _m('斯里兰卡', 'LKA', REGIONS.SOUTH_ASIA, 'The Island Sri Lanka', 'https://island.lk/feed/', 'en', '斯里兰卡'),
  _m('尼泊尔', 'NPL', REGIONS.SOUTH_ASIA, 'Kathmandu Post', 'https://kathmandupost.com/rss', 'en', '尼泊尔'),
  _m('尼泊尔', 'NPL', REGIONS.SOUTH_ASIA, 'Online Khabar', 'https://english.onlinekhabar.com/feed', 'en', '尼泊尔'),

  /* ===== 新增：中亚五国+阿富汗媒体 ===== */
  _m('哈萨克斯坦', 'KAZ', REGIONS.CENTRAL_ASIA, 'Astana Times', 'https://astanatimes.com/feed/', 'en', '哈萨克斯坦'),
  _m('哈萨克斯坦', 'KAZ', REGIONS.CENTRAL_ASIA, 'Tengrinews', 'https://tengrinews.kz/rss/', 'en', '哈萨克斯坦'),
  _m('吉尔吉斯斯坦', 'KGZ', REGIONS.CENTRAL_ASIA, '24.kg', 'https://24.kg/rss/', 'en', '吉尔吉斯斯坦'),
  _m('吉尔吉斯斯坦', 'KGZ', REGIONS.CENTRAL_ASIA, 'AKIpress', 'https://akipress.com/rss.php', 'en', '吉尔吉斯斯坦'),
  _m('塔吉克斯坦', 'TJK', REGIONS.CENTRAL_ASIA, 'Asia-Plus', 'https://asiaplustj.info/rss', 'en', '塔吉克斯坦'),
  _m('乌兹别克斯坦', 'UZB', REGIONS.CENTRAL_ASIA, 'UzDaily', 'https://uzdaily.com/rss', 'en', '乌兹别克斯坦'),
  _m('乌兹别克斯坦', 'UZB', REGIONS.CENTRAL_ASIA, 'Gazeta.uz', 'https://www.gazeta.uz/en/rss/', 'en', '乌兹别克斯坦'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Khaama Press', 'https://www.khaama.com/feed/', 'en', '阿富汗'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Tolo News', 'https://tolonews.com/rss', 'en', '阿富汗'),
  _m('阿富汗', 'AFG', REGIONS.SOUTH_ASIA, 'Afghanistan Times', 'https://www.afghanistantimes.af/feed/', 'en', '阿富汗'), // 本地不可达（待云机恢复）

  /* ===== 新增：非洲各国媒体（大量补充）===== */
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Vanguard Nigeria', 'https://www.vanguardngr.com/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Punch Nigeria', 'https://punchng.com/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'The Guardian Nigeria', 'https://guardian.ng/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Daily Trust', 'https://dailytrust.com/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'ThisDay', 'https://www.thisdaylive.com/feed/', 'en', '尼日利亚'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'Leadership Nigeria', 'https://leadership.ng/feed/', 'en', '尼日利亚'),
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'News24', 'https://feeds.capi24.com/v1/Search/articles/news24/TopStories/rss', 'en', '南非'),
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'Daily Maverick', 'https://www.dailymaverick.co.za/feed/', 'en', '南非'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'The Standard Kenya', 'https://www.standardmedia.co.ke/rss/headlines.php', 'en', '肯尼亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'Daily Nation', 'https://nation.africa/kenya/rss.xml', 'en', '肯尼亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'Capital FM Kenya', 'https://www.capitalfm.co.ke/news/feed/', 'en', '肯尼亚'),
  _m('埃塞俄比亚', 'ETH', REGIONS.EAST_AFRICA, 'Addis Standard', 'https://addisstandard.com/feed/', 'en', '埃塞俄比亚'),
  _m('埃塞俄比亚', 'ETH', REGIONS.EAST_AFRICA, 'Addis Fortune', 'https://addisfortune.news/feed/', 'en', '埃塞俄比亚'),
  _m('埃及', 'EGY', REGIONS.NORTH_AFRICA, 'Ahram Online', 'https://english.ahram.org.eg/rss/13.aspx', 'en', '埃及'),
  _m('埃及', 'EGY', REGIONS.NORTH_AFRICA, 'Egypt Today', 'https://www.egypttoday.com/rss', 'en', '埃及'),
  _m('埃及', 'EGY', REGIONS.NORTH_AFRICA, 'Daily News Egypt', 'https://dailynewsegypt.com/feed/', 'en', '埃及'),
  _m('摩洛哥', 'MAR', REGIONS.NORTH_AFRICA, 'Morocco World News', 'https://www.moroccoworldnews.com/feed', 'en', '摩洛哥'),
  _m('摩洛哥', 'MAR', REGIONS.NORTH_AFRICA, 'The North Africa Post', 'https://northafricapost.com/feed/', 'en', '摩洛哥'),
  _m('突尼斯', 'TUN', REGIONS.NORTH_AFRICA, 'Tunis Afrique Presse', 'https://www.tap.info.tn/en/rss', 'en', '突尼斯'), // 本地不可达（待云机恢复）
  _m('利比亚', 'LBY', REGIONS.NORTH_AFRICA, 'Libya Herald', 'https://www.libyaherald.com/feed/', 'en', '利比亚'),
  _m('苏丹', 'SDN', REGIONS.NORTH_AFRICA, 'Sudan Tribune', 'https://sudantribune.com/feed/', 'en', '苏丹'),
  _m('加纳', 'GHA', REGIONS.WEST_AFRICA, 'Graphic Online', 'https://www.graphic.com.gh/?format=feed', 'en', '加纳'),
  _m('马里', 'MLI', REGIONS.WEST_AFRICA, 'Maliweb', 'https://www.maliweb.net/feed', 'fr', '马里'),
  _m('尼日尔', 'NER', REGIONS.WEST_AFRICA, 'Niger Inter', 'https://www.nigerinter.info/feed/', 'fr', '尼日尔'), // 本地不可达（待云机恢复）
  _m('布基纳法索', 'BFA', REGIONS.WEST_AFRICA, 'Burkina24', 'https://burkina24.com/feed/', 'fr', '布基纳法索'),
  _m('坦桑尼亚', 'TZA', REGIONS.EAST_AFRICA, 'Daily News Tanzania', 'https://dailynews.co.tz/feed/', 'en', '坦桑尼亚'),
  _m('乌干达', 'UGA', REGIONS.EAST_AFRICA, 'Daily Monitor Uganda', 'https://www.monitor.co.ug/rss', 'en', '乌干达'),
  _m('卢旺达', 'RWA', REGIONS.EAST_AFRICA, 'The New Times Rwanda', 'https://www.newtimes.co.rw/rss', 'en', '卢旺达'),
  _m('索马里', 'SOM', REGIONS.EAST_AFRICA, 'Garowe Online', 'https://www.garoweonline.com/en/rss', 'en', '索马里'),
  _m('赞比亚', 'ZMB', REGIONS.SOUTHERN_AFRICA, 'Lusaka Times', 'https://www.lusakatimes.com/feed/', 'en', '赞比亚'),
  _m('赞比亚', 'ZMB', REGIONS.SOUTHERN_AFRICA, 'Zambia Daily Mail', 'https://www.daily-mail.co.zm/feed/', 'en', '赞比亚'),
  _m('津巴布韦', 'ZWE', REGIONS.SOUTHERN_AFRICA, 'The Herald Zimbabwe', 'https://www.herald.co.zw/feed/', 'en', '津巴布韦'),
  _m('津巴布韦', 'ZWE', REGIONS.SOUTHERN_AFRICA, 'NewsDay Zimbabwe', 'https://www.newsday.co.zw/feed', 'en', '津巴布韦'),
  _m('莫桑比克', 'MOZ', REGIONS.SOUTHERN_AFRICA, 'Club of Mozambique', 'https://clubofmozambique.com/feed/', 'en', '莫桑比克'),
  _m('安哥拉', 'AGO', REGIONS.SOUTHERN_AFRICA, 'Angola Press', 'https://www.angop.ao/en/rss/', 'en', '安哥拉'),
  _m('刚果(金)', 'COD', REGIONS.CENTRAL_AFRICA, 'Actualite.cd', 'https://actualite.cd/rss.xml', 'fr', '刚果金'),
  _m('刚果(金)', 'COD', REGIONS.CENTRAL_AFRICA, 'Radio Okapi', 'https://www.radiookapi.net/feed', 'fr', '刚果金'),
  _m('乍得', 'TCD', REGIONS.CENTRAL_AFRICA, 'Tchad Infos', 'https://tchadinfos.com/feed/', 'fr', '乍得'),

  /* ===== 新增：中东各国媒体（大量补充）===== */
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Tehran Times', 'https://www.tehrantimes.com/rss', 'en', '伊朗'),
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Press TV', 'https://www.presstv.ir/rss', 'en', '伊朗'), // 本地不可达（待云机恢复）
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Mehr News', 'https://en.mehrnews.com/rss', 'en', '伊朗'),
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Tasnim News', 'https://www.tasnimnews.com/en/rss', 'en', '伊朗'), // 本地不可达（待云机恢复）
  _m('伊拉克', 'IRQ', REGIONS.MIDDLE_EAST, 'Kurdistan24', 'https://www.kurdistan24.net/en/rss', 'en', '伊拉克'),
  _m('伊拉克', 'IRQ', REGIONS.MIDDLE_EAST, 'Rudaw', 'https://www.rudaw.net/english/rss', 'en', '伊拉克'),
  _m('伊拉克', 'IRQ', REGIONS.MIDDLE_EAST, 'Iraqi News', 'https://www.iraqinews.com/feed/', 'en', '伊拉克'),
  _m('黎巴嫩', 'LBN', REGIONS.MIDDLE_EAST, 'The Daily Star Lebanon', 'https://www.dailystar.com.lb/rss', 'en', '黎巴嫩'),
  _m('黎巴嫩', 'LBN', REGIONS.MIDDLE_EAST, 'Naharnet', 'https://www.naharnet.com/rss', 'en', '黎巴嫩'),
  _m('约旦', 'JOR', REGIONS.MIDDLE_EAST, 'Jordan Times', 'https://www.jordantimes.com/rss', 'en', '约旦'),
  _m('约旦', 'JOR', REGIONS.MIDDLE_EAST, 'Roya News English', 'https://en.royanews.tv/rss', 'en', '约旦'),
  _m('阿联酋', 'ARE', REGIONS.MIDDLE_EAST, 'The National UAE', 'https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml', 'en', '阿联酋'),
  _m('沙特阿拉伯', 'SAU', REGIONS.MIDDLE_EAST, 'Arab News', 'https://www.arabnews.com/rss', 'en', '沙特阿拉伯'),
  _m('沙特阿拉伯', 'SAU', REGIONS.MIDDLE_EAST, 'Saudi Gazette', 'https://saudigazette.com.sa/rss', 'en', '沙特阿拉伯'),
  _m('卡塔尔', 'QAT', REGIONS.MIDDLE_EAST, 'Gulf Times', 'https://www.gulf-times.com/rss', 'en', '卡塔尔'),
  _m('卡塔尔', 'QAT', REGIONS.MIDDLE_EAST, 'The Peninsula Qatar', 'https://thepeninsulaqatar.com/rss', 'en', '卡塔尔'),
  _m('阿曼', 'OMN', REGIONS.MIDDLE_EAST, 'Muscat Daily', 'https://www.muscatdaily.com/rss', 'en', '阿曼'),
  _m('也门', 'YEM', REGIONS.MIDDLE_EAST, 'Yemen Times', 'https://www.yementimes.com/rss', 'en', '也门'),
  _m('叙利亚', 'SYR', REGIONS.MIDDLE_EAST, 'Syria Times', 'https://www.syriatimes.sy/rss', 'en', '叙利亚'), // 本地不可达（待云机恢复）
  _m('以色列', 'ISR', REGIONS.MIDDLE_EAST, 'Times of Israel', 'https://www.timesofisrael.com/feed/', 'en', '以色列'),
  _m('以色列', 'ISR', REGIONS.MIDDLE_EAST, 'Jerusalem Post', 'https://www.jpost.com/Rss/RssFeedsHeadlines.aspx', 'en', '以色列'),
  _m('以色列', 'ISR', REGIONS.MIDDLE_EAST, 'Haaretz', 'https://www.haaretz.com/cmlink/1.628752', 'en', '以色列'),
  _m('巴勒斯坦', 'PSE', REGIONS.MIDDLE_EAST, 'Ma\'an News', 'https://www.maannews.net/eng/rss', 'en', '巴勒斯坦'),
  _m('巴勒斯坦', 'PSE', REGIONS.MIDDLE_EAST, 'Palestine Chronicle', 'https://www.palestinechronicle.com/feed/', 'en', '巴勒斯坦'),

  /* ===== 新增：拉美区域媒体 ===== */
  _m('墨西哥', 'MEX', REGIONS.LATIN_AMERICA, 'Mexico News Daily', 'https://mexiconewsdaily.com/feed/', 'en', '墨西哥'),
  _m('阿根廷', 'ARG', REGIONS.LATIN_AMERICA, 'Buenos Aires Times', 'https://www.batimes.com.ar/feed', 'en', '阿根廷'),
  _m('智利', 'CHL', REGIONS.LATIN_AMERICA, 'Santiago Times', 'https://santiagotimes.cl/feed/', 'en', '智利'),
  _m('秘鲁', 'PER', REGIONS.LATIN_AMERICA, 'Peru Reports', 'https://perureports.com/feed/', 'en', '秘鲁'),
  _m('哥伦比亚', 'COL', REGIONS.LATIN_AMERICA, 'Colombia Reports', 'https://colombiareports.com/feed/', 'en', '哥伦比亚'),
  _m('委内瑞拉', 'VEN', REGIONS.LATIN_AMERICA, 'Caracas Chronicles', 'https://www.caracaschronicles.com/feed/', 'en', '委内瑞拉'),

  /* ===== 新增：中亚/高加索区域媒体 ===== */
  _m('哈萨克斯坦', 'KAZ', REGIONS.CENTRAL_ASIA, 'Astana Times', 'https://astanatimes.com/feed/', 'en', '哈萨克斯坦'),
  _m('乌兹别克斯坦', 'UZB', REGIONS.CENTRAL_ASIA, 'UzDaily', 'https://uzdaily.com/rss', 'en', '乌兹别克斯坦'),
  _m('阿塞拜疆', 'AZE', REGIONS.CENTRAL_ASIA, 'Trend News', 'https://en.trend.az/rss', 'en', '阿塞拜疆'),
  _m('格鲁吉亚', 'GEO', REGIONS.CENTRAL_ASIA, 'Georgia Today', 'https://georgiatoday.ge/rss', 'en', '格鲁吉亚'),
  _m('亚美尼亚', 'ARM', REGIONS.CENTRAL_ASIA, 'Armenpress', 'https://armenpress.am/en/rss', 'en', '亚美尼亚'),

  /* ===== 新增：东南亚/大洋洲区域媒体 ===== */
  _m('柬埔寨', 'KHM', REGIONS.SOUTHEAST_ASIA, 'Khmer Times', 'https://www.khmertimeskh.com/feed/', 'en', '柬埔寨'),
  _m('斯里兰卡', 'LKA', REGIONS.SOUTH_ASIA, 'Colombo Gazette', 'https://colombogazette.com/feed/', 'en', '斯里兰卡'), // 本地不可达（待云机恢复）
  _m('尼泊尔', 'NPL', REGIONS.SOUTH_ASIA, 'The Himalayan Times', 'https://thehimalayantimes.com/rssFeed/0', 'en', '尼泊尔'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'ABC News Australia', 'https://www.abc.net.au/news/feed/51120/rss.xml', 'en', '澳大利亚'),
  _m('新西兰', 'NZL', REGIONS.OCEANIA, 'RNZ News', 'https://www.rnz.co.nz/rss/national.xml', 'en', '新西兰'), // 本地不可达（待云机恢复）

  /* ===== 新增：欧洲区域媒体（补充） ===== */
  _m('土耳其', 'TUR', REGIONS.EUROPE, 'Daily Sabah', 'https://www.dailysabah.com/rss', 'en', '土耳其'),
  _m('希腊', 'GRC', REGIONS.EUROPE, 'Ekathimerini', 'https://www.ekathimerini.com/rss', 'en', '希腊'), // 本地不可达（待云机恢复）
  _m('罗马尼亚', 'ROU', REGIONS.EUROPE, 'Romania Insider', 'https://www.romania-insider.com/rss', 'en', '罗马尼亚'), // 本地不可达（待云机恢复）
  _m('匈牙利', 'HUN', REGIONS.EUROPE, 'Hungary Today', 'https://hungarytoday.hu/feed/', 'en', '匈牙利'),
  _m('捷克', 'CZE', REGIONS.EUROPE, 'Prague Morning', 'https://www.praguemorning.cz/feed/', 'en', '捷克'), // 本地不可达（待云机恢复）
  _m('孟加拉国', 'BGD', REGIONS.SOUTH_ASIA, 'Prothom Alo', 'https://en.prothomalo.com/feed', 'en', '孟加拉国'),
  _m('斯里兰卡', 'LKA', REGIONS.SOUTH_ASIA, 'Daily Mirror', 'https://www.dailymirror.lk/rss', 'en', '斯里兰卡'),
  _m('哈萨克斯坦', 'KAZ', REGIONS.CENTRAL_ASIA, 'Astana Times', 'https://astanatimes.com/feed/', 'en', '哈萨克斯坦'),
  _m('伊朗', 'IRN', REGIONS.MIDDLE_EAST, 'Iran International', 'https://www.iranintl.com/en/feed', 'en', '伊朗'),
  _m('伊拉克', 'IRQ', REGIONS.MIDDLE_EAST, 'Al-Monitor', 'https://www.al-monitor.com/rss', 'en', '中东'),
  _m('土耳其', 'TUR', REGIONS.WEST_ASIA, 'Daily Sabah', 'https://www.dailysabah.com/rss', 'en', '土耳其'),
  _m('埃及', 'EGY', REGIONS.NORTH_AFRICA, 'Egypt Independent', 'https://www.egyptindependent.com/feed/', 'en', '埃及'),
  _m('利比亚', 'LBY', REGIONS.NORTH_AFRICA, 'Libya Herald', 'https://libyaherald.com/feed/', 'en', '利比亚'),
  _m('苏丹', 'SDN', REGIONS.NORTH_AFRICA, 'Sudan Tribune', 'https://sudantribune.com/feed/', 'en', '苏丹'),
  _m('尼日利亚', 'NGA', REGIONS.WEST_AFRICA, 'The Cable', 'https://www.thecable.ng/feed', 'en', '尼日利亚'),
  _m('肯尼亚', 'KEN', REGIONS.EAST_AFRICA, 'The Standard', 'https://www.standardmedia.co.ke/rss/kenya.php', 'en', '肯尼亚'),
  _m('南非', 'ZAF', REGIONS.SOUTHERN_AFRICA, 'Daily Maverick', 'https://www.dailymaverick.co.za/rss/', 'en', '南非'),
  _m('巴西', 'BRA', REGIONS.LATIN_AMERICA, 'O Globo', 'https://oglobo.globo.com/rss.xml', 'pt', '巴西'),
  _m('墨西哥', 'MEX', REGIONS.LATIN_AMERICA, 'Reforma', 'https://www.reforma.com/rss/', 'es', '墨西哥'),
  _m('阿根廷', 'ARG', REGIONS.LATIN_AMERICA, 'Clarín', 'https://www.clarin.com/rss/lo-ultimo/', 'es', '阿根廷'),
  _m('秘鲁', 'PER', REGIONS.LATIN_AMERICA, 'El Comercio', 'https://elcomercio.pe/feed/', 'es', '秘鲁'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'ABC News', 'https://www.abc.net.au/news/feed/51120/rss.xml', 'en', '澳大利亚'),
  _m('澳大利亚', 'AUS', REGIONS.OCEANIA, 'ASPI', 'https://www.aspi.org.au/rss', 'en', '澳大利亚战略政策')
];

/* ============================================================
   四（附）、境外涉华负面关键词（负面信号过滤用）
   ============================================================ */
const CHINA_NEGATIVE_QUERIES = [
  'China sanctions', 'Chinese sanctions', 'China boycott', 'China ban', 'China restrictions', 'China tariffs',
  'China trade war', 'China tech blockade', 'China chip ban', 'Huawei ban', 'ZTE ban', 'TikTok ban', 'WeChat ban',
  'China protest', 'China crackdown', 'China condemnation', 'China criticism', 'China threat', 'China attack',
  'Chinese company raid', 'Chinese investment risk', 'China debt trap', 'BRI backlash', 'BRI protest',
  'Chinese workers attack', 'Chinese nationals kidnapped', 'Chinese embassy attack', 'Chinese consulate',
  'anti-China', 'anti-Chinese', 'China espionage', 'China spy', 'South China Sea tensions', 'Taiwan Strait tensions',
  'Hong Kong crackdown', 'Uyghur sanctions', 'Xinjiang sanctions', 'Chinese military threat',
  '制裁中国', '抵制中国', '限制中国', '反华', '排华', '对华制裁', '对华关税', '对华芯片禁令', '对华技术封锁',
  '中企被查', '中企被罚款', '中资撤离', '中资项目受阻', '中国公民遇袭', '中国公民被绑架', '中国使馆遇袭',
  '华人遇袭', '华侨遭袭', '一带一路抗议', '一带一路债务陷阱', '南海紧张', '台海紧张', '香港镇压',
  '维权', '索赔', '诉讼', '仲裁', '调查', '反垄断', '知识产权侵权'
];

/* ============================================================
   五、按区域统计辅助函数
   ============================================================ */
function statsByRegion(items) {
  const out = {};
  (items || []).forEach(it => {
    const r = it.region || '未分类';
    out[r] = (out[r] || 0) + 1;
  });
  return out;
}
function statsByCountry(items) {
  const out = {};
  (items || []).forEach(it => {
    const k = it.cn || '未分类';
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
function statsByType(items) {
  const out = {};
  (items || []).forEach(it => {
    const t = it.type || 'unknown';
    out[t] = (out[t] || 0) + 1;
  });
  return out;
}

/* ===== 区域重点扩充（2026-08-24：阿富汗/中亚/印度/非洲/拉美/日韩/东南亚/欧美，直采+GoogleNews查询+AllAfrica+ReliefWeb）===== */
const regional = require('./regional_feeds');
const DIRECT_RSS_ALL = (() => {
  const seen = new Set(), out = [];
  for (const s of DIRECT_RSS.concat(regional.REGIONAL_ALL || [])) {
    const k = String(s.url || '').replace(/\/+$/, '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return out;
})();

module.exports = {
  REGIONS, REGION_GROUP,
  DIRECT_RSS: DIRECT_RSS_ALL, THINK_TANK_FEEDS, CHINA_FOCUS_SOURCES, CHINA_FOCUS_QUERIES,
  CHINA_NEGATIVE_SOURCES, CHINA_NEGATIVE_QUERIES,
  REGIONAL_STATS: regional.REGIONAL_STATS,
  statsByRegion, statsByCountry, statsByType
};
