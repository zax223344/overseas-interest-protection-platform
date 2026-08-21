import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// 用后端同款 _looksForeign 逻辑（粗略：含连续4个以上拉丁字母词）
function looksForeign(t){ if(!t)return false; const s=String(t); if(/[一-鿿]/.test(s)) { const lat=(s.match(/[A-Za-z]{4,}/g)||[]).length; return lat>=3 && !/[一-鿿]{3,}/.test(s);} return /[A-Za-z]{4,}/.test(s); }
const r = await fetch('http://localhost:3000/api/scrape?all=1');
const j = await r.json();
const data = j.data||{};
let total=0, foreign=0;
const fByCat={};
for(const cat in data){ for(const it of (data[cat]||[])){ if(!it||!it.title)continue; total++; if(looksForeign(it.title)){ foreign++; fByCat[cat]=(fByCat[cat]||0)+1; } } }
console.log('总抓取: '+total+' 条');
console.log('外文需翻译: '+foreign+' 条 ('+Math.round(foreign/total*100)+'%)');
console.log('外文分布: '+JSON.stringify(fByCat));
