const GATE = require('../gate.js');
const text = '刚果（金）上加丹加省发生严重治安事件 多名中国公民被武装人员带走';
const r = GATE.chinaOverseasGate(text);
console.log(r);
