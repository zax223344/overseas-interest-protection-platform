const social=require('./social');
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async()=>{
  for(const ch of social.TELEGRAM_CHANNELS){
    const url='https://tg.i-c-a.su/json/'+ch.user+'?limit=5';
    let note='';
    try{
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json'},signal:AbortSignal.timeout(15000)});
      const t=await r.text();
      let j=null; try{j=JSON.parse(t);}catch(e){}
      if(!j){note='非JSON len='+t.length+' head='+t.slice(0,60).replace(/\s+/g,' ');}
      else if(j.errors){note='ERR '+JSON.stringify(j.errors).slice(0,70);}
      else{
        const ms=(j.messages||[]);
        const real=ms.filter(m=>String(m.message||'').replace(/<[^>]+>/g,'').trim().length>25);
        note='msgs='+ms.length+' 有效='+real.length;
        if(real[0])note+=' | '+String(real[0].message).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').slice(0,70);
      }
    }catch(e){note='NET '+String(e.message||e).slice(0,40);}
    console.log((ch.user+'                    ').slice(0,20),note);
    await sleep(1500);
  }
})();
