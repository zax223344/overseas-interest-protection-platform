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
console.log('---part0 around 2200---');
console.log(parts[0].slice(2150,2400));
console.log('---part1 start---');
console.log(parts[1].slice(0,250));
