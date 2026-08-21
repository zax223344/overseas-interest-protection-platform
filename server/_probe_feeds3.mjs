// server/_probe_feeds3.mjs — 并发快速重探测
// 复用 _probe_feeds2.mjs 的候选清单（避免重复维护），12 路并发，每源 7s 超时。
// 目标：在数分钟内挖出所有真实可达的直连 RSS，扩充 server/globalmedia.js 的 DIRECT_RSS。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 从 v2 脚本提取候选清单
const v2 = fs.readFileSync(path.join(__dir, '_probe_feeds2.mjs'), 'utf8');
const m = v2.match(/const C = (\[[\s\S]*?\n\]);/);
const C = m ? eval('(' + m[1] + ')') : [];

function countItems(xml){
  if(!xml) return 0;
  const mm = xml.match(/<(item|entry)>/gi);
  return mm ? mm.length : 0;
}
async function probe(cn, name, url){
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 7000);
    const r = await fetch(url, { headers:{'User-Agent':UA,'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'}, redirect:'follow', signal: ctrl.signal });
    clearTimeout(t);
    if(r.status !== 200) return { cn, name, url, ok:false, code:r.status, items:0 };
    const txt = await r.text();
    const items = countItems(txt);
    return { cn, name, url, ok: items>0, code:r.status, items, bytes: txt.length };
  }catch(e){ return { cn, name, url, ok:false, err: e.name==='AbortError'?'timeout':(e.message||e.name), items:0 }; }
}
const CONC = 12;
(async()=>{
  console.log('并发探测 '+C.length+' 个候选源 (CONC='+CONC+', 超时7s)...');
  const res = new Array(C.length);
  let idx = 0;
  async function worker(){
    while(idx < C.length){
      const i = idx++;
      const [cn,name,url] = C[i];
      try{ res[i] = await probe(cn,name,url); }catch(e){ res[i] = { cn,name,url,ok:false,err:String(e),items:0 }; }
      if(res[i] && res[i].ok) console.log('OK  ['+cn+'] '+name+' items='+res[i].items);
    }
  }
  const workers = [];
  for(let k=0;k<CONC;k++) workers.push(worker());
  await Promise.all(workers);
  const ok = res.filter(r=>r.ok);
  console.log('\n=== 可达: '+ok.length+' / '+C.length+' ===');
  const byC = {};
  const byName = {};
  ok.forEach(r=>{
    (byC[r.cn]=byC[r.cn]||[]).push(r.name);
    byName[r.name] = r.url;
  });
  Object.keys(byC).sort().forEach(c=>{ console.log('\n## '+c+' ('+byC[c].length+')'); byC[c].forEach(x=>console.log('   '+x+' :: '+byName[x])); });
  fs.writeFileSync(path.join(__dir, 'probe3_result.json'), JSON.stringify(res,null,1));
  console.log('\n已写入 probe3_result.json');
})();
