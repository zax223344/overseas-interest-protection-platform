const fs = require('fs');
const s = fs.readFileSync('new_orgs_fixed.jsonl', 'utf8');
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
      } catch (e) {
        console.warn('parse failed:', e.message);
      }
    }
    depth--;
  }
}
console.log('parsed', objs.length);
objs.forEach(o => console.log(o.id, o.name));
fs.writeFileSync('temp_orgs_parsed.json', JSON.stringify(objs, null, 2));
