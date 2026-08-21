const scrapers = require('./scrapers');
const txt = 'China blocks exports of helium, key for chipmaking, as Iran war squeezes supply';
const gate = scrapers.chinaOverseasGate(txt);
console.log('gate:', gate);
