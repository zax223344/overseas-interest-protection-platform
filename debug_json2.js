const fs = require('fs');
const line = fs.readFileSync('C:/Users/28737/Desktop/新建文件夹/new_orgs.jsonl','utf8').split(/\r?\n/)[0];
console.log('line length:', line.length);
for(let i=935;i<955;i++){
  console.log(i, JSON.stringify(line[i]));
}
try{JSON.parse(line);}catch(e){console.error(e.message);}
