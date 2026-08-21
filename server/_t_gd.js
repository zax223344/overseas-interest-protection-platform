const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const QS = [
  '"Chinese workers" attack',
  '("Chinese company" OR "Chinese firm") (protest OR suspended)',
  '("Chinese workers" OR "Chinese nationals") (attack OR kidnapped OR killed)',
];
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function one(q, tag) {
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) +
    '&mode=artlist&maxrecords=20&format=json&sort=datedesc&timespan=7d';
  for (let i=0;i<3;i++){
    try {
      const r = await fetch(url, { headers:{'User-Agent':UA,'Accept':'application/json'}, signal: AbortSignal.timeout(30000) });
      const txt = await r.text();
      if (r.status === 429) { console.log(tag+' 尝试'+(i+1)+' 429限速，等待12s'); await sleep(12000); continue; }
      let j=null; try{ j=JSON.parse(txt); }catch(e){
        console.log(tag+' 非JSON['+r.status+']: '+txt.slice(0,160).replace(/\s+/g,' ')); return; }
      const arts = j.articles||[];
      console.log(tag+' [OK] 条数='+arts.length+' | '+q);
      arts.slice(0,3).forEach(a=>console.log('      · '+(a.title||'').slice(0,80)+'  <'+a.domain+'>'));
      return;
    } catch(e){ console.log(tag+' 尝试'+(i+1)+' 网络异常: '+e.message+(e.cause?(' / '+e.cause.code||''):'')); await sleep(8000); }
  }
  console.log(tag+' 三次均失败');
}
(async ()=>{
  for (let i=0;i<QS.length;i++){ await one(QS[i], 'Q'+(i+1)); await sleep(9000); }
})();
