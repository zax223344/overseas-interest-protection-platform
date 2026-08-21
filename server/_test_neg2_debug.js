const gm = require('./globalmedia');
const scrapers = require('./scrapers');

const titles = [
  'Iran says Pakistan-Saudi-Turkiye defence pact not a threat',
  'House of the Dragon Season 3 Finale: Release Time, Where to Watch and What to Expect',
  'Technology can\'t replace some things: Why UP Law bans AI from freshman classes'
];

for (const t of titles) {
  const gate = scrapers.chinaOverseasGate(t);
  console.log('title:', t);
  console.log('  chinaRelated?', gm.chinaFocusGate ? 'n/a' : 'n/a');
  console.log('  gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(t, gate));
}
