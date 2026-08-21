/* 预测引擎离线验证：用真实缓存样本跑一遍 build() 的核心算法（与 app.js ENGINE 同源） */
const fs = require('fs');
const path = require('path');

function _fcTs(v){
  if(!v)return 0;
  if(typeof v==='number')return v>1e12?v:(v>1e9?v*1000:0);
  var s=String(v).trim();
  if(!s)return 0;
  var m=s.match(/^(\d+)\s*(分钟|小时|天|周)前$/);
  if(m){
    var n=parseInt(m[1],10);
    var unit={'分钟':6e4,'小时':36e5,'天':864e5,'周':6048e5}[m[2]]||0;
    return Date.now()-n*unit;
  }
  if(/^(刚刚|just\s*now)$/i.test(s))return Date.now();
  /* 中文本地化 RFC822（RSS 源常见）："周一, 03 8月 2026 07:23:00 GMT"
   * 原生 Date.parse 无法识别，会被当成"时间未知"退化为 45 天前，
   * 直接把当天最新情报误判为陈旧样本、动量全负——必须显式解析。 */
  var cn=s.match(/(\d{1,2})\s*(\d{1,2})月\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC)?/);
  if(cn){
    var tt=Date.UTC(+cn[3],+cn[2]-1,+cn[1],+cn[4],+cn[5],+(cn[6]||0));
    if(!isNaN(tt))return tt;
  }
  /* "2026年8月3日 07:23" / "2026年8月3日" */
  var cn2=s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?/);
  if(cn2){
    var t2=new Date(+cn2[1],+cn2[2]-1,+cn2[3],+(cn2[4]||0),+(cn2[5]||0)).getTime();
    if(!isNaN(t2))return t2;
  }
  var iso=s.replace(/\//g,'-');
  if(/^\d{4}-\d{1,2}-\d{1,2}[ ]\d{1,2}:\d{2}/.test(iso))iso=iso.replace(' ','T');
  var t=Date.parse(iso);
  if(!isNaN(t))return t;
  /* 去掉中文星期前缀后再试一次（"周一, Mon 03 Aug 2026..."） */
  t=Date.parse(s.replace(/^(周[一二三四五六日天]|星期[一二三四五六日天])[,，]?\s*/,''));
  return isNaN(t)?0:t;
}

const LV_W={red:1.0,orange:0.6,yellow:0.3,blue:0.15};
const SELF={'中国':1,'中国大陆':1,'中华人民共和国':1,'China':1,'中国香港':1,'中国澳门':1,'中国台湾':1};
const ALIAS={'印尼':'印度尼西亚','沙特':'沙特阿拉伯','刚果金':'刚果(金)','刚果（金）':'刚果(金)','孟加拉':'孟加拉国','埃塞':'埃塞俄比亚'};
const norm = n => { const t=String(n||'').trim(); return ALIAS[t]||t; };

const appSrc = fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const DIMS_W = {political:.15,economic:.15,security:.20,legal:.10,social:.10,natural:.10,operational:.10,geopolitical:.10};
const COUNTRIES = [];
appSrc.split('\n').filter(l=>/^\{name:'[^']+',flag:'/.test(l.trim())).forEach(l=>{
  const nm=(l.match(/name:'([^']+)'/)||[])[1];
  const fg=(l.match(/flag:'([^']+)'/)||[])[1];
  const sc=(l.match(/scores:\{([^}]+)\}/)||[])[1];
  if(!nm||!sc)return;
  const o={};
  sc.split(',').forEach(kv=>{const[a,b]=kv.split(':');o[a.trim()]=parseFloat(b);});
  COUNTRIES.push({name:nm,flag:fg,scores:o});
});
const calcOverall = s => { let t=0; for(const k in DIMS_W) t+=(s[k]||0)*DIMS_W[k]; return Math.round(t*10)/10; };
console.log('国别基线表载入: '+COUNTRIES.length+' 国');

const samples=[]; let excludedSelf=0, noCty=0;
for(const f of ['osint_intel','socmint_intel']){
  const p=path.join(__dirname,'.cache',f+'.json');
  if(!fs.existsSync(p))continue;
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  const arr=Array.isArray(j)?j:(j.items||j.data||[]);
  arr.forEach(it=>{
    if(it.interestLinked===false)return;
    if(!it.country||it.country==='未知'){noCty++;return;}
    const cty=norm(it.country);
    if(SELF[cty]){excludedSelf++;return;}
    samples.push({country:cty,level:it.level||'blue',type:it.type||it.intel_type||'安全风险',
      title:it.title||'',ts:_fcTs(it.publishedAt||it.pubDate||it.date||it.time),
      detailed:!!((it.content&&it.content.length>=200)||(it.factSheet&&it.factSheet.facts&&it.factSheet.facts.length)),
      src:f});
  });
}
console.log('可归属国家样本: '+samples.length+' 条 | 剔除本国(中国等): '+excludedSelf+' 条 | 缺国家字段: '+noCty+' 条');

const now=Date.now(),DAY=864e5;
const byC={}; samples.forEach(s=>{(byC[s.country]=byC[s.country]||[]).push(s);});
const rows=[];
Object.keys(byC).forEach(cn=>{
  const arr=byC[cn];
  const c=COUNTRIES.find(x=>x.name===cn);
  const hasBase=!!c;
  let base;
  if(hasBase){ base=calcOverall(c.scores); }
  else { let w=0; arr.forEach(s=>{w+=LV_W[s.level]||0.15;}); base=Math.round((2.8+(w/Math.max(arr.length,1))*4.7)*10)/10; }
  let inten=0,recent=0,prior=0,nRecent=0,nPrior=0,nNoTs=0;
  arr.forEach(s=>{
    const w=LV_W[s.level]||0.15;
    if(!s.ts){ inten+=w*0.5; nNoTs++; return; }
    const ageD=Math.max(0,(now-s.ts)/DAY);
    inten+=w*Math.pow(0.5,ageD/30);
    if(ageD<=15){recent+=w;nRecent++;}else if(ageD<=45){prior+=w;nPrior++;}
  });
  const boost=2.5*(1-Math.exp(-inten/2.2));
  let cur=base+boost; cur=Math.max(0,Math.min(10,Math.round(cur*10)/10));
  const nTs=nRecent+nPrior, momWeak=(nTs<2);
  const priorNorm=prior/2;
  let mom=momWeak?0:(recent-priorNorm)/Math.max(priorNorm,0.5); mom=Math.max(-1.6,Math.min(1.6,mom));
  const vol=0.45+Math.min(0.85,inten/6);
  const rev=(cur-base)*0.18;
  let p3=cur+mom*0.62*vol-rev*0.5, p6=cur+mom*0.88*vol-rev;
  p3=Math.max(0,Math.min(10,Math.round(p3*10)/10)); p6=Math.max(0,Math.min(10,Math.round(p6*10)/10));
  const n=arr.length, det=arr.filter(s=>s.detailed).length, withTs=arr.filter(s=>!!s.ts).length;
  let conf=48+Math.min(n,24)*1.35+(det/Math.max(n,1))*16+(withTs/Math.max(n,1))*10+(nRecent&&nPrior?6:0);
  if(!hasBase)conf-=12;
  conf=Math.max(30,Math.min(94,Math.round(conf)));
  const tc={}; arr.forEach(s=>{tc[s.type]=(tc[s.type]||0)+1;});
  const tops=Object.keys(tc).sort((a,b)=>tc[b]-tc[a]);
  rows.push({country:cn,base:base.toFixed(1),cur:cur.toFixed(1),p3:p3.toFixed(1),p6:p6.toFixed(1),
    d:(p6-cur).toFixed(1),mom:mom.toFixed(2),conf,n,det,
    reds:arr.filter(s=>s.level==='red').length, hasBase, momWeak, nNoTs,
    driver:tops.slice(0,2).map(t=>t+' '+tc[t]+'起').join(' · ')});
});
rows.sort((a,b)=>parseFloat(b.d)-parseFloat(a.d)||parseFloat(b.p6)-parseFloat(a.p6));
console.log('\n推导出 '+rows.length+' 国预测:\n');
console.log('国家'.padEnd(14)+'基线  当前  3月   6月   变化   动量   置信  样本 细节  驱动因素');
console.log('-'.repeat(100));
rows.forEach(r=>{
  console.log(String(r.country+(r.hasBase?'':'▲')).padEnd(14)+
    r.base.padStart(4)+'  '+r.cur.padStart(4)+'  '+r.p3.padStart(4)+'  '+r.p6.padStart(4)+'  '+
    (parseFloat(r.d)>0?'+':'')+r.d.padStart(4)+'  '+(r.momWeak?' 弱  ':r.mom.padStart(5))+'  '+String(r.conf).padStart(3)+'%  '+
    String(r.n).padStart(3)+'  '+String(r.det).padStart(3)+'   '+r.driver);
});
console.log('\n(▲ = 不在权威国别评分表内，基线由样本推导，置信度已扣12分)');
const up=rows.filter(r=>parseFloat(r.d)>0.15).length, dn=rows.filter(r=>parseFloat(r.d)<-0.15).length;
console.log('\n上升 '+up+' 国 / 下降 '+dn+' 国 / 持平 '+(rows.length-up-dn)+' 国');
console.log('平均置信度 '+Math.round(rows.reduce((s,r)=>s+r.conf,0)/rows.length)+'%');
console.log('高风险(6月预测≥6): '+rows.filter(r=>parseFloat(r.p6)>=6).map(r=>r.country+'('+r.p6+')').join(', '));
