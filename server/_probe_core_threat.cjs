const w = require('./core-threat-watch.js');
(async () => {
  console.log('开始探测核心威胁一分钟哨兵...');
  const r = await w.runCoreThreatWatch({ skipGdelt: false, skipGnews: false, skipBing: false, skipLocal: true, maxPerQuery: 8 });
  console.log('结果:', JSON.stringify({ count: r.count, stats: r.stats }, null, 2));
  if (r.items && r.items.length) {
    console.log('样例条目:');
    r.items.slice(0, 5).forEach((it, i) => {
      console.log(i + 1, it.country_cn, '|', it.category, '|', it.level, '|', it.title.slice(0, 80));
    });
  }
  process.exit(0);
})();
