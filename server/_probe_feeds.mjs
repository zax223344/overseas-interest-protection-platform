// server/_probe_feeds.mjs — 实测候选媒体 RSS 可达性（铁律一：只纳入真实可达源）
// 用法: node _probe_feeds.mjs
import https from 'https';
import http from 'http';
import { URL } from 'url';

const CANDIDATES = [
  // ===== 巴基斯坦（重仓，用户点名 50+，尽力挖真实可达）=====
  { c:'巴基斯坦', n:'俾路支邮报 The Balochistan Post', u:'https://thebalochistanpost.com/feed/' },
  { c:'巴基斯坦', n:'Dawn', u:'https://www.dawn.com/rss/top' },
  { c:'巴基斯坦', n:'The News International', u:'https://www.thenews.com.pk/rss/1/1' },
  { c:'巴基斯坦', n:'Express Tribune', u:'https://tribune.com.pk/feed/' },
  { c:'巴基斯坦', n:'Daily Times', u:'https://dailytimes.com.pk/feed/' },
  { c:'巴基斯坦', n:'Pakistan Today', u:'https://www.pakistantoday.com.pk/feed/' },
  { c:'巴基斯坦', n:'The Nation', u:'https://nation.com.pk/feed/' },
  { c:'巴基斯坦', n:'Business Recorder', u:'https://www.brecorder.com/rss/home' },
  { c:'巴基斯坦', n:'Samaa', u:'https://www.samaa.tv/feed/' },
  { c:'巴基斯坦', n:'Geo News', u:'https://www.geo.tv/rss' },
  { c:'巴基斯坦', n:'ARY News', u:'https://arynews.tv/feed/' },
  { c:'巴基斯坦', n:'92 News', u:'https://92newshd.tv/feed/' },
  { c:'巴基斯坦', n:'Dunya News', u:'https://dunya.com.pk/feed' },
  { c:'巴基斯坦', n:'The Friday Times', u:'https://www.thefridaytimes.com/feed' },
  { c:'巴基斯坦', n:'Urdu Point (EN)', u:'https://www.urdupoint.com/en/feed' },
  { c:'巴基斯坦', n:'Bol News', u:'https://bolnews.com/feed/' },
  { c:'巴基斯坦', n:'Daily Pakistan (EN)', u:'https://en.dailypakistan.com.pk/feed/' },
  { c:'巴基斯坦', n:'South Asia Journal', u:'https://southasiajournal.net/feed/' },
  { c:'巴基斯坦', n:'Modern Diplomacy (Pak)', u:'https://moderndiplomacy.eu/feed/' },
  { c:'巴基斯坦', n:'Pak Observer', u:'https://pakobserver.net/feed/' },
  { c:'巴基斯坦', n:'The Diplomat (Asia)', u:'https://thediplomat.com/feed/' },

  // ===== 印度 =====
  { c:'印度', n:'The Hindu', u:'https://www.thehindu.com/feeds/rss/HomePage.rss' },
  { c:'印度', n:'Times of India', u:'https://timesofindia.indiatimes.com/rssfeeds/54829569.cms' },
  { c:'印度', n:'Indian Express', u:'https://indianexpress.com/feed/' },
  { c:'印度', n:'Hindustan Times', u:'https://www.hindustantimes.com/feeds/rss/' },
  { c:'印度', n:'The Quint', u:'https://www.thequint.com/feed' },
  { c:'印度', n:'NDTV', u:'https://feeds.feedburner.com/ndtvnews-topstories' },
  { c:'印度', n:'The Wire', u:'https://thewire.in/feed' },
  { c:'印度', n:'Firstpost', u:'https://www.firstpost.com/feed' },
  { c:'印度', n:'Deccan Herald', u:'https://www.deccanherald.com/feed' },
  { c:'印度', n:'Business Standard', u:'https://www.business-standard.com/rss/' },
  { c:'印度', n:'Mint (LiveMint)', u:'https://www.livemint.com/rss/' },
  { c:'印度', n:'Economic Times', u:'https://economictimes.indiatimes.com/rssfeeds/2196708160.cms' },

  // ===== 孟加拉 =====
  { c:'孟加拉国', n:'The Daily Star', u:'https://www.thedailystar.net/frontpage/rss.xml' },
  { c:'孟加拉国', n:'Dhaka Tribune', u:'https://www.dhakatribune.com/feed' },
  { c:'孟加拉国', n:'BDNews24', u:'https://bdnews24.com/rss/feed/en' },
  { c:'孟加拉国', n:'Prothom Alo (EN)', u:'https://en.prothomalo.com/feed' },

  // ===== 缅甸 =====
  { c:'缅甸', n:'Myanmar Now', u:'https://myanmar-now.org/en/feed/' },
  { c:'缅甸', n:'The Irrawaddy', u:'https://www.irrawaddy.com/feed' },
  { c:'缅甸', n:'Mizzima', u:'https://mizzima.com/en/rss.xml' },

  // ===== 斯里兰卡 / 尼泊尔 =====
  { c:'斯里兰卡', n:'EconomyNext', u:'https://economynext.com/feed/' },
  { c:'尼泊尔', n:'The Kathmandu Post', u:'https://kathmandupost.com/rss' },
  { c:'尼泊尔', n:'The Himalayan Times', u:'https://thehimalayantimes.com/rss' },

  // ===== 阿富汗 =====
  { c:'阿富汗', n:'TOLOnews', u:'https://tolonews.com/feed' },
  { c:'阿富汗', n:'Pajhwok', u:'https://www.pajhwok.com/en/rss.xml' },
  { c:'阿富汗', n:'Khaama Press', u:'https://www.khaama.com/feed/' },

  // ===== 中亚 =====
  { c:'哈萨克斯坦', n:'Kazinform', u:'https://www.inform.kz/en/rss' },
  { c:'哈萨克斯坦', n:'Tengri News', u:'https://tengrinews.kz/news/rss/' },
  { c:'中亚', n:'The Times of Central Asia', u:'https://centralasiandaily.com/feed/' },

  // ===== 中东 =====
  { c:'阿联酋', n:'The National', u:'https://www.thenationalnews.com/rss/' },
  { c:'沙特', n:'Arab News', u:'https://www.arabnews.com/rss.xml' },
  { c:'阿联酋', n:'Khaleej Times', u:'https://www.khaleejtimes.com/rss' },
  { c:'阿联酋', n:'Gulf News', u:'https://gulfnews.com/rss' },
  { c:'约旦', n:'Jordan Times', u:'https://www.jordantimes.com/rss' },
  { c:'黎巴嫩', n:'Naharnet', u:'https://www.naharnet.com/rss' },
  { c:'黎巴嫩', n:'Daily Star (Lebanon)', u:'https://www.dailystar.com.lb/rss.xml' },
  { c:'中东', n:'Middle East Eye', u:'https://www.middleeasteye.net/rss.xml' },
  { c:'叙利亚', n:'Enab Baladi', u:'https://enabbaladi.net/feed/' },

  // ===== 非洲-西非 =====
  { c:'尼日利亚', n:'The Punch', u:'https://punchng.com/feed/' },
  { c:'尼日利亚', n:'Vanguard', u:'https://www.vanguardngr.com/feed/' },
  { c:'尼日利亚', n:'Premium Times', u:'https://www.premiumtimesng.com/feed/' },
  { c:'尼日利亚', n:'Sahara Reporters', u:'https://saharareporters.com/rss.xml' },
  { c:'加纳', n:'GhanaWeb', u:'https://www.ghanaweb.com/rss.php' },

  // ===== 非洲-东非 =====
  { c:'肯尼亚', n:'Daily Nation', u:'https://nation.africa/kenya/rss' },
  { c:'肯尼亚', n:'The Standard', u:'https://www.standardmedia.co.ke/rss' },
  { c:'肯尼亚', n:'The Star (KE)', u:'https://thestar.co.ke/rss' },
  { c:'埃塞俄比亚', n:'Addis Standard', u:'https://addisstandard.com/feed/' },
  { c:'苏丹', n:'Sudan Tribune', u:'https://sudantribune.com/feed' },
  { c:'苏丹', n:'Dabanga', u:'https://www.dabangasudan.org/en/rss.xml' },
  { c:'索马里', n:'Hiiraan', u:'https://www.hiiraan.com/rss.aspx' },
  { c:'乌干达', n:'Daily Monitor', u:'https://www.monitor.co.ug/rss' },
  { c:'坦桑尼亚', n:'The Citizen', u:'https://www.thecitizen.co.tz/rss' },

  // ===== 非洲-南非 =====
  { c:'南非', n:'News24', u:'https://www.news24.com/rss' },
  { c:'南非', n:'Daily Maverick', u:'https://www.dailymaverick.co.za/feed/' },
  { c:'津巴布韦', n:'NewsDay', u:'https://www.newsday.co.zw/feed/' },
  { c:'津巴布韦', n:'ZimLive', u:'https://www.zimonlinenews.com/feed/' },
  { c:'莫桑比克', n:'AIM Reports', u:'https://www.pamba.ru/en/rss' },
  { c:'安哥拉', n:'Angop', u:'https://www.angop.ao/angola/pt/rss' },
  { c:'摩洛哥', n:'Morocco World News', u:'https://www.moroccoworldnews.com/feed' },
  { c:'突尼斯', n:'Tunisia Live', u:'https://www.tunisia-live.net/feed/' },
  { c:'阿尔及利亚', n:'TSA Algerie', u:'https://www.tsa-algerie.dz/fr/feed/' },
  { c:'利比亚', n:'Libya Herald', u:'https://libyaherald.com/feed/' },
  { c:'埃及', n:'Egypt Independent', u:'https://egyptindependent.com/feed/' },
  { c:'埃及', n:'Ahram Online', u:'https://english.ahram.org.eg/rss.aspx' },

  // ===== 拉美 =====
  { c:'巴西', n:'Folha', u:'https://feeds.folha.uol.com.br/poder/rss091.xml' },
  { c:'巴西', n:'G1', u:'https://g1.globo.com/rss/g1/' },
  { c:'墨西哥', n:'Milenio', u:'https://www.milenio.com/rss' },
  { c:'哥伦比亚', n:'El Tiempo', u:'https://www.eltiempo.com/rss/coleccion/articulos' },
  { c:'阿根廷', n:'Infobae', u:'https://www.infobae.com/america/rss/' },
  { c:'阿根廷', n:'La Nacion', u:'https://www.lanacion.com.ar/export/rss/index.xml' },
  { c:'秘鲁', n:'La Republica', u:'https://larepublica.pe/rss' },
  { c:'委内瑞拉', n:'Venezuela Analysis', u:'https://venezuelanalysis.com/rss.xml' },
  { c:'智利', n:'Emol', u:'https://www.emol.com/rss/portada.xml' },

  // ===== 东南亚其余 =====
  { c:'印尼', n:'The Jakarta Post', u:'https://www.thejakartapost.com/rss/terracotta' },
  { c:'马来西亚', n:'The Star (MY)', u:'https://www.thestar.com.my/rss/feed/' },
  { c:'马来西亚', n:'Free Malaysia Today', u:'https://www.freemalaysiatoday.com/feed/' },
  { c:'越南', n:'VnExpress', u:'https://vnexpress.net/rss/home.rss' },
  { c:'菲律宾', n:'Inquirer', u:'https://globalnation.inquirer.net/feed' },
  { c:'菲律宾', n:'Rappler', u:'https://www.rappler.com/feed/' },
  { c:'泰国', n:'The Nation (TH)', u:'https://www.nationthailand.com/rss' },
  { c:'柬埔寨', n:'Phnom Penh Post', u:'https://www.phnompenhpost.com/rss.xml' },
  { c:'老挝', n:'Vientiane Times', u:'http://www.vientianetimes.org.la/feed/' },

  // ===== 亚太 =====
  { c:'日本', n:'Nikkei Asia', u:'https://asia.nikkei.com/rss' },
  { c:'韩国', n:'The Korea Times', u:'https://www.koreatimes.co.kr/www/rss/rsskoreatimes.xml' },
  { c:'澳大利亚', n:'ABC News AU', u:'https://www.abc.net.au/news/feed/' },
  { c:'澳大利亚', n:'SBS News', u:'https://www.sbs.com.au/news/feed' },

  // ===== 欧洲 =====
  { c:'欧盟', n:'EU Observer', u:'https://euobserver.com/rss' },
  { c:'巴尔干', n:'Balkan Insight', u:'https://balkaninsight.com/feed/' },
  { c:'土耳其', n:'Daily Sabah', u:'https://www.dailysabah.com/rss' },
  { c:'土耳其', n:'Hurriyet Daily News', u:'https://www.hurriyetdailynews.com/rss' },
  { c:'希腊', n:'Ekathimerini', u:'https://www.ekathimerini.com/rss' },
  { c:'波兰', n:'Notes from Poland', u:'https://notesfrompoland.com/feed/' },

  // ===== 全球聚合（金矿：覆盖万级媒体）=====
  { c:'全球', n:'GDELT Global', u:'https://api.gdeltproject.org/api/v2/doc/doc?query=%20&mode=ArtList&maxrecords=50&format=json&sort=datedesc' },
  { c:'全球', n:'Google News (World)', u:'https://news.google.com/rss/search?q=when:7d%20OR%20Pakistan%20OR%20Afghanistan&hl=en-US&gl=US&ceid=US:en' },
];

function fetchUrl(u, ms=8000){
  return new Promise((resolve)=>{
    let url;
    try{ url=new URL(u); }catch(e){ return resolve({u,ok:false,err:'bad-url',items:0}); }
    const lib = url.protocol==='https:'?https:http;
    const req = lib.get(u, { headers:{'User-Agent':'Mozilla/5.0 (compatible; OverseasIntelBot/1.0)','Accept':'application/rss+xml, application/xml, text/xml, application/json, */*'} }, (res)=>{
      const code = res.statusCode;
      if(code>=300 && code<400 && res.headers.location){
        res.destroy();
        return resolve({u, ok:false, redirect:res.headers.location, items:0});
      }
      if(code!==200){ res.destroy(); return resolve({u, ok:false, code, items:0}); }
      let data=''; let tooBig=false;
      res.on('data',(c)=>{ data+=c; if(data.length>1200000){ tooBig=true; res.destroy(); } });
      res.on('end',()=>{ resolve({u, ok:true, code, bytes:data.length, items:countItems(data)}); });
    });
    req.on('error',(e)=>resolve({u, ok:false, err:e.code||e.message, items:0}));
    req.setTimeout(ms, ()=>{ req.destroy(); resolve({u, ok:false, err:'timeout', items:0}); });
  });
}
function countItems(xml){
  if(!xml) return 0;
  const m = xml.match(/<(item|entry)>/gi);
  return m? m.length : 0;
}

(async()=>{
  console.log('total candidates:', CANDIDATES.length);
  const results = [];
  // 串行，避免并发被限；分批打印进度
  for(let i=0;i<CANDIDATES.length;i++){
    const cand = CANDIDATES[i];
    const r = await fetchUrl(cand.u);
    results.push(Object.assign({}, cand, r));
    const tag = r.ok ? 'OK ' : 'FAIL';
    console.log(`${tag} [${cand.c}] ${cand.n.padEnd(28)} items=${r.items} ${r.err||r.code||''}  ${r.ok?cand.u:''}`);
  }
  const ok = results.filter(r=>r.ok && r.items>0);
  console.log('\n=== 可达且有条目: '+ok.length+' / '+CANDIDATES.length+' ===');
  // 按国家汇总
  const byC = {};
  ok.forEach(r=>{ (byC[r.c]=byC[r.c]||[]).push(r.n+' :: '+r.u); });
  Object.keys(byC).sort().forEach(c=>{ console.log(`\n## ${c} (${byC[c].length})`); byC[c].forEach(x=>console.log('   '+x)); });
  // 输出可 machine-read
  const fs = await import('fs');
  fs.writeFileSync('probe_result.json', JSON.stringify(results,null,1));
  console.log('\n已写入 probe_result.json');
})();
