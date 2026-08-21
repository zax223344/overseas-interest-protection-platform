import { writeFileSync } from 'fs';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ITEM_RE=/<(item|entry)[\s>]/i;

const CANDIDATES=[
  // Ukraine
  {cn:'乌克兰',iso:'UKR',name:'Kyiv Independent',url:'https://www.kyivindependent.com/feed/'},
  {cn:'乌克兰',iso:'UKR',name:'Ukrainska Pravda',url:'https://www.pravda.com.ua/eng/rss/'},
  {cn:'乌克兰',iso:'UKR',name:'Interfax Ukraine',url:'https://en.interfax.com.ua/news/last.xml'},
  {cn:'乌克兰',iso:'UKR',name:'Global Voices Ukraine',url:'https://globalvoices.org/-/world/ukraine/feed/'},
  // Kenya / Horn of Africa
  {cn:'肯尼亚',iso:'KEN',name:'Daily Nation',url:'https://nation.africa/kenya/rss.xml'},
  {cn:'肯尼亚',iso:'KEN',name:'The Standard',url:'https://www.standardmedia.co.ke/rss/kenya.php'},
  {cn:'肯尼亚',iso:'KEN',name:'Capital FM Kenya',url:'https://www.capitalfm.co.ke/feed/'},
  {cn:'索马里',iso:'SOM',name:'Garowe Online',url:'https://www.garoweonline.com/en/feed'},
  {cn:'索马里',iso:'SOM',name:'Hiiraan Online',url:'https://www.hiiraan.com/rss.xml'},
  {cn:'埃塞俄比亚',iso:'ETH',name:'Addis Standard',url:'https://addisstandard.com/feed/'},
  {cn:'埃塞俄比亚',iso:'ETH',name:'Ethiopia Observer',url:'https://www.ethiopiaobserver.com/feed'},
  // South Africa
  {cn:'南非',iso:'ZAF',name:'Daily Maverick',url:'https://www.dailymaverick.co.za/dmrss/'},
  {cn:'南非',iso:'ZAF',name:'News24 Top Stories',url:'https://feeds.capi24.com/v1/Search/articles/news24/TopStories/rss'},
  {cn:'南非',iso:'ZAF',name:'Mail & Guardian',url:'https://mg.co.za/rss/'},
  // Indonesia / SEA
  {cn:'印度尼西亚',iso:'IDN',name:'Jakarta Post',url:'https://www.thejakartapost.com/rss'},
  {cn:'印度尼西亚',iso:'IDN',name:'Tempo English',url:'https://en.tempo.co/rss'},
  {cn:'马来西亚',iso:'MYS',name:'Malaysiakini',url:'https://www.malaysiakini.com/en/rss'},
  {cn:'马来西亚',iso:'MYS',name:'The Star Malaysia',url:'https://www.thestar.com.my/rss/news/'},
  {cn:'泰国',iso:'THA',name:'Bangkok Post',url:'https://www.bangkokpost.com/rss/data/topstories.xml'},
  {cn:'泰国',iso:'THA',name:'The Nation Thailand',url:'https://www.nationthailand.com/rss'},
  {cn:'越南',iso:'VNM',name:'Vietnam News',url:'https://vietnamnews.vn/rss/'},
  {cn:'越南',iso:'VNM',name:'VNExpress International',url:'https://e.vnexpress.net/rss/world.rss'},
  {cn:'柬埔寨',iso:'KHM',name:'The Cambodia Daily',url:'https://english.cambodiadaily.com/feed/'},
  {cn:'老挝',iso:'LAO',name:'Lao Times',url:'https://laotiantimes.com/feed/'},
  // Latin America
  {cn:'墨西哥',iso:'MEX',name:'Mexico News Daily',url:'https://mexiconewsdaily.com/feed/'},
  {cn:'墨西哥',iso:'MEX',name:'Excelsior',url:'https://www.excelsior.com.mx/rss.xml'},
  {cn:'哥伦比亚',iso:'COL',name:'Colombia Reports',url:'https://colombiareports.com/feed/'},
  {cn:'哥伦比亚',iso:'COL',name:'El Espectador',url:'https://www.elespectador.com/feed'},
  {cn:'秘鲁',iso:'PER',name:'Peru Reports',url:'https://perureports.com/feed/'},
  {cn:'智利',iso:'CHL',name:'Santiago Times',url:'https://santiagotimes.com/feed/'},
  {cn:'阿根廷',iso:'ARG',name:'Buenos Aires Times',url:'https://www.batimes.com.ar/feed/'},
  {cn:'委内瑞拉',iso:'VEN',name:'Caracas Chronicles',url:'https://www.caracaschronicles.com/feed/'},
  {cn:'厄瓜多尔',iso:'ECU',name:'Ecuador Times',url:'https://www.ecuadortimes.net/feed/'},
  // MENA
  {cn:'埃及',iso:'EGY',name:'Daily News Egypt',url:'https://www.dailynewssegypt.com/feed/'},
  {cn:'埃及',iso:'EGY',name:'Egypt Independent',url:'https://www.egyptindependent.com/feed/'},
  {cn:'土耳其',iso:'TUR',name:'Daily Sabah',url:'https://www.dailysabah.com/rss'},
  {cn:'土耳其',iso:'TUR',name:'Hurriyet Daily News',url:'https://www.hurriyetdailynews.com/rss.php'},
  {cn:'伊朗',iso:'IRN',name:'Iran International',url:'https://www.iranintl.com/en/feed'},
  {cn:'伊朗',iso:'IRN',name:'Tehran Times',url:'https://www.tehrantimes.com/feed'},
  {cn:'沙特阿拉伯',iso:'SAU',name:'Arab News',url:'https://www.arabnews.com/feed'},
  {cn:'以色列',iso:'ISR',name:'Jerusalem Post',url:'https://www.jpost.com/Rss/RssFeeds/IsraelNews.xml'},
  {cn:'以色列',iso:'ISR',name:'Haaretz',url:'https://www.haaretz.com/rss-feeds/2.183'},
  {cn:'也门',iso:'YEM',name:'Yemen Observer',url:'https://www.yemenobserver.com/feed'},
  // Central Asia / Caucasus
  {cn:'哈萨克斯坦',iso:'KAZ',name:'Astana Times',url:'https://astanatimes.com/feed/'},
  {cn:'哈萨克斯坦',iso:'KAZ',name:'Kazinform',url:'https://www.inform.kz/en/rss'},
  {cn:'乌兹别克斯坦',iso:'UZB',name:'Gazeta.uz',url:'https://en.gazeta.uz/rss/'},
  {cn:'蒙古',iso:'MNG',name:'The UB Post',url:'https://ubpost.mongolnews.mn/feed/'},
  {cn:'蒙古',iso:'MNG',name:'Montsame',url:'https://montsame.mn/en/rss'},
  {cn:'阿塞拜疆',iso:'AZE',name:'AzerNews',url:'https://www.azernews.az/feed.xml'},
  {cn:'格鲁吉亚',iso:'GEO',name:'Agenda.ge',url:'https://agenda.ge/rss.xml'},
  // South Asia
  {cn:'尼泊尔',iso:'NPL',name:'The Kathmandu Post',url:'https://kathmandupost.com/rss'},
  {cn:'斯里兰卡',iso:'LKA',name:'Daily Mirror Sri Lanka',url:'https://www.dailymirror.lk/feed'},
  {cn:'斯里兰卡',iso:'LKA',name:'The Sunday Leader',url:'https://www.thesundayleader.lk/feed/'},
  {cn:'马尔代夫',iso:'MDV',name:'Maldives Independent',url:'https://maldivesindependent.com/feed'},
  // Europe
  {cn:'波兰',iso:'POL',name:'The Warsaw Voice',url:'https://www.warsawvoice.pl/rss.xml'},
  {cn:'罗马尼亚',iso:'ROU',name:'Romania Insider',url:'https://www.romania-insider.com/feed'},
  {cn:'匈牙利',iso:'HUN',name:'Hungary Today',url:'https://hungarytoday.hu/feed/'},
  {cn:'捷克',iso:'CZE',name:'Prague Morning',url:'https://praguemorning.cz/feed/'},
  {cn:'希腊',iso:'GRC',name:'Greek Reporter',url:'https://greekreporter.com/feed/'},
  // Afghanistan more
  {cn:'阿富汗',iso:'AFG',name:'TOLOnews',url:'https://tolonews.com/feed/index.xml'},
  {cn:'阿富汗',iso:'AFG',name:'Pajhwok Afghan News',url:'https://pajhwok.com/feed/'},
  // Myanmar more
  {cn:'缅甸',iso:'MMR',name:'The Irrawaddy',url:'https://www.irrawaddy.com/feed/'},
  {cn:'缅甸',iso:'MMR',name:'Frontier Myanmar',url:'https://www.frontiermyanmar.net/en/feed/'},
  // Nigeria more
  {cn:'尼日利亚',iso:'NGA',name:'The Guardian Nigeria',url:'https://guardian.ng/feed/'},
  {cn:'尼日利亚',iso:'NGA',name:'Premium Times',url:'https://www.premiumtimesng.com/feed'},
  {cn:'尼日利亚',iso:'NGA',name:'Pulse Nigeria',url:'https://www.pulse.ng/feed'},
  // India more
  {cn:'印度',iso:'IND',name:'The Hindu',url:'https://www.thehindu.com/news/?service=rss'},
  {cn:'印度',iso:'IND',name:'The Times of India',url:'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms'},
  {cn:'印度',iso:'IND',name:'Deccan Herald',url:'https://www.deccanherald.com/rss'},
  // Pakistan more
  {cn:'巴基斯坦',iso:'PAK',name:'Dawn',url:'https://www.dawn.com/feeds/home'},
  {cn:'巴基斯坦',iso:'PAK',name:'The Express Tribune',url:'https://tribune.com.pk/feed/'}
];

async function probeOne(c){
  const start=Date.now();
  try{
    const r=await fetch(c.url,{method:'GET',headers:{'User-Agent':UA,Accept:'application/rss+xml,application/xml,text/xml,*/*'},redirect:'follow',signal:AbortSignal.timeout(12000)});
    const t=await r.text();
    const ok=r.status===200 && t && t.length>200 && ITEM_RE.test(t);
    return { ...c, ok, status:r.status, len:t.length, ms:Date.now()-start, items:(t.match(ITEM_RE)||[]).length };
  }catch(e){
    return { ...c, ok:false, status:0, len:0, ms:Date.now()-start, err:e.message };
  }
}

const CONC=12;
const out=[];
for(let i=0;i<CANDIDATES.length;i+=CONC){
  const batch=CANDIDATES.slice(i,i+CONC);
  const res=await Promise.all(batch.map(probeOne));
  out.push(...res);
  res.forEach(x=>console.log(x.ok?'OK':'XX', x.status, x.cn, x.name, x.len, x.items, x.err||''));
  await new Promise(r=>setTimeout(r,300));
}

const ok=out.filter(x=>x.ok);
console.log('\n==== 可达 '+ok.length+'/'+out.length+' ====');
const byC={}; ok.forEach(x=>(byC[x.cn]=byC[x.cn]||[]).push(x.name)); Object.keys(byC).sort().forEach(c=>console.log(c,':',byC[c].join(', ')));
writeFileSync('probe4_result.json',JSON.stringify(out,null,2));
