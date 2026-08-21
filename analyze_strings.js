const fs = require('fs');
const s = fs.readFileSync('new_orgs_fixed.jsonl', 'utf8');
let inStr = false, strCh = '', line = 1, col = 0;
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  col++;
  if (c === '\n') { line++; col = 0; continue; }
  if (inStr) {
    if (c === '\\') { i++; col++; continue; }
    if (c === strCh) { inStr = false; continue; }
    continue;
  }
  if (c === "'" || c === '"') {
    inStr = true;
    strCh = c;
    console.log('string start at line', line, 'col', col, 'char', JSON.stringify(c));
    continue;
  }
}
