const gm = require('./globalmedia');
const scrapers = require('./scrapers');

const cases = [
  { title: 'Iran says Pakistan-Saudi-Turkiye defence pact not a threat', content: 'Speaking at a media briefing, Baghaei said the United States was responsible for insecurity in the Middle East.' },
  { title: 'House of the Dragon Season 3 Finale: Release Time, Where to Watch and What to Expect', content: 'House of the Dragon Season 3 reaches its finale on Sunday, August 9, with Episode 8 set to bring another major chapter of the Targaryen civil war to a close.' }
];

for (const c of cases) {
  const txt = c.title + ' ' + c.content;
  const gate = scrapers.chinaOverseasGate(txt);
  console.log('title:', c.title);
  console.log('  txt chinaRelated?', /中国|Chinese|China|Beijing|Shanghai|中资|中企|中方|华人|华侨|华裔|一带一路|Hong Kong|Taiwan|Macau|RMB|Yuan|BRI|Belt and Road|Xi Jinping|对华|涉华/i.test(txt));
  console.log('  negKw?', gm._CHINA_NEGATIVE_KW_RE.test(txt));
  console.log('  gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(txt, gate));
}
