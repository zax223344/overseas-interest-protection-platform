const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const H={'User-Agent':UA,'Accept':'text/html,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'};
function uniq(a){const s={},o=[];a.forEach(x=>{if(!s[x]){s[x]=1;o.push(x);}});return o;}
async function get(u,re){
  const r=await fetch(u,{headers:H,redirect:'follow',signal:AbortSignal.timeout(15000)});
  const t=await r.text(); let m,ls=[]; re.lastIndex=0;
  while((m=re.exec(t))!==null) ls.push(m[1]);
  return uniq(ls);
}
(async()=>{
  const cases=[
    ['apnews', q=>'https://apnews.com/search?q='+encodeURIComponent(q), /href="(https:\/\/apnews\.com\/article\/[^"]+)"/g],
    ['premiumtimes_ng', q=>'https://www.premiumtimesng.com/?s='+encodeURIComponent(q), /href="(https:\/\/www\.premiumtimesng\.com\/[a-z-]+\/\d+[^"]*)"/g],
    ['rt', q=>'https://www.rt.com/search?q='+encodeURIComponent(q), /href="(\/[a-z-]+\/\d{6,}[^"]*)"/g]
  ];
  for(const [id,mk,re] of cases){
    try{
      const a=await get(mk('Chinese mine'),re);
      await new Promise(r=>setTimeout(r,800));
      const b=await get(mk('vaccine measles'),re);
      const inter=a.filter(x=>b.indexOf(x)>=0).length;
      console.log('=== '+id+' A(Chinese mine)='+a.length+' B(vaccine measles)='+b.length+' 交集='+inter+(inter===0&&a.length?'  → 真实检索(结果随关键词变化)':'  → 疑似非检索结果'));
      a.slice(0,5).forEach(x=>console.log('    A · '+x.slice(0,100)));
      b.slice(0,3).forEach(x=>console.log('    B · '+x.slice(0,100)));
    }catch(e){ console.log('=== '+id+' 失败 '+e.message); }
  }
})();
