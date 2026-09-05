/**
 * server/report-standard.js —— 统一报告标准模块（#625）
 * =====================================================================
 * 全平台研判报告 + 公文输出的唯一规范来源，四处消费同一标准：
 *   1. server.js 每日简报（_buildGovDailyReport，规则成文）
 *   2. server.js AI 七段报告（_DEEP_SEGS：aireport.js 前端消费）
 *   3. server.js 五视图公文（_GOV_DOC_SPECS：govdoc.js 前端消费）
 *   4. reports-engine.js 九类周期报告（SYSTEM_PROMPT + renderGovHtml）
 *
 * 内容三块：
 *   一、规范常量（MANUAL_SPEC 手册规范 / GOV_STYLE_SPEC 公文语体 / REC_SPEC 对策建议）
 *   二、GB/T 9704-2012 公文版式引擎（paperCss/paperHead/paperTail，一处维护四处调用）
 *   三、完稿质检 qcCheck（Markdown 残留 / 半角标点 / 模糊词 / 口号式说教）
 *
 * 铁律：改任何规范只改本文件；各消费方禁止内联复制规范文本。
 */
'use strict';

/* ============================================================
 * 一、规范常量（源自《智库分析报告规范手册》全文 + GB/T 9704-2012）
 * ============================================================ */

/* 手册核心规范：六维质量标准 + IMRAD-C 七段式 + 摘要倒金字塔 + 行文论证 */
const MANUAL_SPEC = '【报告质量规范（必须严格执行，源自《智库分析报告规范手册》）】' +
  '【六维质量标准 STAR-QA】针对性（锁定明确决策主体与具体问题）、证据性（判断有可追溯数据、案例、一手资料支撑）、' +
  '分析性（超越事实罗列，呈现因果链、机制与推演逻辑）、前瞻性（识别趋势与拐点，提出情景研判而非仅复盘）、' +
  '可操作性（建议明确谁来做、做什么、何时、达到什么标准）、可接受性（在政治、财政、社会、合规约束内可执行并预判阻力）。' +
  '证据性与可操作性为不可妥协的硬性要求。' +
  '【报告结构 IMRAD-C 七段式】I 引言摘要（倒金字塔：最重要结论前置，300至500字说清问题、判断、建议三件事，含1至3条核心判断，每条一句话可独立成立，禁止出现正文未展开的新信息）；' +
  'B 背景形势（描述现状、界定口径：时间口径、地域主体口径、概念口径、数据来源口径）；' +
  'A 分析研判（每节开头先给本节论点句；事实陈述与观点判断分层标识，用"数据显示"陈述、"据此判断"引出推论）；' +
  'C 对策建议（分层次、可执行、可检验，见对策建议规范）；' +
  'D 讨论风险（说明不确定性、反证、实施阻力，主动呈现对立观点并回应）；' +
  'E 结论（凝练核心判断，逐条回应引言提出的问题，区分事实性结论与建议性结论）。' +
  '【行文规范】动宾开路（建立、推动、完善、试点，避免"应加强管理"式标语）；一事一议（一篇一核心，建议聚焦3至5条）；' +
  '去模糊化（禁"普遍认为""约数十""成效显著"，须"效率提升30%"式量化）；主谓清晰（长句拆分，每句一个核心意思）；术语一致（同一概念前后统一，缩略语首次出现写"中文全称（英文缩写）"）。' +
  '【论证要求】论点论据论证三要素齐全；因果链完整（避免相关即因果，说明作用机制）；区分事实与推断（"数据显示""据此推断"标识层级）。' +
  '【数字规范】数字必须可复算（分项之和等于合计，衍生指标给出计算口径）；数据注明口径与截止时点；估算推测明确标识，不得伪装为确定事实。';

/* 公文语体规范（GB/T 15834 标点 + GB/T 15835 数字 + 党政机关公文语体） */
const GOV_STYLE_SPEC = '写作规范：一、严格党政机关公文语体，庄重、准确、简明，不用口语和网络用语；' +
  '二、结构层次序号：一级"一、"，二级"（一）"，三级"1."，四级"（1）"；' +
  '三、标点符号严格按 GB/T 15834：中文语境一律全角标点，并列词语用顿号、分句用逗号、句末用句号，严禁半角逗号句号残留；' +
  '四、数字用法按 GB/T 15835：统计数据用阿拉伯数字，约数用"约""余"；' +
  '五、判断有分寸，严格区分"已证实""研判认为""需持续关注"三级确定性表述；' +
  '六、只基于给定数据研判，数据未涉及的领域不得杜撰；' +
  '七、输出纯文本公文，严禁 Markdown 语法（星号加粗、井号标题、反引号、竖线表格）。';

/* 对策建议规范（手册第五章：四条生死线 + 五段式 + 三层架构 + 时序分级 + 关键句式） */
const REC_SPEC = '对策建议撰写规范（必须严格执行，源自《智库报告"对策建议"撰写规范手册》）：' +
  '【四条生死线】对应性（每条建议必须能回指前文某一具体问题，禁止感想式建议）；' +
  '可操作性（明确谁来做、做什么、用什么、何时、达到什么标准）；' +
  '可接受性（须通过政治、财政、社会三条约束校验，并预判阻力与规避办法）；' +
  '可检验性（每条至少配一个量化指标或标志性成果，便于督办验收）。' +
  '【宏观结构】对策体系按"总体思路→核心举措→保障机制→优先级与实施路径"四层组织：' +
  '总体思路1段（战略定位、基本原则、目标年份）；核心举措3至5条（每条按五段式微观结构展开，一事一议，主建议不超过5条）；' +
  '保障机制涵盖法治、资金、人才、考核、数据；优先级与实施路径按时序分级：近期（0至6个月，摸底建机制试点）、中期（6至24个月，建平台推标准扩面）、远期（2至5年，制度定型长效机制）。' +
  '【五段式微观结构】每条建议依次含：①形势判断（1句，点出痛点与时机，回指前文数据）；②战略目标（1句，含目标年份与覆盖率）；' +
  '③具体行动（分2至4条，含牵头与配合单位）；④资源保障（钱、人、数据、法规来源明确）；⑤风险与成效（预期主要阻力与规避路径＋量化成效）。' +
  '具体行动必须使用关键句式「由【牵头单位】会同【配合单位】，于【时间】前，通过【手段】，完成【可验收成果】，预计【成效或风险】。」' +
  '【常见失分纠正】"加强国际合作打击相关问题"→"由外交部牵头，与对象国建立季度情报共享机制，2026年内完成3次联合演练"；' +
  '"提升能力建设水平"→"2026年四季度前完成3个试点部署，覆盖核心区域80%"；"应予以高度重视"→"建议纳入年度考核指标，设定达标率不低于90%"。' +
  '【文风铁律】动宾结构开路，严禁"务必、必须、坚决"等口号式说教；以参谋员身份行文，用"建议、可考虑、宜"；' +
  '牵头单位从外交部、商务部、公安部、国家安全部、国务院国资委、中央企业、驻外使领馆中按职责选定。';

/* 统一研判 persona（reports-engine SYSTEM_PROMPT 消费；其余各处 persona 差异化保留） */
const SYSTEM_PROMPT = '你是中国海外利益保护情报预警平台的高级情报分析员，为外交部、商务部、公安部、国家安全部、中央企业领导撰写专业分析报告。'
  + GOV_STYLE_SPEC + '\n' + MANUAL_SPEC;

/* ============================================================
 * 二、GB/T 9704-2012 公文版式引擎
 * ------------------------------------------------------------
 * 版心 156×225mm（天头37mm/订口28mm/下35mm/右26mm）；
 * 各要素 3 号（16pt）仿宋_GB2312；数字英文半角 3 号 Times New Roman（字体栈首位）；
 * 行距固定值 28.5 磅（每面 22 行）；标题 2 号小标宋居中；
 * 一级黑体 / 二级楷体 / 三级仿宋（可加粗）均 3 号、首行缩进 2 字符；
 * 版记 4 号仿宋 + 首末粗线中间细线。cls 为类名前缀（'drg'/'rgp'/…），
 * 同一份 CSS 服务所有产品线——版式只在此处维护。
 * ============================================================ */
function paperCss(cls) {
  const c = String(cls || 'gov');
  return '.' + c + '-paper{width:21cm;max-width:100%;margin:0 auto;background:#fff;color:#000;padding:37mm 26mm 35mm 28mm;'
    + 'font-family:"Times New Roman","仿宋_GB2312","FangSong_GB2312","仿宋","FangSong",serif;font-size:16pt;line-height:28.5pt;box-sizing:border-box;}'
    + '.' + c + '-paper *{box-sizing:content-box;}'
    + '.' + c + '-redhead{text-align:center;font-family:"方正小标宋简体","FZXiaoBiaoSong-B05S","宋体","SimSun",serif;color:#d40000;font-size:26pt;line-height:34pt;font-weight:700;letter-spacing:5px;margin:0 0 4pt;}'
    + '.' + c + '-paper.nored .' + c + '-redhead,.' + c + '-paper.nored .' + c + '-redline{display:none;}'
    + '.' + c + '-redline{border:none;border-top:3px solid #d40000;margin:2pt 0 0;}'
    + '.' + c + '-qihao{text-align:center;font-family:"Times New Roman","楷体","KaiTi",serif;font-size:16pt;line-height:28.5pt;margin:2pt 0 0;}'
    + '.' + c + '-title{text-align:center;font-family:"方正小标宋简体","FZXiaoBiaoSong-B05S","华文中宋","STZhongsong","宋体","SimSun",serif;font-size:22pt;line-height:34pt;font-weight:700;margin:14pt 0 6pt;}'
    + '.' + c + '-datebar{text-align:center;font-family:"Times New Roman","楷体","KaiTi",serif;font-size:16pt;line-height:28.5pt;margin:0 0 6pt;}'
    + '.' + c + '-h1{font-family:"黑体","SimHei",serif;font-size:16pt;font-weight:400;line-height:28.5pt;margin:12pt 0 2pt;text-align:left;text-indent:2em;}'
    + '.' + c + '-h2{font-family:"楷体","KaiTi",serif;font-size:16pt;font-weight:400;line-height:28.5pt;margin:8pt 0 0;text-align:left;text-indent:2em;}'
    + '.' + c + '-h3{font-family:"仿宋_GB2312","FangSong_GB2312","仿宋","FangSong",serif;font-size:16pt;font-weight:700;line-height:28.5pt;margin:6pt 0 0;text-align:left;text-indent:2em;}'
    + '.' + c + '-p{font-size:16pt;line-height:28.5pt;text-indent:2em;margin:0;}'
    + '.' + c + '-sign{text-align:right;margin-top:22pt;line-height:28.5pt;font-size:16pt;}'
    + '.' + c + '-sign .' + c + '-org{padding-right:2em;}'
    + '.' + c + '-sign .' + c + '-date{padding-right:0;}'
    + '.' + c + '-footer{margin-top:32pt;font-size:14pt;line-height:22pt;font-family:"Times New Roman","仿宋_GB2312","FangSong_GB2312","仿宋","FangSong",serif;}'
    + '.' + c + '-fline{border:none;border-top:1pt solid #000;margin:0;}'
    + '.' + c + '-fline.thin{border-top:0.7pt solid #000;}'
    + '.' + c + '-frow{display:flex;justify-content:space-between;padding:2pt 1em;}'
    + '@media print{.' + c + '-paper{width:auto;padding:0;margin:0;}}'
    + '@page{size:A4;margin:37mm 26mm 35mm 28mm;}';
}

/* 版头：红头 + 红线 + 期号/字号 + 标题（+ 可选主送机关） */
function paperHead(cls, cfg) {
  const c = String(cls || 'gov');
  cfg = cfg || {};
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<div class="' + c + '-paper">'
    + '<div class="' + c + '-redhead">' + esc(cfg.org || '海外利益保护情报预警平台') + '</div>'
    + '<div class="' + c + '-redline"></div>'
    + (cfg.qihao ? '<div class="' + c + '-qihao">' + esc(cfg.qihao) + '</div>' : '')
    + (cfg.datebar ? '<div class="' + c + '-datebar">' + esc(cfg.datebar) + '</div>' : '')
    + '<div class="' + c + '-title">' + esc(cfg.title || '') + '</div>'
    + (cfg.recipient ? '<p class="' + c + '-p" style="text-indent:0">' + esc(cfg.recipient) + '：</p>' : '');
}

/* 版尾：署名 + 成文日期（右空）+ 版记（抄送 / 印发机关和日期） */
function paperTail(cls, cfg) {
  const c = String(cls || 'gov');
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const date = cfg.date || '';
  return '<div class="' + c + '-sign"><div class="' + c + '-org">' + esc(cfg.issuer || cfg.org || '海外利益保护情报预警平台') + '</div>'
    + '<div class="' + c + '-date">' + esc(date) + '</div></div>'
    + '<div class="' + c + '-footer"><div class="' + c + '-fline"></div>'
    + '<div class="' + c + '-frow"><span>抄送：' + esc(cfg.cc || '中心领导，相关业务部门。') + '</span></div>'
    + '<div class="' + c + '-fline thin"></div>'
    + '<div class="' + c + '-frow"><span>' + esc(cfg.printer || (cfg.issuer || cfg.org || '') + '办公室') + '</span><span>' + esc(date) + '印发</span></div>'
    + '<div class="' + c + '-fline"></div></div>'
    + '</div>'; /* .c-paper 收口 */
}

/* ============================================================
 * 三、完稿质检（手册第八章清单的可机检子集；交付前逐项过闸）
 * ============================================================ */
function qcCheck(text) {
  const t = String(text || '');
  const issues = [];
  if (!t.trim()) { issues.push('空文本'); return issues; }
  /* Markdown 残留 */
  if (/(\*\*|(^|\n)#{1,6}\s|`{1,3}|\|.*\|)/.test(t)) issues.push('Markdown 语法残留（星号/井号/反引号/竖线表格）');
  /* 中文语境半角标点 */
  if (/[\u4e00-\u9fff],\s?[\u4e00-\u9fff]/.test(t)) issues.push('中文语境半角逗号残留');
  if (/[\u4e00-\u9fff]\.\s?[\u4e00-\u9fff]/.test(t)) issues.push('中文语境半角句号残留');
  /* 模糊表述（手册四.1 去模糊化） */
  const vague = t.match(/普遍认为|约数十|成效显著|取得显著成效|高度重视/g);
  if (vague) issues.push('模糊表述：' + Array.from(new Set(vague)).join('、'));
  /* 口号式说教（手册五.4 文风铁律） */
  if (/(务必|坚决)贯彻|(必须|坚决)落实|(必须|坚决)执行/.test(t)) issues.push('口号式说教用语（务必/坚决/必须贯彻类）');
  /* 西式时间残留（智库报告历史病灶） */
  if (/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)/i.test(t) || /(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+20\d{2}/i.test(t)) issues.push('西式时间表达残留');
  /* 省略号残留 */
  if (/……{2,}|\.{6,}|。{3,}/.test(t)) issues.push('省略号/句号堆叠残留');
  return issues;
}

/* 生成后质检告警（统一挂点：LLM 文本落库/回包前调用，问题只告警不阻断） */
function qcLog(tag, text) {
  const issues = qcCheck(text);
  if (issues.length) console.warn('[REPORT-QC] ' + tag + ' 质检告警：' + issues.join('；'));
  return issues;
}

/* ============================================================
 * 四、公文版字数硬指标（2026-09-06 用户指令，马上试用前的标准化+深度化）
 * ------------------------------------------------------------
 * 每日简报 3999～45555 字；月报 2 万字；季报 4 万字。
 * min/max 为公文版正文总字数（去标签去空白口径，govCharCount）；
 * judgeMin/judgeMax 为 LLM「综合研判与对策建议」字数（研判深度化随周期放大）；
 * perSec 为公文版每节条目展示数基线；digest 为是否附事件摘要（真实采集内容，扩容主杠杆）。
 * 铁律：字数缺口只能用真实条目/真实摘要扩，数据不足时如实成文并告警，禁止注水虚构。
 * ============================================================ */
const WORD_TARGETS = {
  daily:      { min: 3999,  max: 45555, judgeMin: 600,  judgeMax: 900,  perSec: 6,  digest: false },
  weekly:     { min: 4500,  max: 45555, judgeMin: 1000, judgeMax: 1500, perSec: 8,  digest: false },
  monthly:    { min: 20000, max: 45555, judgeMin: 2500, judgeMax: 3500, perSec: 12, digest: true },
  quarterly:  { min: 40000, max: 45555, judgeMin: 4000, judgeMax: 6000, perSec: 16, digest: true },
  semiannual: { min: 45000, max: 60000, judgeMin: 5000, judgeMax: 7000, perSec: 20, digest: true },
  yearly:     { min: 45000, max: 60000, judgeMin: 5000, judgeMax: 7000, perSec: 24, digest: true }
};
/* 公文版正文字数（去 style/标签/空白口径——与试用验收口径一致） */
function govCharCount(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .length;
}
/* 字数达标校验：返回告警文案（达标返回空串） */
function wordCountIssue(freq, chars) {
  const t = WORD_TARGETS[freq];
  if (!t) return '';
  if (chars < t.min) return '公文版字数 ' + chars + ' 低于' + freq + '硬指标下限 ' + t.min + '（真实数据量所限，已如实成文）';
  if (chars > t.max) return '公文版字数 ' + chars + ' 超出' + freq + '硬指标上限 ' + t.max;
  return '';
}

module.exports = { MANUAL_SPEC, GOV_STYLE_SPEC, REC_SPEC, SYSTEM_PROMPT, paperCss, paperHead, paperTail, qcCheck, qcLog, WORD_TARGETS, govCharCount, wordCountIssue };
