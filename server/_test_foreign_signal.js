const txt = 'Typhoon Bavi makes landfall in eastern China Typhoon Bavi made landfall late on Saturday in the coastal city of Taizhou in eastern China, where nearly 2 million people were evacuated.';
const words = [
  '国际','世界','全球','海外','境外','国外','外国','外交','外事','出访','访问','峰会','会晤','会谈','合作','援助','援建','投资','贸易','进出口','关税','协定','协议','备忘录','制裁','冲突','战争','政变','骚乱','抗议','示威','罢工','紧张','局势','安全','风险','威胁','警告','批评','指责','谴责','抵制','反华','排华','间谍','渗透','监听','袭击','爆炸','绑架','劫持','伤亡','遇害','遇难','事故','灾难','疫情','撤侨',
  'international','world','global','overseas','abroad','foreign','diplomat','diplomatic','summit','visit','cooperation','aid','investment','trade','tariff','agreement','sanction','conflict','war','coup','riot','protest','demonstration','strike','tension','security','risk','threat','warn','critic','condemn','accuse','blame','boycott','anti-china','anti-chinese','spy','espionage','surveillance','attack','kidnap','blast','explosion','explosive','casualty','casualties','killed','dead','injured','wounded','hostage','accident','disaster','pandemic','epidemic'
];
for (const w of words) {
  const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  if (re.test(txt)) console.log('matched:', w);
}
