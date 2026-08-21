const base = 'http://localhost:3000';
(async () => {
  const t0 = Date.now();
  try {
    const url = base + '/api/deepsearch?q=' + encodeURIComponent('Chinese workers attacked Pakistan') + '&max=8&timespan=14d';
    const r = await fetch(url);
    const j = await r.json();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('ok=' + j.ok + ' time=' + sec + 's count=' + (j.count || 0) + ' interestLinked=' + (j.interestLinked || 0));
    const items = j.items || [];
    console.log('items returned=' + items.length);
    items.slice(0, 4).forEach((it, i) => {
      const ents = (it.rel_enterprises || []).concat(it.rel_projects || []);
      console.log('\n[' + (i + 1) + '] ' + (it.alertLevel || '?') + ' risk=' + (it.riskScore || 0) +
        ' ch=' + (it._channel || '?') + ' country=' + (it.country || '?') + ' textFetched=' + !!it._textFetched);
      console.log('   title: ' + (it.title || '').slice(0, 95));
      console.log('   ents: ' + (ents.join(',') || '(none)'));
    });
  } catch (e) { console.log('ERROR: ' + e.message); }
})();
