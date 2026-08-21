import { query } from './db.js';

const REGION = {
  latam: ['墨西哥','巴西','哥伦比亚','秘鲁','智利','阿根廷','委内瑞拉','厄瓜多尔','玻利维亚','危地马拉','洪都拉斯','萨尔瓦多','尼加拉瓜','哥斯达黎加','巴拿马','古巴','多米尼加','海地','牙买加','乌拉圭','巴拉圭'],
  africa: ['尼日利亚','肯尼亚','埃塞俄比亚','苏丹','马里','尼日尔','刚果','索马里','布基纳法索','喀麦隆','南非','埃及','利比亚','中非','莫桑比克','坦桑尼亚','加纳','科特迪瓦','塞内加尔','几内亚','利比里亚','多哥','贝宁','突尼斯','阿尔及利亚','摩洛哥','南苏丹','卢旺达','乌干达','赞比亚','安哥拉','津巴布韦','马达加斯加','马拉维','纳米比亚','博茨瓦纳','塞拉利昂','毛里塔尼亚'],
  centralasia: ['哈萨克斯坦','乌兹别克斯坦','吉尔吉斯斯坦','塔吉克斯坦','土库曼斯坦','蒙古','格鲁吉亚','亚美尼亚','阿塞拜疆'],
  mideast: ['沙特阿拉伯','阿联酋','卡塔尔','约旦','伊拉克','也门','阿曼','科威特','巴林','黎巴嫩','叙利亚','土耳其','伊朗','以色列','巴勒斯坦'],
  europe: ['法国','德国','英国','波兰','意大利','西班牙','荷兰','比利时','瑞典','挪威','罗马尼亚','捷克','塞尔维亚','匈牙利','希腊','爱尔兰','葡萄牙','奥地利','丹麦','芬兰','乌克兰','俄罗斯','保加利亚','克罗地亚'],
  southasia: ['印度','巴基斯坦','阿富汗','孟加拉国','斯里兰卡','尼泊尔','马尔代夫','不丹']
};
const C2R = {};
for (const r in REGION) REGION[r].forEach(c => C2R[c] = r);

const dayStart = new Date(); dayStart.setHours(0,0,0,0);

// by category
const cat = await query(`SELECT data_type, COUNT(*) n FROM intel_data WHERE collect_time >= $1 GROUP BY 1 ORDER BY 2 DESC`, [dayStart]);
console.log('=== 今日按类别(data_type) ===');
cat.rows.forEach(r => console.log(String(r.data_type).padEnd(22), r.n));

// by country
const cty = await query(`SELECT country, COUNT(*) n FROM intel_data WHERE collect_time >= $1 GROUP BY 1 ORDER BY 2 DESC`, [dayStart]);
console.log('\n=== 今日按国别 TOP ===');
cty.rows.forEach(r => console.log(String(r.country).padEnd(16), r.n));

console.log('\n=== 今日按区域汇总 ===');
const rg = {};
cty.rows.forEach(r => { const k = C2R[r.country] || '其他'; rg[k] = (rg[k]||0) + parseInt(r.n,10); });
Object.keys(rg).sort((a,b)=>rg[b]-rg[a]).forEach(k => console.log(k.padEnd(14), rg[k]));
console.log('其他(未映射)', rg['其他']||0);
console.log('\n总条数(今日):', cty.rows.reduce((s,r)=>s+parseInt(r.n,10),0));
process.exit(0);
