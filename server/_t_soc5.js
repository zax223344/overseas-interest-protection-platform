const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function probe(name,url,pick){
  try{
    const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json,text/html'},redirect:'follow',signal:AbortSignal.timeout(15000)});
    const t=await r.text();
    console.log((name+'                        ').slice(0,25),'HTTP'+r.status,'len='+t.length,pick?pick(t):'');
  }catch(e){console.log((name+'                        ').slice(0,25),'NET '+String(e.message||e).slice(0,45));}
}
(async()=>{
  await probe('Lemmy(lemmy.world)','https://lemmy.world/api/v3/search?q=China%20workers&type_=Posts&limit=5',t=>{try{const j=JSON.parse(t);return 'posts='+((j.posts||[]).length)+(j.posts&&j.posts[0]?' | '+j.posts[0].post.name.slice(0,50):'');}catch(e){return t.slice(0,60).replace(/\s+/g,' ');}});
  await probe('Lemmy(sh.itjust.works)','https://sh.itjust.works/api/v3/search?q=China&type_=Posts&limit=5',t=>t.slice(0,60).replace(/\s+/g,' '));
  await probe('4chan API','https://a.4cdn.org/news/catalog.json',t=>t.slice(0,60).replace(/\s+/g,' '));
  await probe('Nitter(nitter.net)','https://nitter.net/search?f=tweets&q=Chinese+workers',t=>t.slice(0,60).replace(/\s+/g,' '));
  await probe('Substack search','https://substack.com/api/v1/post/search?query=Chinese%20workers&limit=5',t=>t.slice(0,60).replace(/\s+/g,' '));
  await probe('StackExch(n/a)','https://api.stackexchange.com/2.3/info?site=stackoverflow',t=>t.slice(0,40));
  console.log('--- 补测 Telegram 镜像频道 ---');
  for(const u of ['rybar','SolovievLive','nexta_live','readovkanews','bbcrussian','GeopoliticsLive','MiddleEastEye','Reuters','ukr_leaks_eng','geopolitics_prime','IntelSlava_eng','WarMonitor3','sentdefenderr','intelslava']){
    try{
      const r=await fetch('https://tg.i-c-a.su/json/'+u+'?limit=3',{headers:{'User-Agent':UA},signal:AbortSignal.timeout(12000)});
      const t=await r.text(); let j=null;try{j=JSON.parse(t);}catch(e){}
      console.log(' ',(u+'                  ').slice(0,19), j&&j.errors?'ERR':(j&&j.messages?('OK msgs='+j.messages.length):'?'));
    }catch(e){console.log(' ',(u+'                  ').slice(0,19),'NET');}
    await sleep(1200);
  }
})();
