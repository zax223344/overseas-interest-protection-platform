/* sources-registry.js — 开源数据源注册表（2026-08-28 从用户工程包 sources.yaml 转换）
 * stance 立场标签：G=政府控制 I=独立商业 N=非营利调查 W=西方中心 C=中国官方亲双边
 * 证据链铁律：事件被 ≥2 个不同 stance 的源报道 → verified（多立场交叉验证）
 * 接入方式：feeds 类由 sources-collector 直采；web/api 类标注待验证
 */
'use strict';

const SOURCES = [
  {
    "id": "cn_mfa",
    "name": "中国外交部",
    "country": "CN",
    "region": "中国官方",
    "language": "zh",
    "stance": "C",
    "access": "web",
    "url": "https://www.fmprc.gov.cn/",
    "risk_topics": [
      "领事保护",
      "安全提醒",
      "国别政策",
      "撤侨"
    ]
  },
  {
    "id": "cn_mfa_consular_rss",
    "name": "外交部领事服务网安全提醒",
    "country": "CN",
    "region": "中国官方",
    "language": "zh",
    "stance": "C",
    "access": "web",
    "url": "https://cs.mfa.gov.cn/",
    "risk_topics": [
      "安全提醒",
      "领事保护",
      "撤侨"
    ]
  },
  {
    "id": "cn_mofcom",
    "name": "商务部对外投资合作",
    "country": "CN",
    "region": "中国官方",
    "language": "zh",
    "stance": "C",
    "access": "web",
    "url": "https://fec.mofcom.gov.cn/",
    "risk_topics": [
      "对外投资",
      "承包工程",
      "劳务合作",
      "统计数据"
    ]
  },
  {
    "id": "cn_beltandroad",
    "name": "中国一带一路网",
    "country": "CN",
    "region": "中国官方",
    "language": "zh",
    "stance": "C",
    "access": "feeds",
    "url": "https://www.yidaiyilu.gov.cn/",
    "feeds": [
      "https://www.yidaiyilu.gov.cn/rss.xml"
    ],
    "risk_topics": [
      "一带一路",
      "项目进展",
      "国别合作"
    ]
  },
  {
    "id": "cn_xinhuanet",
    "name": "新华网国际",
    "country": "CN",
    "region": "中国官方",
    "language": "zh",
    "stance": "C",
    "access": "feeds",
    "url": "https://www.xinhuanet.com/world/",
    "feeds": [
      "https://www.xinhuanet.com/world/rss.xml"
    ],
    "risk_topics": [
      "中国海外利益",
      "国际合作",
      "海外安全"
    ]
  },
  {
    "id": "cn_chinanews",
    "name": "中国新闻网",
    "country": "CN",
    "region": "中国官方",
    "language": "zh",
    "stance": "C",
    "access": "feeds",
    "url": "https://www.chinanews.com/",
    "feeds": [
      "https://www.chinanews.com/rss/world.xml"
    ],
    "risk_topics": [
      "海外安全",
      "领事保护",
      "中资项目"
    ]
  },
  {
    "id": "gdelt",
    "name": "GDELT Project",
    "country": "US",
    "region": "国际多边",
    "language": "multi",
    "stance": "I",
    "access": "api",
    "url": "https://api.gdeltproject.org/api/v2/doc/doc",
    "api": "https://api.gdeltproject.org/api/v2/doc/doc?query={query}&format=json&maxrecords=250",
    "risk_topics": [
      "全球事件",
      "冲突",
      "抗议",
      "地缘政治",
      "中国海外利益"
    ]
  },
  {
    "id": "gdelt_geo",
    "name": "GDELT Geo API",
    "country": "US",
    "region": "国际多边",
    "language": "multi",
    "stance": "I",
    "access": "api",
    "url": "https://api.gdeltproject.org/api/v2/geo/geo",
    "api": "https://api.gdeltproject.org/api/v2/geo/geo?query={query}&format=json",
    "risk_topics": [
      "地理定位事件",
      "热点区域"
    ]
  },
  {
    "id": "acled",
    "name": "ACLED 武装冲突事件",
    "country": "US",
    "region": "国际多边",
    "language": "en",
    "stance": "N",
    "access": "web",
    "url": "https://acleddata.com/",
    "risk_topics": [
      "武装冲突",
      "fatalities",
      "暴乱"
    ]
  },
  {
    "id": "gtd",
    "name": "全球恐怖主义数据库 START",
    "country": "US",
    "region": "国际多边",
    "language": "en",
    "stance": "N",
    "access": "web",
    "url": "https://www.start.umd.edu/gtd/",
    "risk_topics": [
      "恐怖袭击",
      "绑架",
      "极端主义"
    ]
  },
  {
    "id": "wb_wgi",
    "name": "世界银行全球治理指标",
    "country": "US",
    "region": "国际多边",
    "language": "en",
    "stance": "I",
    "access": "api",
    "url": "https://api.worldbank.org/v2/",
    "api": "https://api.worldbank.org/v2/country/{query}/indicator/WI.POL.RGOV.XQ?format=json",
    "risk_topics": [
      "治理指标",
      "法治",
      "腐败",
      "政治稳定"
    ]
  },
  {
    "id": "un_news",
    "name": "联合国新闻",
    "country": "US",
    "region": "国际多边",
    "language": "multi",
    "stance": "I",
    "access": "feeds",
    "url": "https://news.un.org/",
    "feeds": [
      "https://news.un.org/feed/subscribe/zh/news/"
    ],
    "risk_topics": [
      "维和",
      "人道危机",
      "制裁",
      "冲突"
    ]
  },
  {
    "id": "reuters",
    "name": "Reuters World",
    "country": "GB",
    "region": "全球通讯社",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.reuters.com/world/",
    "feeds": [
      "https://www.reuters.com/world/?format=rss"
    ],
    "risk_topics": [
      "地缘政治",
      "经济",
      "安全"
    ]
  },
  {
    "id": "bloomberg",
    "name": "Bloomberg",
    "country": "US",
    "region": "全球通讯社",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.bloomberg.com/",
    "risk_topics": [
      "能源",
      "金融",
      "大宗商品"
    ]
  },
  {
    "id": "apnews",
    "name": "Associated Press",
    "country": "US",
    "region": "全球通讯社",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://apnews.com/",
    "feeds": [
      "https://feeds.apnews.com/rss/apf-topnews"
    ],
    "risk_topics": [
      "突发事件",
      "全球新闻"
    ]
  },
  {
    "id": "afp",
    "name": "Agence France-Presse",
    "country": "FR",
    "region": "全球通讯社",
    "language": "fr",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.afp.com/",
    "feeds": [
      "https://www.afp.com/en/rss"
    ],
    "risk_topics": [
      "非洲",
      "中东",
      "东南亚"
    ]
  },
  {
    "id": "bbc_world",
    "name": "BBC World",
    "country": "GB",
    "region": "全球通讯社",
    "language": "en",
    "stance": "W",
    "access": "feeds",
    "url": "https://www.bbc.com/news/world",
    "feeds": [
      "https://feeds.bbci.co.uk/news/world/rss.xml"
    ],
    "risk_topics": [
      "地缘政治",
      "安全分析"
    ]
  },
  {
    "id": "scmp",
    "name": "南华早报 South China Morning Post",
    "country": "HK",
    "region": "全球通讯社",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.scmp.com/",
    "feeds": [
      "https://www.scmp.com/rss/486182/feed"
    ],
    "risk_topics": [
      "中国海外利益",
      "亚洲",
      "地缘"
    ]
  },
  {
    "id": "lloydslist",
    "name": "Lloyd's List Intelligence",
    "country": "GB",
    "region": "航运",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.lloydslist.com/",
    "risk_topics": [
      "航运",
      "海盗",
      "港口",
      "海峡",
      "海事安全"
    ]
  },
  {
    "id": "argusmedia",
    "name": "Argus Media",
    "country": "GB",
    "region": "能源",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.argusmedia.com/",
    "risk_topics": [
      "原油",
      "天然气",
      "价格",
      "能源政治"
    ]
  },
  {
    "id": "spglobal_platts",
    "name": "S&P Global Platts",
    "country": "US",
    "region": "能源",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.spglobal.com/commodityinsights/",
    "risk_topics": [
      "能源",
      "金属",
      "电力"
    ]
  },
  {
    "id": "aeichinaglobal",
    "name": "AEI 中国全球投资追踪",
    "country": "US",
    "region": "投资",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.aei.org/china-global-investment-tracker/",
    "risk_topics": [
      "中国对外投资",
      "大型交易",
      "问题项目"
    ]
  },
  {
    "id": "reliefweb",
    "name": "ReliefWeb",
    "country": "US",
    "region": "非传统安全",
    "language": "multi",
    "stance": "N",
    "access": "api",
    "url": "https://api.reliefweb.int/v1/",
    "api": "https://api.reliefweb.int/v1/reports?query[value]={query}&limit=100&profile=full",
    "risk_topics": [
      "人道危机",
      "流离失所",
      "灾害",
      "疫情"
    ]
  },
  {
    "id": "pk_dawn",
    "name": "Dawn (Pakistan)",
    "country": "PK",
    "region": "南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.dawn.com/",
    "feeds": [
      "https://www.dawn.com/feeds/home"
    ],
    "risk_topics": [
      "CPEC",
      "恐袭",
      "俾路支",
      "中巴关系"
    ]
  },
  {
    "id": "pk_app",
    "name": "Associated Press of Pakistan",
    "country": "PK",
    "region": "南亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.app.com.pk/",
    "feeds": [
      "https://www.app.com.pk/feed/"
    ],
    "risk_topics": [
      "CPEC",
      "政府政策",
      "双边关系"
    ]
  },
  {
    "id": "pk_tribune",
    "name": "The Express Tribune",
    "country": "PK",
    "region": "南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://tribune.com.pk/",
    "feeds": [
      "https://tribune.com.pk/feed"
    ],
    "risk_topics": [
      "CPEC",
      "安全",
      "经济"
    ]
  },
  {
    "id": "lk_dailynews",
    "name": "Daily News (Sri Lanka)",
    "country": "LK",
    "region": "南亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.dailynews.lk/",
    "feeds": [
      "https://www.dailynews.lk/rss.xml"
    ],
    "risk_topics": [
      "汉班托塔港",
      "科伦坡港",
      "债务"
    ]
  },
  {
    "id": "lk_mirror",
    "name": "Daily Mirror (Sri Lanka)",
    "country": "LK",
    "region": "南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.dailymirror.lk/",
    "feeds": [
      "https://www.dailymirror.lk/rss"
    ],
    "risk_topics": [
      "港口",
      "中国投资",
      "政治"
    ]
  },
  {
    "id": "bd_bss",
    "name": "Bangladesh Sangbad Sangstha",
    "country": "BD",
    "region": "南亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.bssnews.net/",
    "feeds": [
      "https://www.bssnews.net/feed/"
    ],
    "risk_topics": [
      "帕德玛大桥",
      "基建",
      "投资"
    ]
  },
  {
    "id": "bd_dailystar",
    "name": "The Daily Star (Bangladesh)",
    "country": "BD",
    "region": "南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.thedailystar.net/",
    "feeds": [
      "https://www.thedailystar.net/frontpage/rss.xml"
    ],
    "risk_topics": [
      "基建",
      "安全",
      "经济"
    ]
  },
  {
    "id": "id_antara",
    "name": "Antara (Indonesia)",
    "country": "ID",
    "region": "东南亚",
    "language": "id",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.antaranews.com/",
    "feeds": [
      "https://www.antaranews.com/rss/nasional.xml"
    ],
    "risk_topics": [
      "雅万高铁",
      "镍矿",
      "青山工业园"
    ]
  },
  {
    "id": "id_kompas",
    "name": "Kompas",
    "country": "ID",
    "region": "东南亚",
    "language": "id",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.kompas.com/",
    "feeds": [
      "https://rss.kompas.com/"
    ],
    "risk_topics": [
      "投资",
      "资源民族主义",
      "基建"
    ]
  },
  {
    "id": "id_tempo",
    "name": "Tempo",
    "country": "ID",
    "region": "东南亚",
    "language": "id",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.tempo.co/",
    "feeds": [
      "https://rss.tempo.co/"
    ],
    "risk_topics": [
      "镍",
      "劳工",
      "合规"
    ]
  },
  {
    "id": "vn_vna",
    "name": "Vietnam News Agency",
    "country": "VN",
    "region": "东南亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://en.vietnamplus.vn/",
    "feeds": [
      "https://en.vietnamplus.vn/rss/vietnam.rss"
    ],
    "risk_topics": [
      "投资",
      "南海",
      "产业链"
    ]
  },
  {
    "id": "my_malaymail",
    "name": "Malay Mail",
    "country": "MY",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.malaymail.com/",
    "feeds": [
      "https://www.malaymail.com/feed/"
    ],
    "risk_topics": [
      "东海岸铁路",
      "投资",
      "政治"
    ]
  },
  {
    "id": "my_thestar",
    "name": "The Star",
    "country": "MY",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.thestar.com.my/",
    "feeds": [
      "https://www.thestar.com.my/rss/News/"
    ],
    "risk_topics": [
      "基建",
      "华人",
      "投资"
    ]
  },
  {
    "id": "th_bangkokpost",
    "name": "Bangkok Post",
    "country": "TH",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.bangkokpost.com/",
    "feeds": [
      "https://www.bangkokpost.com/rss/data/world.xml"
    ],
    "risk_topics": [
      "中泰铁路",
      "投资",
      "政治动荡"
    ]
  },
  {
    "id": "th_nation",
    "name": "The Nation",
    "country": "TH",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.nationthailand.com/",
    "feeds": [
      "https://www.nationthailand.com/rss"
    ],
    "risk_topics": [
      "基建",
      "政治",
      "安全"
    ]
  },
  {
    "id": "mm_mizzima",
    "name": "Mizzima",
    "country": "MM",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://mizzima.com/",
    "feeds": [
      "https://mizzima.com/rss.xml"
    ],
    "risk_topics": [
      "密松水电站",
      "冲突",
      "中缅关系"
    ]
  },
  {
    "id": "mm_irrawaddy",
    "name": "The Irrawaddy",
    "country": "MM",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.irrawaddy.com/",
    "feeds": [
      "https://www.irrawaddy.com/feed"
    ],
    "risk_topics": [
      "冲突",
      "投资",
      "政治"
    ]
  },
  {
    "id": "kh_phnompenhpost",
    "name": "Phnom Penh Post",
    "country": "KH",
    "region": "东南亚",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.phnompenhpost.com/",
    "feeds": [
      "https://www.phnompenhpost.com/rss.xml"
    ],
    "risk_topics": [
      "西哈努克港",
      "投资",
      "基建"
    ]
  },
  {
    "id": "la_kpl",
    "name": "KPL (Laos)",
    "country": "LA",
    "region": "东南亚",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://kpl.gov.la/",
    "risk_topics": [
      "中老铁路",
      "水电",
      "投资"
    ]
  },
  {
    "id": "kz_kazinform",
    "name": "Kazinform",
    "country": "KZ",
    "region": "中亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.inform.kz/",
    "feeds": [
      "https://www.inform.kz/en/rss"
    ],
    "risk_topics": [
      "铝铜项目",
      "能源",
      "投资"
    ]
  },
  {
    "id": "uz_uza",
    "name": "UzA (Uzbekistan)",
    "country": "UZ",
    "region": "中亚",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://uza.uz/en/",
    "risk_topics": [
      "鹏盛工业园",
      "天然气",
      "投资"
    ]
  },
  {
    "id": "tj_asiaplus",
    "name": "Asia-Plus",
    "country": "TJ",
    "region": "中亚",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://asiaplustj.info/",
    "risk_topics": [
      "中塔公路",
      "边境",
      "安全"
    ]
  },
  {
    "id": "kg_kabar",
    "name": "Kabar",
    "country": "KG",
    "region": "中亚",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://kabar.kg/",
    "risk_topics": [
      "中吉乌铁路",
      "投资",
      "政治"
    ]
  },
  {
    "id": "ru_tass",
    "name": "TASS",
    "country": "RU",
    "region": "中亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://tass.com/",
    "feeds": [
      "https://tass.com/rss/v2.xml"
    ],
    "risk_topics": [
      "亚马尔LNG",
      "中俄东线",
      "制裁"
    ]
  },
  {
    "id": "ru_ria",
    "name": "RIA Novosti",
    "country": "RU",
    "region": "中亚",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://ria.ru/",
    "feeds": [
      "https://ria.ru/exports/rss2/world/index.xml"
    ],
    "risk_topics": [
      "能源",
      "欧亚经济联盟",
      "地缘"
    ]
  },
  {
    "id": "sa_spa",
    "name": "Saudi Press Agency",
    "country": "SA",
    "region": "中东",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.spa.gov.sa/",
    "feeds": [
      "https://www.spa.gov.sa/rss.php"
    ],
    "risk_topics": [
      "延布炼厂",
      "2030愿景",
      "能源"
    ]
  },
  {
    "id": "sa_arabnews",
    "name": "Arab News",
    "country": "SA",
    "region": "中东",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.arabnews.com/",
    "feeds": [
      "https://www.arabnews.com/rss.xml"
    ],
    "risk_topics": [
      "能源",
      "投资",
      "红海"
    ]
  },
  {
    "id": "ae_gulfnews",
    "name": "Gulf News",
    "country": "AE",
    "region": "中东",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://gulfnews.com/",
    "feeds": [
      "https://gulfnews.com/rss"
    ],
    "risk_topics": [
      "港口",
      "能源",
      "投资"
    ]
  },
  {
    "id": "qa_aljazeera",
    "name": "Al Jazeera",
    "country": "QA",
    "region": "中东",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.aljazeera.com/",
    "feeds": [
      "https://www.aljazeera.com/xml/rss/all.xml"
    ],
    "risk_topics": [
      "地缘冲突",
      "红海",
      "伊朗"
    ]
  },
  {
    "id": "ir_irna",
    "name": "IRNA",
    "country": "IR",
    "region": "中东",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://en.irna.ir/",
    "risk_topics": [
      "中伊铁路",
      "能源",
      "制裁"
    ]
  },
  {
    "id": "iq_ina",
    "name": "Iraqi News Agency",
    "country": "IQ",
    "region": "中东",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://ina.iq/",
    "risk_topics": [
      "石油",
      "安全",
      "投资"
    ]
  },
  {
    "id": "eg_mena",
    "name": "MENA (Egypt)",
    "country": "EG",
    "region": "中东",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.mena.org.eg/",
    "risk_topics": [
      "苏伊士运河",
      "投资",
      "政治"
    ]
  },
  {
    "id": "dz_aps",
    "name": "APS (Algeria)",
    "country": "DZ",
    "region": "中东",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.aps.dz/",
    "risk_topics": [
      "光伏",
      "天然气",
      "投资"
    ]
  },
  {
    "id": "ng_nan",
    "name": "News Agency of Nigeria",
    "country": "NG",
    "region": "非洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://nannews.ng/",
    "risk_topics": [
      "绑架",
      "矿区安全",
      "莱基港",
      "锂加工厂"
    ]
  },
  {
    "id": "ng_premiumtimes",
    "name": "Premium Times",
    "country": "NG",
    "region": "非洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.premiumtimesng.com/",
    "feeds": [
      "https://www.premiumtimesng.com/feed"
    ],
    "risk_topics": [
      "绑架",
      "中资",
      "安全"
    ]
  },
  {
    "id": "ng_vanguard",
    "name": "Vanguard",
    "country": "NG",
    "region": "非洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.vanguardngr.com/",
    "feeds": [
      "https://www.vanguardngr.com/feed/"
    ],
    "risk_topics": [
      "经济",
      "安全",
      "投资"
    ]
  },
  {
    "id": "za_sabc",
    "name": "SABC",
    "country": "ZA",
    "region": "非洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.sabcnews.com/",
    "risk_topics": [
      "德阿风电",
      "矿业",
      "BRICS"
    ]
  },
  {
    "id": "za_news24",
    "name": "News24",
    "country": "ZA",
    "region": "非洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.news24.com/",
    "feeds": [
      "https://www.news24.com/rss"
    ],
    "risk_topics": [
      "投资",
      "政治",
      "矿业"
    ]
  },
  {
    "id": "cd_acaj",
    "name": "ACP (刚果金)",
    "country": "CD",
    "region": "非洲",
    "language": "fr",
    "stance": "G",
    "access": "web",
    "url": "https://acp.cd/",
    "risk_topics": [
      "矿产",
      "冲突",
      "中资"
    ]
  },
  {
    "id": "cd_actualitecd",
    "name": "Actualite.cd",
    "country": "CD",
    "region": "非洲",
    "language": "fr",
    "stance": "I",
    "access": "web",
    "url": "https://actualite.cd/",
    "risk_topics": [
      "东部动乱",
      "矿产",
      "安全"
    ]
  },
  {
    "id": "gn_apg",
    "name": "AGP (几内亚)",
    "country": "GN",
    "region": "非洲",
    "language": "fr",
    "stance": "G",
    "access": "web",
    "url": "https://agp.gov.gn/",
    "risk_topics": [
      "西芒杜铁矿",
      "矿产",
      "政变"
    ]
  },
  {
    "id": "et_ena",
    "name": "Ethiopian News Agency",
    "country": "ET",
    "region": "非洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.ena.et/",
    "risk_topics": [
      "亚吉铁路",
      "复兴大坝",
      "冲突"
    ]
  },
  {
    "id": "ke_kenyanews",
    "name": "Kenya News Agency",
    "country": "KE",
    "region": "非洲",
    "language": "en",
    "stance": "G",
    "access": "feeds",
    "url": "https://www.kenyanews.go.ke/",
    "feeds": [
      "https://www.kenyanews.go.ke/feed/"
    ],
    "risk_topics": [
      "蒙内铁路",
      "投资",
      "安全"
    ]
  },
  {
    "id": "mz_aim",
    "name": "AIM (Mozambique)",
    "country": "MZ",
    "region": "非洲",
    "language": "pt",
    "stance": "G",
    "access": "web",
    "url": "https://www.aim.org.mz/",
    "risk_topics": [
      "马普托大桥",
      "天然气",
      "叛乱"
    ]
  },
  {
    "id": "ao_angop",
    "name": "ANGOP (Angola)",
    "country": "AO",
    "region": "非洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.angop.ao/",
    "risk_topics": [
      "卡古路卡巴萨水电站",
      "石油",
      "投资"
    ]
  },
  {
    "id": "eg_egypttoday",
    "name": "Egypt Today",
    "country": "EG",
    "region": "非洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.egypttoday.com/",
    "feeds": [
      "https://www.egypttoday.com/rss.aspx"
    ],
    "risk_topics": [
      "苏伊士",
      "投资",
      "政治"
    ]
  },
  {
    "id": "dj_djibouti",
    "name": "ADI (Djibouti)",
    "country": "DJ",
    "region": "非洲",
    "language": "fr",
    "stance": "G",
    "access": "web",
    "url": "https://www.adi.dj/",
    "risk_topics": [
      "吉布提港",
      "军事基地",
      "通道"
    ]
  },
  {
    "id": "br_folha",
    "name": "Folha de S.Paulo",
    "country": "BR",
    "region": "拉美",
    "language": "pt",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.folha.uol.com.br/",
    "feeds": [
      "https://feeds.folha.uol.com.br/poder/rss091.xml"
    ],
    "risk_topics": [
      "美丽山特高压",
      "投资",
      "锂"
    ]
  },
  {
    "id": "br_brasil247",
    "name": "Brasil 247",
    "country": "BR",
    "region": "拉美",
    "language": "pt",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.brasil247.com/",
    "feeds": [
      "https://www.brasil247.com/feed"
    ],
    "risk_topics": [
      "投资",
      "政治",
      "BRICS"
    ]
  },
  {
    "id": "pe_andina",
    "name": "Andina (Peru)",
    "country": "PE",
    "region": "拉美",
    "language": "es",
    "stance": "G",
    "access": "feeds",
    "url": "https://andina.pe/",
    "feeds": [
      "https://andina.pe/agencia/rss.aspx"
    ],
    "risk_topics": [
      "钱凯港",
      "矿业",
      "投资"
    ]
  },
  {
    "id": "pe_comercio",
    "name": "El Comercio (Peru)",
    "country": "PE",
    "region": "拉美",
    "language": "es",
    "stance": "I",
    "access": "feeds",
    "url": "https://elcomercio.pe/",
    "feeds": [
      "https://elcomercio.pe/feed/"
    ],
    "risk_topics": [
      "钱凯港",
      "政治",
      "安全"
    ]
  },
  {
    "id": "ar_telam",
    "name": "Télam (Argentina)",
    "country": "AR",
    "region": "拉美",
    "language": "es",
    "stance": "G",
    "access": "web",
    "url": "https://www.telam.com.ar/",
    "risk_topics": [
      "锂矿",
      "债务",
      "投资"
    ]
  },
  {
    "id": "ar_clarin",
    "name": "Clarín",
    "country": "AR",
    "region": "拉美",
    "language": "es",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.clarin.com/",
    "feeds": [
      "https://www.clarin.com/rss/"
    ],
    "risk_topics": [
      "锂",
      "经济",
      "政治"
    ]
  },
  {
    "id": "cl_mercurio",
    "name": "El Mercurio (Chile)",
    "country": "CL",
    "region": "拉美",
    "language": "es",
    "stance": "I",
    "access": "web",
    "url": "https://www.emol.com/",
    "risk_topics": [
      "高压直流",
      "锂",
      "能源"
    ]
  },
  {
    "id": "mx_notimex",
    "name": "Notimex (Mexico)",
    "country": "MX",
    "region": "拉美",
    "language": "es",
    "stance": "G",
    "access": "web",
    "url": "https://notimex.mx/",
    "risk_topics": [
      "投资",
      "毒品战争",
      "产业链"
    ]
  },
  {
    "id": "bo_abi",
    "name": "ABI (Bolivia)",
    "country": "BO",
    "region": "拉美",
    "language": "es",
    "stance": "G",
    "access": "web",
    "url": "https://www.abi.bo/",
    "risk_topics": [
      "穆通钢厂",
      "锂",
      "天然气"
    ]
  },
  {
    "id": "ec_andes",
    "name": "Andes (Ecuador)",
    "country": "EC",
    "region": "拉美",
    "language": "es",
    "stance": "G",
    "access": "web",
    "url": "https://www.andes.info.ec/",
    "risk_topics": [
      "投资",
      "债务",
      "矿产"
    ]
  },
  {
    "id": "de_dpa",
    "name": "DPA",
    "country": "DE",
    "region": "欧洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.dpa.com/",
    "feeds": [
      "https://www.dpa.com/en/rss-feed"
    ],
    "risk_topics": [
      "投资审查",
      "中德关系",
      "供应链"
    ]
  },
  {
    "id": "de_faz",
    "name": "FAZ",
    "country": "DE",
    "region": "欧洲",
    "language": "de",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.faz.net/",
    "feeds": [
      "https://www.faz.net/rss/aktuell/"
    ],
    "risk_topics": [
      "投资",
      "政治",
      "经济"
    ]
  },
  {
    "id": "gb_reuters_london",
    "name": "Reuters UK",
    "country": "GB",
    "region": "欧洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.reuters.com/world/uk/",
    "feeds": [
      "https://www.reuters.com/world/uk/?format=rss"
    ],
    "risk_topics": [
      "中英关系",
      "投资",
      "地缘"
    ]
  },
  {
    "id": "fr_afp_fr",
    "name": "AFP",
    "country": "FR",
    "region": "欧洲",
    "language": "fr",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.afp.com/fr",
    "feeds": [
      "https://www.afp.com/fr/rss"
    ],
    "risk_topics": [
      "投资",
      "非洲",
      "地缘"
    ]
  },
  {
    "id": "rs_tanjug",
    "name": "Tanjug (Serbia)",
    "country": "RS",
    "region": "欧洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.tanjug.rs/",
    "risk_topics": [
      "匈塞铁路",
      "基建",
      "投资"
    ]
  },
  {
    "id": "hu_mti",
    "name": "MTI (Hungary)",
    "country": "HU",
    "region": "欧洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://mti.hu/",
    "risk_topics": [
      "匈塞铁路",
      "投资",
      "政治"
    ]
  },
  {
    "id": "gr_amna",
    "name": "AMNA (Greece)",
    "country": "GR",
    "region": "欧洲",
    "language": "en",
    "stance": "G",
    "access": "web",
    "url": "https://www.amna.gr/",
    "risk_topics": [
      "比雷埃夫斯港",
      "投资",
      "航运"
    ]
  },
  {
    "id": "us_wsj",
    "name": "Wall Street Journal",
    "country": "US",
    "region": "北美",
    "language": "en",
    "stance": "W",
    "access": "web",
    "url": "https://www.wsj.com/",
    "risk_topics": [
      "对华投资",
      "制裁",
      "脱钩"
    ]
  },
  {
    "id": "us_bloomberg_na",
    "name": "Bloomberg US",
    "country": "US",
    "region": "北美",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.bloomberg.com/",
    "risk_topics": [
      "能源",
      "金融制裁",
      "投资"
    ]
  },
  {
    "id": "ca_theglobe",
    "name": "The Globe and Mail",
    "country": "CA",
    "region": "北美",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.theglobeandmail.com/",
    "feeds": [
      "https://www.theglobeandmail.com/rss/"
    ],
    "risk_topics": [
      "中加关系",
      "投资",
      "矿产"
    ]
  },
  {
    "id": "au_aap",
    "name": "AAP (Australia)",
    "country": "AU",
    "region": "大洋洲",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.aap.com.au/",
    "risk_topics": [
      "达尔文港",
      "矿产",
      "投资审查"
    ]
  },
  {
    "id": "au_smh",
    "name": "Sydney Morning Herald",
    "country": "AU",
    "region": "大洋洲",
    "language": "en",
    "stance": "I",
    "access": "feeds",
    "url": "https://www.smh.com.au/",
    "feeds": [
      "https://www.smh.com.au/rss/feed.xml"
    ],
    "risk_topics": [
      "投资",
      "太平洋",
      "安全"
    ]
  },
  {
    "id": "pg_postcourier",
    "name": "Post-Courier",
    "country": "PG",
    "region": "大洋洲",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://www.postcourier.com.pg/",
    "risk_topics": [
      "资源",
      "港口",
      "地缘"
    ]
  },
  {
    "id": "sb_islandsbusiness",
    "name": "Islands Business",
    "country": "SB",
    "region": "大洋洲",
    "language": "en",
    "stance": "I",
    "access": "web",
    "url": "https://islandsbusiness.com/",
    "risk_topics": [
      "所罗门群岛",
      "港口",
      "地缘竞争"
    ]
  }
];

function byStance(stance) { return SOURCES.filter(s => s.stance === stance); }
function rssSources() { return SOURCES.filter(s => s.access === 'feeds' && Array.isArray(s.feeds) && s.feeds.length); }
function get(id) { return SOURCES.find(s => s.id === id) || null; }
module.exports = { SOURCES, byStance, rssSources, get };
