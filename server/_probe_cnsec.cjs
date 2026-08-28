/* 临时探针：验证刚果金上加丹加涉华袭击案能否经 GDELT / Google News 检索到 */
const crawler = require('./crawler.js');
const netx = require('./netx.js');

function parseRss(xml) {
  const items = [];
  const blocks = (xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(b => {
    const tg = n => {
      const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    let title = tg('title'); let link = tg('link');
    const pub = tg('pubDate') || tg('updated') || tg('published');
    if (title) items.push({ title, link, pub });
  });
  return items;
}

(async () => {
  console.log('=== GDELT EN: Chinese kidnapped/attacked Congo ===');
  const g1 = await crawler.gdeltSearch('("Chinese nationals" OR Chinese) (kidnapped OR abducted OR attacked OR killed OR ambush) (Congo OR DRC OR Katanga OR Kolwezi OR Lubumbashi)', { timespan: '3d', maxrecords: 30 });
  g1.forEach(a => console.log(' ', a.seendate, '|', (a.title || '').slice(0, 110), '|', a.domain));
  console.log('GDELT EN total:', g1.length);

  console.log('\n=== GDELT FR: chinois enleves Congo ===');
  const g2 = await crawler.gdeltSearch('chinois (enlevé OR enlevés OR kidnappé OR kidnappés OR attaque OR tué OR tués) (Congo OR Katanga OR Kolwezi) sourcelang:french', { timespan: '3d', maxrecords: 30 });
  g2.forEach(a => console.log(' ', a.seendate, '|', (a.title || '').slice(0, 110), '|', a.domain));
  console.log('GDELT FR total:', g2.length);

  console.log('\n=== Google News RSS: Chinese kidnapped Congo ===');
  try {
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent('Chinese kidnapped Congo OR "Haut-Katanga" when:3d') + '&hl=en-US&gl=US&ceid=US:en';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
    const items = parseRss(await r.text());
    items.slice(0, 15).forEach(i => console.log(' ', i.pub, '|', i.title.slice(0, 110)));
    console.log('GNews total:', items.length);
  } catch (e) { console.log('GNews ERR:', e.message); }

  console.log('\n=== Google News RSS FR: chinois enlevés Congo ===');
  try {
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent('chinois enlevés Congo OR Katanga when:3d') + '&hl=fr&gl=CD&ceid=CD:fr';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
    const items = parseRss(await r.text());
    items.slice(0, 15).forEach(i => console.log(' ', i.pub, '|', i.title.slice(0, 110)));
    console.log('GNews FR total:', items.length);
  } catch (e) { console.log('GNews FR ERR:', e.message); }
  process.exit(0);
})();
