const fs = require('fs');
const s = fs.readFileSync('new_orgs_fixed.jsonl', 'utf8');
let depth = 0, start = -1, inStr = false, strCh = '';
let found = false;
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
      fs.writeFileSync('bla_extracted.js', objStr);
      console.log('saved BLA extract, length', objStr.length);
      found = true;
      break;
    }
    depth--;
  }
}
if (!found) console.log('not found');
