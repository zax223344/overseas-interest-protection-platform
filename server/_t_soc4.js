const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
const CAND=['sentdefender','clashreport','insiderpaper','WarMonitors','bbcbreaking','AJENews','globaltimesnews'];
(async()=>{
  for(const u of CAND){
    let note='';
    try{
      const r=await fetch('https://t.me/s/'+u,{headers:{'User-Agent':UA,'Accept':'text/html'},redirect:'follow',signal:AbortSignal.timeout(15000)});
      const t=await r.text();
      const m=t.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g)||[];
      note='HTTP'+r.status+' len='+t.length+' 消息块='+m.length;
      if(m[m.length-1])note+=' | '+m[m.length-1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').slice(0,70);
    }catch(e){note='NET '+String(e.message||e).slice(0,40);}
    console.log((u+'                  ').slice(0,19),note);
    await sleep(800);
  }
})();
