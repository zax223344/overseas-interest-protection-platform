const fs = require('fs');
const s = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/server/server.js', 'utf8');
const block = s.match(/const _TITLE_CORE_PLACES =[\s\S]*?function _completeTitle\(it\) \{[\s\S]*?\n\}/)[0];
console.log(block.slice(-500));
