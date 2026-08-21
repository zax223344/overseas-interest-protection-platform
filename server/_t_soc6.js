const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  const r=await fetch('https://lemmy.world/api/v3/search?q=Chinese%20workers&type_=Posts&sort=New&limit=5',{headers:{'User-Agent':UA},signal:AbortSignal.timeout(15000)});
  const j=await r.json();
  console.log('keys=',Object.keys(j));
  const p=(j.posts||[])[0];
  if(p){console.log('post keys=',Object.keys(p.post));console.log('community=',p.community&&p.community.name,'| creator=',p.creator&&p.creator.name);
    console.log('name=',p.post.name);console.log('body=',String(p.post.body||'(空)').slice(0,160).replace(/\s+/g,' '));
    console.log('url=',p.post.url);console.log('ap_id=',p.post.ap_id);console.log('published=',p.post.published);
    console.log('counts=',JSON.stringify(p.counts).slice(0,140));}
  console.log('--- 多实例可用性 ---');
  for(const h of ['lemmy.world','sh.itjust.works','lemm.ee','lemmy.ml','feddit.org','programming.dev','discuss.online','startrek.website']){
    try{const rr=await fetch('https://'+h+'/api/v3/search?q=China&type_=Posts&limit=3',{headers:{'User-Agent':UA},signal:AbortSignal.timeout(10000)});
      const tt=await rr.text();let jj=null;try{jj=JSON.parse(tt);}catch(e){}
      console.log(' ',(h+'                  ').slice(0,20),'HTTP'+rr.status,jj?('posts='+((jj.posts||[]).length)):('非JSON '+tt.slice(0,40)));
    }catch(e){console.log(' ',(h+'                  ').slice(0,20),'NET '+String(e.message||e).slice(0,30));}
    await sleep(500);
  }
})();
