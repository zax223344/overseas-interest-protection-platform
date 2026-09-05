/* ============================================================
 * ORPS 存量翻译数据修复（三任务，2026-09-03）
 *   任务1：72h 内外文正文未译（无 _untranslated_body 标记）→ 剥 HTML 后
 *          POST /api/translate 回填 data_json.content_zh（+content/content_en，
 *          与服务端入库约定同构）；质检不过 → 打 _untranslated_body。
 *   任务2：72h 内中英混杂标题 → 优先 title_en 原文重译（新管线含 _fixMixedZh
 *          + zhPolish），本地再 polishTitle + 兜底媒体尾巴剥离；质检通过才覆盖
 *          title_zh，否则保留原值打 _mixed_pending。全大写缩写（2-6位）豁免。
 *   任务3：id 36589 错位标题修复（title_en 存在则翻译，幻觉/质检不过则回退
 *          description 中文正文首句截 60 字）+ 最近 7 天 url 域名与 country
 *          不搭扫描（只报告不修）。
 *   任务2c：混杂标题专名级片段修复——整句重译后仍残留的非缩写英文实词（人名/
 *          地名/机构名，如 Shehbaz/Rosatom/Bahri），逐片段送 /api/translate，
 *          译出纯中文（2-14 字）才替换；含尾部 hashtag 簇剥离与"分隔符+大写词+
 *          中文后缀"媒体尾巴剥离。完全清干净 → 覆盖；仍有残留 → 覆盖改善值并打
 *          _mixed_pending（引擎上限，留痕待查）。
 *   任务en：72h 内全英标题且带 _untranslated=true → 重译成功覆盖 title_zh 并清
 *          _untranslated，失败保留标记。
 *
 * 用法：node scripts/repair-translate-stock.js [--task=1|2|2c|3|scan|en|all] [--dry] [--limit=N] [--retry-marked] [--since=ISO时间]
 *   --dry          每任务只走前 5 条全流程（含翻译质检），不执行任何 UPDATE
 *   --limit=N      每任务最多处理 N 条
 *   --retry-marked 只处理已打标（_untranslated_body/_mixed_pending/_title_repaired）条目
 *   --since=ISO    任务2 额外限定 created_at >= 该时间（用于只补新到货，避免幂等重跑）
 *
 * 纪律：
 *   - 所有 UPDATE 只动 data_json（jsonb_set / - key），绝不动 title/description 列、audit_status；
 *   - /api/translate 一次 ≤10 条、批间隔 ≥1s；接口失败跳过该批（幂等，下次再修）；
 *   - 连续 5 批接口整体失败视为引擎异常，中止该任务并报告。
 * ============================================================ */
'use strict';
const zhPolish = require('../zh-polish');
const { Client } = require('pg');

const DB_CONFIG = { host: '127.0.0.1', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' };
const API_URL = 'http://127.0.0.1:3000/api/translate';
const BATCH = 10;
const BATCH_GAP_MS = 1100;

const DRY = process.argv.includes('--dry');
const RETRY_MARKED = process.argv.includes('--retry-marked');
const LIMIT = (() => { const m = process.argv.join(' ').match(/--limit=(\d+)/); return m ? parseInt(m[1], 10) : 0; })();
const TASK = (() => { const m = process.argv.join(' ').match(/--task=([0-9a-z,]+)/); return (m ? m[1] : 'all').split(','); })();
const SINCE = (() => { const m = process.argv.join(' ').match(/--since=([0-9T:.Zz+\-]+)/); return m ? m[1] : ''; })();
const DRY_N = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasZh = s => /[一-龥]/.test(String(s || ''));

/* ---------- /api/translate 调用（≤10 条/批） ---------- */
async function apiTranslate(texts) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(300000)
    });
    const j = await res.json();
    if (!j || j.ok !== true || !Array.isArray(j.results)) return null;
    return j.results;
  } catch (e) {
    console.warn('  [API] 调用失败:', e.message);
    return null;
  }
}

/* ---------- 输入清洗：HTML 标签（含实体转义态）/实体/超长裸链 ---------- */
function cleanBodySrc(raw) {
  let t = String(raw || '');
  t = t.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');            /* 转义标签还原 */
  t = t.replace(/<[^>]{0,600}>/g, ' ');                            /* 剥所有标签 */
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
       .replace(/&quot;/gi, '"').replace(/(&#0?39;|&#x27;|&apos;)/gi, "'");
  t = t.replace(/https?:\/\/\S{113,}/gi, ' ');                     /* >120 字符裸链 */
  t = t.replace(/(?:https?[:：]\/\/)?news\.google\.com\/(?:rss|url)\/?\S*/gi, ' '); /* 跳转壳 */
  return t.replace(/\s{2,}/g, ' ').trim();
}

/* ---------- 幻觉护栏（实测 TranSmart 对葡语文本会串出"胡适/任正非/重庆市政府"
 * 等毫不相关的中文实体——36589 错位标题即此类产物） ---------- */
function halluReason(src, dst) {
  const s = String(src || '').toLowerCase();
  if (hasZh(s)) return null; /* 源本身含中文（title_zh 直发路径）时人名护栏不适用 */
  const d = String(dst || '');
  if (/任正非|孟晚舟|孟某|胡适/.test(d) && !/zhengfei|wanzhou|hu\s*shih/.test(s)) return 'hallu_names';
  if (/华为/.test(d) && !/huawei/.test(s)) return 'hallu_huawei';
  if (/(重庆|北京|上海|深圳|广州|杭州|武汉)市政府/.test(d) && !/chongqing|beijing|shanghai|shenzhen|guangzhou|hangzhou|wuhan/.test(s)) return 'hallu_cn_gov';
  return null;
}

/* ---------- 质检：正文 ---------- */
function qcBody(src, dst) {
  const a = String(src || ''), b = String(dst || '');
  if (!b.trim()) return 'empty';
  const cjk = (b.match(/[一-龥]/g) || []).length;
  if (cjk < 2) return 'no_chinese';
  if (cjk / b.length < 0.15) return 'low_cjk_ratio';
  const ratio = b.length / Math.max(1, a.length);
  if (ratio < 0.2 || ratio > 4) return 'len_ratio';
  if (/阅读更多|阅读全文|继续阅读|点击此处/.test(b)) return 'paywall_junk';
  const h = halluReason(a, b); if (h) return h;
  const rep = b.match(/([^，。；、\s]{4,14})\1/); if (rep) return 'repetition';
  return null;
}

/* ---------- 质检：标题（尾部 3+ 英文实词残留，全大写缩写 2-6 位豁免） ---------- */
function tailResidue(t) {
  let s = String(t || '').trim();
  const words = [];
  for (let i = 0; i < 6; i++) {
    const m = s.match(/[\s|｜\-–—:：,，、]*[A-Za-z][A-Za-z0-9'&.-]{0,19}\s*$/);
    if (!m) break;
    const wm = m[0].match(/[A-Za-z][A-Za-z0-9'&.-]{0,19}/);
    if (!wm) break;
    words.unshift(wm[0]);
    s = s.slice(0, s.length - m[0].length).trim();
  }
  const residue = words.filter(w => {
    if (w.replace(/[^A-Za-z]/g, '').length < 3) return false;   /* <3 字母非实词 */
    if (/^[A-Z0-9&.-]{2,6}$/.test(w)) return false;             /* 全大写缩写豁免 */
    return true;
  });
  return residue.length >= 3 ? residue.join(' ') : '';
}
function qcTitle(src, dst) {
  const b = String(dst || '').trim();
  if (!b) return 'empty';
  if (!hasZh(b)) return 'no_chinese';
  if (/阅读更多|阅读全文|继续阅读/.test(b)) return 'paywall_junk';
  const ratio = b.length / Math.max(1, String(src || '').length);
  if (ratio < 0.15 || ratio > 4) return 'len_ratio';
  const h = halluReason(src, b); if (h) return h;
  const rep = b.match(/([^，。；、\s]{4,14})\1/); if (rep) return 'repetition';
  const tail = tailResidue(b); if (tail) return 'tail_en(' + tail.slice(0, 24) + ')';
  return null;
}

/* ---------- 标题抛光：polishTitle + 兜底"分隔符+大写词"尾巴剥离
 * （zh-polish 的通用规则要求主体纯中文，混排标题"…MQ-9无人机作为报复开始- IranWire"
 * 剥不掉；此处放宽守卫：主体 ≥8 汉字且汉字数 ≥ 英文字母数才剥，防误伤专名结尾） */
function stripExtraTail(t) {
  let out = String(t || '').trim();
  for (let round = 0; round < 3; round++) {
    /* 2026-09-03 扩展：允许尾部大写词后跟 0-4 个汉字后缀（"- Yeni Safak 中国" 类
     * 机翻媒体尾巴+国名残留），守卫不变：主体 ≥8 汉字且汉字数 ≥ 英文字母数才剥 */
    const m = out.match(/[\s\-–—|｜]{1,3}([A-Z][A-Za-z]{1,18}(?:\s+[A-Z][A-Za-z]{0,18}){0,2})(?:\s*[一-龥]{1,4})?\s*$/);
    if (!m) break;
    const kept = out.slice(0, m.index).trim();
    const zh = (kept.match(/[一-龥]/g) || []).length;
    const en = (kept.match(/[A-Za-z]/g) || []).length;
    if (zh >= 8 && zh >= en) out = kept; else break;
  }
  return out.replace(/[\s\-–—|｜,，:：]+$/, '').trim();
}
/* 尾部 hashtag 簇剥离（社媒采集残留："# 塔可 # Nacho #新闻#政治#北约#战争# ww3"）：
 * ≥2 个尾部 # 簇且剥后主体仍含 ≥6 汉字才剥 */
function stripHashtagTail(t) {
  let out = String(t || '').trim();
  const m = out.match(/(?:\s*#[^\s#]{1,16}){2,}\s*$/);
  if (m) {
    const kept = out.slice(0, m.index).trim();
    if ((kept.match(/[一-龥]/g) || []).length >= 6) out = kept;
  }
  return out.replace(/[\s#，,、:：]+$/, '').trim();
}
function polishTitleFull(t) { return stripExtraTail(zhPolish.polishTitle(t)); }

/* ---------- UPDATE 辅助（只动 data_json） ---------- */
async function updSetBody(c, id, zh, srcEn) {
  await c.query(
    `UPDATE intel_data SET data_json =
       jsonb_set(jsonb_set(jsonb_set(data_json - '_untranslated_body', '{content_zh}', to_jsonb($2::text), true),
       '{content}', to_jsonb($2::text), true), '{content_en}', to_jsonb($3::text), true)
     WHERE id = $1`, [id, zh, srcEn]);
}
async function updMark(c, id, key) {
  await c.query(`UPDATE intel_data SET data_json = jsonb_set(data_json, '{${key}}', 'true'::jsonb, true) WHERE id = $1`, [id]);
}
async function updTitleZh(c, id, zh) {
  await c.query(`UPDATE intel_data SET data_json = jsonb_set(data_json - '_mixed_pending', '{title_zh}', to_jsonb($2::text), true) WHERE id = $1`, [id, zh]);
}
async function updTitleZhMark(c, id, zh) {
  await c.query(`UPDATE intel_data SET data_json = jsonb_set(jsonb_set(data_json, '{title_zh}', to_jsonb($2::text), true), '{_mixed_pending}', 'true'::jsonb, true) WHERE id = $1`, [id, zh]);
}
async function updTitleZhClearUntrans(c, id, zh) {
  await c.query(`UPDATE intel_data SET data_json = jsonb_set(data_json - '_untranslated', '{title_zh}', to_jsonb($2::text), true) WHERE id = $1`, [id, zh]);
}

/* ---------- 通用批处理：rows=[{id,src,...}]，逐条回调判定 ---------- */
async function runBatches(c, rows, label, onResult) {
  const stats = { fixed: 0, failed: 0, apiSkip: 0, reasons: {} };
  const note = (r) => { stats.reasons[r] = (stats.reasons[r] || 0) + 1; };
  let consecutiveApiFail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await apiTranslate(chunk.map(r => r.src));
    if (res === null) {
      consecutiveApiFail++; stats.apiSkip += chunk.length;
      console.warn(`  [${label}] 批 ${Math.floor(i / BATCH) + 1} 接口整体失败，跳过 ${chunk.length} 条（连续失败 ${consecutiveApiFail}）`);
      if (consecutiveApiFail >= 5) { console.error(`  [${label}] 连续 5 批接口失败，中止本任务（已处理部分保持幂等，可下次再修）`); break; }
      await sleep(BATCH_GAP_MS); continue;
    }
    consecutiveApiFail = 0;
    for (let k = 0; k < chunk.length; k++) {
      const row = chunk[k];
      const out = res[k] || '';
      const act = onResult(row, out);   /* {act:'fix'|'fail'|'skip', reason?} */
      if (act.act === 'fix') { if (!DRY) await act.apply(); stats.fixed++; }
      else if (act.act === 'fail') { if (!DRY) await act.apply(); stats.failed++; note(act.reason || 'unknown'); }
      else { stats.apiSkip++; note(act.reason || 'api_empty'); }
    }
    process.stdout.write(`  [${label}] 进度 ${Math.min(i + BATCH, rows.length)}/${rows.length}（修 ${stats.fixed} / 败 ${stats.failed} / 跳 ${stats.apiSkip}）\r`);
    await sleep(BATCH_GAP_MS);
  }
  console.log('');
  return stats;
}

/* ================= 任务1：外文正文回填 ================= */
async function task1(c) {
  console.log('\n========== 任务1：72h 内外文正文未译回填 ==========');
  let sql = `SELECT id, description, data_json->>'content_zh' AS content_zh, data_json->>'content' AS content
    FROM intel_data
    WHERE created_at >= NOW()-INTERVAL '72 hours'
      AND COALESCE(NULLIF(data_json->>'content_zh',''),description) !~ '[一-龥]'
      AND description IS NOT NULL AND description <> ''
      AND (data_json->>'content' IS NULL OR data_json->>'content' = '' OR data_json->>'content' !~ '[一-龥]')
      AND COALESCE((data_json->>'_untranslated_body')::boolean, false) = ${RETRY_MARKED}
    ORDER BY id`;
  if (LIMIT) sql += ` LIMIT ${LIMIT}`;
  const { rows } = await c.query(sql);
  const list = DRY ? rows.slice(0, DRY_N) : rows;
  console.log(`待处理 ${rows.length} 条${DRY ? '（DRY 只走前 ' + DRY_N + ' 条）' : ''}`);

  /* 预清洗：剥离后为空/仅剩媒体名残渣（<12字符）的打标记，不占翻译配额 */
  const pending = [];
  let htmlEmpty = 0;
  for (const r of list) {
    const src = cleanBodySrc(r.description);
    if (src.length < 12) {
      if (!DRY) await updMark(c, r.id, '_untranslated_body');
      htmlEmpty++;
      if (DRY) console.log(`  [DRY] id=${r.id} 剥离后为空 → 只打 _untranslated_body`);
    } else pending.push({ id: r.id, src });
  }
  console.log(`预清洗：HTML 剥离后为空 ${htmlEmpty} 条（打标记），送翻译 ${pending.length} 条`);

  const stats = await runBatches(c, pending, '任务1', (row, out) => {
    const zh = out ? zhPolish.polish(out) : '';
    const reason = out ? qcBody(row.src, zh) : 'api_empty';
    if (!reason) {
      if (DRY) console.log(`  [DRY·通过] id=${row.id} "${zh.slice(0, 50)}…"`);
      return { act: 'fix', apply: () => updSetBody(c, row.id, zh, row.src) };
    }
    if (DRY) console.log(`  [DRY·拒绝] id=${row.id} 原因=${reason} 译="${String(zh).slice(0, 40)}"`);
    return { act: 'fail', reason, apply: () => updMark(c, row.id, '_untranslated_body') };
  });
  stats.htmlEmpty = htmlEmpty;
  console.log(`任务1 完成：回填 ${stats.fixed}，质检拒绝打标 ${stats.failed}（${Object.entries(stats.reasons).map(([k, v]) => k + ':' + v).join(', ') || '无'}），接口跳过 ${stats.apiSkip}，剥离空打标 ${htmlEmpty}`);
  return stats;
}

/* ================= 任务2：中英混杂标题重译 ================= */
async function task2(c) {
  console.log('\n========== 任务2：72h 内中英混杂标题重译 ==========');
  let sql = `SELECT id, title, data_json->>'title_zh' AS title_zh, data_json->>'title_en' AS title_en, data_json->>'title' AS dj_title
    FROM intel_data
    WHERE created_at >= NOW()-INTERVAL '72 hours'
      AND COALESCE(NULLIF(data_json->>'title_zh',''),title) ~ '[一-龥]'
      AND COALESCE(NULLIF(data_json->>'title_zh',''),title) ~ '[A-Za-z]{3,}'
      AND COALESCE((data_json->>'_mixed_pending')::boolean, false) = ${RETRY_MARKED}
    ORDER BY id`;
  if (SINCE) sql = sql.replace("ORDER BY id", `AND created_at >= '${SINCE}' ORDER BY id`);
  if (LIMIT) sql += ` LIMIT ${LIMIT}`;
  const { rows } = await c.query(sql);
  const list = DRY ? rows.slice(0, DRY_N) : rows;
  console.log(`待处理 ${rows.length} 条${DRY ? '（DRY 只走前 ' + DRY_N + ' 条）' : ''}`);

  /* 翻译源选择：title_en 原文 > data_json.title（外文主体时）> title 列（外文主体时）> title_zh */
  const pending = []; const srcStat = { title_en: 0, dj_title: 0, col_title: 0, title_zh: 0 };
  for (const r of list) {
    let src = String(r.title_en || '').trim(); let kind = 'title_en';
    if (!src) {
      const dj = String(r.dj_title || '').trim();
      if (dj && !hasZh(dj)) { src = dj; kind = 'dj_title'; }
    }
    if (!src) {
      const ct = String(r.title || '').trim();
      if (ct && !hasZh(ct)) { src = ct; kind = 'col_title'; }
    }
    if (!src) { src = String(r.title_zh || r.title || '').trim(); kind = 'title_zh'; }
    srcStat[kind]++; pending.push({ id: r.id, src, kind, oldZh: String(r.title_zh || '') });
  }
  console.log(`翻译源分布：title_en=${srcStat.title_en} data_json.title=${srcStat.dj_title} title列=${srcStat.col_title} title_zh直发=${srcStat.title_zh}`);

  const stats = await runBatches(c, pending, '任务2', (row, out) => {
    /* title_zh 直发且接口原样回显（中文为主预检）→ 无改进，打 _mixed_pending */
    const zh0 = out ? polishTitleFull(out) : '';
    if (!zh0 || zh0 === row.src) {
      return { act: 'fail', reason: row.kind === 'title_zh' ? 'echo_no_fix' : 'api_empty', apply: () => updMark(c, row.id, '_mixed_pending') };
    }
    const reason = qcTitle(row.src, zh0);
    if (!reason) {
      if (DRY) console.log(`  [DRY·通过] id=${row.id} "${row.oldZh.slice(0, 36)}" → "${zh0.slice(0, 40)}"`);
      return { act: 'fix', apply: () => updTitleZh(c, row.id, zh0) };
    }
    if (DRY) console.log(`  [DRY·拒绝] id=${row.id} 原因=${reason} 译="${zh0.slice(0, 40)}"`);
    return { act: 'fail', reason, apply: () => updMark(c, row.id, '_mixed_pending') };
  });
  console.log(`任务2 完成：重译覆盖 ${stats.fixed}，质检拒绝打标 ${stats.failed}（${Object.entries(stats.reasons).map(([k, v]) => k + ':' + v).join(', ') || '无'}），接口跳过 ${stats.apiSkip}`);
  return stats;
}

/* ================= 任务2c：混杂标题专名级片段修复 =================
 * 背景：整句重译（任务2）后仍有 ~430 条标题残留非缩写英文实词——绝大多数是引擎
 * 保留原文的专名（Shehbaz/Rosatom/Bahri/Krishna 区）。修法与平台自有策略同源
 * （server.js _fixMixedZh / scripts/fix-mixed-titles.js）：逐片段送 /api/translate，
 * 译出纯中文（2-14 字，允许·）才做词边界替换；同时剥离尾部 hashtag 簇与
 * "分隔符+大写词+中文后缀"媒体尾巴。完全清干净 → 覆盖；仍有残留 → 覆盖改善值
 * 并打 _mixed_pending（引擎上限留痕）。全大写缩写（2-6位）合法保留不动。 */
const FRAG_RE = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'&.\-]{1,23}/g;
const FRAG_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'says', 'said', 'amid', 'after', 'about', 'against', 'between', 'during', 'under', 'over', 'into', 'than', 'then', 'they', 'their', 'them', 'this', 'that', 'will', 'would', 'been', 'being', 'have', 'has', 'had', 'was', 'were', 'are', 'not', 'but', 'all', 'any', 'new', 'one', 'two', 'who', 'what', 'which', 'when', 'where', 'why', 'how', 'www', 'com', 'http', 'https']);
function extractFrags(zh) {
  const out = [];
  let m; FRAG_RE.lastIndex = 0;
  while ((m = FRAG_RE.exec(String(zh)))) {
    const w = m[0];
    if (w.length < 3) continue;                                  /* <3 字母非实词 */
    if (/^[A-Z0-9&.'-]{2,6}$/.test(w)) continue;                 /* 全大写缩写合法保留 */
    if (FRAG_STOP.has(w.toLowerCase())) continue;                /* 功能词不单独翻 */
    if (/\d/.test(w)) continue;                                   /* 含数字（型号/编号）保守跳过 */
    out.push(w);
  }
  return out;
}
function fragOk(tr) { return /^[\u4e00-\u9fff·]{2,14}$/.test(String(tr || '').trim()); }
function replaceFrag(zh, frag, tr) {
  const re = new RegExp("(?<![A-Za-z0-9À-ÿ])" + frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9À-ÿ])", "g");
  return zh.replace(re, tr);
}
async function task2c(c) {
  console.log('\n========== 任务2c：混杂标题专名级片段修复 ==========');
  const { rows } = await c.query(
    `SELECT id, COALESCE(NULLIF(data_json->>'title_zh',''),title) AS zh
     FROM intel_data
     WHERE created_at >= NOW()-INTERVAL '72 hours'
       AND COALESCE(NULLIF(data_json->>'title_zh',''),title) ~ '[一-龥]'
       AND COALESCE(NULLIF(data_json->>'title_zh',''),title) ~ '[A-Za-z]{3,}'
       AND COALESCE((data_json->>'_mixed_pending')::boolean, false) = ${RETRY_MARKED}
     ORDER BY id`);
  const targets = [];
  let acrOnly = 0;
  for (const r of rows) {
    const frags = extractFrags(r.zh);
    if (frags.length) targets.push({ id: r.id, zh0: String(r.zh).trim(), frags });
    else acrOnly++;
  }
  console.log(`混杂标题 ${rows.length} 条：仅缩写保留（合法，不动）${acrOnly} 条，含非缩写实词（片段修复目标）${targets.length} 条${DRY ? '（DRY 只走前 ' + DRY_N + ' 条）' : ''}`);
  const list = DRY ? targets.slice(0, DRY_N) : targets;

  /* 唯一片段收集 → 批量翻译（≤10/批，间隔≥1s） */
  const uniq = [...new Set(list.flatMap(t => t.frags))].slice(0, 1200);
  console.log(`唯一片段 ${uniq.length} 个，批量翻译…`);
  const dict = {};
  for (let i = 0; i < uniq.length; i += BATCH) {
    const chunk = uniq.slice(i, i + BATCH);
    const res = await apiTranslate(chunk);
    if (res !== null) chunk.forEach((f, k) => { const tr = String(res[k] || '').trim(); if (fragOk(tr) && tr !== f) dict[f] = tr; });
    process.stdout.write(`  [片段] ${Math.min(i + BATCH, uniq.length)}/${uniq.length} 译出 ${Object.keys(dict).length}\r`);
    await sleep(BATCH_GAP_MS);
  }
  console.log(`\n片段译出 ${Object.keys(dict).length}/${uniq.length} 个`);

  let fixed = 0, improvedPending = 0, unchanged = 0, shown = 0;
  for (const t of list) {
    let zh = stripExtraTail(stripHashtagTail(t.zh0));
    let changed = zh !== t.zh0;
    for (const f of t.frags) {
      const tr = dict[f];
      if (!tr) continue;
      const nz = replaceFrag(zh, f, tr);
      if (nz !== zh) { zh = nz; changed = true; }
    }
    zh = zh.replace(/\s{2,}/g, ' ').trim();
    if (!changed || !hasZh(zh) || zh.length < 6) { unchanged++; continue; }
    const stillSolid = extractFrags(zh);
    if (DRY && shown < DRY_N) { console.log(`  [DRY] id=${t.id} 残留=${stillSolid.length ? stillSolid.join('/') : '无'} "${t.zh0.slice(0, 30)}" → "${zh.slice(0, 36)}"`); shown++; continue; }
    if (!DRY) {
      if (stillSolid.length) { await updTitleZhMark(c, t.id, zh); improvedPending++; }
      else { await updTitleZh(c, t.id, zh); fixed++; }
    } else fixed++;
  }
  console.log(`任务2c 完成：完全修复 ${fixed}，改善但仍有残留（覆盖+打 _mixed_pending）${improvedPending}，无可改进 ${unchanged}`);
  return { fixed, improvedPending, unchanged };
}

/* ================= 任务en：全英标题 _untranslated 重译 ================= */
async function taskEn(c) {
  console.log('\n========== 任务en：全英标题 _untranslated 重译 ==========');
  const { rows } = await c.query(
    `SELECT id, title FROM intel_data
     WHERE created_at >= NOW()-INTERVAL '72 hours'
       AND COALESCE(NULLIF(data_json->>'title_zh',''),title) !~ '[一-龥]'
       AND COALESCE((data_json->>'_untranslated')::boolean, false)
     ORDER BY id`);
  console.log(`全英标题带 _untranslated：${rows.length} 条`);
  const pending = rows.map(r => ({ id: r.id, src: String(r.title || '').trim() })).filter(r => r.src);
  const stats = await runBatches(c, pending, '任务en', (row, out) => {
    const zh = out ? polishTitleFull(out) : '';
    const reason = out ? qcTitle(row.src, zh) : 'api_empty';
    if (!reason) {
      if (DRY) console.log(`  [DRY·通过] id=${row.id} "${row.src.slice(0, 36)}" → "${zh.slice(0, 40)}"`);
      return { act: 'fix', apply: () => updTitleZhClearUntrans(c, row.id, zh) };
    }
    if (DRY) console.log(`  [DRY·拒绝] id=${row.id} 原因=${reason} 译="${zh.slice(0, 40)}"`);
    /* 失败保留 _untranslated 标记（已在，无需 UPDATE） */
    return { act: 'fail', reason, apply: async () => {} };
  });
  console.log(`任务en 完成：重译覆盖并清标 ${stats.fixed}，失败保留标记 ${stats.failed}（${Object.entries(stats.reasons).map(([k, v]) => k + ':' + v).join(', ') || '无'}），接口跳过 ${stats.apiSkip}`);
  return stats;
}

/* ================= 任务3：36589 错位标题 + 全库扫描 ================= */
function buildEventSig(country, title) {
  const parts = String(title || '').split(/[：:，,。！!？?；;、]/).map(s => s.trim()).filter(Boolean);
  return String(country || '') + '|kw|' + parts.join('+');
}
async function task3fix(c) {
  console.log('\n========== 任务3：id 36589 错位标题修复 ==========');
  const { rows } = await c.query(`SELECT id, description, country, data_json FROM intel_data WHERE id = 36589`);
  if (!rows.length) { console.log('id 36589 不存在'); return; }
  const r = rows[0];
  const dj = r.data_json || {};
  if (dj._title_repaired && !RETRY_MARKED) { console.log('已修复过（_title_repaired=true），跳过；--retry-marked 可重做'); return; }
  console.log(`现 title_zh: "${dj.title_zh}"`);
  console.log(`title_en 原文: "${dj.title_en}"`);

  let newTitle = '';
  /* ① 有原文备份（title_en）→ 翻译它 */
  const srcEn = String(dj.title_en || '').trim();
  if (srcEn && !hasZh(srcEn)) {
    const res = await apiTranslate([srcEn]);
    const out = res && res[0] ? polishTitleFull(res[0]) : '';
    const reason = out ? qcTitle(srcEn, out) : 'api_empty';
    console.log(`title_en 翻译结果: "${out}"（质检=${reason || '通过'}）`);
    if (!reason) newTitle = out;
  }
  /* ② 翻译失败/幻觉 → 回退：description 中文正文首句（截 60 字，句号/分号断） */
  if (!newTitle) {
    const body = String(dj.content_zh || r.description || '').trim();
    let first = body.split(/[。；;]/)[0].trim();
    if (first.length > 60) first = first.slice(0, 60);
    if (hasZh(first)) {
      newTitle = first;
      console.log(`回退用正文首句: "${newTitle}"`);
    }
  }
  if (!newTitle) { console.log('两条路径均失败，不修改（保持原状，下次再修）'); return; }

  const sig = buildEventSig(r.country || dj.country, newTitle);
  console.log(`新 title_zh: "${newTitle}"\n新 _eventSig: "${sig}"`);
  if (!DRY) {
    await c.query(
      `UPDATE intel_data SET data_json =
         jsonb_set(jsonb_set(jsonb_set(jsonb_set(data_json, '{title_zh}', to_jsonb($2::text), true),
         '{title}', to_jsonb($2::text), true), '{_eventSig}', to_jsonb($3::text), true),
         '{_title_repaired}', 'true'::jsonb, true)
       WHERE id = $1`, [36589, newTitle, sig]);
    console.log('已 UPDATE（仅 data_json：title_zh/title/_eventSig/_title_repaired）');
  } else console.log('[DRY] 不执行 UPDATE');
}

/* ---------- 只报告不修：7 天 url 域名 vs country 不搭 + 错位特征词 ---------- */
const TLD_COUNTRY = {
  cn: '中国', in: '印度', pk: '巴基斯坦', bd: '孟加拉国', lk: '斯里兰卡', np: '尼泊尔',
  br: '巴西', ar: '阿根廷', cl: '智利', co: '哥伦比亚', pe: '秘鲁', mx: '墨西哥', ve: '委内瑞拉',
  ec: '厄瓜多尔', bo: '玻利维亚', py: '巴拉圭', uy: '乌拉圭',
  ru: '俄罗斯', ua: '乌克兰', pl: '波兰', cz: '捷克', hu: '匈牙利', ro: '罗马尼亚', gr: '希腊',
  fr: '法国', de: '德国', uk: '英国', ie: '爱尔兰', nl: '荷兰', be: '比利时', ch: '瑞士',
  at: '奥地利', se: '瑞典', no: '挪威', fi: '芬兰', dk: '丹麦', pt: '葡萄牙', es: '西班牙', it: '意大利',
  jp: '日本', kr: '韩国', sg: '新加坡', my: '马来西亚', th: '泰国', vn: '越南', ph: '菲律宾',
  id: '印度尼西亚', mm: '缅甸', kh: '柬埔寨', la: '老挝', mn: '蒙古', kz: '哈萨克斯坦',
  ir: '伊朗', iq: '伊拉克', il: '以色列', tr: '土耳其', sa: '沙特', ae: '阿联酋', qa: '卡塔尔',
  eg: '埃及', ly: '利比亚', ma: '摩洛哥', dz: '阿尔及利亚', tn: '突尼斯', sd: '苏丹',
  au: '澳大利亚', nz: '新西兰', ca: '加拿大', us: '美国',
  za: '南非', ng: '尼日利亚', ke: '肯尼亚', tz: '坦桑尼亚', ug: '乌干达', gh: '加纳',
  et: '埃塞俄比亚', zm: '赞比亚', zw: '津巴布韦', mz: '莫桑比克'
};
function domainCountry(url) {
  try {
    const u = new URL(String(url || ''));
    const labels = u.hostname.toLowerCase().split('.').filter(Boolean);
    if (labels.length < 2) return null;
    const secondLast = labels[labels.length - 2];
    const last = labels[labels.length - 1];
    /* co.uk / com.br / com.pk 等二级国别 → 取最末段 */
    const tld = ['co', 'com', 'net', 'org', 'gov', 'edu', 'news', 'web'].includes(secondLast) ? last : last;
    return TLD_COUNTRY[tld] || null;
  } catch (e) { return null; }
}
function countryMatch(a, b) {
  if (!a || !b) return true;
  const x = String(a).trim(), y = String(b).trim();
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  return x.slice(0, 2) === y.slice(0, 2);   /* "沙特" vs "沙特阿拉伯" 类前缀匹配 */
}
async function task3scan(c) {
  console.log('\n========== 任务3 附：7 天同类错位扫描（只报告不修） ==========');
  const { rows } = await c.query(
    `SELECT id, country, source, title, data_json->>'url' AS url, data_json->>'title_zh' AS title_zh,
            COALESCE(data_json->>'content_zh', description) AS body
     FROM intel_data WHERE created_at >= NOW()-INTERVAL '7 days'`);
  console.log(`扫描总数 ${rows.length}`);

  const MISALING_MARK = /任正非|孟晚舟|孟某|胡适|华为/;
  const MISALING_LATIN = /huawei|zhengfei|wanzhou|hu\s*shih/i;
  const tldMismatch = [], cnCovering = [], titleBodyMismatch = [];
  for (const r of rows) {
    /* 启发一：url 域名国别与 country 字段明显不搭（国际来源豁免）。
     * A1（预期形态）：中文媒体域名覆盖外国事件——平台本就聚合中文国际报道，低可疑；
     * A2（可疑）：外国域名 vs 另一外国国别，或中文事件挂外国域名。 */
    if (r.country && r.country !== '国际' && r.url) {
      const dc = domainCountry(r.url);
      if (dc && !countryMatch(dc, r.country)) {
        if (dc === '中国') cnCovering.push(r); else tldMismatch.push(r);
      }
    }
    /* 启发二：标题含错位特征词但正文/信源完全无涉 → 疑似 36589 同类串写。
     * 正文过短/为空时证据不足，跳过（防 31383 类空正文误报）。 */
    const tz = String(r.title_zh || r.title || '');
    if (MISALING_MARK.test(tz)) {
      const body = String(r.body || '');
      const src = String(r.source || '');
      if (body.replace(/\s/g, '').length < 10) continue; /* 证据不足 */
      const bodyHit = MISALING_MARK.test(body) || MISALING_LATIN.test(body + ' ' + src);
      const cnRelated = /中国|涉华/.test(String(r.country || '')) || /中国|涉华|北京|华为/.test(body);
      if (!bodyHit && !cnRelated) titleBodyMismatch.push(r);
    }
  }
  console.log(`\n[A2] 外国 url 域名国别与 country 不搭（${tldMismatch.length} 条，可疑度高，只报告）：`);
  for (const r of tldMismatch.slice(0, 60)) {
    console.log(`  [${r.id}] country=${r.country} url=${String(r.url).slice(0, 70)} title="${String(r.title_zh || r.title).slice(0, 40)}"`);
  }
  if (tldMismatch.length > 60) console.log(`  …（其余 ${tldMismatch.length - 60} 条略）`);
  console.log(`\n[A1] 中文媒体域名覆盖外国事件（${cnCovering.length} 条，预期形态，低可疑，只计数）：`);
  for (const r of cnCovering.slice(0, 5)) {
    console.log(`  [${r.id}] country=${r.country} url=${String(r.url).slice(0, 60)}`);
  }
  console.log(`\n[B] 标题含错位特征词而正文无涉（${titleBodyMismatch.length} 条，疑似 36589 同类串写，只报告）：`);
  for (const r of titleBodyMismatch) {
    console.log(`  [${r.id}] country=${r.country} title="${String(r.title_zh || r.title).slice(0, 46)}" body="${String(r.body).slice(0, 40)}"`);
  }
  console.log(`\n扫描结论：A2（外国域名不搭）${tldMismatch.length} 条、A1（中文媒体覆盖外国，预期形态）${cnCovering.length} 条、B（疑似错位串写）${titleBodyMismatch.length} 条，均未修改（待人工/后续任务确认）。`);
}

/* ================= 主流程 ================= */
(async () => {
  console.log(`ORPS 存量翻译修复 ${DRY ? '【DRY 模式：不执行 UPDATE】' : ''}${RETRY_MARKED ? '【含重试已打标条目】' : ''} ${new Date().toISOString()}`);
  const c = new Client(DB_CONFIG);
  await c.connect();
  try {
    if (TASK.includes('1') || TASK.includes('all')) await task1(c);
    if (TASK.includes('2c')) await task2c(c);
    if (TASK.includes('en')) await taskEn(c);
    if (TASK.includes('2') || TASK.includes('all')) await task2(c);
    if (TASK.includes('3') || TASK.includes('all')) { await task3fix(c); await task3scan(c); }
    if (TASK.includes('scan')) await task3scan(c);
  } finally {
    await c.end();
  }
  console.log('\n全部完成。');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
