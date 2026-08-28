// Test updated _eventKeyFuzzy behavior
const COUNTRIES=[{name:'俄罗斯'},{name:'中国'},{name:'尼泊尔'},{name:'美国'},{name:'巴基斯坦'}];
function _eventKeyFuzzy(a){
  try{
    var title=String(a.title_zh||a.title||'');
    var country=String(a.country||'');
    function _mainEventCountry(t){
      if(!t) return '';
      var m=t.match(/(?:在|于)([^，。；,;]{1,12}?(?:国|地区|省|州|市|港|机场|边境|海域|海峡))/);
      if(m){
        var loc=m[1].replace(/(?:的|地区|省|州|市|港|机场|边境|海域|海峡)$/,'').trim();
        if(loc && loc!=='中国' && loc!=='China') return loc;
      }
      m=t.match(/([^，。；,;]{1,10}?(?:国|地区))(?:发生|爆发|肆虐|袭击|遭袭|境内|附近)/);
      if(m){
        var loc=m[1].replace(/(?:的|地区)$/,'').trim();
        if(loc && loc!=='中国' && loc!=='China') return loc;
      }
      m=t.match(/(?:^|[\s\-–—])([^\s\-–—和与]{2,10})(?:和|与|-|–|—)([^\s\-–—和与]{2,10})/);
      if(m) return m[2].trim();
      if(COUNTRIES.length){
        for(var i=0;i<COUNTRIES.length;i++){
          var cn=COUNTRIES[i].name;
          if(!cn || cn==='中国' || cn==='China') continue;
          if(t.indexOf(cn)>=0) return cn;
        }
      }
      return '';
    }
    var extracted=_mainEventCountry(title);
    if(extracted) country=extracted;
    else if(!country && COUNTRIES.length){
      for(var i=0;i<COUNTRIES.length;i++){ if(title.indexOf(COUNTRIES[i].name)>=0){ country=COUNTRIES[i].name; break; } }
    }
    title=title.replace(/\s*[-—–]\s*[^，。；;]+$/,'').replace(/\d+/g,'').replace(/[０-９]+/g,'');
    var norm=title
      .replace(/液化天然气厂|LNG厂|LNG综合体|液化天然气综合体|天然气厂|天然气工厂|天然气综合体|天然气化工厂|天然气化工综合体|煤气厂|石化厂|石油化工|炼油厂|石油厂|油田|气田|化工园区|工业园区|工业综合体|发电厂|电站|火电站|水电站|核电站|制造厂|生产基地|工业基地|产业园|产业区/g,'能源设施')
      .replace(/综合体|工厂|厂房|厂区|车间|仓库|基地|设施/g,'能源设施')
      .replace(/工人|员工|公民|人员|民众|群众|雇员|职员|务工者|劳务人员/g,'人')
      .replace(/死亡|遇难|丧生|遇害|罹难|身亡|死者|遇难者|受害者|丧命/g,'亡')
      .replace(/失踪|失联|下落不明|不知所踪/g,'踪')
      .replace(/发生火灾|起火|着火|大火|火灾事故|火情|失火/g,'火灾')
      .replace(/中国|中方|华人|华侨|华裔|中企|中资|中国大陆/g,'中');
    for(var i=0;i<COUNTRIES.length;i++){
      var cn=COUNTRIES[i].name;
      if(!cn || cn.length<2) continue;
      norm=norm.split(cn).join('国');
    }
    norm=norm.replace(/[\s\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\u3000-\u303F\uFF00-\uFFEF]/g,'');
    var ent=norm.match(/(能源设施|化工厂|矿区|营地|港口|机场|车站|铁路|边境|首都|海域|海峡|设施|法院|司法机关|贸易|经济|市场|货币|汇率|银行|金融|关税|制裁|冲突|战争|无人机|导弹|战机|军舰|潜艇|航母|坦克|装甲车|火炮|火箭弹|地雷|爆炸物)/);
    var inc=norm.match(/(火灾|爆炸|袭击|绑架|劫持|枪击|坠机|沉船|地震|洪水|山洪|制裁|冲突|战争|事故|坠毁|沉没|抗议|骚乱|罢工|政变|恐袭|空袭|交火|扣押|逮捕|审判|选举|公投|签约|谈判|协议|条约|关税|贸易战|禁运|封锁|入侵|占领|撤退|停火|维和|救援|疏散|撤离|遣返|驱逐|引渡|通缉|追捕|伏击|屠杀|人道主义危机|难民|饥荒|干旱|飓风|台风|龙卷风|海啸|火山|泥石流|雪崩|山火|森林火灾|化学泄漏|核泄漏|辐射|污染|中毒|传染病|疫情|网络攻击|黑客|勒索|数据泄露|间谍|监控|审查|宣传|欺诈|诈骗|洗钱|腐败|贿赂|走私|贩毒|武器|弹药|导弹|无人机)/);
    var vic=/(中|Chinese|China)/i.test(norm)?'中':'';
    if(country && ent && inc) return country+'|'+ent[1]+'|'+inc[1]+'|'+vic;
    if(country && inc) return country+'|'+inc[1]+'|'+vic;
    var clean=norm.replace(/[^一-龥a-z]/gi,'');
    var sorted=clean.split('').sort().join('');
    var fallback=(country||'')+'|'+sorted.slice(0,14);
    return fallback;
  }catch(e){ return 'error|'+String(a.title||'').slice(0,20); }
}
const samples=[
  // Russia gas factory - same event, different titles
  {title_zh:'俄罗斯天然气厂火灾造成7人死亡，其中6名中国公民',country:'俄罗斯'},
  {title_zh:'七人死亡，其中包括六名中国公民，九人在俄罗斯天然气厂火灾中失踪-路透社',country:'俄罗斯'},
  {title_zh:'俄罗斯天然气化工厂发生火灾，7人死亡，9名中国工人失踪',country:'俄罗斯'},
  // Same but with wrong country field (victim nationality)
  {title_zh:'俄罗斯天然气厂火灾造成7人死亡，其中6名中国公民',country:'中国'},
  {title_zh:'七人死亡，其中包括六名中国公民，九人在俄罗斯天然气厂火灾中失踪-路透社',country:'中国'},
  // Nepal earthquake
  {title_zh:'尼泊尔发生地震造成中国公民受伤',country:'尼泊尔'},
  {title_zh:'中国公民在尼泊尔地震中受伤',country:'尼泊尔'},
  {title_zh:'尼泊尔地震致中国公民受伤',country:'尼泊尔'},
  // Nepal with wrong country
  {title_zh:'尼泊尔发生地震造成中国公民受伤',country:'中国'},
  // Different Russia event (should NOT dedup with fire)
  {title_zh:'俄罗斯无人机袭击乌克兰边境，无中方人员伤亡',country:'俄罗斯'},
];
const keys={};
for(const a of samples){
  const k=_eventKeyFuzzy(a);
  keys[k]=(keys[k]||0)+1;
  console.log(a.title_zh.slice(0,40), 'country='+a.country, '=>', k);
}
console.log('\nKey counts:');
for(const [k,v] of Object.entries(keys)) console.log(v, k);
