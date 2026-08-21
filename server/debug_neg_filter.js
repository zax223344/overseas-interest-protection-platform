const gm = require('./globalmedia');
const scrapers = require('./scrapers');
const fs = require('fs');

function _parseRss(xml) {
  const items = [];
  const blocks = (xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  blocks.forEach(b => {
    const tg = n => {
      const m = b.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)<\\/' + n + '>', 'i'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    let title = tg('title');
    let link = tg('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1]; }
    const pub = tg('pubDate') || tg('updated') || tg('published');
    const desc = tg('description') || tg('summary') || '';
    if (title) items.push({ title: title, link: link, pubDate: pub, description: desc.replace(/<[^>]+>/g, '').slice(0, 400) });
  });
  return items;
}

(async () => {
  const srcs = gm.CHINA_NEGATIVE_SOURCES.filter(s => /BBC China/.test(s.name));
  if (!srcs.length) { console.log('no source'); process.exit(0); }
  const s = srcs[0];
  console.log('URL:', s.url);
  // 用 crawler 的 fetchText 或 node-fetch 拉取 RSS
  const crawler = require('./crawler');
  let xml = '';
  try {
    const buf = await crawler.fetchPublic(s.url, 10000);
    xml = buf ? buf.toString('utf-8') : '';
  } catch (e) {
    console.log('fetch err', e.message, e.stack);
    process.exit(0);
  }
  console.log('xml len', xml.length);
  fs.writeFileSync('C:/Users/28737/Desktop/新建文件夹/server/debug_bbc.xml', xml);
  const parsed = _parseRss(xml);
  console.log('items', parsed.length);
  parsed.slice(0, 8).forEach(it => {
    const txt = (it.title || '') + ' ' + (it.description || '');
    console.log('---');
    console.log('TITLE:', it.title);
    console.log('gateRel:', gm.gateRelevant(txt));
    console.log('gate:', scrapers.chinaOverseasGate(txt).pass, scrapers.chinaOverseasGate(txt).reason);
    console.log('hasChina:', /中国|Chinese|China|Beijing|Shanghai|中资|中企|中方|华人|华侨|华裔|一带一路|Hong Kong|Taiwan|Macau|RMB|Yuan/.test(txt));
    console.log('neg:', gm._CHINA_NEGATIVE_KW_RE ? gm._CHINA_NEGATIVE_KW_RE.test(txt) : 'no regex');
  });
})();
