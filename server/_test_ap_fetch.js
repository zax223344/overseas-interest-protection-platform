const crawler = require('./crawler');
(async () => {
  const url = 'https://apnews.com/article/china-eu-sanctions-russia-export-control-war-cfb75918077b268eb76b0f19c1673511';
  const html = await crawler.fetchPublic(url, 12000);
  console.log('html length:', html ? html.length : 0);
  if (html) {
    const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
    console.log('title:', titleMatch ? titleMatch[1] : 'none');
    const art = crawler.extractArticle(html);
    console.log('extract snippet:', art ? art.slice(0, 300) : 'none');
  }
})();
