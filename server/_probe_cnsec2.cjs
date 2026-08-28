/* 探针 v2：放宽地点约束，验证检索式召回 */
const crawler = require('./crawler.js');
const netx = require('./netx.js');
function parseRss(xml) {
  const items = [];
  const blocks = (xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(b => {
    const tg = n => { const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; };
    let title = tg('title'); let link = tg('link'); const pub = tg('pubDate') || tg('updated') || tg('published');
    if (title) items.push({ title, link, pub });
  });
  return items;
}
(async () => {
  console.log('=== GDELT FR 宽式: chinois enlevé (无地点约束) ===');
  const g1 = await crawler.gdeltSearch('chinois (enlevé OR enlevés OR kidnappé OR kidnappés OR otages) sourcelang:french', { timespan: '3d', maxrecords: 40 });
  g1.forEach(a => console.log(' ', a.seendate, '|', (a.title || '').slice(0, 110), '|', a.domain));
  console.log('total:', g1.length);

  console.log('\n=== GDELT FR: Pweto / Katanga chinois ===');
  const g2 = await crawler.gdeltSearch('(Pweto OR Katanga OR Kasenga OR Kolwezi) chinois', { timespan: '3d', maxrecords: 40 });
  g2.forEach(a => console.log(' ', a.seendate, '|', (a.title || '').slice(0, 110), '|', a.domain));
  console.log('total:', g2.length);

  console.log('\n=== GNews RSS FR: Pweto chinois ===');
  try {
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent('Pweto chinois when:7d') + '&hl=fr&gl=CD&ceid=CD:fr';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
    const items = parseRss(await r.text());
    items.slice(0, 15).forEach(i => console.log(' ', i.pub, '|', i.title.slice(0, 110)));
    console.log('total:', items.length);
  } catch (e) { console.log('ERR:', e.message); }

  console.log('\n=== GNews RSS FR: chinois enlevé when:7d ===');
  try {
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent('chinois enlevé when:7d') + '&hl=fr&gl=CD&ceid=CD:fr';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
    const items = parseRss(await r.text());
    items.slice(0, 15).forEach(i => console.log(' ', i.pub, '|', i.title.slice(0, 110)));
    console.log('total:', items.length);
  } catch (e) { console.log('ERR:', e.message); }

  console.log('\n=== GNews RSS EN: "Chinese" kidnapped Congo when:7d ===');
  try {
    const u = 'https://news.google.com/rss/search?q=' + encodeURIComponent('Chinese kidnapped Congo when:7d') + '&hl=en-US&gl=US&ceid=US:en';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
    const items = parseRss(await r.text());
    items.slice(0, 15).forEach(i => console.log(' ', i.pub, '|', i.title.slice(0, 110)));
    console.log('total:', items.length);
  } catch (e) { console.log('ERR:', e.message); }

  console.log('\n=== Bing News RSS: Chinese kidnapped Congo ===');
  try {
    const u = 'https://www.bing.com/news/search?q=' + encodeURIComponent('Chinese kidnapped Congo') + '&format=rss';
    const r = await netx.smartFetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
    const items = parseRss(await r.text());
    items.slice(0, 15).forEach(i => console.log(' ', i.pub, '|', i.title.slice(0, 110)));
    console.log('total:', items.length);
  } catch (e) { console.log('ERR:', e.message); }
  process.exit(0);
})();
