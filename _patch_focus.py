# -*- coding: utf-8 -*-
# renderIntelPanels → 全球态势焦点面板（态势总览定位：态势怎么样/哪里升温/最该盯什么）
import io
p = 'app.js'
s = io.open(p, encoding='utf-8').read()

lines = s.split('\n')
# 7450 行起（索引 7449）到 7715 行（索引 7714，renderTicker 前一行）
start = None
end = None
for i, l in enumerate(lines):
    if l.strip() == 'renderIntelPanels(){':
        start = i
    if start is not None and l.strip() == 'renderTicker(){':
        end = i
        break
print('replace range:', start + 1, '-', end)
assert start is not None and end is not None

new_fn = '''  /* ===== 全球态势焦点面板（2026-08-18 用户指令：态势总览要体现"态势"——
   * ① 今日态势总温（预警分级/涉华/升温国数）② 升温国家 TOP5（八维推演引擎实算）
   * ③ 高价值预警 TOP4（价值分引擎实算）。信息流由底部滚动条承担。 */
  renderIntelPanels(){
    var liveEl=document.getElementById('globe-intel-live');
    if(!liveEl) return;
    /* --- 数据准备 --- */
    var red=0,orange=0,yellow=0,cnN=0;
    try{
      (ALERTS||[]).forEach(function(a){
        if(a.level==='red')red++; else if(a.level==='orange')orange++; else if(a.level==='yellow')yellow++;
        if(/中国|中资|中企|中方|华人|一带一路|涉华|Chinese|China|CPEC/i.test((a.title||'')+(a.title_zh||'')))cnN++;
      });
    }catch(e){}
    var focus=[], watchN=0;
    try{
      if(typeof FORESEE!=='undefined'){
        var d=FORESEE.compute();
        focus=d.high.concat(d.watch).slice(0,5);
        watchN=d.high.length+d.watch.length;
      }
    }catch(e){}
    var topAlerts=[];
    try{
      topAlerts=(ALERTS||[]).slice().sort(function(a,b){
        return (typeof AVIEW!=='undefined'?AVIEW._alertValue(b).score:0)-(typeof AVIEW!=='undefined'?AVIEW._alertValue(a).score:0);
      }).slice(0,4);
    }catch(e){}
    var now=new Date();
    var hh=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    /* --- 渲染 --- */
    var h='<div class="panel-tt" style="cursor:grab"><span class="panel-drag-handle">\\u283F</span>'+
      '<span class="live-tt">\\uD83C\\uDFAF 全球态势焦点</span>'+
      '<span class="live-count">'+hh+'</span>'+
      '<span class="panel-toggle" title="折叠/展开">−</span></div>';
    h+='<div class="panel-body">';
    /* 今日态势总温 */
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px;margin-bottom:8px;padding:6px 8px;background:var(--bg2);border-radius:6px">'+
      '<span>🔴<b style="color:var(--red)">'+red+'</b></span>'+
      '<span>🟠<b style="color:var(--orange)">'+orange+'</b></span>'+
      '<span>🟡<b style="color:var(--yellow)">'+yellow+'</b></span>'+
      '<span style="color:var(--text3)">|</span>'+
      '<span>🇨🇳涉华 <b style="color:var(--cyan)">'+cnN+'</b></span>'+
      '<span>📈升温 <b style="color:var(--red)">'+watchN+'</b>国</span></div>';
    /* 升温国家 TOP5 */
    h+='<div style="font-size:10px;font-weight:700;color:var(--orange);margin-bottom:4px">🔺 风险升温国家</div>';
    if(focus.length){
      focus.forEach(function(r){
        var deltaTxt=r.delta>0?('↑+'+r.delta):(r.delta<0?('↓'+r.delta):'→');
        var dCol=r.delta>0?'var(--red)':r.delta<0?'var(--green)':'var(--text3)';
        h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;font-size:10px" onclick="showCtyDetail(\\''+r.name+'\\')">'+
          '<span>'+r.flag+'</span><b style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+r.name+'</b>'+
          '<span style="color:'+(r.pred>=8.5?'var(--red)':r.pred>=7?'var(--orange)':'var(--yellow)')+';font-weight:800">'+r.pred+'</span>'+
          '<span style="color:'+dCol+';font-size:9px">'+deltaTxt+'</span>'+
          '<span style="color:var(--text3);font-size:9px;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="主导维度">'+(r.domDim||'')+'</span></div>';
      });
    }else{
      h+='<div style="padding:6px;font-size:10px;color:var(--text3)">当前无重点升温国家——全域平稳</div>';
    }
    /* 高价值预警 TOP4 */
    h+='<div style="font-size:10px;font-weight:700;color:var(--red);margin:8px 0 4px">🎯 最高价值预警</div>';
    if(topAlerts.length){
      topAlerts.forEach(function(a){
        var lv=ALERT_LV[a.level]||{label:a.level,cls:'b-blue'};
        var sc=typeof AVIEW!=='undefined'?AVIEW._alertValue(a).score:0;
        h+='<div style="padding:4px 2px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer" onclick="navigateTo(\\'alerts\\');setTimeout(function(){AVIEW.selectAlert(\\''+String(a.id).replace(/'/g,"")+'\\');},300)">'+
          '<div style="display:flex;gap:4px;align-items:center;font-size:10px">'+
          '<span class="badge '+lv.cls+'" style="font-size:8px;padding:0 3px">'+lv.label+'</span>'+
          '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600">'+String(a.title_zh||a.title||'').slice(0,22)+'</span>'+
          '<span style="color:'+(sc>=70?'var(--red)':sc>=45?'var(--orange)':'var(--text3)')+';font-weight:800;font-size:9px">◆'+sc+'</span></div>'+
          '<div style="font-size:9px;color:var(--text3);margin-top:1px">📍'+(a.country||'-')+' · 🕐'+String(a.time||'').slice(5,16)+'</div></div>';
      });
    }else{
      h+='<div style="padding:6px;font-size:10px;color:var(--text3)">今日暂无高价值预警</div>';
    }
    h+='</div>';
    liveEl.innerHTML=h;
    /* 折叠/关闭行为与原版一致（委托给通用面板逻辑） */
    try{
      var tog=liveEl.querySelector('.panel-toggle');
      if(tog && !tog._bound){ tog._bound=1; tog.addEventListener('click',function(ev){ ev.stopPropagation(); liveEl.classList.toggle('collapsed'); tog.textContent=liveEl.classList.contains('collapsed')?'+':'−'; }); }
    }catch(e){}
  },

'''
lines = lines[:start] + new_fn.split('\n') + lines[end:]
s = '\n'.join(lines)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
