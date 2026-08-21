const fs = require('fs');
const s = fs.readFileSync('new_orgs_fixed.jsonl', 'utf8');
let depth = 0, inStr = false, strCh = '';
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === strCh) inStr = false;
    continue;
  }
  if (c === "'" || c === '"') { inStr = true; strCh = c; continue; }
  if (c === '{') {
    depth++;
    if (depth === 1) console.log('start', i);
  } else if (c === '}') {
    if (depth === 1) console.log('end', i);
    depth--;
  }
}
