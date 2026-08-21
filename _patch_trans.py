# -*- coding: utf-8 -*-
# server.js 翻译升级：auto 源语言 + 质量校验 + EN pivot + 拦截审计
import io
p = 'server/server.js'
s = io.open(p, encoding='utf-8').read()

# 1) TranSmart 支持 auto 源语言 + 目标语言参数
o = """async function _tryTranSmart(text) {
  const src = String(text || '').slice(0, 2000);
  if (!src.trim()) return '';"""
n = """async function _tryTranSmart(text, from, to) {
  const src = String(text || '').slice(0, 2000);
  if (!src.trim()) return '';
  from = from || 'auto'; to = to || 'zh';"""
assert s.count(o) == 1; s = s.replace(o, n, 1)

o = """      source: { lang: 'en', text_list: ['', src, ''] },
      target: { lang: 'zh' }"""
n = """      source: { lang: from, text_list: ['', src, ''] },
      target: { lang: to }"""
assert s.count(o) == 1; s = s.replace(o, n, 1)

# 2) 质量校验 + pivot：替换 _translateAny 整体
old_start = "async function _translateAny(text) {"
i1 = s.index(old_start)
i2 = s.index("/* 采集即译：把一批情报的标题+正文翻译成中文", i1)
new_translate = '''/* 翻译质量校验（2026-08-17 用户指令：译文必须是合格中文，不是原文复读/乱码）：
 * ① 非空且≠原文 ② 含足量中文（CJK 占比≥15%）③ 长度比合理（0.2x~4x）④ 无大面积未译外文 */
function _translationOk(src, dst) {
  const a = String(src || '').trim(), b = String(dst || '').trim();
  if (!a || !b) return false;
  if (b === a) return false;
  const cjk = (b.match(/[一-龥]/g) || []).length;
  if (cjk < 2) return false;
  if (cjk / b.length < 0.15) return false;
  const ratio = b.length / Math.max(1, a.length);
  if (ratio < 0.2 || ratio > 4) return false;
  return true;
}

async function _translateAny(text) {
  const baiduId = process.env.BAIDU_TRANSLATE_APPID;
  const baiduKey = process.env.BAIDU_TRANSLATE_KEY;
  const src = String(text || '');
  if (!src.trim()) return '';
  /* 1) 腾讯 TranSmart（auto 源语言，2026-08-17 修：原来写死 en→小语种必出乱码） */
  try {
    const r = await _tryTranSmart(src);
    if (_translationOk(src, r)) return r;
  } catch (e) { console.warn('[TRANSLATE] TranSmart 失败，试有道:', e.message); }
  /* 2) 有道（from=Auto 本就支持自动识别） */
  try {
    const r = await _tryYoudao(src);
    if (_translationOk(src, r)) return r;
  } catch (e) { console.warn('[TRANSLATE] 有道失败，试 Baidu:', e.message); }
  /* 3) Baidu */
  if (baiduId && baiduKey) {
    try {
      const r = await _baiduTranslateRetry(src, baiduId, baiduKey);
      if (_translationOk(src, r)) return r.trim();
    } catch (e) { console.warn('[TRANSLATE] Baidu 失败，试 MyMemory:', e.message); }
  }
  /* 4) MyMemory */
  try {
    const tr = await _myMemoryOne(src.slice(0, 500), MYMEMORY_KEY);
    if (_translationOk(src, tr)) return tr.trim();
  } catch (e) {}
  /* 5) LibreTranslate */
  try {
    const lr = await _tryLibreTranslate([src.slice(0, 500)]);
    if (lr && lr[0] && _translationOk(src, lr[0])) return lr[0].trim();
  } catch (e) {}
  /* 6) 小语种 pivot（2026-08-17 用户指令：小语种先译英文再译中文）：
   * 直译全部不合格时，先 auto→en（TranSmart 英译覆盖好），en 再→zh 走主链 */
  try {
    const en = await _tryTranSmart(src, 'auto', 'en');
    if (en && en.trim() && en.trim() !== src.trim() && /[a-zA-Z]{4}/.test(en)) {
      const zh = await _tryTranSmart(en, 'en', 'zh').catch(() => '');
      if (_translationOk(en, zh)) { console.log('[TRANSLATE] pivot(en) 成功:', src.slice(0, 24)); return zh.trim(); }
      const zh2 = await _tryYoudao(en).catch(() => '');
      if (_translationOk(en, zh2)) { console.log('[TRANSLATE] pivot(en) 成功(有道):', src.slice(0, 24)); return zh2.trim(); }
    }
  } catch (e) {}
  /* 7) Edge 微软翻译 */
  try {
    const er = await _tryEdge([src.slice(0, 500)]);
    if (er && er[0] && _translationOk(src, er[0])) return er[0].trim();
  } catch (e) {}
  return ''; /* 全部不合格 → 返回空，调用方保留原文并打 _untranslated 标记，绝不入库乱码 */
}
'''
s = s[:i1] + new_translate + s[i2:]

# 3) 拦截审计基础设施（插在 _alertInterestScore 前）
o = "function _alertInterestScore(a) {"
n = '''/* ===== 拦截审计（2026-08-17 用户指令：闸门拦了什么必须可见可审计）===== */
const _GATE_AUDIT = { since: new Date().toISOString(), total: 0, by: {}, samples: {} };
function _gateAudit(gate, reason, title) {
  try {
    _GATE_AUDIT.total++;
    const k = gate + '|' + reason;
    _GATE_AUDIT.by[k] = (_GATE_AUDIT.by[k] || 0) + 1;
    const arr = _GATE_AUDIT.samples[k] || (_GATE_AUDIT.samples[k] = []);
    arr.unshift({ t: new Date().toTimeString().slice(0, 5), title: String(title || '').slice(0, 70) });
    if (arr.length > 5) arr.length = 5;
  } catch (e) {}
}
app.get('/api/quality/gates', authMiddleware, (req, res) => {
  const rows = Object.keys(_GATE_AUDIT.by).map(k => {
    const [gate, reason] = k.split('|');
    return { gate, reason, count: _GATE_AUDIT.by[k], samples: _GATE_AUDIT.samples[k] || [] };
  }).sort((a, b) => b.count - a.count);
  res.json({ since: _GATE_AUDIT.since, total: _GATE_AUDIT.total, rows });
});

function _alertInterestScore(a) {'''
assert s.count(o) == 1; s = s.replace(o, n, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
