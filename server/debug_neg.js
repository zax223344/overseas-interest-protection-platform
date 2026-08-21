const crawler = require('./crawler');
const gm = require('./globalmedia');
const scrapers = require('./scrapers');

const gdeltQueries = [
  '(China OR Chinese OR Beijing) (sanction OR boycott OR ban OR restriction OR tariff)',
  '(China OR Chinese) (attack OR protest OR raid OR violence OR kidnapped OR killed)',
  '(BRI OR "Belt and Road") (backlash OR protest OR debt OR risk OR delay)'
];

async function main() {
  let total = 0;
  for (const q of gdeltQueries) {
    try {
      const arts = await crawler.gdeltSearch(q, { timespan: '2d', maxrecords: 25 });
      console.log('\nQuery:', q, '=>', arts.length, 'arts');
      for (const a of arts || []) {
        const txt = a.title || '';
        const rel = gm.gateRelevant(txt);
        const gate = scrapers.chinaOverseasGate(txt);
        const neg = /\b(sanction|embargo|boycott|ban|restriction|crackdown|probe|investigation|fine|seizure|freeze|penalty|lawsuit|arbitration|claim|withdraw|pull\s*out|terminate|cancel|suspend|delay|postpone|default|loss|layoff|bankruptcy|attack|terrorist|kidnap|blast|shooting|violence|killed|casualt|conflict|war|coup|riot|protest|demonstration|strike|xenophobia|anti-china|anti-chinese|spy|espionage|surveillance|security\s*threat|cyber\s*threat|data\s*breach|military\s*threat|threat|criticize|criticism|condemn|accuse|blame|warn|confrontation|friction|dispute|divergence|tension|crisis|deteriorate|downgrade|expel|detain|sink|intercept|ram|crash|accident|disaster|fire|collapse|leak|pollution|poisoning|pandemic|epidemic|earthquake|flood|typhoon|hurricane)\b|制裁|抵制|禁运|封锁|限制|打压|审查|调查|罚款|扣押|查封|冻结|处罚|起诉|诉讼|仲裁|索赔|撤资|退出|终止|取消|暂停|推迟|搁置|违约|亏损|裁员|倒闭|破产|袭击|恐袭|绑架|爆炸|枪击|暴力|遇害|遇难|伤亡|死伤|冲突|战争|政变|骚乱|抗议|示威|罢工|游行|抵制|排斥|仇外|反华|排华|歧视|辱华|间谍|渗透|监听|安全威胁|网络安全|数据安全|军事威胁|威胁|批评|指责|谴责|警告|对抗/i.test(txt);
        if (gate.pass && neg) {
          console.log('  HIT:', txt);
          total++;
        }
      }
    } catch (e) { console.log('ERR', q, e.message); }
  }
  console.log('\nTotal HIT:', total);
}
main();
