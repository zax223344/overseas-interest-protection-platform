// server/_probe_feeds2.mjs — 重探测 v2：真实 Chrome UA + 自动跟随重定向 + 10s超时
// 目标：挖出更多真实可达的直连 RSS（尤其巴基斯坦，用户点名 50+）
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const C = [
  // ===== 巴基斯坦（重仓）=====
  ['巴基斯坦','thebalochistanpost.com/feed/','https://thebalochistanpost.com/feed/'],
  ['巴基斯坦','Dawn','https://www.dawn.com/rss/top'],
  ['巴基斯坦','Dawn-news','https://www.dawn.com/news/rss'],
  ['巴基斯坦','Express Tribune','https://tribune.com.pk/feed/'],
  ['巴基斯坦','The News','https://www.thenews.com.pk/rss/1/1'],
  ['巴基斯坦','Daily Times','https://dailytimes.com.pk/feed/'],
  ['巴基斯坦','Pakistan Today','https://www.pakistantoday.com.pk/feed/'],
  ['巴基斯坦','The Nation','https://nation.com.pk/feed/'],
  ['巴基斯坦','Business Recorder','https://www.brecorder.com/rss/home'],
  ['巴基斯坦','Samaa','https://www.samaa.tv/feed/'],
  ['巴基斯坦','Geo News','https://www.geo.tv/rss'],
  ['巴基斯坦','ARY News','https://arynews.tv/feed/'],
  ['巴基斯坦','92 News','https://92newshd.tv/feed/'],
  ['巴基斯坦','Dunya','https://dunya.com.pk/feed'],
  ['巴基斯坦','The Friday Times','https://www.thefridaytimes.com/feed'],
  ['巴基斯坦','Urdu Point','https://www.urdupoint.com/en/feed'],
  ['巴基斯坦','Bol News','https://bolnews.com/feed/'],
  ['巴基斯坦','Daily Pakistan','https://en.dailypakistan.com.pk/feed/'],
  ['巴基斯坦','Pak Observer','https://pakobserver.net/feed/'],
  ['巴基斯坦','Modern Diplomacy','https://moderndiplomacy.eu/feed/'],
  ['巴基斯坦','ProPakistani','https://propakistani.pk/feed/'],
  ['巴基斯坦','TechJuice','https://techjuice.pk/feed/'],
  ['巴基斯坦','The Current','https://thecurrent.pk/feed/'],
  ['巴基斯坦','Balochistan Post-Pak','https://thebalochistanpost.com/category/pakistan/feed/'],
  ['巴基斯坦','Balochistan Post-Bal','https://thebalochistanpost.com/category/balochistan/feed/'],

  // ===== 印度 =====
  ['印度','Indian Express','https://indianexpress.com/feed/'],
  ['印度','The Hindu','https://www.thehindu.com/feeds/rss/HomePage.rss'],
  ['印度','Times of India','https://timesofindia.indiatimes.com/rssfeeds/54829569.cms'],
  ['印度','Hindustan Times','https://www.hindustantimes.com/feeds/rss/'],
  ['印度','The Wire','https://thewire.in/feed'],
  ['印度','Firstpost','https://www.firstpost.com/feed'],
  ['印度','Deccan Herald','https://www.deccanherald.com/feed'],
  ['印度','Business Standard','https://www.business-standard.com/rss/'],
  ['印度','LiveMint','https://www.livemint.com/rss/'],
  ['印度','Economic Times','https://economictimes.indiatimes.com/rssfeeds/2196708160.cms'],

  // ===== 孟加拉 =====
  ['孟加拉国','Daily Star','https://www.thedailystar.net/frontpage/rss.xml'],
  ['孟加拉国','Dhaka Tribune','https://www.dhakatribune.com/feed'],
  ['孟加拉国','BDNews24','https://bdnews24.com/rss/feed/en'],
  ['孟加拉国','Prothom Alo','https://en.prothomalo.com/feed'],
  ['孟加拉国','Bangla News24','https://banglanews24.com/rss'],

  // ===== 缅甸 =====
  ['缅甸','Myanmar Now','https://myanmar-now.org/en/feed/'],
  ['缅甸','Irrawaddy','https://www.irrawaddy.com/feed'],
  ['缅甸','Mizzima','https://mizzima.com/en/rss.xml'],

  // ===== 斯里兰卡/尼泊尔 =====
  ['斯里兰卡','EconomyNext','https://economynext.com/feed/'],
  ['斯里兰卡','Daily Mirror','https://www.dailymirror.lk/rss'],
  ['尼泊尔','Kathmandu Post','https://kathmandupost.com/rss'],
  ['尼泊尔','Himalayan Times','https://thehimalayantimes.com/rss'],

  // ===== 阿富汗 =====
  ['阿富汗','Khaama Press','https://www.khaama.com/feed/'],
  ['阿富汗','Pajhwok','https://www.pajhwok.com/en/rss.xml'],
  ['阿富汗','TOLOnews','https://tolonews.com/feed'],

  // ===== 中亚 =====
  ['哈萨克斯坦','Kazinform','https://www.inform.kz/en/rss'],
  ['哈萨克斯坦','Tengri News','https://tengrinews.kz/news/rss/'],
  ['中亚','Times of Central Asia','https://centralasiandaily.com/feed/'],

  // ===== 中东 =====
  ['阿联酋','The National','https://www.thenationalnews.com/rss/'],
  ['沙特','Arab News','https://www.arabnews.com/rss.xml'],
  ['阿联酋','Khaleej Times','https://www.khaleejtimes.com/rss'],
  ['阿联酋','Gulf News','https://gulfnews.com/rss'],
  ['约旦','Jordan Times','https://www.jordantimes.com/rss'],
  ['黎巴嫩','Naharnet','https://www.naharnet.com/rss'],
  ['黎巴嫩','Daily Star','https://www.dailystar.com.lb/rss.xml'],
  ['中东','Middle East Eye','https://www.middleeasteye.net/rss.xml'],
  ['叙利亚','Enab Baladi','https://enabbaladi.net/feed/'],

  // ===== 非洲 =====
  ['尼日利亚','Punch','https://punchng.com/feed/'],
  ['尼日利亚','Vanguard','https://www.vanguardngr.com/feed/'],
  ['尼日利亚','Premium Times','https://www.premiumtimesng.com/feed/'],
  ['尼日利亚','Sahara Reporters','https://saharareporters.com/rss.xml'],
  ['加纳','GhanaWeb','https://www.ghanaweb.com/rss.php'],
  ['肯尼亚','Daily Nation','https://nation.africa/kenya/rss'],
  ['肯尼亚','Standard','https://www.standardmedia.co.ke/rss'],
  ['肯尼亚','The Star','https://thestar.co.ke/rss'],
  ['埃塞俄比亚','Addis Standard','https://addisstandard.com/feed/'],
  ['苏丹','Sudan Tribune','https://sudantribune.com/feed'],
  ['苏丹','Dabanga','https://www.dabangasudan.org/en/rss.xml'],
  ['南非','News24','https://www.news24.com/rss'],
  ['南非','Daily Maverick','https://www.dailymaverick.co.za/feed/'],
  ['津巴布韦','NewsDay','https://www.newsday.co.zw/feed/'],
  ['津巴布韦','ZimLive','https://www.zimonlinenews.com/feed/'],
  ['利比亚','Libya Herald','https://libyaherald.com/feed/'],
  ['埃及','Egypt Independent','https://egyptindependent.com/feed/'],
  ['埃及','Ahram Online','https://english.ahram.org.eg/rss.aspx'],
  ['摩洛哥','Morocco World News','https://www.moroccoworldnews.com/feed'],
  ['突尼斯','Tunisia Live','https://www.tunisia-live.net/feed/'],
  ['阿尔及利亚','TSA Algerie','https://www.tsa-algerie.dz/fr/feed/'],
  ['坦桑尼亚','The Citizen','https://www.thecitizen.co.tz/rss'],
  ['乌干达','Daily Monitor','https://www.monitor.co.ug/rss'],

  // ===== 拉美 =====
  ['巴西','Folha','https://feeds.folha.uol.com.br/poder/rss091.xml'],
  ['巴西','G1','https://g1.globo.com/rss/g1/'],
  ['墨西哥','Milenio','https://www.milenio.com/rss'],
  ['哥伦比亚','El Tiempo','https://www.eltiempo.com/rss/coleccion/articulos'],
  ['阿根廷','Infobae','https://www.infobae.com/america/rss/'],
  ['阿根廷','La Nacion','https://www.lanacion.com.ar/export/rss/index.xml'],
  ['秘鲁','La Republica','https://larepublica.pe/rss'],
  ['委内瑞拉','Venezuela Analysis','https://venezuelanalysis.com/rss.xml'],
  ['智利','Emol','https://www.emol.com/rss/portada.xml'],

  // ===== 东南亚 =====
  ['印尼','Jakarta Post','https://www.thejakartapost.com/rss/terracotta'],
  ['马来西亚','The Star','https://www.thestar.com.my/rss/feed/'],
  ['马来西亚','Free Malaysia Today','https://www.freemalaysiatoday.com/feed/'],
  ['越南','VnExpress','https://vnexpress.net/rss/home.rss'],
  ['菲律宾','Inquirer','https://globalnation.inquirer.net/feed'],
  ['菲律宾','Rappler','https://www.rappler.com/feed/'],
  ['泰国','The Nation','https://www.nationthailand.com/rss'],
  ['柬埔寨','Phnom Penh Post','https://www.phnompenhpost.com/rss.xml'],
  ['老挝','Vientiane Times','https://www.vientianetimes.org.la/feed/'],

  // ===== 亚太 =====
  ['日本','Nikkei Asia','https://asia.nikkei.com/rss'],
  ['韩国','Korea Times','https://www.koreatimes.co.kr/www/rss/rsskoreatimes.xml'],
  ['澳大利亚','ABC News','https://www.abc.net.au/news/feed/'],
  ['澳大利亚','SBS','https://www.sbs.com.au/news/feed'],

  // ===== 欧洲 =====
  ['欧盟','EU Observer','https://euobserver.com/rss'],
  ['巴尔干','Balkan Insight','https://balkaninsight.com/feed/'],
  ['波兰','Notes from Poland','https://notesfrompoland.com/feed/'],
  ['土耳其','Daily Sabah','https://www.dailysabah.com/rss'],
  ['土耳其','Hurriyet','https://www.hurriyetdailynews.com/rss'],
  ['希腊','Ekathimerini','https://www.ekathimerini.com/rss'],
];

function countItems(xml){
  if(!xml) return 0;
  const m = xml.match(/<(item|entry)>/gi);
  return m ? m.length : 0;
}
async function probe(cn, name, url){
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 10000);
    const r = await fetch(url, { headers:{'User-Agent':UA,'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'}, redirect:'follow', signal: ctrl.signal });
    clearTimeout(t);
    if(r.status !== 200) return { cn, name, url, ok:false, code:r.status, items:0 };
    const txt = await r.text();
    const items = countItems(txt);
    return { cn, name, url, ok: items>0, code:r.status, items, bytes: txt.length };
  }catch(e){ return { cn, name, url, ok:false, err: e.name==='AbortError'?'timeout':(e.message||e.name), items:0 }; }
}
(async()=>{
  const res = [];
  for(const [cn,name,url] of C){
    const r = await probe(cn,name,url);
    res.push(r);
    const tag = r.ok ? 'OK ' : 'FAIL';
    console.log(`${tag} [${cn}] ${name.padEnd(22)} items=${r.items} ${r.err||r.code||''}`);
  }
  const ok = res.filter(r=>r.ok);
  console.log(`\n=== 可达: ${ok.length} / ${C.length} ===`);
  const byC = {};
  ok.forEach(r=>{ (byC[r.cn]=byC[r.cn]||[]).push(`${r.name} :: ${r.url}`); });
  Object.keys(byC).sort().forEach(c=>{ console.log(`\n## ${c} (${byC[c].length})`); byC[c].forEach(x=>console.log('   '+x)); });
  fs.writeFileSync('probe2_result.json', JSON.stringify(res,null,1));
  console.log('\n已写入 probe2_result.json');
})();
