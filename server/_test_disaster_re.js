const titles = [
  'China Warns UNSC That ISIS-K in Afghanistan Remains Regional Security Threat',
  'Tourists evacuated from China\'s Jiuzhaigou World Heritage site after mudslides, heavy rain',
  'China evacuates 340,000 people as Typhoon Noul approaches',
  'Southwest China landslide kills 8, leaves at least 34 missing',
  'Typhoon Bavi makes landfall in eastern China'
];

const _DOMESTIC_CHINA_DISASTER_RE = /\b(China|Chinese)\b.*\b(eastern China|western China|southern China|northern China|central China|southwest China|southeast China|northeast China|northwest China|mainland China|Guangdong|Guangxi|Fujian|Zhejiang|Jiangsu|Shandong|Liaoning|Hebei|Henan|Hubei|Hunan|Jiangxi|Anhui|Sichuan|Yunnan|Guizhou|Gansu|Shaanxi|Shanxi|Hainan|Taiwan|Hong Kong|Macau|Beijing|Shanghai|Tianjin|Chongqing|Shenzhen|Chengdu|Wuhan|Xi'an|Hangzhou|Nanjing|Qingdao|Dalian|Xiamen|Suzhou|Zhengzhou|Changsha)\b.*\b(typhoon|mudslide|landslide|flood|flooding|earthquake|tsunami|hurricane|drought|wildfire|blizzard|avalanche|tornado)\b|\b(台风|泥石流|滑坡|洪水|地震|海啸|飓风|干旱|山火|暴风雪|雪崩|龙卷风)\b.*\b(中国|广东|广西|福建|浙江|江苏|山东|辽宁|河北|河南|湖北|湖南|江西|安徽|四川|云南|贵州|甘肃|陕西|山西|海南|台湾|香港|澳门|北京|上海|天津|重庆|深圳|成都|武汉|西安|杭州|南京|青岛|大连|厦门|苏州|郑州|长沙)\b/i;

for (const t of titles) {
  console.log(t, '=>', _DOMESTIC_CHINA_DISASTER_RE.test(t));
}
