/* 2026-08-29 一次性清扫：历史旧案回顾条目（1988 泛美103 审判推迟类）
 * 与 server.js _isHistoricalRetrospect 同源判定；删除走墓碑链路（同 DELETE /api/intel/:id）：
 * 先立碑（归一化标题键 + 核心实体键 + URL）再删行，采集器再抓到同文一律拒收。 */
'use strict';
const { query } = require('../db');

function _normTitleKey(t) {
  return String(t || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w一-龥]+/g, '')
    .slice(0, 48);
}
function _coreEntityKey(t) {
  const s = String(t || '').toLowerCase();
  const parts = [];
  const countries = (s.match(/\b(afghanistan|pakistan|china|chinese|kabul|gwadar|balochistan|iran|iraq|syria|yemen|libya|sudan|nigeria|kenya|somalia|mali|niger|chad|ukraine|russia|myanmar|israel|palestine|turkey|saudi|uae|egypt|ethiopia|tanzania|congo|bangladesh|sri lanka|nepal|kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan|laos|cambodia|vietnam|thailand|malaysia|indonesia|philippines|brazil|argentina|chile|peru|mexico|australia|serbia|hungary|poland|germany|france|britain|italy|japan|korea|mongolia)\b/g) || []);
  const orgs = (s.match(/\b(isis|isil|is[- ]?khorasan|taliban|ttp|boko haram|al[- ]?shabaab|houthi|hezbollah|hamas|bla|blf|al[- ]?qaeda|qaida|islamic state)\b/g) || []);
  const nums = (s.match(/\b\d+\b/g) || []);
  const verbs = (s.match(/\b(attack|blast|bomb|explosion|kidnap|killing|killed|dead|death|shooting|hostage|clash|raid|ambush|sanction|protest|riot|coup|crash|collapse|fire|explosion|绑架|爆炸|袭击|枪击|冲突|骚乱|抗议|示威|罢工|政变|制裁|封锁|禁运|海盗|劫持|叛乱|武装|极端组织|恐袭|死亡|遇难|身亡|伤亡|事故|灾难|撤离|疏散)\b/g) || []);
  parts.push(...countries, ...orgs, ...nums, ...verbs);
  return parts.sort().join('|').slice(0, 120);
}
const _HIST_CASE_RE = /案|空难|坠机|爆炸案|恐袭案|审判|裁决|判决|定罪|无罪|翻案|追诉|引渡|悬案|解密|档案|周年|纪念|悼念|遇难者|幸存者|回顾|真相|tribunal|trial|verdict|convict|acquitt|retrial|indict|anniversary|memorial|commemorat|declassified|archives?|retrospect|cold case|bombing of|crash of|downing of|massacre of|flight \d+/i;
const _HIST_FAMOUS_RE = /洛克比|lockerbie|泛美(?:航空)? ?103|pan am (?:flight )?103|修道院门|修道院大门|abbey gate|9·11事件|9\.11事件|911事件|september 11 attack|慕尼黑惨案|munich massacre|别斯兰|beslan|MH370|马航370|马航MH370|俄克拉荷马城爆炸|oklahoma city bombing|东京地铁沙林|aum shinrikyo|沙林毒气/i;
const _HIST_RELATIVE_RE = /(?:\d+|一|二|两|三|四|五|六|七|八|九|十)\s*年(?:之)?[后後]|周年|后\s*(?:\d+|一|二|两|三|四|五|六|七|八|九|十)\s*年|years? (?:after|on|since|later)|anniversary|\d+\s*years? later/i;
const _HIST_EVENT_RE = /案|空难|坠机|爆炸|恐袭|袭击|屠杀|惨案|遇难|attack|bombing|blast|massacre|crash|killing|strike/i;
function _isHistoricalRetrospect(title, titleZh) {
  const t = String(title || '') + ' ' + String(titleZh || '');
  if (t.trim().length < 8) return false;
  if (_HIST_FAMOUS_RE.test(t)) return true; /* 历史旧案专名一票否决（无需年份） */
  if (_HIST_RELATIVE_RE.test(t) && _HIST_EVENT_RE.test(t)) return true; /* "N年后/周年"+袭击爆炸 → 周年回顾报道 */
  const years = t.match(/(?:19|20)\d{2}/g);
  if (!years) return false;
  const curYear = new Date().getFullYear();
  const hasOld = years.some(y => { const n = parseInt(y, 10); return n >= 1900 && n <= curYear - 10; });
  if (!hasOld) return false;
  return _HIST_CASE_RE.test(t);
}

(async () => {
  const { rows } = await query(
    "SELECT id, title, data_json FROM intel_data"
  );
  const hits = rows.filter(r => _isHistoricalRetrospect(r.title, (r.data_json || {}).title_zh || ''));
  console.log('全库命中历史旧案回顾:', hits.length, '条');
  for (const r of hits) {
    const dj = r.data_json || {};
    console.log('  ·', r.id, '|', String(r.title).slice(0, 60));
    const keys = [];
    const k1 = _normTitleKey(r.title), k2 = _normTitleKey(dj.title_zh || '');
    if (k1.length >= 6) keys.push(k1);
    if (k2.length >= 6 && k2 !== k1) keys.push(k2);
    const c1 = _coreEntityKey(r.title), c2 = _coreEntityKey(dj.title_zh || '');
    if (c1 && c1.length >= 6) keys.push('c:' + c1);
    if (c2 && c2.length >= 6 && c2 !== c1) keys.push('c:' + c2);
    for (const k of keys) {
      await query('INSERT INTO intel_tombstones (tkey, url, title) VALUES ($1,$2,$3)',
        [k, dj.url || null, String(r.title || '').slice(0, 200)]);
    }
    await query('DELETE FROM intel_data WHERE id = $1', [r.id]);
  }
  console.log('清扫完成（已立碑+删行）');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
