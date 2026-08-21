const fs = require('fs');
const s = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs_fixed.jsonl','utf8');
function splitObjects(str){
  const out=[]; let i=0, depth=0, start=null, inStr=false, esc=false;
  for(;i<str.length;i++){
    const c=str[i];
    if(esc){esc=false; continue;}
    if(c==='\\'){esc=true; continue;}
    if(c==='"'){inStr=!inStr; continue;}
    if(inStr) continue;
    if(c==='{'){if(depth===0) start=i; depth++;}
    else if(c==='}'){depth--; if(depth===0 && start!==null){out.push(str.slice(start,i+1)); start=null;}}
  }
  return out;
}
const parts=splitObjects(s);
console.log('parts', parts.length, 'lengths', parts.map(p=>p.length));
for(let k=0;k<parts.length;k++){
  console.log('part', k, 'start chars:', parts[k].slice(0,60));
  console.log('part', k, 'end chars:', parts[k].slice(-60));
}
