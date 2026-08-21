const base = 'http://localhost:3000';
(async () => {
  const t0 = Date.now();
  try {
    const r = await fetch(base + '/api/social?q=' + encodeURIComponent('Chinese workers') + '&limit=25');
    const j = await r.json();
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('ok=' + j.ok + ' time=' + sec + 's');
    console.log('stats:', JSON.stringify(j.stats));
    const items = j.items || [];
    console.log('items returned=' + items.length);
    items.slice(0, 5).forEach((it, i) => {
      const ents = (it.rel_enterprises || []).concat(it.rel_projects || []);
      console.log('\n[' + (i + 1) + '] ' + it.alertLevel + ' risk=' + it.riskScore +
        ' platform=' + it.social_platform + ' country=' + (it.country || '?'));
      console.log('   title: ' + (it.title || '').slice(0, 95));
      console.log('   ents: ' + (ents.join(',') || '(none)') + ' | interestLinked=' + it.interestLinked);
    });
  } catch (e) { console.log('ERROR: ' + e.message); }
})();
