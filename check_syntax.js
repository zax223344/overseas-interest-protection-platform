const cp=require('child_process'),fs=require('fs');
const NODE='C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const files=['server/scrapers.js','datasources.js','app.js','test_chain.js','server/server.js'];
let out='';
for(const f of files){
  try{ cp.execSync(NODE+' --check "'+f+'"',{stdio:'pipe'}); out+=f+': OK\n'; }
  catch(e){ const sd=e.stderr?e.stderr.toString():(e.stdout?e.stdout.toString():e.message); out+=f+': ERR '+(sd||'').split('\n').slice(0,2).join(' | ')+'\n'; }
}
fs.writeFileSync('_err.txt',out);
console.log('DONE');
