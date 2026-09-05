/* ============================================================
 * strat-viz.js v1.0 — 战略咽喉 / 一带一路 沉浸式态势可视化
 * 真实大陆轮廓（countries-110m.json + d3 Natural Earth 投影）
 * 动效：雷达脉冲环 / 航线流光 / 走廊巡航光点 / 扫描线 / 发光终端
 * 数据全部来自 CHOKEPOINTS / CORRIDORS 实战库，点击穿透到既有详情。
 * ============================================================ */
(function () {
  'use strict';

  var W = 1200, H = 600;
  var _worldPromise = null;

  /* 战略咽喉坐标（与 MONITOR 内一致的真实坐标） */
  var CHK_COORDS = {
    '红海-曼德海峡': { lat: 12.6, lon: 43.4 },
    '苏伊士运河': { lat: 30.0, lon: 32.5 },
    '马六甲海峡': { lat: 2.5, lon: 101.0 },
    '霍尔木兹海峡': { lat: 26.5, lon: 56.5 },
    '巴拿马运河': { lat: 9.0, lon: -80.0 },
    '北极航道': { lat: 75.0, lon: 60.0 }
  };

  /* 全球主干航线（示意，串联真实咽喉点，仅作态势示意） */
  var LANES = [
    { name: '太平洋-印度洋-欧洲干线', pts: [[101.0, 2.5], [80, 5], [60, 12], [43.4, 12.6], [32.5, 30.0], [14, 36], [-6, 36]] },
    { name: '波斯湾石油线', pts: [[56.5, 26.5], [52, 20], [46, 14], [43.4, 12.6]] },
    { name: '美洲-欧洲干线', pts: [[-80, 9.0], [-70, 22], [-45, 32], [-20, 36], [-6, 36]] },
    { name: '北极航道', pts: [[60, 75], [100, 74], [140, 72], [170, 66], [-160, 64]] }
  ];

  /* 一带一路走廊路径（与 MONITOR.renderCorridors 同源，[lon,lat] 真实航点） */
  var COR_ROUTES = [
    [[116, 40], [90, 30], [74, 31]],
    [[116, 40], [105, 25], [96, 21]],
    [[116, 40], [80, 45], [67, 40], [64, 41]],
    [[116, 40], [105, 25], [102, 19]],
    [[107, -6], [109, -7]],
    [[23, 38], [21, 44]]
  ];

  function riskColor(r) { return r >= 8 ? '#ff3355' : r >= 6 ? '#ff8800' : r >= 4 ? '#ffcc00' : '#00ff9f'; }
  function corColor(r) { return r >= 7 ? '#ff3355' : r >= 5 ? '#ff8800' : r >= 3 ? '#ffcc00' : '#00ff9f'; }

  function loadWorld() {
    if (_worldPromise) return _worldPromise;
    _worldPromise = new Promise(function (resolve, reject) {
      if (typeof d3 === 'undefined' || typeof topojson === 'undefined') { reject(new Error('d3/topojson 未加载')); return; }
      d3.json('countries-110m.json').then(function (world) {
        resolve({
          land: topojson.feature(world, world.objects.countries),
          borders: topojson.mesh(world, world.objects.countries, function (a, b) { return a !== b; })
        });
      }).catch(reject);
    });
    return _worldPromise;
  }

  function baseSvg(id) {
    return '<svg id="' + id + '" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;min-height:340px">' +
      '<defs>' +
      '<radialGradient id="sv-ocean" cx="50%" cy="42%" r="75%">' +
      '<stop offset="0%" stop-color="#0b1e33"/><stop offset="60%" stop-color="#081527"/><stop offset="100%" stop-color="#050b16"/></radialGradient>' +
      '<filter id="sv-glow" x="-80%" y="-80%" width="260%" height="260%">' +
      '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<linearGradient id="sv-scan" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="rgba(0,212,255,0)"/><stop offset="50%" stop-color="rgba(0,212,255,0.16)"/><stop offset="100%" stop-color="rgba(0,212,255,0)"/></linearGradient>' +
      '</defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="url(#sv-ocean)"/>' +
      '<g class="sv-grat"></g><g class="sv-land"></g><g class="sv-border"></g>' +
      '<g class="sv-lanes"></g><g class="sv-marks"></g><g class="sv-labels"></g>' +
      '<rect class="sv-scanline" x="-140" y="0" width="140" height="' + H + '" fill="url(#sv-scan)">' +
      '<animate attributeName="x" values="-140;' + W + '" dur="9s" repeatCount="indefinite"/></rect>' +
      '</svg>';
  }

  function drawBase(svgEl, fitFeature) {
    var proj = d3.geoNaturalEarth1().fitExtent([[12, 12], [W - 12, H - 12]], fitFeature || { type: 'Sphere' });
    var path = d3.geoPath(proj);
    var svg = d3.select(svgEl);
    svg.select('.sv-grat').append('path')
      .attr('d', path(d3.geoGraticule10()))
      .attr('fill', 'none').attr('stroke', 'rgba(0,212,255,0.06)').attr('stroke-width', 0.5);
    return loadWorld().then(function (w) {
      svg.select('.sv-land').append('path')
        .attr('d', path(w.land))
        .attr('fill', '#16263d').attr('stroke', 'none');
      svg.select('.sv-border').append('path')
        .attr('d', path(w.borders))
        .attr('fill', 'none').attr('stroke', 'rgba(0,212,255,0.16)').attr('stroke-width', 0.45);
      return { proj: proj, path: path };
    });
  }

  /* 平滑弧线路径（真实航点 + d3 curveBasis），返回 path d 串 */
  function smoothPath(proj, lonLats) {
    var pts = lonLats.map(function (p) { return proj(p); });
    var line = d3.line().x(function (p) { return p[0]; }).y(function (p) { return p[1]; }).curve(d3.curveBasis);
    return { d: line(pts), pts: pts };
  }

  function pulseRing(x, y, color, maxR, dur, delay) {
    return '<circle cx="' + x + '" cy="' + y + '" r="4" fill="none" stroke="' + color + '" stroke-width="1.2">' +
      '<animate attributeName="r" values="4;' + maxR + '" dur="' + dur + 's" begin="' + delay + 's" repeatCount="indefinite"/>' +
      '<animate attributeName="opacity" values="0.85;0" dur="' + dur + 's" begin="' + delay + 's" repeatCount="indefinite"/></circle>';
  }

  /* ============ 战略咽喉 ============ */
  function renderChokeMap(container, onPick) {
    container.innerHTML = baseSvg('sv-chk-map');
    var svgEl = container.querySelector('svg');
    drawBase(svgEl).then(function (ctx) {
      var proj = ctx.proj;
      var svg = d3.select(svgEl);
      /* 主干航线：流光虚线 + 巡航光点 */
      var lanesG = svg.select('.sv-lanes');
      LANES.forEach(function (lane, li) {
        var sp = smoothPath(proj, lane.pts.map(function (p) { return [p[0], p[1]]; }));
        var pid = 'sv-lane-' + li;
        lanesG.append('path').attr('id', pid).attr('d', sp.d)
          .attr('fill', 'none').attr('stroke', 'rgba(0,212,255,0.30)').attr('stroke-width', 1.4)
          .attr('stroke-dasharray', '10 8')
          .append('animate').attr('attributeName', 'stroke-dashoffset')
          .attr('values', '0;-36').attr('dur', '2.2s').attr('repeatCount', 'indefinite');
        /* 巡航光点（示意航运动态） */
        [0, 1].forEach(function (k) {
          lanesG.append('circle').attr('r', 2.6).attr('fill', '#7fe7ff').attr('filter', 'url(#sv-glow)')
            .append('animateMotion').attr('dur', (10 + li * 2.5) + 's').attr('begin', (k * 5 + li) + 's')
            .attr('repeatCount', 'indefinite')
            .append('mpath').attr('href', '#' + pid);
        });
      });
      /* 咽喉点：雷达脉冲 + 菱形 + 标签 */
      var marksG = svg.select('.sv-marks'), labelsG = svg.select('.sv-labels');
      CHOKEPOINTS.forEach(function (c, i) {
        var co = CHK_COORDS[c.name];
        if (!co) return;
        var xy = proj([co.lon, co.lat]);
        var x = xy[0], y = xy[1];
        var col = riskColor(c.risk);
        var g = marksG.append('g').style('cursor', 'pointer')
          .on('click', function () { onPick(i); });
        g.node().insertAdjacentHTML('beforeend',
          pulseRing(x, y, col, 26, 2.4, 0) + pulseRing(x, y, col, 26, 2.4, 1.2) +
          '<rect x="' + (x - 6) + '" y="' + (y - 6) + '" width="12" height="12" transform="rotate(45 ' + x + ' ' + y + ')" ' +
          'fill="' + col + '" fill-opacity="0.9" stroke="#04070e" stroke-width="1" filter="url(#sv-glow)"/>' +
          '<title>' + c.name + ' | 风险 ' + c.risk + '</title>');
        /* 命中热区放大 */
        g.append('circle').attr('cx', x).attr('cy', y).attr('r', 18).attr('fill', 'transparent');
        var anchorLeft = x > W - 200;
        labelsG.append('text')
          .attr('x', anchorLeft ? x - 14 : x + 14).attr('y', y + 4)
          .attr('text-anchor', anchorLeft ? 'end' : 'start')
          .attr('fill', col).attr('font-size', 12).attr('font-weight', 700)
          .attr('paint-order', 'stroke').attr('stroke', 'rgba(4,8,14,0.9)').attr('stroke-width', 3)
          .text('⚓ ' + c.name + ' ' + c.risk)
          .style('cursor', 'pointer')
          .on('click', function () { onPick(i); });
      });
    }).catch(function (e) {
      container.insertAdjacentHTML('beforeend', '<div style="padding:10px;color:var(--text3);font-size:11px">底图加载失败：' + e.message + '</div>');
    });
  }

  /* ============ 一带一路走廊 ============ */
  /* 走廊集中在欧亚大陆：聚焦该区域投影，路线更有冲击力 */
  var EURASIA_FIT = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-12, -10], [-12, 72], [148, 72], [148, -10], [-12, -10]]] } };
  function renderCorridorMap(container, onPick) {
    container.innerHTML = baseSvg('sv-cor-map');
    var svgEl = container.querySelector('svg');
    drawBase(svgEl, EURASIA_FIT).then(function (ctx) {
      var proj = ctx.proj;
      var svg = d3.select(svgEl);
      var lanesG = svg.select('.sv-lanes'), marksG = svg.select('.sv-marks'), labelsG = svg.select('.sv-labels');
      CORRIDORS.forEach(function (c, i) {
        var route = COR_ROUTES[i];
        if (!route || route.length < 2) return;
        var col = corColor(c.risk);
        var sp = smoothPath(proj, route);
        var pid = 'sv-cor-' + i;
        /* 走廊光带：底层光晕 + 流动虚线 */
        lanesG.append('path').attr('d', sp.d).attr('fill', 'none')
          .attr('stroke', col).attr('stroke-opacity', 0.18).attr('stroke-width', 7).attr('stroke-linecap', 'round');
        lanesG.append('path').attr('id', pid).attr('d', sp.d).attr('fill', 'none')
          .attr('stroke', col).attr('stroke-width', 2.2).attr('stroke-dasharray', '12 7')
          .attr('filter', 'url(#sv-glow)').style('cursor', 'pointer')
          .on('click', function () { onPick(i); })
          .append('animate').attr('attributeName', 'stroke-dashoffset')
          .attr('values', '0;-38').attr('dur', '1.8s').attr('repeatCount', 'indefinite');
        /* 巡航光点：走廊上的项目推进感 */
        lanesG.append('circle').attr('r', 3).attr('fill', '#fff').attr('filter', 'url(#sv-glow)')
          .append('animateMotion').attr('dur', (6 + i) + 's').attr('begin', (i * 0.9) + 's')
          .attr('repeatCount', 'indefinite')
          .append('mpath').attr('href', '#' + pid);
        /* 起终点终端 */
        var first = sp.pts[0], last = sp.pts[sp.pts.length - 1];
        marksG.node().insertAdjacentHTML('beforeend',
          pulseRing(first[0], first[1], col, 20, 2.2, i * 0.3) +
          '<circle cx="' + first[0] + '" cy="' + first[1] + '" r="4.5" fill="' + col + '" filter="url(#sv-glow)"/>' +
          pulseRing(last[0], last[1], col, 20, 2.2, i * 0.3 + 1.1) +
          '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="4.5" fill="' + col + '" filter="url(#sv-glow)"/>');
        /* 走廊名称标签（终点外侧；邻近走廊错位防重叠） */
        var LABEL_OFF = { 1: { dx: 0, dy: -16 }, 3: { dx: 8, dy: 10 } };
        var off = LABEL_OFF[i] || { dx: 0, dy: 0 };
        labelsG.append('text')
          .attr('x', last[0] + 12 + off.dx).attr('y', last[1] + 4 + off.dy)
          .attr('fill', col).attr('font-size', 12).attr('font-weight', 700)
          .attr('paint-order', 'stroke').attr('stroke', 'rgba(4,8,14,0.9)').attr('stroke-width', 3)
          .text(c.name).style('cursor', 'pointer')
          .on('click', function () { onPick(i); });
      });
      /* 起点星标（北京） */
      var bj = proj([116, 40]);
      if (bj) {
        marksG.node().insertAdjacentHTML('beforeend',
          '<text x="' + bj[0] + '" y="' + (bj[1] - 12) + '" text-anchor="middle" font-size="13" fill="#ffd166" filter="url(#sv-glow)">★</text>');
      }
    }).catch(function (e) {
      container.insertAdjacentHTML('beforeend', '<div style="padding:10px;color:var(--text3);font-size:11px">底图加载失败：' + e.message + '</div>');
    });
  }

  /* ============ 完整面板（地图 + 列表 + 侧栏，对接既有详情函数） ============ */
  function renderChokepoints(el) {
    if (typeof CHOKEPOINTS === 'undefined') { el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">咽喉通道数据未加载</div>'; return; }
    var high = CHOKEPOINTS.filter(function (c) { return c.risk >= 8; }).length;
    var mid = CHOKEPOINTS.filter(function (c) { return c.risk >= 6 && c.risk < 8; }).length;
    var toolbar = (typeof CRUD !== 'undefined') ? CRUD.toolbar('共 ' + CHOKEPOINTS.length + ' 个通道', 'MONITOR.showChokepointForm()', 'MONITOR.exportData()', null) : '';
    el.innerHTML = toolbar +
      '<div class="card" style="margin-bottom:12px;border:1px solid rgba(0,212,255,0.22)">' +
      '<div class="card-tt"><span class="ic">🗺️</span>全球航运要道态势图 ' +
      '<span style="font-size:10px;color:var(--text3);font-weight:400">· 真实大陆轮廓 · 航线流光为态势示意 · 点击咽喉标记查看详情</span>' +
      '<span style="float:right;font-size:10px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#00ff9f;box-shadow:0 0 6px #00ff9f;margin-right:4px;animation:sv-blink 1.6s infinite"></span><span style="color:#00ff9f">LIVE</span></span></div>' +
      '<div style="background:#050b16;border-radius:8px;overflow:hidden;position:relative" id="chk-viz"></div>' +
      '<div style="display:flex;gap:14px;padding:8px;font-size:10px;color:var(--text3);flex-wrap:wrap">' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:#ff3355;transform:rotate(45deg);margin-right:3px"></span>极高风险(≥8.0) <b style="color:#ff3355">' + high + '</b></span>' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:#ff8800;transform:rotate(45deg);margin-right:3px"></span>高风险(6.0-8.0) <b style="color:#ff8800">' + mid + '</b></span>' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:#ffcc00;transform:rotate(45deg);margin-right:3px"></span>中风险(4.0-6.0)</span>' +
      '<span><span style="display:inline-block;width:8px;height:8px;background:#00ff9f;transform:rotate(45deg);margin-right:3px"></span>低风险(&lt;4.0)</span>' +
      '<span style="margin-left:auto">航线为态势示意，咽喉点位与风险为实战库真实数据</span></div></div>' +
      '<div class="grid" style="grid-template-columns:1fr 320px;gap:12px">' +
      '<div class="card"><div class="card-tt"><span class="ic">⚓</span>关键航运通道 (' + CHOKEPOINTS.length + ')</div>' +
      '<div style="max-height:500px;overflow-y:auto">' + CHOKEPOINTS.map(function (c, i) {
        var lv = c.risk >= 8 ? 'b-red' : c.risk >= 6 ? 'b-orange' : c.risk >= 4 ? 'b-yellow' : 'b-green';
        var barColor = c.risk >= 8 ? 'var(--red)' : c.risk >= 6 ? 'var(--orange)' : c.risk >= 4 ? 'var(--yellow)' : 'var(--green)';
        return '<div class="chk-item" id="chk-' + i + '" onclick="MONITOR.showChokepointDetail(' + i + ')" style="padding:12px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:.15s" onmouseover="this.style.borderColor=\'' + barColor + '\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><strong style="font-size:13px">' + c.name + '</strong><span class="badge ' + lv + '">风险 ' + c.risk + '</span></div>' +
          '<div class="risk-bar" style="margin-bottom:6px"><div class="risk-bar-fill" style="width:' + (c.risk * 10) + '%;background:' + barColor + '"></div></div>' +
          '<div class="text-xs text-muted" style="line-height:1.5">' + c.desc.substring(0, 80) + '...</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="text-xs text-muted">点击查看详情</span>' + ((typeof PERM !== 'undefined' && PERM.isAdmin()) ? '<span style="display:flex;gap:2px"><button class="btn sm" style="font-size:9px;padding:1px 5px" onclick="event.stopPropagation();MONITOR.showChokepointForm(' + i + ')">✏️</button><button class="btn sm danger" style="font-size:9px;padding:1px 5px" onclick="event.stopPropagation();MONITOR.deleteChokepoint(' + i + ')">🗑️</button></span>' : '') + '</div></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><div class="card-tt"><span class="ic">📊</span>通道安全态势</div><div id="chk-summary"></div></div></div>' +
      '<style>@keyframes sv-blink{0%,100%{opacity:1}50%{opacity:0.25}}</style>';
    renderChokeMap(document.getElementById('chk-viz'), function (i) { MONITOR.showChokepointDetail(i); });
    MONITOR._renderChkSummary();
  }

  function renderCorridors(el) {
    if (typeof CORRIDORS === 'undefined') { el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">走廊数据未加载</div>'; return; }
    var totalInv = CORRIDORS.reduce(function (s, c) { return s + c.inv; }, 0);
    var totalEnts = CORRIDORS.reduce(function (s, c) { return s + c.ents; }, 0);
    var activeCor = CORRIDORS.filter(function (c) { return c.status === '正常运营' || c.status === '良好'; }).length;
    var riskCor = CORRIDORS.filter(function (c) { return c.risk >= 6; }).length;
    var toolbar = (typeof CRUD !== 'undefined') ? CRUD.toolbar('共 ' + CORRIDORS.length + ' 条走廊', 'MONITOR.showCorridorForm()', 'MONITOR.exportData()', null) : '';
    el.innerHTML = toolbar +
      '<div class="card" style="margin-bottom:12px;border:1px solid rgba(0,212,255,0.22)">' +
      '<div class="card-tt"><span class="ic">🛤️</span>一带一路走廊态势图 ' +
      '<span style="font-size:10px;color:var(--text3);font-weight:400">· 真实大陆轮廓 · 流光方向为项目推进方向 · 点击走廊查看详情</span>' +
      '<span style="float:right;font-size:10px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#00ff9f;box-shadow:0 0 6px #00ff9f;margin-right:4px;animation:sv-blink 1.6s infinite"></span><span style="color:#00ff9f">LIVE</span></span></div>' +
      '<div style="background:#050b16;border-radius:8px;overflow:hidden;position:relative" id="cor-viz"></div>' +
      '<div style="display:flex;gap:16px;padding:8px;font-size:10px;color:var(--text3);flex-wrap:wrap">' +
      '<span>📦 总投资: <strong style="color:var(--cyan)">' + totalInv + '亿$</strong></span>' +
      '<span>🏨 涉及企业: <strong style="color:var(--cyan)">' + totalEnts + '家</strong></span>' +
      '<span>✅ 正常运营: <strong style="color:var(--green)">' + activeCor + '条</strong></span>' +
      '<span>⚠️ 高风险: <strong style="color:var(--red)">' + riskCor + '条</strong></span></div></div>' +
      '<div class="grid" style="grid-template-columns:1fr 320px;gap:12px">' +
      '<div class="card"><div class="card-tt"><span class="ic">🛤️</span>一带一路走廊 (' + CORRIDORS.length + ')</div>' +
      '<div style="max-height:500px;overflow-y:auto">' + CORRIDORS.map(function (c, i) {
        var lv = c.risk >= 7 ? 'b-red' : c.risk >= 5 ? 'b-orange' : c.risk >= 3 ? 'b-yellow' : 'b-green';
        var barColor = c.risk >= 7 ? 'var(--red)' : c.risk >= 5 ? 'var(--orange)' : c.risk >= 3 ? 'var(--yellow)' : 'var(--green)';
        var stColor = c.status === '正常运营' || c.status === '良好' ? 'var(--green)' : c.status === '正常推进' ? 'var(--cyan)' : c.status === '部分受阻' ? 'var(--orange)' : 'var(--red)';
        return '<div class="cor-item" id="cor-' + i + '" onclick="MONITOR.showCorridorDetail(' + i + ')" style="padding:12px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:.15s" onmouseover="this.style.borderColor=\'' + barColor + '\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><div><strong style="font-size:13px">' + c.name + '</strong><span class="text-xs text-muted ml-8">' + c.countries + '</span></div><div style="display:flex;gap:4px"><span class="badge ' + lv + '">风险 ' + c.risk + '</span><span class="badge b-blue" style="background:' + stColor + '22;color:' + stColor + ';border:1px solid ' + stColor + '55">' + c.status + '</span></div></div>' +
          '<div class="risk-bar" style="margin-bottom:6px"><div class="risk-bar-fill" style="width:' + (c.risk * 10) + '%;background:' + barColor + '"></div></div>' +
          '<div class="text-xs text-muted" style="line-height:1.5">' + c.desc.substring(0, 80) + '...</div>' +
          '<div class="flex gap-12 text-xs mt-8"><span style="color:var(--cyan)">📦 ' + c.inv + '亿$</span><span>🏨 ' + c.ents + '家</span></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="text-xs text-muted">点击查看详情</span>' + ((typeof PERM !== 'undefined' && PERM.isAdmin()) ? '<span style="display:flex;gap:2px"><button class="btn sm" style="font-size:9px;padding:1px 5px" onclick="event.stopPropagation();MONITOR.showCorridorForm(' + i + ')">✏️</button><button class="btn sm danger" style="font-size:9px;padding:1px 5px" onclick="event.stopPropagation();MONITOR.deleteCorridor(' + i + ')">🗑️</button></span>' : '') + '</div></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><div class="card-tt"><span class="ic">📊</span>走廊安全态势</div><div id="cor-summary"></div></div></div>' +
      '<style>@keyframes sv-blink{0%,100%{opacity:1}50%{opacity:0.25}}</style>';
    renderCorridorMap(document.getElementById('cor-viz'), function (i) { MONITOR.showCorridorDetail(i); });
    MONITOR._renderCorSummary();
  }

  window.STRAT_VIZ = {
    renderChokepoints: renderChokepoints,
    renderCorridors: renderCorridors
  };
})();
