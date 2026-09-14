/* ============================================================
 * country-enforce-matrix.js — 执法引渡风险三维矩阵（#788 P0 纠错）
 * ------------------------------------------------------------
 * 取代 exec-travel.js 旧版 EXTRADITE_US 二元名单（#753 初版缺陷）：
 *   旧版把「中国香港」「中国台湾」直接列进对美引渡高风险区 —— 方向性错误：
 *     · 香港：2020-08 美方因国安法单方面中止对港引渡条约，通道已关闭，
 *       且香港系中国法域，不存在"经港引渡赴美"的现实通道；
 *     · 台湾：无官方对美引渡条约（仅 2002 刑事司法互助协议 MLAA，
 *       且该协议方向是司法协助而非人员引渡），历史上无对华人员引渡个案。
 *   旧版把"有没有条约"当唯一维度 —— 缺两个关键维度：
 *     · 对华执法立场（愿不愿意配合美方办中企/中方人员的案子）；
 *     · 历史拘押先例（有没有实际干过：孟晚舟 2018 加拿大、
 *       华为员工 2019 波兰、华为芬兰/法国调查等）。
 *
 * 三维矩阵（静态可解释规则库，非数据模拟；口径基于公开条约文本与公开案例）：
 *   us  —— 对美引渡法律通道：T=有效引渡条约 / M=仅司法互助无引渡条约 / N=无通道（缺失/悬置/敌对）
 *   rel —— 对华执法立场：A=对华强硬阵营（五眼/实体清单积极执行方）
 *                     B=竞争摇摆（对美安全依附+对华经济依赖）
 *                     C=友好中立（配合美方对华执法概率低）
 *   prec —— 对华拘押/执法先例（实际发生过，写明案例）
 *
 * 评分（0-100，可解释）：us(T=60/M=25/N=5) + rel(A=30/B=15/C=5) + prec(+10)
 * 档位：≥70 高 / ≥40 中 / <40 低
 * ============================================================ */

const US_PTS = { T: 60, M: 25, N: 5 };
const REL_PTS = { A: 30, B: 15, C: 5 };
const TIER_CN = { high: '高', mid: '中', low: '低' };

const MATRIX = {
  /* ---- 北美（孟晚舟案法域） ---- */
  '美国':      { us: 'T', rel: 'A', prec: '美方本土即执法发起国（出口管制/实体清单长臂管辖发起方）' },
  '加拿大':    { us: 'T', rel: 'A', prec: '2018 孟晚舟温哥华转机被捕（美方引渡请求，五年程序）——本系统原型场景' },
  '墨西哥':    { us: 'T', rel: 'B', prec: '对美引渡合作活跃（墨籍人员年引渡数百人），对华个案暂无先例' },

  /* ---- 五眼 ---- */
  '英国':      { us: 'T', rel: 'A', prec: '涉华出口管制调查活跃；2020 后对华科技围堵核心成员' },
  '澳大利亚':  { us: 'T', rel: 'A', prec: '对外国干涉法执法记录；对中资项目审查从严' },
  '新西兰':    { us: 'T', rel: 'A', prec: null },

  /* ---- 东亚 ---- */
  '日本':      { us: 'T', rel: 'A', prec: '对华出口管制执法记录；美日引渡条约 1980 生效' },
  '韩国':      { us: 'T', rel: 'A', prec: '1948 美韩引渡条约（1998 修订）；对华半导体管制跟随' },
  '蒙古':      { us: 'M', rel: 'C', prec: null },
  '中国香港':  { us: 'N', rel: 'C', prec: null,
    note: '★方向性纠错：2020-08 美方单方面中止对港引渡条约，经港引渡通道已关闭；香港系中国法域。美方残余风险在出口管制盘查与二次合规（非引渡），由 D6/D3 口径承接' },
  '中国台湾':  { us: 'M', rel: 'C', prec: null,
    note: '★方向性纠错：台湾地区系中国领土，无官方对美引渡条约，仅 2002 刑事司法互助协议（司法协助而非引渡），历史上无对华人员经台引渡个案' },

  /* ---- 欧洲（对美条约网主力 + 先例区） ---- */
  '波兰':      { us: 'T', rel: 'A', prec: '2019 华为员工王伟晶华沙被捕（美方引渡请求，在押多年）——五眼外先例法域' },
  '德国':      { us: 'T', rel: 'A', prec: '对华出口管制调查活跃（海关稽查记录）' },
  '法国':      { us: 'T', rel: 'A', prec: '阿尔斯通式"长臂司法"先例法域（对非美方企业刑事施压记录）' },
  '意大利':    { us: 'T', rel: 'A', prec: null },
  '西班牙':    { us: 'T', rel: 'A', prec: null },
  '荷兰':      { us: 'T', rel: 'A', prec: 'ASML 对华出口管制核心执行方；调查配合度高' },
  '比利时':    { us: 'T', rel: 'A', prec: null },
  '瑞士':      { us: 'T', rel: 'A', prec: null },
  '瑞典':      { us: 'T', rel: 'A', prec: null },
  '挪威':      { us: 'T', rel: 'A', prec: null },
  '丹麦':      { us: 'T', rel: 'A', prec: null },
  '芬兰':      { us: 'T', rel: 'A', prec: null },
  '奥地利':    { us: 'T', rel: 'A', prec: null },
  '爱尔兰':    { us: 'T', rel: 'A', prec: null },
  '葡萄牙':    { us: 'T', rel: 'A', prec: null },
  '希腊':      { us: 'T', rel: 'B', prec: null },
  '捷克':      { us: 'T', rel: 'A', prec: null },
  '斯洛伐克':  { us: 'T', rel: 'A', prec: null },
  '斯洛文尼亚':{ us: 'T', rel: 'A', prec: null },
  '克罗地亚':  { us: 'T', rel: 'A', prec: null },
  '罗马尼亚':  { us: 'T', rel: 'A', prec: null },
  '保加利亚':  { us: 'T', rel: 'A', prec: null },
  '匈牙利':    { us: 'T', rel: 'B', prec: null, note: '对华友好度高于欧盟均值，但引渡条约与欧盟司法合作框架仍在' },
  '爱沙尼亚':  { us: 'T', rel: 'A', prec: null },
  '拉脱维亚':  { us: 'T', rel: 'A', prec: null },
  '立陶宛':    { us: 'T', rel: 'A', prec: '涉台问题激进方，对华立场强硬' },
  '乌克兰':    { us: 'M', rel: 'A', prec: null },
  '白俄罗斯':  { us: 'N', rel: 'C', prec: null },
  '俄罗斯':    { us: 'N', rel: 'C', prec: null, note: '美俄无引渡条约且相互敌对——经俄转机对"美方引渡"方向风险极低，但需另行评估俄方执法风险（本矩阵口径为对美引渡）' },
  '塞尔维亚':  { us: 'M', rel: 'C', prec: null },
  '格鲁吉亚':  { us: 'T', rel: 'A', prec: null },
  '亚美尼亚':  { us: 'M', rel: 'B', prec: null },
  '阿塞拜疆':  { us: 'M', rel: 'B', prec: null },
  '土耳其':    { us: 'T', rel: 'B', prec: '布伦森牧师案显示条约可用；对华个案无先例', usPts: 50 },
  '阿尔巴尼亚':{ us: 'T', rel: 'A', prec: null },

  /* ---- 亚太枢纽（中资差旅高频过境点，重点纠错区） ---- */
  '新加坡':    { us: 'T', rel: 'B', prec: '对美刑事合作记录（金融合规），对华个案无先例', usPts: 55,
    note: '对美引渡条约有效但对华立场独立自主——主要风险在美方金融合规协查，非拘押先例' },
  '泰国':      { us: 'T', rel: 'B', prec: null, usPts: 45, note: '1931 旧条约活性低；对华友好，配合美方对华执法概率低' },
  '菲律宾':    { us: 'T', rel: 'A', prec: null, usPts: 50 },
  '马来西亚':  { us: 'M', rel: 'B', prec: null },
  '印度尼西亚':{ us: 'M', rel: 'B', prec: null },
  '越南':      { us: 'M', rel: 'C', prec: null },
  '柬埔寨':    { us: 'M', rel: 'C', prec: null },
  '老挝':      { us: 'N', rel: 'C', prec: null },
  '缅甸':      { us: 'N', rel: 'C', prec: null },
  '文莱':      { us: 'M', rel: 'B', prec: null },
  '印度':      { us: 'T', rel: 'A', prec: '1997 美印引渡条约；Quad 成员，对华安全对抗立场' },
  '巴基斯坦':  { us: 'M', rel: 'B', prec: null },
  '孟加拉国':  { us: 'M', rel: 'C', prec: null },
  '斯里兰卡':  { us: 'M', rel: 'C', prec: null },
  '尼泊尔':    { us: 'M', rel: 'C', prec: null },
  '哈萨克斯坦':{ us: 'M', rel: 'C', prec: null },
  '乌兹别克斯坦':{ us: 'M', rel: 'C', prec: null },
  '吉尔吉斯斯坦':{ us: 'M', rel: 'C', prec: null },
  '塔吉克斯坦':{ us: 'M', rel: 'C', prec: null },
  '阿富汗':    { us: 'N', rel: 'C', prec: null },

  /* ---- 中东 ---- */
  '阿联酋':    { us: 'M', rel: 'B', prec: '迪拜/阿布扎比无对美引渡条约，但有个案协查记录', usPts: 30 },
  '卡塔尔':    { us: 'M', rel: 'C', prec: null },
  '沙特阿拉伯':{ us: 'M', rel: 'B', prec: null },
  '科威特':    { us: 'M', rel: 'B', prec: null },
  '巴林':      { us: 'M', rel: 'B', prec: null },
  '阿曼':      { us: 'M', rel: 'C', prec: null },
  '约旦':      { us: 'T', rel: 'B', prec: null, usPts: 45 },
  '以色列':    { us: 'T', rel: 'A', prec: '美以引渡条约 1963 生效；对华科技审查跟随美方（港口/5G 否决记录）' },
  '伊拉克':    { us: 'M', rel: 'B', prec: null },
  '黎巴嫩':    { us: 'M', rel: 'B', prec: null },
  '叙利亚':    { us: 'N', rel: 'C', prec: null },
  '伊朗':      { us: 'N', rel: 'C', prec: null },
  '也门':      { us: 'N', rel: 'C', prec: null },
  '埃及':      { us: 'M', rel: 'B', prec: null },

  /* ---- 非洲 ---- */
  '南非':      { us: 'M', rel: 'C', prec: null },
  '肯尼亚':    { us: 'M', rel: 'B', prec: null },
  '尼日利亚':  { us: 'T', rel: 'B', prec: null, usPts: 45, note: '1931 英式旧条约延续，活性低' },
  '埃塞俄比亚':{ us: 'M', rel: 'C', prec: null },
  '摩洛哥':    { us: 'T', rel: 'B', prec: null, usPts: 45 },
  '阿尔及利亚':{ us: 'M', rel: 'C', prec: null },
  '突尼斯':    { us: 'M', rel: 'B', prec: null },
  '加纳':      { us: 'M', rel: 'B', prec: null },
  '坦桑尼亚':  { us: 'M', rel: 'C', prec: null },
  '赞比亚':    { us: 'M', rel: 'C', prec: null },
  '津巴布韦':  { us: 'N', rel: 'C', prec: null },
  '安哥拉':    { us: 'N', rel: 'C', prec: null },
  '苏丹':      { us: 'N', rel: 'C', prec: null },
  '刚果民主共和国': { us: 'M', rel: 'C', prec: null },
  '刚果（金）':{ us: 'M', rel: 'C', prec: null },

  /* ---- 拉美 ---- */
  '巴西':      { us: 'T', rel: 'B', prec: null, usPts: 50 },
  '阿根廷':    { us: 'T', rel: 'B', prec: null, usPts: 50 },
  '智利':      { us: 'T', rel: 'B', prec: null, usPts: 50 },
  '秘鲁':      { us: 'T', rel: 'B', prec: null, usPts: 50 },
  '哥伦比亚':  { us: 'T', rel: 'A', prec: '对美引渡合作极活跃（年引渡百余人均为墨/哥籍毒犯），对华个案无先例' },
  '委内瑞拉':  { us: 'N', rel: 'C', prec: null },
  '古巴':      { us: 'N', rel: 'C', prec: null },
  '玻利维亚':  { us: 'N', rel: 'B', prec: null },
  '厄瓜多尔':  { us: 'N', rel: 'C', prec: null },
  '巴拿马':    { us: 'T', rel: 'B', prec: null, usPts: 50, note: '运河区通道国，对美司法依附度高' },

  /* ---- 大洋洲 ---- */
  '巴布亚新几内亚': { us: 'M', rel: 'B', prec: null },
  '斐济':      { us: 'M', rel: 'C', prec: null }
};

/* 别名归一：前端/台账录入变体 → 标准键 */
const ALIAS = {
  '美利坚': '美国', '美国本土': '美国',
  '香港': '中国香港', 'hongkong': '中国香港', 'hong kong': '中国香港',
  '台湾': '中国台湾', '台湾地区': '中国台湾', 'taiwan': '中国台湾',
  '阿联酋迪拜': '阿联酋', '迪拜': '阿联酋', '阿布扎比': '阿联酋',
  '沙特': '沙特阿拉伯', '刚果': '刚果民主共和国', '刚果金': '刚果民主共和国',
  '巴新': '巴布亚新几内亚'
};

const _normName = (s) => String(s == null ? '' : s).trim().replace(/[\s·]/g, '');

/* ---------- 探针：国名 → 三维画像 + 得分 + 档位 ---------- */
function probe(countryName) {
  const raw = _normName(countryName);
  if (!raw) return null;
  const key = ALIAS[raw.toLowerCase()] || ALIAS[raw] || raw;
  const e = MATRIX[key];
  if (!e) {
    /* 未收录法域：保守默认（无引渡条约仅互助 + 摇摆立场）→ 中档，并显式标注"未收录" */
    return { country: raw, known: false, us: 'M', rel: 'B', prec: null,
      score: US_PTS.M + REL_PTS.B, tier: 'mid',
      usCN: '未收录（按仅司法互助保守默认）', relCN: '竞争摇摆（默认）', precCN: null, note: '该法域未收录矩阵——按保守默认计分，建议人工补充研判' };
  }
  const usPts = e.usPts != null ? e.usPts : US_PTS[e.us];
  const score = usPts + REL_PTS[e.rel] + (e.prec ? 10 : 0);
  return {
    country: key, known: true, us: e.us, rel: e.rel, prec: !!e.prec,
    score, tier: score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low',
    usCN: { T: '对美引渡条约有效', M: '无引渡条约·仅司法互助', N: '对美引渡通道缺失/已中止' }[e.us]
      + (e.usPts != null ? '（活性修正）' : ''),
    relCN: { A: '对华强硬阵营', B: '竞争摇摆', C: '友好中立' }[e.rel],
    precCN: e.prec || null, note: e.note || null
  };
}

const isHighRisk = (name) => { const p = probe(name); return !!p && p.tier === 'high'; };
const listByTier = (tier) => Object.keys(MATRIX).filter(k => {
  const e = MATRIX[k];
  const usPts = e.usPts != null ? e.usPts : US_PTS[e.us];
  const score = usPts + REL_PTS[e.rel] + (e.prec ? 10 : 0);
  return (score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low') === tier;
});

module.exports = {
  MATRIX, probe, isHighRisk, listByTier, TIER_CN,
  meta: {
    version: 'v3-20260913',
    basis: '公开引渡条约文本 + 公开判例（孟晚舟 2018 温哥华 / 华为员工 2019 华沙）+ 对华执法立场公开记录；静态规则库，非数据模拟',
    dims: [
      { k: 'us', cn: '对美引渡法律通道', vals: 'T=有效条约 / M=仅司法互助 / N=无通道' },
      { k: 'rel', cn: '对华执法立场', vals: 'A=强硬 / B=摇摆 / C=友好中立' },
      { k: 'prec', cn: '对华拘押先例', vals: '实际发生过（写明案例）' }
    ],
    formula: 'us(T=60/M=25/N=5) + rel(A=30/B=15/C=5) + prec(+10)；≥70 高 / ≥40 中 / <40 低'
  }
};
