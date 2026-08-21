const fs = require('fs');
const file = 'globalmedia.js';
let src = fs.readFileSync(file, 'utf8');

const before = src.indexOf('const _CHINA_NEGATIVE_KW_RE = new RegExp');
const after = src.indexOf(');', before) + 2;
const oldDecl = src.substring(before, after);

// Show first 20 chars of the literal
const firstQuote = oldDecl.indexOf("'");
console.log('literal prefix chars:', JSON.stringify(oldDecl.substring(firstQuote, firstQuote + 12)));
console.log('char codes:', [...oldDecl.substring(firstQuote, firstQuote + 12)].map(c => c.charCodeAt(0)));

// Replace four-backslash-b patterns with two-backslash-b patterns.
// The file literally contains '\\\\b( and )\\\\b|' (each backslash is its own char).
// We want '\b( and )\b|'.
const newDecl = oldDecl
  .replaceAll("'\\\\\\\\b(", "'\\\\b(")
  .replaceAll(")\\\\\\\\b|'", ")\\\\b|'");

console.log('changed:', oldDecl !== newDecl);
console.log('new prefix:', JSON.stringify(newDecl.substring(firstQuote, firstQuote + 12)));

if (oldDecl !== newDecl) {
  src = src.substring(0, before) + newDecl + src.substring(after);
  fs.writeFileSync(file, src, 'utf8');
  console.log('fixed _CHINA_NEGATIVE_KW_RE word boundaries');
}
