const fs=require('fs');
const p='C:\\Users\\28737\\Desktop\\新建文件夹\\app.js';
let s=fs.readFileSync(p,'utf8');
const bad='norm=norm.replace(/[s\\p{P}]/g,\'\')';
const good='norm=norm.replace(/[\\s\\p{P}]/gu,\'\')';
if(s.indexOf(bad)<0){console.log('bad pattern not found');process.exit(1);}
s=s.split(bad).join(good);
fs.writeFileSync(p,s);
console.log('fixed regex');
