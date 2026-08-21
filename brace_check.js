const fs=require('fs');
const files=['app.js','server/scrapers.js','datasources.js','server/server.js','test_chain.js'];
for(const f of files){
  const s=fs.readFileSync(f,'utf8');
  const c=ch=>{let n=0;for(let i=0;i<s.length;i++)if(s[i]===ch)n++;return n;};
  const b=c('{'),B=c('}'),p=c('('),P=c(')'),k=c('['),K=c(']');
  console.log(f.padEnd(20)+' {:'+b+' }:'+B+(b===B?' OK':' MISMATCH')+
    '  (:'+p+' ):'+P+(p===P?' OK':' MISMATCH')+
    '  [: '+k+' ]: '+K+(k===K?' OK':' MISMATCH'));
}
