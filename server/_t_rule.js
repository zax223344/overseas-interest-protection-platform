const E=require('../entities.js');
const CASES=[
 ["伊朗打击中资企业楼宇致1名工人死亡","An Iranian strike has hit a Chinese firm's building, killing a worker, Kuwait's military says","伊朗"],
 ["巴西将比亚迪列入用工耻辱名单","Brazil puts BYD on list of shame for workers' past slavery-like conditions after rescuing 220 Chinese workers from a construction site","巴西"],
 ["中国工人在境外遭袭受伤","Three Chinese workers were injured when gunmen attacked their convoy near the mine site in Pakistan","巴基斯坦"],
 ["中资矿山尾矿泄漏引发社区抗议","Local community protests after tailings spill at Chinese-owned copper mine causes water pollution","赞比亚"],
 ["匈牙利比亚迪工厂调查","Hungary: Numerous investigations surround the BYD plant in Szeged","匈牙利"],
 ["中性财经报道（应低分）","Chinese company reports quarterly revenue growth in overseas markets",""]
];
CASES.forEach(([n,t,c])=>{
  const r=E.assessRisk({title:t,content:t,country:c,source:'Lemmy · c/World News',platform:'社交媒体',pubDate:new Date().toISOString(),publishedAt:new Date().toISOString()});
  console.log('【'+n+'】 '+r.riskScore+'/'+r.alertLevel);
  console.log('   '+r.rationale.slice(0,190));
});
