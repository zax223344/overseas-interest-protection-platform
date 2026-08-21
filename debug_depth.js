const fs = require('fs');
const s = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs_fixed.jsonl','utf8');
let depth=0, inStr=false, esc=false;
for(let i=0;i<3000;i++){
  const c=s[i];
  if(esc){esc=false; continue;}
  if(c==='\\'){esc=true; continue;}
  if(c==='"'){inStr=!inStr; continue;}
  if(inStr) continue;
  if(c==='{') depth++;
  else if(c==='}') depth--;
  if((i>=2380 && i<=2420) || (i%200===0)) console.log(i, JSON.stringify(c), 'depth', depth, 'inStr', inStr);
}
