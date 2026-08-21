const base = 'http://localhost:3000';
async function test(q, tag) {
  const t0 = Date.now();
  const r = await fetch(base + '/api/deepsearch?q=' + encodeURIComponent(q) + '&max=8&timespan=14d');
  const j = await r.json();
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n### ' + tag + ' :: "' + q + '"  ok=' + j.ok + ' ' + sec + 's  count=' + (j.count || 0) + ' interestLinked=' + (j.interestLinked || 0));
  (j.items || []).slice(0, 4).forEach((it, i) => {
    const ents = (it.rel_enterprises || []).concat(it.rel_projects || []);
    console.log('  [' + (i + 1) + '] ' + (it.alertLevel || '?') + ' risk=' + (it.riskScore || 0) +
      ' ch=' + (it._channel || '?') + ' cn=' + it.chinaNegative + ' linked=' + it.interestLinked +
      ' | ' + (it.title || '').slice(0, 80));
    if (ents.length) console.log('       ents: ' + ents.join(','));
  });
}
(async () => {
  await test('Chinese workers attacked Pakistan', 'GENERIC-FOREIGN (expect drop)');
  await test('Chinese company protest overseas', 'CHINA-SPECIFIC (expect pass)');
})();
