/* 2026-08-29 一次性回填：国别 ISO 两位码 → 中文名
 * 根因：sources_pack 通道落库 country=ISO 码（CN/PK/BR…），异动引擎按中文名过滤失效
 * （CN 混进异动监测）、getTier 查不到梯队、前端显示裸码。
 * 范围：intel_data + intel_archive 存量行；预警队列 ANOM- 条目（裸码→中文、中国→剔除）。 */
'use strict';
const { query } = require('../db');

const ISO2CN = {
  CN:'中国', US:'美国', GB:'英国', FR:'法国', HK:'中国香港', MO:'中国澳门', TW:'中国台湾',
  PK:'巴基斯坦', LK:'斯里兰卡', BD:'孟加拉国', ID:'印尼', VN:'越南', MY:'马来西亚', TH:'泰国',
  MM:'缅甸', KH:'柬埔寨', LA:'老挝', KZ:'哈萨克斯坦', UZ:'乌兹别克斯坦', TJ:'塔吉克斯坦',
  KG:'吉尔吉斯斯坦', RU:'俄罗斯', SA:'沙特', AE:'阿联酋', QA:'卡塔尔', IR:'伊朗', IQ:'伊拉克',
  EG:'埃及', DZ:'阿尔及利亚', NG:'尼日利亚', ZA:'南非', CD:'刚果（金）', GN:'几内亚',
  ET:'埃塞俄比亚', KE:'肯尼亚', MZ:'莫桑比克', AO:'安哥拉', DJ:'吉布提', BR:'巴西', PE:'秘鲁',
  AR:'阿根廷', CL:'智利', MX:'墨西哥', BO:'玻利维亚', EC:'厄瓜多尔', DE:'德国', RS:'塞尔维亚',
  HU:'匈牙利', GR:'希腊', CA:'加拿大', AU:'澳大利亚', PG:'巴布亚新几内亚', SB:'所罗门群岛',
  JP:'日本', KR:'韩国', KP:'朝鲜', IN:'印度', TR:'土耳其', UA:'乌克兰', IL:'以色列', PS:'巴勒斯坦',
  SD:'苏丹', LY:'利比亚', SO:'索马里', ML:'马里', NE:'尼日尔', TD:'乍得', SY:'叙利亚',
  YE:'也门', LB:'黎巴嫩', JO:'约旦', MA:'摩洛哥', TN:'突尼斯', TZ:'坦桑尼亚', UG:'乌干达',
  ZM:'赞比亚', ZW:'津巴布韦', MW:'马拉维', BW:'博茨瓦纳', NA:'纳米比亚', SN:'塞内加尔',
  BF:'布基纳法索', CM:'喀麦隆', CI:'科特迪瓦', SG:'新加坡', PH:'菲律宾', MN:'蒙古',
  PL:'波兰', BY:'白俄罗斯', RO:'罗马尼亚', CZ:'捷克', SK:'斯洛伐克', BG:'保加利亚',
  FI:'芬兰', SE:'瑞典', NO:'挪威', DK:'丹麦', NL:'荷兰', BE:'比利时', CH:'瑞士',
  AT:'奥地利', IT:'意大利', ES:'西班牙', PT:'葡萄牙', IE:'爱尔兰', NZ:'新西兰'
};
function fix(c) {
  const s = String(c || '').trim();
  if (!s) return null;
  if (/[\u4e00-\u9fa5]/.test(s)) return null; /* 已中文 */
  if (!/^[A-Z]{2}$/.test(s)) return null;     /* 非两位码（如英文全名）不动 */
  return ISO2CN[s] || null;                    /* 未收录码不动 */
}

(async () => {
  /* ① intel_data / intel_archive 存量回填 */
  for (const tbl of ['intel_data', 'intel_archive']) {
    const { rows } = await query(`SELECT id, country FROM ${tbl} WHERE country ~ '^[A-Z]{2}$'`);
    let n = 0;
    for (const r of rows) {
      const cn = fix(r.country);
      if (!cn) continue;
      await query(`UPDATE ${tbl} SET country = $1 WHERE id = $2`, [cn, r.id]);
      n++;
    }
    console.log(tbl, '两位码回填:', n, '/', rows.length, '条');
  }
  /* CN 码行（中国）一律清空 country——中国永不是海外利益事发地 */
  for (const tbl of ['intel_data', 'intel_archive']) {
    const { rowCount } = await query(`UPDATE ${tbl} SET country = '' WHERE country = 'CN'`);
    console.log(tbl, 'CN→空:', rowCount, '条');
  }

  /* ② 预警队列 ANOM- 修正：裸码→中文；中国/CN 剔除 */
  const { rows } = await query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
  if (rows.length && Array.isArray(rows[0].data_json)) {
    const alerts = rows[0].data_json;
    let fixed = 0, dropped = 0;
    const out = [];
    for (const a of alerts) {
      if (!a) { out.push(a); continue; }
      const c = String(a.country || '').trim();
      if (c === '中国' || c === 'CN' || c === 'CHN') { dropped++; continue; } /* 中国异动条目剔除 */
      if (/^[A-Z]{2}$/.test(c)) {
        const cn = ISO2CN[c];
        if (cn) { a.country = cn; fixed++; }
      }
      out.push(a);
    }
    await query('UPDATE datahub_store SET data_json=$1, updated_at=NOW() WHERE collection=$2', [JSON.stringify(out), 'alerts']);
    console.log('预警队列：裸码修正', fixed, '条，中国异动剔除', dropped, '条，余', out.length, '条');
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
