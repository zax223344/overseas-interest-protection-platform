const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
const CAND=['sentdefender','Faytuks','faytuksnetwork','clashreport','visegrad24','NoelReports',
'worldonalert','Middle_East_Spectator','IntelRepublic','rt_com','RTnews','Global_Mil_ITA',
'AlertesInfos','africa_intel','SouthAsiaIndex','myanmar_now','MilitaryLand','warfareanalysis',
'ChinaObserver','thewarzone','ELINTNews','Osinttechnical'];
(async()=>{
  for(const u of CAND){
    let note='';
    try{
      const r=await fetch('https://tg.i-c-a.su/json/'+u+'?limit=5',{headers:{'User-Agent':UA,'Accept':'application/json'},signal:AbortSignal.timeout(15000)});
      const t=await r.text(); let j=null; try{j=JSON.parse(t);}catch(e){}
      if(!j)note='非JSON';
      else if(j.errors)note='ERR '+String(JSON.stringify(j.errors)).slice(0,50);
      else{const ms=j.messages||[];const real=ms.filter(m=>String(m.message||'').replace(/<[^>]+>/g,'').trim().length>25);
        note='OK msgs='+ms.length+' 有效='+real.length+(real[0]?' | '+String(real[0].message).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').slice(0,60):'');}
    }catch(e){note='NET '+String(e.message||e).slice(0,30);}
    console.log((u+'                      ').slice(0,23),note);
    await sleep(1400);
  }
})();
