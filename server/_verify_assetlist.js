/* 验证 autoalert-v3 新 _assetList：巴基斯坦必须命中大量项目 */
var ENTITY = require('C:/Users/28737/Desktop/新建文件夹/entities.js');
/* 模拟 app.js ENTERPRISES（缩写字段 n/c/inv/p）——取含巴基斯坦项目的真实条目 */
var ENTERPRISES = [
  { id: 3, name: '中国建筑集团', short: '中建', countries: ['巴基斯坦'], projects: [{ n: 'PKM高速公路', c: '巴基斯坦', inv: 28, p: 1200 }] },
  { id: 8, name: '中国交通建设', short: '中交建', countries: ['巴基斯坦'], projects: [{ n: '瓜达尔港', c: '巴基斯坦', inv: 16, p: 600 }] },
  { id: 9, name: '中国电力建设', short: '中电建', countries: ['巴基斯坦'], projects: [{ n: '卡西姆港燃煤电站', c: '巴基斯坦', inv: 4.5, p: 400 }] },
  { id: 17, name: '中国核工业', short: '中核工', countries: ['巴基斯坦'], projects: [{ n: '卡拉奇核电站', c: '巴基斯坦', inv: 8, p: 400 }] }
];
var ASSETS = undefined;

function _assetList() {
  var out = [], seen = {};
  var _norm = function (c) { try { return (typeof ENTITY !== 'undefined' && ENTITY.normalizeCountry) ? ENTITY.normalizeCountry(c) : (c || ''); } catch (e) { return c || ''; } };
  try {
    if (typeof ENTERPRISES !== 'undefined') ENTERPRISES.forEach(function (e) {
      (e.projects || []).forEach(function (p) {
        var nm = p.name || p.n || '', cy = _norm(p.country || p.c || '');
        if (!nm || !cy) return;
        var k = nm + '@' + cy; if (seen[k]) return; seen[k] = 1;
        out.push({ type: 'project', name: nm, country: cy, enterprise: e.short || e.name || '', inv: p.inv, personnel: p.p });
      });
    });
    if (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) ENTITY.PROJECTS.forEach(function (p) {
      var nm = p.name || '', cy = _norm(p.country || '');
      if (!nm || !cy) return;
      var k = nm + '@' + cy; if (seen[k]) return; seen[k] = 1;
      out.push({ type: 'project', name: nm, country: cy, enterprise: (p.corp || []).join('/'), tier: p.tier });
    });
  } catch (e) {}
  return out;
}

var all = _assetList();
var pk = all.filter(function (a) { return a.country === '巴基斯坦'; });
console.log('总资产数:', all.length);
console.log('巴基斯坦项目数:', pk.length);
console.log('巴基斯坦项目清单:', pk.map(function (a) { return a.name + '(' + (a.enterprise || '') + ')'; }).join('、'));
/* 走廊资产计数验证 */
var CORRIDOR_COUNTRIES = ['巴基斯坦','阿富汗','印度','孟加拉国','尼泊尔','斯里兰卡','哈萨克斯坦','乌兹别克斯坦','吉尔吉斯斯坦','塔吉克斯坦','土库曼斯坦'];
var cn = all.filter(function (a) { return CORRIDOR_COUNTRIES.indexOf(a.country) >= 0; }).length;
console.log('南亚-中亚走廊沿线我方利益:', cn, '项');
/* 抽查刚果金归一 */
var drc = all.filter(function (a) { return /刚果/.test(a.country); });
console.log('刚果（金）项目数:', drc.length, drc.map(function (a) { return a.name; }).join('、'));
