const fs = require('fs');
const s = fs.readFileSync('new_orgs_fixed.jsonl', 'utf8');
// 手动按 top-level }]}} 边界拆分（文件包含 BLA 和 ETIM 两个对象）
const end1 = s.indexOf('}]}') + 3; // BLA 对象在 statements 后结束
const end2 = s.indexOf('}]}', end1) + 3; // 但 BLA events 也有 }]}，所以这不是可靠方法

// 更可靠：找到每个顶层对象的结束位置（statements 字段后的 }）
const objs = [];
let depth = 0, start = -1, inStr = false, strCh = '';
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === strCh) inStr = false;
    continue;
  }
  if (c === "'" || c === '"') { inStr = true; strCh = c; continue; }
  if (c === '{') {
    if (depth === 0) start = i;
    depth++;
  } else if (c === '}') {
    if (depth === 1) {
      const objStr = s.slice(start, i + 1);
      try {
        objs.push(new Function('return ' + objStr)());
        console.log('parsed object ending at', i);
      } catch (e) {
        console.warn('parse failed at', i, ':', e.message.slice(0, 80));
      }
    }
    depth--;
  }
}
console.log('total parsed', objs.length);
fs.writeFileSync('temp_orgs_parsed.json', JSON.stringify(objs, null, 2));
