const fs = require('fs');
const s = fs.readFileSync('new_orgs_fixed.jsonl', 'utf8');
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
      console.log('Extracted object length:', objStr.length);
      console.log('Last 200 chars:', objStr.slice(-200));
      try {
        const obj = new Function('return ' + objStr)();
        console.log('Parsed:', obj.id, obj.name);
      } catch (e) {
        console.warn('Parse failed:', e.message);
        // Find position of error
        try { JSON.parse(objStr); } catch(je) {}
      }
      break;
    }
    depth--;
  }
}
