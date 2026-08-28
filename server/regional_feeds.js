/**
 * server/regional_feeds.js — 区域重点数据源扩充模块（2026-08-24）
 *
 * 用户指令：对系统 445 源全面救援，扩充至 1000+，重点覆盖：
 *   阿富汗、中亚五国、印度、非洲各国、拉美各国、日本、韩国、东南亚各国、欧美各国。
 *
 * 组成（全部真实通道，零模拟）：
 *   1. DIRECT_REGIONAL —— 重点区域主流媒体直采 RSS（人工登记）；
 *   2. GOOGLE_NEWS_SOURCES —— Google News RSS 按国别×主题生成的查询源
 *      （URL 模式官方稳定：news.google.com/rss/search?q=..&hl=..&gl=..&ceid=..）；
 *   3. ALLAFRICA_FEEDS —— AllAfrica 非洲各国官方 RDF 聚合源；
 *   4. RELIEFWEB_FEEDS —— 联合国 ReliefWeb 国别人道/安全态势 RSS（ISO3）。
 *
 * 铁律（与 media_feeds.js 一致）：本文件只登记通道，不可达源抓取时自然失败、如实返回 0 条。
 * 暴露：REGIONAL_ALL（并入 media_feeds.DIRECT_RSS）、REGIONAL_STATS。
 */
'use strict';

/* 区域名与 media_feeds.js REGIONS 保持一致 */
const CA = '中亚', SA = '南亚', SEA = '东南亚', EA = '东亚', ME = '中东',
      NAf = '北非', WAf = '西非', EAf = '东非', SAf = '南部非洲',
      EU = '欧洲', NA = '北美', LATAM = '拉美', OC = '大洋洲';

function _m(cn, iso, region, name, url, lang, focus) {
  return { cn, iso, region, name, url, type: 'media', lang: lang || 'en', focus: focus || '' };
}

/* ================= 1. 重点区域直采 RSS（人工登记） ================= */
const DIRECT_REGIONAL = [
  /* ---- 阿富汗（用户单列重点） ---- */
  _m('阿富汗', 'AF', CA, 'TOLOnews', 'https://tolonews.com/rss.xml', 'en', '安全/政局'),
  _m('阿富汗', 'AF', CA, 'Pajhwok Afghan News', 'https://pajhwok.com/en/feed/', 'en', '安全/政局'),
  _m('阿富汗', 'AF', CA, 'Khaama Press', 'https://www.khaama.com/feed/', 'en', '安全/政局'),
  _m('阿富汗', 'AF', CA, 'Ariana News', 'https://ariananews.af/feed/', 'en', '安全/政局'),
  _m('阿富汗', 'AF', CA, 'Afghanistan International', 'https://www.afintl.com/en/rss', 'en', '政局/人权'),
  _m('阿富汗', 'AF', CA, 'KabulNow', 'https://kabulnow.com/feed/', 'en', '安全/投资/电力'),
  /* ---- 中亚五国 ---- */
  _m('哈萨克斯坦', 'KZ', CA, 'The Astana Times', 'https://astanatimes.com/feed/', 'en', '政局/经济'),
  _m('哈萨克斯坦', 'KZ', CA, 'Kazinform', 'https://qazinform.com/rss/', 'en', '官方通讯'),
  _m('哈萨克斯坦', 'KZ', CA, 'Tengrinews', 'https://tengrinews.kz/eng/rss/', 'en', '综合'),
  _m('哈萨克斯坦', 'KZ', CA, 'Kapital.kz', 'https://kapital.kz/rss', 'ru', '经济'),
  _m('乌兹别克斯坦', 'UZ', CA, 'Gazeta.uz', 'https://www.gazeta.uz/en/rss/', 'en', '政局/经济'),
  _m('乌兹别克斯坦', 'UZ', CA, 'Kun.uz', 'https://kun.uz/en/rss', 'en', '综合'),
  _m('乌兹别克斯坦', 'UZ', CA, 'Daryo', 'https://daryo.uz/en/feed', 'en', '综合'),
  _m('乌兹别克斯坦', 'UZ', CA, 'UzDaily', 'https://www.uzdaily.uz/en/rss', 'en', '经济'),
  _m('土库曼斯坦', 'TM', CA, 'Orient', 'https://orient.tm/en/rss', 'en', '政局/经济'),
  _m('吉尔吉斯斯坦', 'KG', CA, 'AKIpress', 'https://akipress.com/rss.php', 'ru', '综合'),
  _m('吉尔吉斯斯坦', 'KG', CA, '24.kg English', 'https://24.kg/english/rss/', 'en', '综合'),
  _m('吉尔吉斯斯坦', 'KG', CA, 'Kabar', 'https://en.kabar.kg/rss/', 'en', '官方通讯'),
  _m('吉尔吉斯斯坦', 'KG', CA, 'Kloop', 'https://kloop.kg/blog/feed/', 'ru', '调查报道'),
  _m('塔吉克斯坦', 'TJ', CA, 'Asia-Plus', 'https://asiaplustj.info/en/rss', 'en', '综合'),
  _m('塔吉克斯坦', 'TJ', CA, 'Khovar', 'https://eng.khovar.tj/rss/', 'en', '官方通讯'),
  _m('中亚区域', 'CA-REG', CA, 'Eurasianet', 'https://eurasianet.org/rss.xml', 'en', '中亚/高加索深度'),
  _m('中亚区域', 'CA-REG', CA, 'Diplomat Central Asia', 'https://thediplomat.com/feed/', 'en', '地缘分析'),
  /* ---- 印度（用户单列重点） ---- */
  _m('印度', 'IN', SA, 'The Hindu National', 'https://www.thehindu.com/news/national/feeder/default.rss', 'en', '政局'),
  _m('印度', 'IN', SA, 'The Hindu International', 'https://www.thehindu.com/news/international/feeder/default.rss', 'en', '外交'),
  _m('印度', 'IN', SA, 'Times of India Top', 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', 'en', '综合'),
  _m('印度', 'IN', SA, 'TOI World', 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', 'en', '国际'),
  _m('印度', 'IN', SA, 'Hindustan Times India', 'https://www.hindustantimes.com/rss/india-news/rssfeed.xml', 'en', '政局'),
  _m('印度', 'IN', SA, 'Hindustan Times World', 'https://www.hindustantimes.com/rss/world-news/rssfeed.xml', 'en', '国际'),
  _m('印度', 'IN', SA, 'NDTV Top Stories', 'https://feeds.feedburner.com/ndtvnews-top-stories', 'en', '综合'),
  _m('印度', 'IN', SA, 'NDTV World', 'https://feeds.feedburner.com/ndtvnews-world-news', 'en', '国际'),
  _m('印度', 'IN', SA, 'Indian Express', 'https://indianexpress.com/feed/', 'en', '政局/调查'),
  _m('印度', 'IN', SA, 'The Wire', 'https://thewire.in/feed', 'en', '安全/社会'),
  _m('印度', 'IN', SA, 'Scroll.in', 'https://scroll.in/feed', 'en', '深度'),
  _m('印度', 'IN', SA, 'The Print', 'https://theprint.in/feed/', 'en', '防务/政局'),
  _m('印度', 'IN', SA, 'Firstpost', 'https://www.firstpost.com/feed', 'en', '综合'),
  _m('印度', 'IN', SA, 'India Today', 'https://www.indiatoday.in/rss/home', 'en', '综合'),
  _m('印度', 'IN', SA, 'Mint Politics', 'https://www.livemint.com/rss/politics', 'en', '政策/经济'),
  _m('印度', 'IN', SA, 'Economic Times Top', 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', 'en', '经济'),
  _m('印度', 'IN', SA, 'Deccan Herald', 'https://www.deccanherald.com/rss-feed', 'en', '综合'),
  _m('印度', 'IN', SA, 'Tribune India', 'https://www.tribuneindia.com/rss/feed.aspx', 'en', '北部/边境'),
  _m('印度', 'IN', SA, 'News18', 'https://www.news18.com/rss/india.xml', 'en', '综合'),
  _m('印度', 'IN', SA, 'Business Standard', 'https://www.business-standard.com/rss/home_page_top_stories.rss', 'en', '经济'),
  /* ---- 日本 ---- */
  _m('日本', 'JP', EA, 'Japan Times', 'https://www.japantimes.co.jp/feed/', 'en', '综合'),
  _m('日本', 'JP', EA, 'NHK World', 'https://www3.nhk.or.jp/nhkworld/en/news/rss/', 'en', '官方国际'),
  _m('日本', 'JP', EA, 'Asahi AJW', 'https://www.asahi.com/ajw/rss/index.rdf', 'en', '政局'),
  _m('日本', 'JP', EA, 'Mainichi English', 'https://mainichi.jp/english/rss/etc/english.rdf', 'en', '综合'),
  _m('日本', 'JP', EA, 'Kyodo News', 'https://english.kyodonews.net/rss/news.xml', 'en', '通讯社'),
  _m('日本', 'JP', EA, 'Nikkei Asia', 'https://asia.nikkei.com/rss/feed/nar', 'en', '经济/供应链'),
  _m('日本', 'JP', EA, 'Japan Today', 'https://japantoday.com/feed', 'en', '综合'),
  _m('日本', 'JP', EA, 'Nippon.com', 'https://www.nippon.com/en/feed/', 'en', '深度'),
  _m('日本', 'JP', EA, 'Yomiuri Japan News', 'https://japannews.yomiuri.co.jp/feed/', 'en', '政局'),
  /* ---- 韩国 ---- */
  _m('韩国', 'KR', EA, 'Yonhap English', 'https://en.yna.co.kr/RSS/news.xml', 'en', '通讯社'),
  _m('韩国', 'KR', EA, 'Korea Herald', 'https://www.koreaherald.com/rss/020100000000.xml', 'en', '综合'),
  _m('韩国', 'KR', EA, 'Korea Times', 'https://www.koreatimes.co.kr/www/rss/rss.xml', 'en', '综合'),
  _m('韩国', 'KR', EA, 'Chosun English', 'https://www.chosun.com/english/rss/outlet/', 'en', '政局'),
  _m('韩国', 'KR', EA, 'Korea JoongAng Daily', 'https://koreajoongangdaily.joins.com/news/rss', 'en', '综合'),
  _m('韩国', 'KR', EA, 'Hankyoreh English', 'https://english.hani.co.kr/rss/', 'en', '进步视角'),
  _m('韩国', 'KR', EA, 'Dong-A Ilbo English', 'https://english.donga.com/rss/', 'en', '政局'),
  _m('韩国', 'KR', EA, 'KBS World', 'https://world.kbs.co.kr/rss/rss_news.htm', 'en', '官方国际'),
  _m('韩国', 'KR', EA, 'Arirang News', 'https://www.arirang.com/rss/news.xml', 'en', '官方国际'),
  /* ---- 东南亚 ---- */
  _m('新加坡', 'SG', SEA, 'Straits Times', 'https://www.straitstimes.com/news/singapore/rss.xml', 'en', '综合'),
  _m('新加坡', 'SG', SEA, 'Straits Times Asia', 'https://www.straitstimes.com/news/asia/rss.xml', 'en', '亚洲'),
  _m('新加坡', 'SG', SEA, 'CNA', 'https://www.channelnewsasia.com/rssfeeds/8395986', 'en', '综合'),
  _m('新加坡', 'SG', SEA, 'CNA Asia', 'https://www.channelnewsasia.com/rssfeeds/8395882', 'en', '亚洲'),
  _m('印度尼西亚', 'ID', SEA, 'Jakarta Post', 'https://www.thejakartapost.com/rss', 'en', '综合'),
  _m('印度尼西亚', 'ID', SEA, 'Tempo English', 'https://en.tempo.co/rss', 'en', '政局'),
  _m('印度尼西亚', 'ID', SEA, 'Antara News', 'https://en.antaranews.com/rss', 'en', '官方通讯'),
  _m('越南', 'VN', SEA, 'VnExpress International', 'https://e.vnexpress.net/rss/news.rss', 'en', '综合'),
  _m('越南', 'VN', SEA, 'Vietnam News', 'https://vietnamnews.vn/rss/home.rss', 'en', '官方'),
  _m('越南', 'VN', SEA, 'Tuoi Tre News', 'https://tuoitre.vn/rss/tin-tuc.rss', 'vi', '综合'),
  _m('泰国', 'TH', SEA, 'Bangkok Post', 'https://www.bangkokpost.com/rss/data/news.xml', 'en', '综合'),
  _m('泰国', 'TH', SEA, 'The Nation Thailand', 'https://www.nationthailand.com/rss', 'en', '政局'),
  _m('泰国', 'TH', SEA, 'Thai PBS World', 'https://www.thaipbsworld.com/feed/', 'en', '公共媒体'),
  _m('菲律宾', 'PH', SEA, 'Inquirer', 'https://newsinfo.inquirer.net/feed', 'en', '政局'),
  _m('菲律宾', 'PH', SEA, 'Manila Bulletin', 'https://mb.com.ph/feed/', 'en', '综合'),
  _m('菲律宾', 'PH', SEA, 'Philstar', 'https://www.philstar.com/rss/headlines', 'en', '综合'),
  _m('菲律宾', 'PH', SEA, 'Rappler', 'https://www.rappler.com/feed/', 'en', '调查'),
  _m('马来西亚', 'MY', SEA, 'New Straits Times', 'https://www.nst.com.my/rss', 'en', '综合'),
  _m('马来西亚', 'MY', SEA, 'The Star Malaysia', 'https://www.thestar.com.my/rss/news/nation/', 'en', '综合'),
  _m('马来西亚', 'MY', SEA, 'Malay Mail', 'https://www.malaymail.com/feed', 'en', '政局'),
  _m('马来西亚', 'MY', SEA, 'Free Malaysia Today', 'https://www.freemalaysiatoday.com/feed/', 'en', '政局'),
  _m('柬埔寨', 'KH', SEA, 'Khmer Times', 'https://www.khmertimeskh.com/feed/', 'en', '综合'),
  _m('柬埔寨', 'KH', SEA, 'Phnom Penh Post', 'https://www.phnompenhpost.com/rss', 'en', '政局'),
  _m('缅甸', 'MM', SEA, 'The Irrawaddy', 'https://www.irrawaddy.com/feed', 'en', '冲突/政局'),
  _m('缅甸', 'MM', SEA, 'Myanmar Now', 'https://myanmar-now.org/en/feed/', 'en', '冲突/人权'),
  _m('缅甸', 'MM', SEA, 'Frontier Myanmar', 'https://www.frontiermyanmar.net/en/feed/', 'en', '深度'),
  _m('缅甸', 'MM', SEA, 'Mizzima', 'https://mizzima.com/feed', 'en', '流亡媒体'),
  _m('老挝', 'LA', SEA, 'Vientiane Times', 'https://www.vientianetimes.org.la/rss/rss.xml', 'en', '官方'),
  _m('文莱', 'BN', SEA, 'Borneo Bulletin', 'https://borneobulletin.com.bn/rss/', 'en', '综合'),
  _m('东帝汶', 'TL', SEA, 'Tatoli', 'https://en.tatoli.tl/feed/', 'en', '官方'),
  _m('东南亚区域', 'SEA-REG', SEA, 'BenarNews', 'https://www.benarnews.org/rss/z/657', 'en', '反恐/安全'),
  _m('东南亚区域', 'SEA-REG', SEA, 'The Diplomat SEA', 'https://thediplomat.com/regions/southeast-asia/feed/', 'en', '地缘分析'),
  /* ---- 拉美 ---- */
  _m('拉美区域', 'LATAM-REG', LATAM, 'MercoPress', 'https://en.mercopress.com/rss', 'en', '南锥体/大西洋'),
  _m('拉美区域', 'LATAM-REG', LATAM, 'InSight Crime', 'https://insightcrime.org/feed/', 'en', '有组织犯罪'),
  _m('拉美区域', 'LATAM-REG', LATAM, 'Latin American Post', 'https://latinamericanpost.com/feed/', 'en', '综合'),
  _m('拉美区域', 'LATAM-REG', LATAM, 'Telesur English', 'https://www.telesurenglish.net/rss/RssPortada.html', 'en', '左翼视角'),
  _m('阿根廷', 'AR', LATAM, 'Buenos Aires Times', 'https://www.batimes.com.ar/feed', 'en', '综合'),
  _m('阿根廷', 'AR', LATAM, 'Infobae', 'https://www.infobae.com/feeds/rss/', 'es', '综合'),
  _m('阿根廷', 'AR', LATAM, 'Ámbito', 'https://www.ambito.com/rss/pages/home.xml', 'es', '经济'),
  _m('阿根廷', 'AR', LATAM, 'La Nación', 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/', 'es', '政局'),
  _m('巴西', 'BR', LATAM, 'Folha Em Cima da Hora', 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', 'pt', '综合'),
  _m('巴西', 'BR', LATAM, 'G1 Globo', 'https://g1.globo.com/rss/g1/', 'pt', '综合'),
  _m('巴西', 'BR', LATAM, 'O Globo', 'https://oglobo.globo.com/rss.xml', 'pt', '政局'),
  _m('巴西', 'BR', LATAM, 'The Rio Times', 'https://riotimesonline.com/feed/', 'en', '英文视角'),
  _m('墨西哥', 'MX', LATAM, 'El Universal', 'https://www.eluniversal.com.mx/rss/mexico.xml', 'es', '政局'),
  _m('墨西哥', 'MX', LATAM, 'Mexico News Daily', 'https://mexiconewsdaily.com/feed/', 'en', '综合'),
  _m('墨西哥', 'MX', LATAM, 'Milenio', 'https://www.milenio.com/rss/mexico', 'es', '安全'),
  _m('哥伦比亚', 'CO', LATAM, 'El Tiempo', 'https://www.eltiempo.com/rss/politica.xml', 'es', '政局'),
  _m('哥伦比亚', 'CO', LATAM, 'Colombia Reports', 'https://colombiareports.com/feed/', 'en', '冲突/政局'),
  _m('智利', 'CL', LATAM, 'La Tercera', 'https://www.latercera.com/arc/outboundfeeds/rss/', 'es', '综合'),
  _m('智利', 'CL', LATAM, 'BioBioChile', 'https://www.biobiochile.cl/lista/categorias/nacional/rss', 'es', '综合'),
  _m('智利', 'CL', LATAM, 'Santiago Times', 'https://santiagotimes.cl/feed/', 'en', '英文视角'),
  _m('秘鲁', 'PE', LATAM, 'El Comercio Peru', 'https://elcomercio.pe/arc/outboundfeeds/rss/', 'es', '综合'),
  _m('秘鲁', 'PE', LATAM, 'Peruvian Times', 'https://peruviantimes.com/feed/', 'en', '英文视角'),
  _m('委内瑞拉', 'VE', LATAM, 'Efecto Cocuyo', 'https://efectococuyo.com/feed/', 'es', '独立媒体'),
  _m('委内瑞拉', 'VE', LATAM, 'Tal Cual', 'https://talcualdigital.com/feed/', 'es', '反对派视角'),
  _m('厄瓜多尔', 'EC', LATAM, 'Primicias', 'https://www.primicias.ec/feed/', 'es', '综合'),
  _m('厄瓜多尔', 'EC', LATAM, 'El Comercio EC', 'https://www.elcomercio.com/feed/', 'es', '综合'),
  _m('玻利维亚', 'BO', LATAM, 'Los Tiempos', 'https://www.lostiempos.com/rss', 'es', '综合'),
  _m('乌拉圭', 'UY', LATAM, 'El País Uruguay', 'https://www.elpais.com.uy/rss', 'es', '综合'),
  _m('巴拉圭', 'PY', LATAM, 'Última Hora', 'https://www.ultimahora.com/rss', 'es', '综合'),
  _m('古巴', 'CU', LATAM, 'Granma English', 'https://en.granma.cu/rss.xml', 'en', '官方'),
  _m('多米尼加', 'DO', LATAM, 'Dominican Today', 'https://dominicantoday.com/feed/', 'en', '综合'),
  _m('海地', 'HT', LATAM, 'Haiti Libre', 'https://www.haitilibre.com/en/rss.php', 'en', '安全/政局'),
  _m('牙买加', 'JM', LATAM, 'Jamaica Gleaner', 'https://jamaica-gleaner.com/feed', 'en', '综合'),
  _m('牙买加', 'JM', LATAM, 'Jamaica Observer', 'https://www.jamaicaobserver.com/feed/', 'en', '综合'),
  _m('特立尼达和多巴哥', 'TT', LATAM, 'Trinidad Newsday', 'https://newsday.co.tt/feed/', 'en', '综合'),
  _m('圭亚那', 'GY', LATAM, 'Kaieteur News', 'https://www.kaieteurnewsonline.com/feed/', 'en', '综合'),
  _m('圭亚那', 'GY', LATAM, 'Stabroek News', 'https://www.stabroeknews.com/feed/', 'en', '综合'),
  _m('巴拿马', 'PA', LATAM, 'Newsroom Panama', 'https://www.newsroompanama.com/feed', 'en', '综合'),
  _m('哥斯达黎加', 'CR', LATAM, 'Tico Times', 'https://ticotimes.net/feed', 'en', '综合'),
  _m('哥斯达黎加', 'CR', LATAM, 'CRHoy', 'https://www.crhoy.com/feed/', 'es', '综合'),
  _m('萨尔瓦多', 'SV', LATAM, 'El Faro English', 'https://elfaro.net/en/rss', 'en', '调查/帮派'),
  _m('危地马拉', 'GT', LATAM, 'Prensa Libre', 'https://www.prensalibre.com/rss/', 'es', '综合'),
  _m('洪都拉斯', 'HN', LATAM, 'La Prensa HN', 'https://www.laprensa.hn/rss', 'es', '综合'),
  _m('尼加拉瓜', 'NI', LATAM, 'Confidencial', 'https://confidencial.digital/feed/', 'es', '独立媒体'),
  /* ---- 非洲直采（AllAfrica 之外的各国主流媒体） ---- */
  _m('尼日利亚', 'NG', WAf, 'Punch', 'https://punchng.com/feed/', 'en', '综合'),
  _m('尼日利亚', 'NG', WAf, 'Vanguard', 'https://www.vanguardngr.com/feed/', 'en', '综合'),
  _m('尼日利亚', 'NG', WAf, 'ThisDay', 'https://www.thisdaylive.com/feed/', 'en', '政局'),
  _m('尼日利亚', 'NG', WAf, 'Daily Trust', 'https://dailytrust.com/feed/', 'en', '北部/安全'),
  _m('尼日利亚', 'NG', WAf, 'Premium Times', 'https://www.premiumtimesng.com/feed', 'en', '调查'),
  _m('尼日利亚', 'NG', WAf, 'TheCable', 'https://www.thecable.ng/feed', 'en', '快讯'),
  _m('尼日利亚', 'NG', WAf, 'Sahara Reporters', 'http://saharareporters.com/feeds/latest/feed', 'en', '反腐/安全'),
  _m('加纳', 'GH', WAf, 'GhanaWeb', 'https://www.ghanaweb.com/GhanaHomePage/rss.php', 'en', '综合'),
  _m('加纳', 'GH', WAf, 'Joy Online', 'https://www.myjoyonline.com/feed/', 'en', '综合'),
  _m('加纳', 'GH', WAf, 'Citi Newsroom', 'https://citinewsroom.com/feed/', 'en', '政局'),
  _m('加纳', 'GH', WAf, 'Graphic Online', 'https://www.graphic.com.gh/?feed=rss2', 'en', '官方'),
  _m('塞内加尔', 'SN', WAf, 'Seneweb', 'https://www.seneweb.com/news/rss.php', 'fr', '综合'),
  _m('科特迪瓦', 'CI', WAf, 'Abidjan.net', 'https://news.abidjan.net/rss', 'fr', '综合'),
  _m('科特迪瓦', 'CI', WAf, 'FratMat', 'https://www.fratmat.info/feed', 'fr', '官方'),
  _m('马里', 'ML', WAf, 'Sahelien', 'https://sahelien.com/en/feed/', 'en', '萨赫勒安全'),
  _m('布基纳法索', 'BF', WAf, 'Lefaso.net', 'https://lefaso.net/spip.php?page=backend', 'fr', '综合'),
  _m('尼日尔', 'NE', WAf, 'ActuNiger', 'https://www.actuniger.com/feed/', 'fr', '综合'),
  _m('几内亚', 'GN', WAf, 'Guinée News', 'https://guineenews.org/feed/', 'fr', '综合'),
  _m('利比里亚', 'LR', WAf, 'FrontPage Africa', 'https://frontpageafricaonline.com/feed/', 'en', '综合'),
  _m('塞拉利昂', 'SL', WAf, 'Awoko', 'https://awokonewspaper.com/feed/', 'en', '综合'),
  _m('肯尼亚', 'KE', EAf, 'Daily Nation', 'https://nation.africa/kenya/rss', 'en', '综合'),
  _m('肯尼亚', 'KE', EAf, 'Standard Media', 'https://www.standardmedia.co.ke/rss/headlines.php', 'en', '综合'),
  _m('肯尼亚', 'KE', EAf, 'The Star Kenya', 'https://www.the-star.co.ke/news/feed/', 'en', '政局'),
  _m('肯尼亚', 'KE', EAf, 'Citizen Digital', 'https://citizen.digital/feed', 'en', '综合'),
  _m('埃塞俄比亚', 'ET', EAf, 'Addis Standard', 'https://addisstandard.com/feed/', 'en', '冲突/政局'),
  _m('埃塞俄比亚', 'ET', EAf, 'Ethiopian Reporter', 'https://www.thereporterethiopia.com/feed', 'en', '综合'),
  _m('埃塞俄比亚', 'ET', EAf, 'Ethiopian Monitor', 'https://ethiopianmonitor.com/feed/', 'en', '综合'),
  _m('苏丹', 'SD', EAf, 'Sudan Tribune', 'https://sudantribune.com/spip.php?page=backend', 'en', '冲突'),
  _m('苏丹', 'SD', EAf, 'Radio Dabanga', 'https://www.dabangasudan.org/en/all-news/rss', 'en', '冲突/人道'),
  _m('南苏丹', 'SS', EAf, 'Eye Radio', 'https://eyeradio.org/feed/', 'en', '冲突/人道'),
  _m('南苏丹', 'SS', EAf, 'Radio Tamazuj', 'https://radiotamazuj.org/en/news/rss', 'en', '冲突'),
  _m('索马里', 'SO', EAf, 'Garowe Online', 'https://www.garoweonline.com/en/rss', 'en', '安全'),
  _m('索马里', 'SO', EAf, 'Radio Ergo', 'https://radioergo.org/feed/', 'en', '人道/安全'),
  _m('索马里', 'SO', EAf, 'Hiiraan Online', 'https://hiiraan.com/rss.xml', 'en', '综合'),
  _m('坦桑尼亚', 'TZ', EAf, 'The Citizen TZ', 'https://www.thecitizen.co.tz/tanzania/rss', 'en', '综合'),
  _m('坦桑尼亚', 'TZ', EAf, 'Daily News TZ', 'https://dailynews.co.tz/feed/', 'en', '官方'),
  _m('乌干达', 'UG', EAf, 'Daily Monitor', 'https://www.monitor.co.ug/uganda/rss', 'en', '综合'),
  _m('乌干达', 'UG', EAf, 'New Vision', 'https://www.newvision.co.ug/feed', 'en', '官方'),
  _m('乌干达', 'UG', EAf, 'The Independent Uganda', 'https://www.independent.co.ug/feed/', 'en', '政局'),
  _m('卢旺达', 'RW', EAf, 'The New Times', 'https://www.newtimes.co.rw/rss/feed.xml', 'en', '官方'),
  _m('刚果金', 'CD', EAf, 'Actualité.cd', 'https://actualite.cd/rss.xml', 'fr', '冲突/矿业'),
  _m('刚果金', 'CD', EAf, 'Radio Okapi', 'https://www.radiookapi.net/rss', 'fr', '联合国电台'),
  _m('南非', 'ZA', SAf, 'News24', 'https://www.news24.com/news24/southafrica/rss', 'en', '综合'),
  _m('南非', 'ZA', SAf, 'Daily Maverick', 'https://www.dailymaverick.co.za/feed/', 'en', '调查'),
  _m('南非', 'ZA', SAf, 'Mail & Guardian', 'https://mg.co.za/feed/', 'en', '政局'),
  _m('南非', 'ZA', SAf, 'TimesLIVE', 'https://www.timeslive.co.za/rss/', 'en', '综合'),
  _m('南非', 'ZA', SAf, 'eNCA', 'https://www.enca.com/rss.xml', 'en', '综合'),
  _m('津巴布韦', 'ZW', SAf, 'NewsDay Zimbabwe', 'https://www.newsday.co.zw/feed', 'en', '政局'),
  _m('津巴布韦', 'ZW', SAf, 'The Herald ZW', 'https://www.herald.co.zw/feed/', 'en', '官方'),
  _m('津巴布韦', 'ZW', SAf, 'ZimLive', 'https://www.zimlive.com/feed/', 'en', '综合'),
  _m('赞比亚', 'ZM', SAf, 'Lusaka Times', 'https://www.lusakatimes.com/feed/', 'en', '综合'),
  _m('赞比亚', 'ZM', SAf, 'Zambia Daily Mail', 'https://www.daily-mail.co.zm/feed/', 'en', '官方'),
  _m('莫桑比克', 'MZ', SAf, 'Zitamar News', 'https://zitamar.com/feed/', 'en', '北部冲突'),
  _m('莫桑比克', 'MZ', SAf, 'Club of Mozambique', 'https://clubofmozambique.com/feed/', 'en', '综合'),
  _m('安哥拉', 'AO', SAf, 'ANGOP', 'https://www.angop.ao/en/rss/', 'en', '官方通讯'),
  _m('纳米比亚', 'NA', SAf, 'The Namibian', 'https://www.namibian.com.na/feed/', 'en', '综合'),
  _m('博茨瓦纳', 'BW', SAf, 'Mmegi', 'https://www.mmegi.bw/feed', 'en', '综合'),
  _m('马拉维', 'MW', SAf, 'Malawi 24', 'https://malawi24.com/feed/', 'en', '综合'),
  _m('马拉维', 'MW', SAf, 'Nyasa Times', 'https://www.nyasatimes.com/feed/', 'en', '综合'),
  _m('毛里求斯', 'MU', SAf, 'Lexpress.mu', 'https://www.lexpress.mu/rss', 'fr', '综合'),
  _m('埃及', 'EG', NAf, 'Ahram Online', 'https://english.ahram.org.eg/rss/13.aspx', 'en', '官方'),
  _m('埃及', 'EG', NAf, 'Egypt Independent', 'https://www.egyptindependent.com/feed/', 'en', '综合'),
  _m('埃及', 'EG', NAf, 'Daily News Egypt', 'https://www.dailynewsegypt.com/feed/', 'en', '经济'),
  _m('埃及', 'EG', NAf, 'Mada Masr', 'https://www.madamasr.com/en/feed/', 'en', '独立媒体'),
  _m('摩洛哥', 'MA', NAf, 'Morocco World News', 'https://www.moroccoworldnews.com/rss', 'en', '综合'),
  _m('摩洛哥', 'MA', NAf, 'Le360 English', 'https://en.le360.ma/rss/', 'en', '综合'),
  _m('突尼斯', 'TN', NAf, 'Tunisia Live', 'https://tunisia-live.net/feed/', 'en', '政局'),
  _m('突尼斯', 'TN', NAf, 'TAP News', 'https://www.tap.info.tn/en/rss', 'en', '官方通讯'),
  _m('利比亚', 'LY', NAf, 'Libya Herald', 'https://libyaherald.com/feed/', 'en', '冲突/政局'),
  _m('利比亚', 'LY', NAf, 'Libya Observer', 'https://libyaobserver.ly/rss.xml', 'en', '冲突'),
  _m('阿尔及利亚', 'DZ', NAf, 'Algeria Press Service', 'https://www.aps.dz/en/rss', 'en', '官方通讯'),
  _m('喀麦隆', 'CM', WAf, 'Journal du Cameroun EN', 'https://www.journalducameroun.com/en/feed/', 'en', '综合'),
  _m('马达加斯加', 'MG', EAf, 'Midi Madagasikara', 'https://www.midi-madagasikara.mg/feed/', 'fr', '综合'),
  _m('厄立特里亚', 'ER', EAf, 'Shabait', 'https://shabait.com/feed/', 'en', '官方'),
  _m('乍得', 'TD', WAf, 'Tchad Infos', 'https://tchadinfos.com/feed/', 'fr', '综合'),
  _m('非洲区域', 'AF-REG', EAf, 'The Africa Report', 'https://www.theafricareport.com/feed/', 'en', '政经深度'),
  _m('非洲区域', 'AF-REG', EAf, 'Africanews', 'https://www.africanews.com/feed/rss', 'en', '泛非'),
  _m('非洲区域', 'AF-REG', WAf, 'ISS Africa Today', 'https://issafrica.org/rss.xml', 'en', '安全研究'),
  /* ---- 欧美扩充（主流已覆盖，补防务/政策/区域媒体） ---- */
  _m('欧盟', 'EU-REG', EU, 'Politico Europe', 'https://www.politico.eu/feed/', 'en', '欧盟政策'),
  _m('欧盟', 'EU-REG', EU, 'Euractiv', 'https://www.euractiv.com/feed/', 'en', '欧盟政策'),
  _m('欧盟', 'EU-REG', EU, 'EUobserver', 'https://euobserver.com/rss', 'en', '欧盟监督'),
  _m('欧盟', 'EU-REG', EU, 'Euronews', 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', 'en', '泛欧'),
  _m('法国', 'FR', EU, 'France 24 English', 'https://www.france24.com/en/rss', 'en', '国际'),
  _m('德国', 'DE', EU, 'DW English', 'https://rss.dw.com/rdf/rss-en-all', 'en', '国际'),
  _m('德国', 'DE', EU, 'Spiegel International', 'https://www.spiegel.de/international/index.rss', 'en', '深度'),
  _m('意大利', 'IT', EU, 'ANSA English', 'https://www.ansa.it/english/news/english_news_rss.xml', 'en', '综合'),
  _m('西班牙', 'ES', EU, 'El País English', 'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada', 'en', '综合'),
  _m('爱尔兰', 'IE', EU, 'RTÉ News', 'https://www.rte.ie/news/rss/news-headlines.xml', 'en', '综合'),
  _m('乌克兰', 'UA', EU, 'Kyiv Independent', 'https://kyivindependent.com/feed/', 'en', '战争'),
  _m('乌克兰', 'UA', EU, 'Ukrinform', 'https://www.ukrinform.net/rss/block-lastnews', 'en', '官方通讯'),
  _m('俄罗斯', 'RU', EU, 'Meduza English', 'https://meduza.io/rss/en', 'en', '独立媒体'),
  _m('俄罗斯', 'RU', EU, 'Moscow Times', 'https://www.themoscowtimes.com/rss/news', 'en', '综合'),
  _m('俄罗斯', 'RU', EU, 'TASS', 'https://tass.com/rss/v2.xml', 'en', '官方通讯'),
  _m('巴尔干区域', 'BALKAN', EU, 'Balkan Insight', 'https://balkaninsight.com/feed/', 'en', '区域安全'),
  _m('东欧区域', 'EEU-REG', EU, 'RFE/RL', 'https://www.rferl.org/rss/', 'en', '东欧/中亚'),
  _m('美国', 'US', NA, 'NPR News', 'https://feeds.npr.org/1001/rss.xml', 'en', '公共媒体'),
  _m('美国', 'US', NA, 'The Hill', 'https://thehill.com/feed/', 'en', '政局'),
  _m('美国', 'US', NA, 'Axios', 'https://axios.com/feeds/feed.rss', 'en', '政策快讯'),
  _m('美国', 'US', NA, 'Politico', 'https://www.politico.com/rss/politicopicks.xml', 'en', '政局'),
  _m('美国', 'US', NA, 'Defense One', 'https://www.defenseone.com/rss/all/', 'en', '防务'),
  _m('美国', 'US', NA, 'Breaking Defense', 'https://breakingdefense.com/feed/', 'en', '防务'),
  _m('美国', 'US', NA, 'War on the Rocks', 'https://warontherocks.com/feed/', 'en', '安全研究'),
  _m('美国', 'US', NA, 'Foreign Policy', 'https://foreignpolicy.com/feed/', 'en', '外交政策'),
  _m('美国', 'US', NA, 'VOA News', 'https://feeds.voanews.com/voa/news/rss', 'en', '官方国际'),
  _m('加拿大', 'CA', NA, 'CBC News', 'https://www.cbc.ca/cmlink/rss-topstories', 'en', '综合'),
  _m('加拿大', 'CA', NA, 'CTV News', 'https://www.ctvnews.ca/rss/ctvnews-ca-top-stories-public-rss-1.822009', 'en', '综合')
];

/* ================= 2. Google News RSS 国别×主题查询源 =================
 * URL 模式（官方稳定）：https://news.google.com/rss/search?q={q}&hl=en-US&gl={ISO2}&ceid={ISO2}:en
 * 每个国家 3 个主题：涉华 / 安全冲突 / 中资经贸。GitHub Actions（美国机房）直连稳定。 */
const GN_COUNTRIES = [
  /* 阿富汗+中亚五国（用户单列） */
  ['AF', '阿富汗', CA], ['KZ', '哈萨克斯坦', CA], ['UZ', '乌兹别克斯坦', CA], ['TM', '土库曼斯坦', CA], ['KG', '吉尔吉斯斯坦', CA], ['TJ', '塔吉克斯坦', CA],
  /* 南亚（印度单列） */
  ['IN', '印度', SA], ['PK', '巴基斯坦', SA], ['BD', '孟加拉国', SA], ['LK', '斯里兰卡', SA], ['NP', '尼泊尔', SA], ['MV', '马尔代夫', SA], ['BT', '不丹', SA],
  /* 日韩+蒙古 */
  ['JP', '日本', EA], ['KR', '韩国', EA], ['MN', '蒙古', EA],
  /* 东南亚 */
  ['MM', '缅甸', SEA], ['TH', '泰国', SEA], ['VN', '越南', SEA], ['PH', '菲律宾', SEA], ['ID', '印度尼西亚', SEA], ['MY', '马来西亚', SEA], ['SG', '新加坡', SEA], ['KH', '柬埔寨', SEA], ['LA', '老挝', SEA], ['BN', '文莱', SEA], ['TL', '东帝汶', SEA],
  /* 中东 */
  ['IR', '伊朗', ME], ['IQ', '伊拉克', ME], ['SA', '沙特阿拉伯', ME], ['AE', '阿联酋', ME], ['QA', '卡塔尔', ME], ['KW', '科威特', ME], ['OM', '阿曼', ME], ['YE', '也门', ME], ['SY', '叙利亚', ME], ['LB', '黎巴嫩', ME], ['JO', '约旦', ME], ['IL', '以色列', ME], ['TR', '土耳其', ME],
  /* 非洲 */
  ['NG', '尼日利亚', WAf], ['GH', '加纳', WAf], ['SN', '塞内加尔', WAf], ['CI', '科特迪瓦', WAf], ['ML', '马里', WAf], ['BF', '布基纳法索', WAf], ['NE', '尼日尔', WAf], ['GN', '几内亚', WAf], ['LR', '利比里亚', WAf], ['SL', '塞拉利昂', WAf], ['CM', '喀麦隆', WAf], ['TD', '乍得', WAf], ['MR', '毛里塔尼亚', WAf], ['GM', '冈比亚', WAf], ['GW', '几内亚比绍', WAf], ['TG', '多哥', WAf], ['BJ', '贝宁', WAf], ['CV', '佛得角', WAf],
  ['KE', '肯尼亚', EAf], ['ET', '埃塞俄比亚', EAf], ['TZ', '坦桑尼亚', EAf], ['UG', '乌干达', EAf], ['SD', '苏丹', EAf], ['SS', '南苏丹', EAf], ['SO', '索马里', EAf], ['RW', '卢旺达', EAf], ['BI', '布隆迪', EAf], ['CD', '刚果金', EAf], ['CG', '刚果布', EAf], ['ER', '厄立特里亚', EAf], ['DJ', '吉布提', EAf], ['MG', '马达加斯加', EAf], ['CF', '中非共和国', EAf], ['GA', '加蓬', EAf],
  ['ZA', '南非', SAf], ['ZW', '津巴布韦', SAf], ['ZM', '赞比亚', SAf], ['MZ', '莫桑比克', SAf], ['AO', '安哥拉', SAf], ['NA', '纳米比亚', SAf], ['BW', '博茨瓦纳', SAf], ['MW', '马拉维', SAf], ['MU', '毛里求斯', SAf], ['LS', '莱索托', SAf], ['SZ', '斯威士兰', SAf],
  ['EG', '埃及', NAf], ['MA', '摩洛哥', NAf], ['TN', '突尼斯', NAf], ['LY', '利比亚', NAf], ['DZ', '阿尔及利亚', NAf],
  /* 拉美 */
  ['AR', '阿根廷', LATAM], ['BR', '巴西', LATAM], ['MX', '墨西哥', LATAM], ['CO', '哥伦比亚', LATAM], ['CL', '智利', LATAM], ['PE', '秘鲁', LATAM], ['VE', '委内瑞拉', LATAM], ['EC', '厄瓜多尔', LATAM], ['BO', '玻利维亚', LATAM], ['PY', '巴拉圭', LATAM], ['UY', '乌拉圭', LATAM], ['GY', '圭亚那', LATAM], ['SR', '苏里南', LATAM], ['CU', '古巴', LATAM], ['DO', '多米尼加', LATAM], ['HT', '海地', LATAM], ['JM', '牙买加', LATAM], ['TT', '特立尼达和多巴哥', LATAM], ['PA', '巴拿马', LATAM], ['CR', '哥斯达黎加', LATAM], ['SV', '萨尔瓦多', LATAM], ['GT', '危地马拉', LATAM], ['HN', '洪都拉斯', LATAM], ['NI', '尼加拉瓜', LATAM], ['BS', '巴哈马', LATAM], ['BB', '巴巴多斯', LATAM],
  /* 欧美 */
  ['US', '美国', NA], ['CA', '加拿大', NA],
  ['GB', '英国', EU], ['FR', '法国', EU], ['DE', '德国', EU], ['IT', '意大利', EU], ['ES', '西班牙', EU], ['PT', '葡萄牙', EU], ['NL', '荷兰', EU], ['BE', '比利时', EU], ['LU', '卢森堡', EU], ['IE', '爱尔兰', EU], ['AT', '奥地利', EU], ['CH', '瑞士', EU], ['SE', '瑞典', EU], ['NO', '挪威', EU], ['DK', '丹麦', EU], ['FI', '芬兰', EU], ['IS', '冰岛', EU], ['PL', '波兰', EU], ['CZ', '捷克', EU], ['HU', '匈牙利', EU], ['RO', '罗马尼亚', EU], ['BG', '保加利亚', EU], ['GR', '希腊', EU], ['RS', '塞尔维亚', EU], ['HR', '克罗地亚', EU], ['SK', '斯洛伐克', EU], ['SI', '斯洛文尼亚', EU], ['LT', '立陶宛', EU], ['LV', '拉脱维亚', EU], ['EE', '爱沙尼亚', EU], ['UA', '乌克兰', EU], ['MD', '摩尔多瓦', EU], ['BY', '白俄罗斯', EU], ['AL', '阿尔巴尼亚', EU], ['BA', '波黑', EU], ['MK', '北马其顿', EU], ['ME', '黑山', EU], ['GE', '格鲁吉亚', EU], ['AM', '亚美尼亚', EU], ['AZ', '阿塞拜疆', EU], ['RU', '俄罗斯', EU],
  /* 大洋洲 */
  ['AU', '澳大利亚', OC], ['NZ', '新西兰', OC], ['PG', '巴布亚新几内亚', OC], ['FJ', '斐济', OC], ['SB', '所罗门群岛', OC], ['VU', '瓦努阿图', OC]
];
const GN_QUERIES = [
  { key: 'china', q: 'China OR Chinese OR "Belt and Road"', focus: '涉华' },
  { key: 'security', q: 'attack OR conflict OR coup OR terrorism OR protest OR kidnapping', focus: '安全冲突' },
  { key: 'investment', q: 'China investment OR infrastructure OR railway OR port OR mining OR trade', focus: '中资经贸' }
];
const GOOGLE_NEWS_SOURCES = [];
/* 2026-08-29 根因修复（Task #465 国别审计）：gl/ceid 参数只偏置不限定，
 * 通用 OR 查询（attack OR conflict...）返回的是全球新闻，入库时被"事件地点校准"
 * 改写国别——实测 GoogleNews·哈萨克斯坦·安全冲突 的条目被标为海地、阿富汗源被标为伊朗，
 * 沙特/印尼/哈萨克等 TIER1 弱国覆盖形同虚设。查询词前缀英文国名做地理锚定。 */
const _REGION_EN = new Intl.DisplayNames(['en'], { type: 'region' });
/* 别名修正：Intl 生成的个别名称含连字符/括注会干扰 GNews 查询解析 */
const _REGION_ALIAS = { CD: 'Congo', CG: 'Congo', TW: 'Taiwan', HK: 'Hong Kong', MO: 'Macau' };
for (const [iso, cn, region] of GN_COUNTRIES) {
  let en = _REGION_ALIAS[iso] || '';
  if (!en) { try { en = _REGION_EN.of(iso) || ''; } catch (e) {} }
  for (const t of GN_QUERIES) {
    const q = en ? '(' + en + ') ' + t.q : t.q;
    GOOGLE_NEWS_SOURCES.push({
      cn, iso, region,
      name: 'GoogleNews·' + cn + '·' + t.focus,
      url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=' + iso + '&ceid=' + encodeURIComponent(iso + ':en'),
      type: 'query', lang: 'en', focus: t.focus
    });
  }
}

/* ================= 3. AllAfrica 非洲国别聚合（官方 RDF） ================= */
const ALLAFRICA_SLUGS = [
  ['nigeria', '尼日利亚', WAf], ['ghana', '加纳', WAf], ['senegal', '塞内加尔', WAf], ['mali', '马里', WAf],
  ['cameroon', '喀麦隆', WAf], ['niger', '尼日尔', WAf], ['chad', '乍得', WAf], ['liberia', '利比里亚', WAf],
  ['kenya', '肯尼亚', EAf], ['ethiopia', '埃塞俄比亚', EAf], ['tanzania', '坦桑尼亚', EAf], ['uganda', '乌干达', EAf],
  ['sudan', '苏丹', EAf], ['somalia', '索马里', EAf], ['rwanda', '卢旺达', EAf],
  ['southafrica', '南非', SAf], ['zimbabwe', '津巴布韦', SAf], ['zambia', '赞比亚', SAf], ['mozambique', '莫桑比克', SAf],
  ['angola', '安哥拉', SAf], ['namibia', '纳米比亚', SAf], ['botswana', '博茨瓦纳', SAf], ['malawi', '马拉维', SAf], ['mauritius', '毛里求斯', SAf],
  ['egypt', '埃及', NAf], ['libya', '利比亚', NAf], ['tunisia', '突尼斯', NAf], ['algeria', '阿尔及利亚', NAf], ['morocco', '摩洛哥', NAf]
];
const ALLAFRICA_FEEDS = ALLAFRICA_SLUGS.map(([slug, cn, region]) => ({
  cn, iso: slug.toUpperCase().slice(0, 2), region,
  name: 'AllAfrica·' + cn,
  url: 'https://allafrica.com/tools/headlines/rdf/' + slug + '/headlines.rdf',
  type: 'media', lang: 'en', focus: '聚合'
}));

/* ================= 4. ReliefWeb 国别人道/安全态势（联合国 OCHA，ISO3） ================= */
const RELIEFWEB_ISO3 = [
  ['afg', '阿富汗', CA], ['tjk', '塔吉克斯坦', CA],
  ['pak', '巴基斯坦', SA], ['mmr', '缅甸', SEA], ['phl', '菲律宾', SEA], ['idn', '印度尼西亚', SEA], ['khm', '柬埔寨', SEA], ['lao', '老挝', SEA], ['tls', '东帝汶', SEA],
  ['irq', '伊拉克', ME], ['syr', '叙利亚', ME], ['yem', '也门', ME], ['lbn', '黎巴嫩', ME], ['pse', '巴勒斯坦', ME], ['tur', '土耳其', ME],
  ['nga', '尼日利亚', WAf], ['mli', '马里', WAf], ['bfa', '布基纳法索', WAf], ['ner', '尼日尔', WAf], ['cmr', '喀麦隆', WAf], ['tcd', '乍得', WAf], ['mrt', '毛里塔尼亚', WAf], ['sen', '塞内加尔', WAf],
  ['eth', '埃塞俄比亚', EAf], ['ken', '肯尼亚', EAf], ['som', '索马里', EAf], ['sdn', '苏丹', EAf], ['ssd', '南苏丹', EAf], ['uga', '乌干达', EAf], ['cod', '刚果金', EAf], ['caf', '中非共和国', EAf], ['moz', '莫桑比克', EAf],
  ['col', '哥伦比亚', LATAM], ['ven', '委内瑞拉', LATAM], ['hti', '海地', LATAM], ['ecu', '厄瓜多尔', LATAM], ['per', '秘鲁', LATAM], ['bol', '玻利维亚', LATAM],
  ['ukr', '乌克兰', EU]
];
const RELIEFWEB_FEEDS = RELIEFWEB_ISO3.map(([iso3, cn, region]) => ({
  cn, iso: iso3.toUpperCase(), region,
  name: 'ReliefWeb·' + cn,
  url: 'https://reliefweb.int/updates/rss.xml?country=' + iso3,
  type: 'media', lang: 'en', focus: '人道/安全态势'
}));

/* ================= 汇总 ================= */
const REGIONAL_ALL = DIRECT_REGIONAL.concat(GOOGLE_NEWS_SOURCES, ALLAFRICA_FEEDS, RELIEFWEB_FEEDS);
const REGIONAL_STATS = {
  direct: DIRECT_REGIONAL.length,
  googleNews: GOOGLE_NEWS_SOURCES.length,
  allAfrica: ALLAFRICA_FEEDS.length,
  reliefWeb: RELIEFWEB_FEEDS.length,
  total: REGIONAL_ALL.length
};

module.exports = { REGIONAL_ALL, REGIONAL_STATS, DIRECT_REGIONAL, GOOGLE_NEWS_SOURCES, ALLAFRICA_FEEDS, RELIEFWEB_FEEDS };
