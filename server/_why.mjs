import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const a = JSON.parse(fs.readFileSync('./.cache/osint_intel.json', 'utf8'));
const SEC = new RegExp([
  '袭击|遇袭|爆炸|枪击|绑架|劫持|扣押|人质|遇害|死亡|伤亡|受伤|失踪',
  '撤侨|撤离|疏散|封锁|宵禁|骚乱|暴乱|示威冲突|武装冲突|交火|空袭|导弹',
  '制裁|罚款|起诉|查封|冻结资产|拘留|逮捕|驱逐|吊销|禁令|反倾销|关税',
  '停工|停产|罢工|违约|毁约|征收|国有化|撤资|断供|断电|港口关闭',
  '海盗|走私|诈骗|勒索|网络攻击|数据泄露|间谍|渗透',
  'attack|bomb|shoot|kidnap|hostage|casualt|evacuat|sanction|arrest|detain|seiz|strike|riot|clash'
].join('|'), 'i');
['工人阶级', '丝绸之路制造业'].forEach(k => {
  const x = a.find(i => String(i.title || '').includes(k));
  if (!x) return console.log(k + ' 未找到');
  const head = String(x.title_en || '') + ' ' + String(x.title || '');
  const body = String(x.content || '').slice(0, 400);
  console.log('=== ' + k + ' ===');
  console.log('title_en 全文:', JSON.stringify(String(x.title_en || '')));
  console.log('head 命中安全词:', JSON.stringify(head.match(SEC)));
  console.log('body 命中安全词:', JSON.stringify(body.match(SEC)));
  console.log('body 片段:', body.slice(0, 150).replace(/\s+/g, ' '));
  console.log('');
});
