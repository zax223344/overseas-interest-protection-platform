const fs = require('fs');
const p = 'C:/Users/28737/Desktop/新建文件夹/app.js';
let s = fs.readFileSync(p, 'utf8');

const fn = 'function showAlertDetail(id){';
const i = s.indexOf(fn);
if (i < 0) { console.error('showAlertDetail not found'); process.exit(1); }
const marker = "document.getElementById('modal').classList.add('show');";
const j = s.indexOf(marker, i);
if (j < 0) { console.error('show call not found'); process.exit(1); }
const ins = "  if(typeof INTELBUS!=='undefined') INTELBUS._enrichModal(a.country,a.enterprise);\n  ";
s = s.slice(0, j) + ins + s.slice(j);
fs.writeFileSync(p, s, 'utf8');
console.log('patched showAlertDetail at', j);
