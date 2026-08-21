const E = require('../entities.js');
const cases = [
  { title:'Ford to partner with Chinese automaker Geely in Spain in new joint venture',
    content:'Ford said Tuesday it will partner with Chinese automaker Geely to produce electric vehicles at its plant in Valencia, Spain. The deal comes as Ford has cut thousands of jobs in Europe and struggled with slowing EV demand. Workers unions welcomed the investment which they said would secure employment at the plant.' },
  { title:'Bishoftu Airport Bid Selection Delayed As Ethiopian Airlines Awaits USD 9bln Financing',
    content:'Ethiopian Airlines said the selection of a contractor for the new Bishoftu international airport has been delayed as the carrier awaits financing. China Communications Construction Company is among bidders.' },
  { title:'Philippines accuses Chinese coast guard of injuring Filipino sailor in disputed shoal',
    content:'The Philippine military accused the Chinese coast guard of using water cannons against a resupply vessel near Second Thomas Shoal, injuring a Filipino sailor.' }
];
cases.forEach((c,i)=>{
  const r = E.assessRisk({ title:c.title, content:c.content, country:'', source:'apnews.com', pubDate:new Date().toISOString() });
  console.log('=== ['+(i+1)+'] '+c.title.slice(0,70));
  console.log('    风险分='+r.riskScore+' 等级='+r.alertLevel);
  console.log('    命中规则='+JSON.stringify(r.ruleHits));
  console.log('    实体='+JSON.stringify(r.entities));
  console.log('    依据='+(r.rationale||'').slice(0,220));
});
console.log('\nnormalizeCountry 检查: China →', E.normalizeCountry('China'), '| United States →', E.normalizeCountry('United States'), '| Spain →', E.normalizeCountry('Spain'));
