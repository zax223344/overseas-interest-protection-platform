import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ENTITY = require('../entities.js');
const fs = require('node:fs');

const cache = JSON.parse(fs.readFileSync('./.cache/osint_intel.json', 'utf8'));
console.log('=== 存量缓存体裁判定 ===');
let blocked = 0;
cache.forEach(x => {
  const c = ENTITY.isCommentaryPiece(x);
  if (c) { blocked++; console.log('  [拦截] ' + String(x.title || '').slice(0, 44)); }
});
console.log('拦截 ' + blocked + ' / ' + cache.length + ' 条\n');

console.log('=== 误杀回归测试（真情报必须放行）===');
const mustPass = [
  { title: '中国工程师在巴基斯坦达苏水坝遇袭，多人伤亡', content: '一辆汽车冲撞中国工程师车队' },
  { title: '我们该不该讨论中企在缅甸撤离的时机？', content: '中资企业紧急撤离员工' },
  { title: '[Opinion] Why China must evacuate nationals from Sudan', content: 'evacuation of Chinese nationals amid clashes' },
  { title: '美国制裁14家中国科技企业', content: '商务部将其列入实体清单' },
  { title: '中资金矿工人遭绑架', content: '武装分子劫持矿场' }
];
mustPass.forEach(x => {
  const c = ENTITY.isCommentaryPiece(x);
  console.log('  ' + (c ? '❌误杀' : '✅放行') + '  ' + x.title.slice(0, 40));
});

console.log('\n=== 应拦截样本 ===');
const mustBlock = [
  { title: '中国社会主义道路上的坎坷我们该不该讨论？', title_en: 'Should We Discuss the Potholes on China’s Road to Socialism?', content: '中国革命是对欧洲、日本和美国的帝国主义和殖民主义事业的一次重大挫折，人们可以钦佩中国革命。社会主义道路上人民民主国家的探索。' },
  { title: '《中国工人阶级的形成（1840-1989）》', title_en: 'Notes on the Formation of the Chinese Working Class, 1840–1989', content: '工人阶级 无产阶级 革命 资本主义' },
  { title: '丝绸之路制造业：全球化的另一条道路', title_en: 'Silk Road Manufacturing: An Alternative Path to Globalisation', content: '全球化的路径讨论' },
  { title: '人为的愤怒：中国民族团结法的真相', title_en: 'Manufactured Outrage: The Truth About China’s Ethnic Unity Law', content: '关于该法律的意识形态争论 社会主义 革命' }
];
mustBlock.forEach(x => {
  const c = ENTITY.isCommentaryPiece(x);
  console.log('  ' + (c ? '✅拦截' : '❌漏放') + '  ' + x.title.slice(0, 40));
});
