import { writeFileSync } from 'fs';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ITEM_RE=/<(item|entry)[\s>]/i;
const CANDIDATES=[
  // 巴基斯坦（用户点名地方媒体）
  {cn:'巴基斯坦',iso:'PAK',name:'The Balochistan Post',url:'https://thebalochistanpost.com/feed/'},
  {cn:'巴基斯坦',iso:'PAK',name:'Geo TV',url:'https://www.geo.tv/rss'},{cn:'巴基斯坦',iso:'PAK',name:'Business Recorder',url:'https://www.brecorder.com/rss'},
  {cn:'巴基斯坦',iso:'PAK',name:'Pakistan Today',url:'https://www.pakistantoday.com.pk/feed'},{cn:'巴基斯坦',iso:'PAK',name:'The Nation',url:'https://www.nation.com.pk/feed'},
  {cn:'巴基斯坦',iso:'PAK',name:'Dawn Business',url:'https://www.dawn.com/feeds/business'},{cn:'巴基斯坦',iso:'PAK',name:'The Friday Times',url:'https://thefridaytimes.com/feed/'},
  // 阿富汗
  {cn:'阿富汗',iso:'AFG',name:'Afghanistan Analysts Network',url:'https://www.afghanistan-analysts.org/feed/'},
  {cn:'阿富汗',iso:'AFG',name:'TOLOnews English',url:'https://tolonews.com/feed/index.xml'},
  // 乌克兰
  {cn:'乌克兰',iso:'UKR',name:'Ukrinform',url:'https://www.ukrinform.net/rss/'},{cn:'乌克兰',iso:'UKR',name:'Euromaidan Press',url:'https://euromaidanpress.com/feed/'},
  {cn:'乌克兰',iso:'UKR',name:'Yahoo World Ukraine',url:'https://news.yahoo.com/rss/world'},{cn:'乌克兰',iso:'UKR',name:'Guardian Ukraine',url:'https://www.theguardian.com/world/ukraine/rss'},
  {cn:'乌克兰',iso:'UKR',name:'Reuters Ukraine',url:'https://www.reuters.com/world/ukraine/feed/'},{cn:'乌克兰',iso:'UKR',name:'Kyiv Post',url:'https://www.kyivpost.com/feed/'},
  // 中东
  {cn:'伊拉克',iso:'IRQ',name:'Iraqi News',url:'https://www.iraqinews.com/feed/'},{cn:'伊拉克',iso:'IRQ',name:'Almasdar News',url:'https://www.almasdarnews.com/feed/'},
  {cn:'叙利亚',iso:'SYR',name:'Syria Direct',url:'https://syriadirect.org/feed/'},{cn:'叙利亚',iso:'SYR',name:'Almasdar Syria',url:'https://www.almasdarnews.com/feed/'},
  {cn:'也门',iso:'YEM',name:'Yemen News Agency',url:'https://sabanews.net/feed/'},{cn:'也门',iso:'YEM',name:'Yemen Times',url:'https://yementimes.com/feed/'},
  {cn:'中东',iso:'MENA',name:'Middle East Eye',url:'https://www.middleeasteye.net/rss'},{cn:'中东',iso:'MENA',name:'Middle East Monitor',url:'https://www.middleeastmonitor.com/rss'},
  {cn:'中东',iso:'MENA',name:'Al Jazeera',url:'https://www.aljazeera.com/xml/rss/all.xml'},{cn:'中东',iso:'MENA',name:'Al-Monitor',url:'https://www.al-monitor.com/rss'},
  {cn:'土耳其',iso:'TUR',name:'Daily Sabah',url:'https://www.dailysabah.com/rss'},{cn:'土耳其',iso:'TUR',name:'Hurriyet Daily News',url:'https://www.hurriyetdailynews.com/rss.php'},
  {cn:'埃及',iso:'EGY',name:'Egypt Today',url:'https://www.egypttoday.com/rss'},{cn:'沙特',iso:'SAU',name:'Al Arabiya English',url:'https://english.alarabiya.net/feed'},
  {cn:'以色列',iso:'ISR',name:'Times of Israel',url:'https://www.timesofisrael.com/feed/'},{cn:'以色列',iso:'ISR',name:'Haaretz',url:'https://www.haaretz.com/rss-feeds/2.183'},
  // 非洲
  {cn:'肯尼亚',iso:'KEN',name:'The EastAfrican',url:'https://www.theeastafrican.co.ke/rss.xml'},{cn:'肯尼亚',iso:'KEN',name:'Daily Nation Politics',url:'https://nation.africa/kenya/politics/rss.xml'},
  {cn:'乌干达',iso:'UGA',name:'Daily Monitor',url:'https://www.monitor.co.ug/feed'},{cn:'乌干达',iso:'UGA',name:'New Vision',url:'https://www.newvision.co.ug/feed'},
  {cn:'南非',iso:'ZAF',name:'Daily Maverick',url:'https://www.dailymaverick.co.za/dmrss/'},{cn:'南非',iso:'ZAF',name:'SowetanLIVE',url:'https://www.sowetanlive.co.za/rss/'},
  {cn:'索马里',iso:'SOM',name:'Hiiraan Online',url:'https://www.hiiraan.com/rss.xml'},{cn:'埃塞俄比亚',iso:'ETH',name:'Addis Standard',url:'https://addisstandard.com/feed/'},
  {cn:'津巴布韦',iso:'ZWE',name:'NewsDay Zimbabwe',url:'https://www.newsday.co.zw/feed/'},{cn:'赞比亚',iso:'ZMB',name:'Lusaka Times',url:'https://www.lusakatimes.com/feed/'},
  // 东南亚
  {cn:'印度尼西亚',iso:'IDN',name:'Jakarta Globe',url:'https://jakartaglobe.id/feed/'},{cn:'印度尼西亚',iso:'IDN',name:'Antara News',url:'https://www.antaranews.com/en/rss'},{cn:'印度尼西亚',iso:'IDN',name:'Jakarta Post',url:'https://www.thejakartapost.com/rss'},
  {cn:'马来西亚',iso:'MYS',name:'Malaysiakini',url:'https://www.malaysiakini.com/en/rss'},{cn:'马来西亚',iso:'MYS',name:'Free Malaysia Today',url:'https://www.freemalaysiatoday.com/feed/'},
  {cn:'泰国',iso:'THA',name:'Bangkok Post Top Stories',url:'https://www.bangkokpost.com/rss/data/topstories.xml'},{cn:'泰国',iso:'THA',name:'The Nation Thailand',url:'https://www.nationthailand.com/rss'},
  {cn:'柬埔寨',iso:'KHM',name:'Khmer Times',url:'https://www.khmertimeskh.com/feed/'},{cn:'柬埔寨',iso:'KHM',name:'Phnom Penh Post',url:'https://www.phnompenhpost.com/feed'},
  // 拉丁美洲
  {cn:'墨西哥',iso:'MEX',name:'Milenio',url:'https://www.milenio.com/rss'},{cn:'墨西哥',iso:'MEX',name:'El Financiero',url:'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/'},
  {cn:'哥伦比亚',iso:'COL',name:'El Espectador',url:'https://www.elespectador.com/feed'},{cn:'哥伦比亚',iso:'COL',name:'El Pais Colombia',url:'https://www.elpais.com.co/rss/'},
  {cn:'阿根廷',iso:'ARG',name:'La Nacion',url:'https://www.lanacion.com.ar/rss/'},{cn:'阿根廷',iso:'ARG',name:'Clarin',url:'https://www.clarin.com/rss/'},{cn:'智利',iso:'CHL',name:'Emol',url:'https://www.emol.com/rss/'},
  {cn:'秘鲁',iso:'PER',name:'El Comercio',url:'https://elcomercio.pe/feed/'},{cn:'委内瑞拉',iso:'VEN',name:'Caracas Chronicles',url:'https://www.caracaschronicles.com/feed/'},
  // 欧洲/中亚
  {cn:'俄罗斯',iso:'RUS',name:'The Moscow Times',url:'https://www.themoscowtimes.com/rss/news'},{cn:'俄罗斯',iso:'RUS',name:'Meduza',url:'https://meduza.io/en/rss/all'},
  {cn:'土耳其',iso:'TUR',name:'TRT World',url:'https://www.trtworld.com/rss'},{cn:'希腊',iso:'GRC',name:'Greek Reporter',url:'https://greekreporter.com/feed/'},
  {cn:'白俄罗斯',iso:'BLR',name:'Belsat',url:'https://belsat.eu/feed/'},{cn:'格鲁吉亚',iso:'GEO',name:'Civil Georgia',url:'https://civil.ge/feed/'}
];
async function probeOne(c){
  const start=Date.now();
  try{
    const r=await fetch(c.url,{method:'GET',headers:{'User-Agent':UA,Accept:'application/rss+xml,application/xml,text/xml,*/*'},redirect:'follow',signal:AbortSignal.timeout(12000)});
    const t=await r.text();
    const ok=r.status===200 && t && t.length>200 && ITEM_RE.test(t);
    return { ...c, ok, status:r.status, len:t.length, ms:Date.now()-start };
  }catch(e){ return { ...c, ok:false, status:0, len:0, ms:Date.now()-start, err:e.message }; }
}
const out=[];
for(let i=0;i<CANDIDATES.length;i+=12){
  const batch=CANDIDATES.slice(i,i+12);
  const res=await Promise.all(batch.map(probeOne));
  out.push(...res);
  res.forEach(x=>console.log(x.ok?'OK':'XX', x.status, x.cn, x.name, x.len, x.err||''));
  await new Promise(r=>setTimeout(r,300));
}
const ok=out.filter(x=>x.ok);
console.log('\n==== 可达 '+ok.length+'/'+out.length+' ====');
const byC={}; ok.forEach(x=>(byC[x.cn]=byC[x.cn]||[]).push(x.name)); Object.keys(byC).sort().forEach(c=>console.log(c,':',byC[c].join(', ')));
writeFileSync('probe5_result.json',JSON.stringify(out,null,2));
