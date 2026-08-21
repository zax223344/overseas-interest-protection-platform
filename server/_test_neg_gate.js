const gm = require('./globalmedia');
const scrapers = require('./scrapers');

const _CHINA_RELATED_RE = /中国|Chinese|China|Beijing|Shanghai|中资|中企|中方|华人|华侨|华裔|一带一路|Hong Kong|Taiwan|Macau|RMB|Yuan|BRI|Belt and Road|Xi Jinping|对华|涉华/i;

const titles = [
  'Iran says Pakistan-Saudi-Turkiye defence pact not a threat',
  'House of the Dragon Season 3 Finale: Release Time, Where to Watch and What to Expect',
  'Technology can\'t replace some things: Why UP Law bans AI from freshman classes',
  'China Warns UNSC That ISIS-K in Afghanistan Remains Regional Security Threat',
  'Typhoon Dolphin strikes eastern China, forces evacuation of over a million people'
];

for (const t of titles) {
  const gate = scrapers.chinaOverseasGate(t);
  console.log('title:', t);
  console.log('  chinaRelated?', _CHINA_RELATED_RE.test(t));
  console.log('  negKw?', gm._CHINA_NEGATIVE_KW_RE.test(t));
  console.log('  foreignOrIntl?', gm._FOREIGN_OR_INTL_RE ? gm._FOREIGN_OR_INTL_RE.test(t) : 'n/a');
  console.log('  strategicNeg?', gm._STRATEGIC_NEGATIVE_RE ? gm._STRATEGIC_NEGATIVE_RE.test(t) : 'n/a');
  console.log('  gate:', gate.pass, gate.reason, 'negGate:', gm.chinaNegativeGate(t, gate));
}
