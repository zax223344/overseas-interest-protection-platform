const fs = require('fs');
const s = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs_fixed.jsonl','utf8');
let depth=0, inStr=false, esc=false;
for(let i=0;i<s.length;i++){
  const c=s[i];
  if(esc){esc=false; continue;}
  if(c==='\\'){esc=true; continue;}
  if(c==='"'){inStr=!inStr; continue;}
  if(inStr) continue;
  const old=depth;
  if(c==='{') depth++;
  else if(c==='}') depth--;
  if(old!==depth && i<2600) console.log(i, 'depth', old, '->', depth, 'char', c, 'context', s.slice(Math.max(0,i-30), i+30));
}
