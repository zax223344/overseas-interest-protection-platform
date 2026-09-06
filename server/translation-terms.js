/**
 * translation-terms.js — 安全情报领域术语库（占位符法前置替换 + 译文后处理本地化）
 *
 * 依据：《数据采集分类与翻译精准化操作手册》第二/三/五/六部分：
 *   ① 术语前置替换（占位符法）——翻译前把术语换成 ⟦T012⟧，翻译后还原为标准中文，
 *      消灭"中外文混杂"（ISIS 一会儿译一会儿不译）与"翻译不精准"（VBIED 直译乱码）；
 *   ② 译文后处理本地化——数字/货币/单位转中文习惯（"50百万美元"→"5000万美元"）；
 *   ③ 占位符格式 ⟦T012⟧：字母 T 后紧跟数字，_fixMixedZh 的英文片段正则只会抓到
 *      单字母 "T"（长度<3 自动跳过），不会被二次翻译破坏；⟦⟧ 为罕用括号，引擎保留率高。
 *
 * 术语表维护规则：
 *   - 只收"通用引擎译错/译不一致"的领域专名，普通词汇（kidnapping→绑架）不重复劳动；
 *   - 多写法（ISIS/ISIL/Daesh）映射同一标准译名，长写法优先匹配（模块内自动按长度倒序）；
 *   - 组织缩写必须全大写词边界匹配（ISIS 可替，Analysis 中的 "is" 永不误伤）。
 */
'use strict';

/* [源语言写法数组, 标准中文译名] —— 顺序无关，模块加载时按最长写法优先排序 */
const _TERM_DEFS = [
  /* ── 恐怖/武装组织 ── */
  [['Islamic State', 'ISIS', 'ISIL', 'Daesh'], '伊斯兰国'],
  [['Islamic State West Africa Province', 'ISWAP'], '伊斯兰国西非省'],
  [['Islamic State Khorasan', 'ISIS-K', 'ISKP', 'IS-K'], '伊斯兰国呼罗珊省'],
  [['Al-Shabaab', 'Al Shabaab', 'al-Shabab', 'Harakat al-Shabaab'], '索马里青年党'],
  [['Boko Haram'], '博科圣地'],
  [['Al-Qaeda', 'Al Qaeda', 'al-Qaida', 'Al Qaida'], '基地组织'],
  [['Tehrik-i-Taliban', 'Tehreek-e-Taliban', 'TTP'], '巴基斯坦塔利班'],
  [['Taliban'], '塔利班'],
  [['Hamas'], '哈马斯'],
  [['Hezbollah', 'Hizbollah', 'Hizbullah'], '真主党'],
  [['Houthi', 'Houthis', 'Ansar Allah'], '胡塞武装'],
  [['Allied Democratic Forces', 'ADF'], '民主同盟军'],
  [['Jama\'at Nusrat al-Islam', 'JNIM'], '伊斯兰与穆斯林支持组织'],
  [['Rapid Support Forces', 'RSF'], '快速支援部队'],
  [['Wagner Group', 'Wagner'], '瓦格纳集团'],
  [['March 23 Movement', 'M23'], 'M23运动'],
  [['Al-Aqsa Martyrs Brigade', 'Al-Aqsa Brigades'], '阿克萨烈士旅'],
  [['Islamic Revolutionary Guard Corps', 'IRGC'], '伊斯兰革命卫队'],
  [['Kurdistan Workers\' Party', 'PKK'], '库尔德工人党'],
  [['Abu Sayyaf'], '阿布沙耶夫组织'],
  [['Lashkar-e-Taiba', 'LeT'], '虔诚军'],
  [['Jaish-e-Mohammed', 'JeM'], '穆罕默德军'],

  /* ── 武器/战术（通用引擎高频译错区） ── */
  [['vehicle-borne improvised explosive device', 'vehicle-borne IED', 'VBIED'], '车载简易爆炸装置'],
  [['improvised explosive device', 'IED'], '简易爆炸装置'],
  [['suicide bombing', 'suicide attack'], '自杀式爆炸袭击'],
  [['suicide bomber'], '自杀式袭击者'],
  [['car bomb', 'car bombing'], '汽车炸弹'],
  [['roadside bomb'], '路边炸弹'],
  [['rocket-propelled grenade', 'RPG'], '火箭推进榴弹'],
  [['drone strike', 'drone attack'], '无人机袭击'],
  [['airstrike', 'air strike', 'air raid'], '空袭'],
  [['mortar shelling', 'mortar attack'], '迫击炮袭击'],
  [['improvised explosive'], '简易爆炸物'],

  /* ── 冲突/事件词（统一译法防漂移） ── */
  [['ceasefire', 'cease-fire'], '停火'],
  [['coup d\'état', 'coup d\'etat', 'military coup'], '军事政变'],
  [['armed insurgents', 'insurgents'], '叛乱分子'],
  [['militants'], '武装分子'],
  [['gunmen'], '持枪歹徒'],
  [['militia', 'militias'], '民兵'],
  [['peacekeeping forces', 'peacekeepers'], '维和部队'],
  [['hostage-taking', 'hostage crisis'], '人质劫持'],

  /* ── 国际机构 ── */
  [['United Nations', 'UN'], '联合国'],
  [['World Health Organization', 'WHO'], '世界卫生组织'],
  [['NATO'], '北约'],
  [['African Union'], '非洲联盟'],
  [['ECOWAS'], '西非国家经济共同体'],
  [['INTERPOL', 'Interpol'], '国际刑警组织'],
  [['International Committee of the Red Cross', 'ICRC'], '红十字国际委员会'],
  [['UNHCR', 'UN Refugee Agency'], '联合国难民署'],
  [['World Bank'], '世界银行'],
  [['IMF', 'International Monetary Fund'], '国际货币基金组织'],
  [['European Union', 'EU'], '欧盟'],
  [['African Development Bank'], '非洲开发银行'],

  /* ── 涉华高频 ── */
  [['Belt and Road Initiative', 'Belt and Road', 'BRI'], '一带一路'],
  [['China-Pakistan Economic Corridor', 'CPEC'], '中巴经济走廊'],
  [['People\'s Liberation Army', 'PLA'], '中国人民解放军']
];

/* 编译：长写法优先（防 "Islamic State" 被 "ISIS" 抢先截断），词边界整词匹配 */
const _COMPILED = [];
(function _compile() {
  const rows = [];
  _TERM_DEFS.forEach(function (def, idx) {
    def[0].forEach(function (src) { rows.push({ src: src, cn: def[1], id: idx }); });
  });
  rows.sort(function (a, b) { return b.src.length - a.src.length; });
  rows.forEach(function (r) {
    const esc = r.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* 左边界：前面不是字母/数字；右边界同理。缩写全大写仍安全（ISIS 整词才中）。
     * 大小写策略：≤4 字符且混合大小写的写法（LeT/JeM）必须大小写敏感——
     * gi 会把英文单词 "let" 误替换成"虔诚军"；全大写缩写（ISIS/ADF）gi 安全。 */
    const mixedCase = /[a-z]/.test(r.src) && /[A-Z]/.test(r.src);
    const flags = (r.src.length <= 4 && mixedCase) ? 'g' : 'gi';
    const re = new RegExp('(?<![A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', flags);
    _COMPILED.push({ re: re, cn: r.cn, id: r.id, src: r.src });
  });
})();

/**
 * 翻译前：术语 → 占位符 ⟦T007⟧
 * @returns {{text:string, slots:Object<string,string>}} slots 键为序号字符串，值为标准中文
 */
function preReplace(text) {
  let t = String(text || '');
  const slots = {};
  if (!t || !/[A-Za-z]{3,}/.test(t)) return { text: t, slots: slots };
  _COMPILED.forEach(function (term) {
    term.re.lastIndex = 0; /* g 正则 test 会推进 lastIndex，跨条目复用必须显式重置 */
    if (!term.re.test(t)) return;
    term.re.lastIndex = 0;
    const ph = '\u27E6T' + String(term.id).padStart(3, '0') + '\u27E7';
    t = t.replace(term.re, ph);
    slots[String(term.id)] = term.cn;
  });
  return { text: t, slots: slots };
}

/**
 * 翻译后：占位符 → 标准中文。容忍引擎变体：
 *   ⟦T007⟧ / ⟦ T007 ⟧ / [T007] / ［T007］ / 【T07】 / T007（括号被引擎吃掉）
 */
function postRestore(text, slots) {
  let t = String(text || '');
  if (!t || !slots || !Object.keys(slots).length) return t;
  /* 左括号必需（⟦ [ ［ 【），右括号可选（引擎可能丢半边）；纯数字引用 [12] 与
   * 正文裸 "T12" 均不中招，已登记序号才替换，未登记原样保留。 */
  t = t.replace(/(?:\u27E6|\[|\uFF3B|\u3010)\s*T\s*0*(\d{1,3})\s*(?:\u27E7|\]|\uFF3D|\u3011)?/gi, function (m, idStr) {
    const cn = slots[String(parseInt(idStr, 10))];
    return cn || m;
  });
  return t;
}

/**
 * 译文后处理本地化（手册 6.2 数字·单位·货币，A 级自动修正）：
 *   50百万美元 → 5000万美元；3.5十亿美元 → 35亿美元；5百万(人) → 500万
 *   公里/英里等引擎译法已统一，不重复处理；只修通用引擎高频错译。
 */
function localizeNums(text) {
  let t = String(text || '');
  if (!t) return t;
  /* N百万美元 → N*100 万美元（"50百万美元"是典型直译腔错误） */
  t = t.replace(/(\d+(?:\.\d+)?)\s*百万美元/g, function (_, n) {
    const v = parseFloat(n) * 100;
    return (Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')) + '万美元';
  });
  /* N十亿美元 → N*10 亿美元 */
  t = t.replace(/(\d+(?:\.\d+)?)\s*十亿美元/g, function (_, n) {
    const v = parseFloat(n) * 10;
    return (Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')) + '亿美元';
  });
  /* N百万（非美元/亿前缀） → N*100 万：5百万人 → 500万人；"数百万/数千万"不含数字不中招 */
  t = t.replace(/(\d+(?:\.\d+)?)\s*百万(?![美亿])/g, function (_, n) {
    const v = parseFloat(n) * 100;
    return (Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')) + '万';
  });
  /* N十亿（非美元） → N*10 亿 */
  t = t.replace(/(\d+(?:\.\d+)?)\s*十亿(?![美])/g, function (_, n) {
    const v = parseFloat(n) * 10;
    return (Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')) + '亿';
  });
  return t;
}

/**
 * 译文术语归一（后置，主路径）：
 * 实测 TranSmart 对 ⟦T012⟧ 占位符会吃掉括号并误翻（T→塔利班），且中英混排输入
 * 在 auto 模式下被原样退回——前置占位符法在本系统引擎组合下不可行。
 * 改后置：引擎原生译文中的残留英文术语（VBIED/RSF/TTP 等缩写引擎不译）
 * 与非标准中文变体（"青年党"→"索马里青年党"）统一归一为权威译名。
 * 幂等，可在翻译链多点调用。
 */
const _ZH_VARIANTS = [
  /* [正则, 标准译名] —— 防自吞：长形态用负后顾排除 */
  [/(?<!索马里)青年党/g, '索马里青年党'],
  [/伊斯兰国-K/g, '伊斯兰国呼罗珊省'],
  [/伊斯兰国呼罗珊(?!省)/g, '伊斯兰国呼罗珊省'], /* (?!省)：防上一条规则替换结果被二次追加成"省省" */
  [/伊拉克和黎凡特伊斯兰国/g, '伊斯兰国'],
  [/伊拉克和沙姆伊斯兰国/g, '伊斯兰国'],
  [/(?<!红十字)红十字委员会/g, '红十字国际委员会'],
  [/西共体/g, '西非国家经济共同体'],
  [/博科哈拉姆/g, '博科圣地'],
  [/瓦格纳军团/g, '瓦格纳集团'],
  [/真主党武装/g, '真主党']
];
function normalizeZh(zh) {
  let t = String(zh || '');
  if (!t) return t;
  /* ① 译文残留英文术语 → 标准中文（复用 _COMPILED 词表，长词优先） */
  if (/[A-Za-z]{2,}/.test(t)) {
    _COMPILED.forEach(function (term) {
      term.re.lastIndex = 0;
      if (!term.re.test(t)) return;
      term.re.lastIndex = 0;
      t = t.replace(term.re, term.cn);
    });
  }
  /* ② 非标准中文变体归一 */
  _ZH_VARIANTS.forEach(function (v) { t = t.replace(v[0], v[1]); });
  /* ③ 数字·货币本地化 */
  t = localizeNums(t);
  return t;
}

module.exports = { preReplace, postRestore, localizeNums, normalizeZh, _COMPILED };
