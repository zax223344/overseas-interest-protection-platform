const fs = require('fs');
const src = fs.readFileSync('server/server.js', 'utf8');
const start = src.indexOf('const _TITLE_CORE_PLACES');
const end = src.indexOf('function _isTitleQualityOk', start);
const block = src.substring(start, end).trimEnd();
console.log('start:', block.substring(0, 200));
console.log('---');
try { eval(block); console.log('eval ok, _TITLE_CORE_PLACES defined:', typeof _TITLE_CORE_PLACES); }
catch (e) { console.log('eval error:', e.message); }
