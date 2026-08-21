/* 体裁闸门验证：商业榜单/经济统计（ranking-list）+ 评论/论述（commentary-piece）
 * 重点回归「hardLink 绕过风险分」漏洞——榜单文必然罗列中资巨头（中国石油/国家电网），
 * 命中企业主体后 hardLink=true 会一路绿灯入库。体裁噪声必须压过 hardLink。
 * 运行：node server/_genre_test.mjs（从项目根目录）*/
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ENTITY = require('../entities.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- 一、用户实际反馈的两条脏数据，必须拦截 ---------- */
const BLOCK = [
  {
    tag: '用户样本①·2025中国企业500强',
    item: {
      title: '中国企业联合会、中国企业家协会发布"2025中国企业500强"榜单',
      content: '9月15日，中国企业联合会、中国企业家协会发布"2025中国企业500强"榜单。这是中国企业联合会连续第24次向社会发布该榜单。据悉，这份榜单以2024年企业营业收入为入围标准，入围门槛较上年提高5.79亿元，达到479.6亿元。',
      source: '新华网'
    }
  },
  {
    tag: '用户样本②·《财富》世界500强',
    item: {
      title: '今年《财富》世界500强排行榜企业的营业收入总和约为41.7万亿美元',
      content: '今年《财富》世界500强排行榜企业的营业收入总和约为41.7万亿美元，超过全球GDP的三分之一，比去年增长了约1.8%。此次上榜门槛（最低销售收入）从321亿美元增长至322亿美元。所有上榜公司的净利润总和同比增长约0.4%，约为2.98万亿美元。沃尔玛连续第十二年成为全球最大公司，亚马逊保持第二。中国的国家电网公司继续位列第三。排在第四和第五位的分别是沙特阿美和中国石油。',
      source: '财富中文网'
    }
  },
  {
    tag: '同类·胡润全球富豪榜',
    item: { title: '2025胡润全球富豪榜发布 中国上榜企业家人数位列第二', content: '榜单显示，上榜门槛为10亿美元，中国上榜人数排名第二。', source: '胡润研究院' }
  },
  {
    tag: '同类·Fortune Global 500（英文）',
    item: { title: 'Fortune Global 500: State Grid of China ranks third with combined revenue growth', content: 'The combined revenue of the Fortune Global 500 companies reached 41.7 trillion dollars this year.', source: 'Fortune' }
  },
  {
    tag: '同类·Forbes Global 2000',
    item: { title: 'Forbes Global 2000 rankings show PetroChina climbing', content: 'The threshold for the list rose again this year, with the largest companies posting record total revenue.', source: 'Forbes' }
  },
  {
    tag: '存量·评论/论述（回归上一轮闸门）',
    item: { title: '中国社会主义道路上的坎坷我们该不该讨论？', content: '本文试论中国道路的另一条路径。', source: 'Lemmy c/Pravda News' }
  }
];

/* ---------- 二、真情报，绝不能被榜单闸门误杀 ---------- */
const KEEP = [
  {
    tag: '真情报·中资项目遇袭',
    item: { title: '巴基斯坦俾路支省中国石油工程车队遇袭 造成人员伤亡', content: '当地时间凌晨，一支中国石油相关工程车队在俾路支省遭武装分子袭击，中方人员受伤，中国驻巴使馆已启动应急机制。', country: '巴基斯坦', source: '路透社' }
  },
  {
    tag: '真情报·撤侨',
    item: { title: '中国驻苏丹使馆组织在苏中国公民撤离', content: '受武装冲突影响，中国驻苏丹使馆紧急组织中资企业员工和华侨撤离至港口城市。', country: '苏丹', source: '外交部' }
  },
  {
    tag: '真情报·制裁（含"位列"式措辞但有实质安全事件）',
    item: { title: '美国将多家中国企业列入实体清单 涉海外项目融资受阻', content: '美国商务部宣布对多家中资企业实施出口管制与制裁，相关海外基建项目融资受阻。', country: '美国', source: '美国商务部' }
  },
  {
    tag: '真情报·中企海外资产被强制征收',
    item: { title: '某国宣布对中资矿业项目实施国有化 中方投资面临重大损失', content: '该国政府宣布强制征收中资持股的铜矿项目，中国企业约数十亿美元投资面临损失。', country: '刚果（金）', source: '彭博社' }
  },
  {
    tag: '真情报·中国远洋船舶遭海盗劫持',
    item: { title: '中国远洋货轮在几内亚湾遭海盗劫持 船员被绑架', content: '一艘中国籍货轮在几内亚湾海域遭海盗登船劫持，多名船员被绑架。', country: '尼日利亚', source: 'IMB' }
  }
];

console.log('\n=== 一、应拦截（商业榜单/经济统计 + 评论论述） ===');
BLOCK.forEach(function (c) {
  const it = Object.assign({}, c.item);
  const genre = ENTITY.nonIntelGenre(it);
  ENTITY.enrich(it);
  check(c.tag + ' → nonIntelGenre 命中', !!genre, 'genre=' + JSON.stringify(genre));
  check(c.tag + ' → enrich 后 interestLinked=false', it.interestLinked === false,
    'interestLinked=' + it.interestLinked + ' hard/soft 已被体裁压过?');
  check(c.tag + ' → filterReason 已标注', !!it.filterReason, 'filterReason=' + it.filterReason);
});

console.log('\n=== 二、不得误杀（真实海外利益安全情报） ===');
KEEP.forEach(function (c) {
  const it = Object.assign({}, c.item);
  const genre = ENTITY.nonIntelGenre(it);
  ENTITY.enrich(it);
  check(c.tag + ' → 未被体裁闸门拦下', !genre, 'genre=' + JSON.stringify(genre));
  check(c.tag + ' → interestLinked 保持 true', it.interestLinked === true,
    'interestLinked=' + it.interestLinked + ' reason=' + (it.filterReason || '-'));
});

console.log('\n=== 三、导出面校验 ===');
check('ENTITY.isRankingPiece 已导出', typeof ENTITY.isRankingPiece === 'function');
check('ENTITY.nonIntelGenre 已导出', typeof ENTITY.nonIntelGenre === 'function');
check('ENTITY.isCommentaryPiece 仍在', typeof ENTITY.isCommentaryPiece === 'function');
check('ranking 判定返回值为 ranking-list',
  ENTITY.nonIntelGenre({ title: '2025中国企业500强榜单发布 入围门槛提高', content: '入围门槛达到479.6亿元。' }) === 'ranking-list');

console.log('\n---------------------------------------------');
console.log(fail === 0 ? `全部通过 ${pass}/${pass}` : `通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
