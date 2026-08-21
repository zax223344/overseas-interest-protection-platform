const fs = require('fs');
const lines = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs.jsonl','utf8').split(/\r?\n/).filter(l=>l.trim() && !l.includes('<!--END-->'));
for (let i=0;i<lines.length;i++){
  try{JSON.parse(lines[i]); console.log('line',i+1,'OK');}
  catch(e){
    console.error('line',i+1,'FAIL',e.message);
    const p = e.message.match(/position (\d+)/);
    const pos = p ? parseInt(p[1]) : 0;
    console.error('around:', lines[i].slice(Math.max(0,pos-50), pos+50));
  }
}
