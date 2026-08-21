const gm = require('./globalmedia');
const scrapers = require('./scrapers');

const txt = 'Typhoon Bavi makes landfall in eastern China Typhoon Bavi made landfall late on Saturday in the coastal city of Taizhou in eastern China, where nearly 2 million people were evacuated.';
const gate = scrapers.chinaOverseasGate(txt);

console.log('gate:', gate);
console.log('chinaRelated?', gm._CHINA_RELATED_RE ? 'not exported' : 'not exported');
console.log('negKw?', gm._CHINA_NEGATIVE_KW_RE.test(txt));
console.log('strongOverseas?', /中资|中企|华人|华侨|侨胞|使馆|领事馆|领事|撤侨|一带一路|海外项目|境外投资|外派|援外|Chinese company|Chinese embassy|Chinese consulate|Belt and Road|overseas Chinese|Chinese workers|Chinese nationals/i.test(txt));
console.log('foreignSignal?', /\b(国际|世界|全球|海外|境外|国外|外国|外交|外事|出访|访问|峰会|会晤|会谈|合作|援助|援建|投资|贸易|进出口|关税|协定|协议|备忘录|制裁|冲突|战争|政变|骚乱|抗议|示威|罢工|紧张|局势|安全|风险|威胁|警告|批评|指责|谴责|抵制|反华|排华|间谍|渗透|监听|袭击|爆炸|绑架|劫持|伤亡|遇害|遇难|事故|灾难|疫情|地震|洪水|台风|飓风|撤侨|international|world|global|overseas|abroad|foreign|diplomat|diplomatic|summit|visit|cooperation|aid|investment|trade|tariff|agreement|sanction|conflict|war|coup|riot|protest|demonstration|strike|tension|security|risk|threat|warn|critic|condemn|accuse|blame|boycott|anti-china|anti-chinese|spy|espionage|surveillance|attack|kidnap|blast|explosion|explosive|casualty|casualties|killed|dead|injured|wounded|hostage|accident|disaster|pandemic|epidemic|earthquake|flood|typhoon|hurricane)\b/i.test(txt));
console.log('strategicNeg?', /\b(sanction|ban|restriction|export control|embargo|tariff|trade war|boycott|blacklist|dual-use|forced labor|human rights abuses|genocide|espionage|spy|cyberattack|hack|theft of intellectual property|IP theft|technology theft|military aid|arms sales|missile|drone|warship|warplane|conflict zone|war zone|combat|airstrike|bombing|shelling|blockade|closure|strait|chokepoint|supply chain disruption|critical mineral|rare earth|lithium|cobalt|copper|oil|gas|energy security|nuclear)\b|\b(制裁|禁运|出口管制|限制|禁令|关税|贸易战|抵制|封锁|断供|扣押|冻结资产|间谍|网络攻击|黑客|知识产权盗窃|军售|武器|导弹|无人机|军舰|战机|冲突|空袭|轰炸|封锁|海峡|咽喉要道|供应链中断|关键矿产|稀土|锂|钴|铜|石油|天然气|能源安全|核)\b/i.test(txt));
console.log('domesticDisaster?', /\b(China|Chinese|中国)\b.*\b(typhoon|mudslide|landslide|flood|flooding|earthquake|tsunami|hurricane|drought|wildfire|blizzard|avalanche|tornado|evacuat)\b|\b(typhoon|mudslide|landslide|flood|flooding|earthquake|tsunami|hurricane|drought|wildfire|blizzard|avalanche|tornado|evacuat)\b.*\b(China|Chinese|中国)\b|\b(台风|泥石流|滑坡|洪水|地震|海啸|飓风|干旱|山火|暴风雪|雪崩|龙卷风|撤离)\b/i.test(txt));
console.log('negGate:', gm.chinaNegativeGate(txt, gate));
