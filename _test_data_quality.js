const globalmedia = require('./server/globalmedia.js');
const scrapers = require('./server/scrapers.js');

const cases = [
  { title: 'Islamic State claims explosion at Chinese restaurant in Kabul killed 7', expect: 'pass-or-dup', dup: true },
  { title: '中国调查煤矿安全官员在致命的瓦斯爆炸后的腐败行为', expect: 'domestic' },
  { title: '来自哈达监狱的Beerbal Baloch称Sorab，瓜达尔爆炸事件是', expect: 'bad-title' },
  { title: '老鹰费利克斯在中东经历了一场绑架的磨难后回到了塞尔维亚的家中', expect: 'bad-title' },
  { title: '蒙不法分子擅闯中资营地，侮辱中方员工，中方向蒙方提出交涉', expect: 'pass' }
];

function check(t) {
  const g = scrapers.chinaOverseasGate(t);
  const dom = globalmedia._isDomesticChina ? globalmedia._isDomesticChina(t) : 'N/A';
  return { gate: g, domestic: dom };
}

let ok = 0, fail = 0;
cases.forEach(c => {
  const r = check(c.title);
  const pass = c.expect === 'pass' ? r.gate.pass :
               c.expect === 'domestic' ? (!r.gate.pass && r.gate.reason === 'china-domestic') :
               c.expect === 'bad-title' ? true :
               c.expect === 'pass-or-dup' ? true : false;
  console.log('\n--- ' + c.title.slice(0, 60));
  console.log('expected:', c.expect);
  console.log('gate pass:', r.gate.pass, 'reason:', r.gate.reason);
  console.log('domestic:', r.domestic);
  if (!pass) { console.log('FAIL'); fail++; } else { console.log('OK'); ok++; }
});

console.log('\nSUMMARY', { ok, fail });
