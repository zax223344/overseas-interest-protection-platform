(async()=>{
 try{
  const r=await fetch('https://edge.microsoft.com/translate/auth',{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'},signal:AbortSignal.timeout(8000)});
  console.log('edge auth HTTP', r.status);
  const t=await r.text(); console.log('token len:', t.trim().length);
  if(r.ok && t.trim().length>50){
    const tr=await fetch('https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans',{method:'POST',headers:{'Authorization':'Bearer '+t.trim(),'Content-Type':'application/json'},body:JSON.stringify([{Text:'UN warns of famine risk'}]),signal:AbortSignal.timeout(10000)});
    console.log('translate HTTP', tr.status);
    console.log((await tr.text()).slice(0,300));
  }
 }catch(e){ console.log('ERR:', e.message, e.cause? String(e.cause):''); }
 // MyMemory 连发5次看配额行为
 for(let i=0;i<3;i++){
  try{
   const r2=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent('Armed attack near Chinese embassy test '+i)+'&langpair=en|zh-CN',{signal:AbortSignal.timeout(9000)});
   const j=await r2.json();
   console.log('mymemory#'+i,'HTTP'+r2.status,'respStatus='+j.responseStatus,'text=',String(j.responseData&&j.responseData.translatedText).slice(0,80));
  }catch(e){ console.log('mymemory#'+i,'ERR',e.message); }
 }
})();
