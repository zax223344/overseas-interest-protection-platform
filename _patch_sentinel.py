# -*- coding: utf-8 -*-
# server.js：预警利益关联哨兵——预警中心每条数据必须能回答"对中国海外利益的影响"
import io
p = 'server/server.js'
s = io.open(p, encoding='utf-8').read()

anchor = "setInterval(_qualityGuardian, 30 * 60 * 1000);"
assert s.count(anchor) == 1
block = '''/* ===== 预警利益关联哨兵（2026-08-16 用户铁律：预警中心是核心中的核心）=====
 * 实战标准：每条预警必须体现对中国海外利益（人员/项目/资产/通道/声誉）的影响。
 * 每30分钟巡查共享预警库：五维利益关联评分——
 *   涉华要素(30) + 中资资产命中(30) + 威胁组织关联(10) + 伤亡烈度(20/8) + BRI沿线国(10)
 * 红/橙级一律保留（高烈度事件本身构成环境风险）；
 * 黄/蓝级且关联分<20 的为"与我无关的泛新闻"，移出预警中心（数据中心仍可查）。
 * 巡检结果并入 /api/quality 报告。 */
const _INTEREST_CN_RE = /中国|中资|中企|中方|华人|华侨|华裔|一带一路|涉华|对华|驻[^，。]{0,4}使馆|孔子|撤侨|Chinese|China|Beijing|CPEC|Belt and Road/i;
const _INTEREST_ASSET_RE = /瓜达尔|中巴经济走廊|汉班托塔|比雷埃夫斯|皎漂|中老铁路|雅万|蒙内|亚吉|钱凯|科伦坡港口城|中白工业园|吉布提|莱基|坦赞|西芒杜|中欧班列|China Railway Express/i;
const _INTEREST_ORG_RE = /塔利班|青年党|博科圣地|伊斯兰国|基地组织|胡塞|真主党|哈马斯|俾路支|Taliban|Shabaab|Boko|ISIS|Qaeda|Houthi|BLA|TTP/i;
const _BRI_COUNTRIES = ['巴基斯坦', '哈萨克斯坦', '乌兹别克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '土库曼斯坦', '老挝', '柬埔寨', '缅甸', '印度尼西亚', '马来西亚', '泰国', '越南', '塞尔维亚', '匈牙利', '希腊', '埃塞俄比亚', '肯尼亚', '吉布提', '埃及', '斯里兰卡', '孟加拉国', '尼泊尔', '沙特阿拉伯', '阿联酋', '土耳其', '白俄罗斯', '波兰'];
function _alertInterestScore(a) {
  const txt = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
  let sc = 0;
  const hits = [];
  if (_INTEREST_CN_RE.test(txt)) { sc += 30; hits.push('涉华'); }
  if (_INTEREST_ASSET_RE.test(txt) || (a.asset_tags && a.asset_tags.length)) { sc += 30; hits.push('资产'); }
  if (_INTEREST_ORG_RE.test(txt)) { sc += 10; hits.push('威胁组织'); }
  const dm = txt.match(/(\\d+)\\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\\d+)\\s*(?:killed|dead)/i);
  const deaths = dm ? parseInt(dm[1] || dm[2], 10) : 0;
  if (deaths >= 10) { sc += 20; hits.push('重大伤亡'); } else if (deaths > 0) { sc += 8; hits.push('伤亡'); }
  if (_BRI_COUNTRIES.indexOf(String(a.country || '')) >= 0) { sc += 10; hits.push('BRI沿线'); }
  if (a.corroboration > 1) sc += 5;
  return { score: sc, hits: hits };
}
async function _alertValueSentinel() {
  try {
    const r = await query("SELECT data_json FROM datahub_store WHERE collection='alerts'");
    if (!r.rows.length || !Array.isArray(r.rows[0].data_json)) return;
    const alerts = r.rows[0].data_json;
    const kept = [], demoted = [];
    for (const a of alerts) {
      if (!a) continue;
      if (a.level === 'red' || a.level === 'orange') { kept.push(a); continue; }
      const v = _alertInterestScore(a);
      a._interestScore = v.score; a._interestHits = v.hits;
      if (v.score >= 20) kept.push(a);
      else demoted.push(a);
    }
    if (demoted.length) {
      await query('UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2', [JSON.stringify(kept), 'alerts']);
      console.log('[VALUE-SENTINEL] 移出无利益关联低烈度预警 ' + demoted.length + ' 条，保留 ' + kept.length + ' 条（红/橙全保留）');
    }
    /* 给保留条目回写利益关联标注（前端可直接展示"影响"标签） */
    const avg = kept.length ? Math.round(kept.reduce((s2, a) => s2 + (a._interestScore || 0), 0) / kept.length) : 0;
    _valueSentinelState = { at: new Date().toISOString(), total: alerts.length, kept: kept.length, demoted: demoted.length, avgScore: avg };
  } catch (e) { console.warn('[VALUE-SENTINEL] 巡检异常:', e.message); }
}
let _valueSentinelState = { at: null, total: 0, kept: 0, demoted: 0, avgScore: 0 };
setInterval(_alertValueSentinel, 30 * 60 * 1000);
setTimeout(_alertValueSentinel, 90 * 1000);

setInterval(_qualityGuardian, 30 * 60 * 1000);'''
s = s.replace(anchor, block, 1)

# quality 报告并入利益关联项
o2 = "      checks.push({ name: '今日入库(全库口径)', ok: true, detail: r3.rows[0].c + ' 条' });"
n2 = """      checks.push({ name: '今日入库(全库口径)', ok: true, detail: r3.rows[0].c + ' 条' });
      /* 利益关联哨兵结果并入 */
      if (typeof _valueSentinelState !== 'undefined' && _valueSentinelState.at) {
        checks.push({ name: '预警利益关联', ok: true, detail: '在队 ' + _valueSentinelState.kept + ' 条 · 本轮移出无关联 ' + _valueSentinelState.demoted + ' 条 · 平均关联分 ' + _valueSentinelState.avgScore });
      }"""
assert s.count(o2) == 1
s = s.replace(o2, n2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
