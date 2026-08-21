// 验证闸门 + 分发器核心逻辑（Node 端，entities/gate 支持 module.exports）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const GATE = require('../gate.js');
const ENTITY = require('../entities.js');
let pass=0, fail=0;
function chk(name, cond){ if(cond){pass++;console.log('  ✓ '+name);}else{fail++;console.log('  ✗ '+name);} }

// 闸门：相关性
const g1 = GATE.chinaOverseasGate('巴基斯坦瓜达尔港附近中方人员遭武装袭击');
chk('相关性闸门: 涉华海外袭击 PASS', g1.pass===true);
const g2 = GATE.chinaOverseasGate('我市召开民生保障工作会议部署供暖');
chk('相关性闸门: 纯国内民生 FILTER', g2.pass===false);

// 体裁闸门：评论/榜单
chk('体裁闸门: 意识形态评论 拦截', ENTITY.nonIntelGenre({title:'中国社会主义道路上的坎坷我们该不该讨论？',content:''})==='commentary-piece');
chk('体裁闸门: 商业榜单 拦截', ENTITY.nonIntelGenre({title:'2025中国企业500强出炉 入围门槛479.6亿元',content:''})==='ranking-list');
chk('体裁闸门: 真实安全情报 放行', ENTITY.nonIntelGenre({title:'中资企业刚果金矿区遭武装袭击',content:'造成人员伤亡'})==='');

// enrich: interestLinked
const e1 = ENTITY.enrich({title:'紫金矿业刚果(金)铜矿附近发生武装冲突',content:'M23武装推进',country:'刚果(金)'});
chk('enrich: 中资矿区冲突 interestLinked=true', e1.interestLinked===true);
const e2 = ENTITY.enrich({title:'2025中国企业500强 入围门槛479.6亿元',content:'营收总和'});
chk('enrich: 商业榜单 interestLinked=false', e2.interestLinked!==true);

console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
process.exit(fail?1:0);
