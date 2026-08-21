const fs = require('fs');
const c = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/threats.js', 'utf8');
const m = 'const THREAT_DATA={organizations:[';
const s = c.indexOf(m);
if (s === -1) { console.error('start marker not found'); process.exit(1); }
const arrayStart = s + m.length - 1;
let bracketCount = 0, inString = false, escape = false, arrayEnd = -1;
for (let i = arrayStart; i < c.length; i++) {
  const ch = c[i];
  if (escape) { escape = false; continue; }
  if (ch === '\\') { escape = true; continue; }
  if (ch === '"') inString = !inString;
  if (!inString) {
    if (ch === '[') bracketCount++;
    else if (ch === ']') { bracketCount--; if (bracketCount === 0) { arrayEnd = i; break; } }
  }
}
if (arrayEnd === -1) { console.error('end not found'); process.exit(1); }
const arr = c.substring(arrayStart + 1, arrayEnd);
try {
  JSON.parse('[' + arr + ']');
  console.log('parse OK, end at', arrayEnd);
} catch (e) {
  console.error('parse error:', e.message);
  console.error('around:', arr.slice(e.message.includes('position') ? 0 : 0, 200));
  process.exit(1);
}
