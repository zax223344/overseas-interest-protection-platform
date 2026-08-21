const s = require('./scrapers.js');
const CASES = [
  ['上海餐厅持刀伤人事件致2名日本公民和1名中国公民受伤', false, '境内治安事件（含外国国名，但事发地在境内）'],
  ['Shanghai restaurant knife attack injures 2 Japanese citizens and a Chinese national', false, '同上英文'],
  ['北京谴责巴基斯坦达苏水电站袭击事件 致9名中国工程师遇难', true, '外交表态+境外袭击我人员（含"北京"但有强信号）'],
  ['阿富汗承诺就致3名中国工人在塔吉克斯坦遇难的跨境袭击展开合作', true, '境外袭击我公民'],
  ['中资企业在尼日利亚的矿山遭武装抢劫 3名中方人员被绑架', true, '中资企业境外遇袭'],
  ['广东启动防台风Ⅳ级应急响应', false, '纯国内灾害'],
  ['中国驻南非使馆提醒在南中国公民注意安全', true, '使馆领保'],
  ['Chinese-owned copper mine in Zambia halts operations after protests', true, '中资矿山境外停产'],
  ['Congo Ebola response limited by attacks on health workers', false, '与我海外利益无关外讯'],
  ['深圳一工厂发生火灾 无人员伤亡', false, '境内事故'],
  ['中欧班列（重庆）新增至德国杜伊斯堡线路', true, '含"重庆"但属一带一路强信号'],
  ['上海合作组织峰会讨论中亚安全合作与中资项目保护', true, '含"上海"但属境外机制与中资保护']
];
let ok=0;
CASES.forEach(([t,expect,note])=>{
  const r = s.chinaOverseasGate(t);
  const pass = !!r.pass;
  const good = pass===expect;
  if(good) ok++;
  console.log((good?'✔':'✘')+' 期望'+(expect?'放行':'拦截')+' 实际'+(pass?'放行':'拦截')+'['+r.reason+'] | '+t.slice(0,44)+'  ← '+note);
});
console.log('\n通过 '+ok+'/'+CASES.length);
