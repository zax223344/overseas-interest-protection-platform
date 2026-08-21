/* LINK_GRAPH 跨模块关联引擎 —— 离线逻辑验证
 * 用法（在 server 目录）：node _linkgraph_test.mjs
 * 目的：验证「恐怖组织 ↔ 袭击事件 ↔ 国家 ↔ 企业 ↔ 预警」的双向反查是否真正打通，
 *       以及两套威胁组织表（THREAT_DATA / THREAT_ORGS_DB）是否按名称+别名合并为同一实体。
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.resolve('..');
const code = fs.readFileSync(path.join(ROOT, 'linkgraph.js'), 'utf8');

/* ---- 极简 DOM 桩：只需让 inject/_openModal 不炸，逻辑验证走 collect/resolve ---- */
const els = {};
function mkEl(id) {
  return els[id] || (els[id] = {
    id, innerHTML: '', textContent: '',
    classList: { add() { }, remove() { } },
    insertAdjacentHTML(pos, h) { this.innerHTML += h; },
    querySelector() { return null; }
  });
}

const sandbox = {
  console,
  document: {
    getElementById: (id) => mkEl(id),
    querySelectorAll: () => [],
    querySelector: () => null
  },
  showToast: () => { },
  navigateTo: () => { },

  /* ---------------- 模拟真实数据结构（字段名与线上一致） ---------------- */
  ENTITY: {
    normalizeCountry(n) {
      const map = { 'Mali': '马里', 'MALI': '马里', 'Nigeria': '尼日利亚', '刚果(金)': '刚果民主共和国' };
      return map[n] || n;
    }
  },
  COUNTRIES: [
    { name: '马里', flag: '🇲🇱', ov: 8.4, risk: 8.4, politicalRisk: 8, securityRisk: 9 },
    { name: '尼日利亚', flag: '🇳🇬', ov: 7.1, risk: 7.1 }
  ],
  ENTERPRISES: [
    { id: 101, name: '中国水利水电建设集团', short: '中国电建', industry: '基建', countries: ['马里'], risk: 7.8 },
    { id: 102, name: '中国石油天然气集团', short: '中石油', industry: '能源', countries: ['尼日利亚'], risk: 6.2 }
  ],
  ALERTS: [
    { id: 'A-9001', title: '马里加奥中资营地遭武装袭击', country: '马里', enterprise: '中国电建', level: 'red', type: '恐怖袭击', time: '2026-07-30' },
    { id: 'A-9002', title: '尼日利亚三角洲输油管道爆炸', country: '尼日利亚', enterprise: '中石油', level: 'orange', type: '基础设施破坏', time: '2026-07-28' }
  ],
  EVENTS: [
    { id: 'E-5001', title: 'JNIM 宣称对加奥袭击负责', country: '马里', sev: 'high', date: '2026-07-30', desc: 'JNIM 通过社交账号宣称负责' }
  ],
  PREDICTIONS: [],
  CHOKEPOINTS: [{ name: '几内亚湾', risk: 7, level: '高', ents: ['中石油'], desc: '海盗活动频繁' }],
  CORRIDORS: [],

  /* 两套威胁组织表 —— 结构与线上一致：
   *   THREAT_DATA.organizations（静态档案，threats.js）
   *   THREAT_ORGS_DB.getAll()  （localStorage 真实采集，scraper.js:1740）
   * 故意用不同 ID / 不同字段名 / 不同别名写法，检验能否按 名称+别名 合并为同一实体 */
  THREAT_DATA: {
    organizations: [
      {
        id: 'jnim', name: '伊斯兰与穆斯林支持者组织',
        aliases: ['JNIM', "Jama'at Nusrat al-Islam wal-Muslimin"],
        category: '宗教极端', threatLevel: 9, operatingRegions: ['马里', '布基纳法索'],
        events: [{ title: '加奥营地袭击', country: '马里', desc: '袭击中资营地' }]
      }
    ]
  },
  THREAT_ORGS_DB: {
    _rows: [
      {
        id: 77, name: 'JNIM', alias: ['伊斯兰与穆斯林支持者组织'],
        category: '宗教极端', threat_level: 'high', active_regions: ['马里', 'Mali'],
        attacks: [{ type: '武装袭击', location: '加奥', description: '袭击中资营地' }],
        anti_china_events: []
      },
      {
        id: 78, name: '博科圣地', alias: ['Boko Haram'],
        category: '宗教极端', threat_level: 'high', active_regions: ['尼日利亚'],
        attacks: [{ type: '绑架', location: '博尔诺州', description: '绑架外籍工人' }]
      }
    ],
    getAll() { return this._rows; },
    getById(id) { return this._rows.find(o => o.id === id); }
  },

  MATRIX: { _cases: [{ t: '马里营地遇袭案例', cty: '马里', ent: '中国电建', d: '武装分子夜间突袭' }] },
  DBCenter: {
    getAll(cat) {
      if (cat === 'terror_events') return [{ id: 1, title: '马里加奥袭击事件', country: '马里', source: 'ACLED', audit_status: 'approved' }];
      return [];
    }
  },
  INTELINDEX: { _evt: {}, related: () => [] },
  DATASOURCES: { REGISTRY: [{ id: 'acled', name: 'ACLED', icon: '📡', desc: '武装冲突事件数据库', coverage: ['全球'] }] },
  ENTERPRISE_DB: [],
  PROJECTS: []
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'linkgraph.js' });
const LG = sandbox.LINK_GRAPH;

/* ---------------- 断言工具 ---------------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}
/* collect() 返回 [{icon,title,view,total,items:[{t,s,c,fn,tag}]}] */
function groupOf(res, title) {
  const g = (res || []).find(x => (x.title || '').indexOf(title) >= 0);
  return g ? g.items : [];
}

console.log('\n===== LINK_GRAPH 跨模块关联验证 =====\n');

/* 1. 两套威胁组织表合并 */
console.log('[1] 威胁组织双源合并（THREAT_DATA + THREAT_ORGS_DB）');
const idx = LG.orgIndex();
ok('索引非空', idx.length > 0, 'len=' + idx.length);
const jnim = idx.find(o => /JNIM|支持者/.test(o.name) || (o.aliases || []).some(a => /JNIM/.test(a)));
ok('JNIM 被识别', !!jnim);
ok('JNIM 双源合并为同一实体（merged=true）', !!(jnim && jnim.merged), jnim ? 'merged=' + jnim.merged : 'not found');
ok('合并后不重复计数（组织总数=2：JNIM + 博科圣地）', idx.length === 2, 'len=' + idx.length);
const boko = idx.find(o => o.name === '博科圣地');
ok('单源组织博科圣地存在且 merged=false', !!boko && !boko.merged);

/* 2. 组织 → 反查（袭击事件的组织能找到国家/企业/预警） */
console.log('\n[2] 恐怖组织 → 国家/企业/预警/事件（用户原例：恐怖组织与袭击事件无关联）');
const r1 = LG.resolve({ org: 'JNIM', orgs: ['JNIM'], text: '加奥营地袭击' });
ok('组织解析命中', (r1.O || []).length > 0, JSON.stringify(r1.O));
ok('组织→活动区域反哺出国家「马里」', (r1.C || []).some(c => c === '马里'), JSON.stringify(r1.C));
const c1 = LG.collect(r1);
ok('反查到关联国家', groupOf(c1, '关联国家').length > 0);
ok('反查到关联预警（马里加奥袭击）', groupOf(c1, '关联预警').length > 0);
ok('反查到关联事件', groupOf(c1, '关联事件').length > 0);
ok('反查到关联中资企业（中国电建）', groupOf(c1, '关联中资企业').length > 0);
ok('反查到风险案例', groupOf(c1, '关联风险案例').length > 0);

/* 3. 反向：袭击事件（国家维度） → 威胁组织 */
console.log('\n[3] 袭击事件/国家 → 威胁组织（反向穿透）');
const r2 = LG.resolve({ country: '马里', text: '中资营地遭武装袭击' });
const c2 = LG.collect(r2);
const orgHits = groupOf(c2, '关联威胁组织');
ok('从马里反查到威胁组织', orgHits.length > 0, 'hits=' + orgHits.length);
ok('命中的组织标记「双源」徽章', orgHits.some(x => x.tag === '双源'), JSON.stringify(orgHits.map(x => x.t + '/' + x.tag)));

/* 4. 英文国名归一（Mali → 马里）打通 */
console.log('\n[4] 实体口径归一（英文国名 / 别名互通）');
ok('normCty("Mali") = 马里', LG.normCty('Mali') === '马里');
const r3 = LG.resolve({ country: 'Mali' });
const c3 = LG.collect(r3);
ok('用英文国名 Mali 也能反查到预警', groupOf(c3, '关联预警').length > 0);

/* 5. 企业维度 */
console.log('\n[5] 企业 → 国家/预警/项目');
const r4 = LG.resolve({ enterprise: '中国电建' });
const c4 = LG.collect(r4);
ok('企业反查到预警', groupOf(c4, '关联预警').length > 0);

/* 6. 面板 HTML 生成 */
console.log('\n[6] 关联面板渲染');
const panel = LG.buildPanel({ org: 'JNIM', text: '加奥营地袭击' });
ok('面板 HTML 非空', !!panel && panel.length > 100);
ok('面板含「跨模块关联」标题', /跨模块关联/.test(panel || ''));
ok('面板含可点击 onclick 穿透', /onclick=/.test(panel || ''));
ok('无 undefined 泄漏到 HTML', !/undefined/.test(panel || ''));

/* 7. 安全打开器：未收录实体不静默失败 */
console.log('\n[7] 安全打开器（未收录实体降级为关联透视，杜绝"点了没反应"）');
let opened = false;
sandbox.showCtyDetail = () => { opened = true; };
LG.openCountry('马里');
ok('库内国家 → 打开国家风险页', opened === true);
opened = false;
mkEl('modal-bd').innerHTML = '';
LG.openCountry('圣马力诺');   // 未收录
ok('未收录国家 → 降级为关联透视（非静默失败）', mkEl('modal-bd').innerHTML.length > 0);

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====\n');
process.exit(fail ? 1 : 0);
