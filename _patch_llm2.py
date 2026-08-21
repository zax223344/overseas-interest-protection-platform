# -*- coding: utf-8 -*-
# LLM 双通道：Kimi 主、讯飞星火备（任一可用即出稿）
import io
p = 'server/server.js'
s = io.open(p, encoding='utf-8').read()

# 1) 端点内联调用 → 重构为主备双通道
old_call = """    const t0 = Date.now();
    const https = require('https');
    const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 6000 }); /* kimi-k2.6 为推理模型：reasoning 先耗额度，max_tokens 要给足；仅允许 temperature=1，不传默认 */
    const llmRes = await new Promise((resolve, reject) => {
      const u = new URL(BASE + '/chat/completions');
      const rq = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 150000, /* 推理模型 reasoning 耗时，放宽到 150s */ headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY, 'Content-Length': Buffer.byteLength(body) } }, resolve);
      rq.on('error', reject);
      rq.on('timeout', () => { rq.destroy(); reject(new Error('大模型调用超时')); });
      rq.end(body);
    });
    const chunks = [];
    llmRes.on('data', c => chunks.push(c));
    await new Promise(r => llmRes.on('end', r));
    const raw = Buffer.concat(chunks).toString('utf8');
    let j = {};
    try { j = JSON.parse(raw); } catch (e) { return res.status(502).json({ ok: false, error: '大模型返回解析失败: ' + raw.slice(0, 200) }); }
    if (j.error) {
      const msg = /insufficient balance|exceeded_current_quota/i.test(j.error.message || '') ? '大模型账户欠费停机，充值后立即可用' : (j.error.message || '大模型调用失败');
      return res.status(502).json({ ok: false, error: msg, raw: (j.error.type || '') });
    }
    const _msg = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message : {};
    const text = _msg.content || ''; /* 推理模型 content 为最终输出，reasoning_content 不展示 */
    if (!text) return res.status(502).json({ ok: false, error: '大模型返回空内容' });
    _llmCache = { at: Date.now(), key: sig, text: text, model: MODEL };
    res.json({ ok: true, text: text, model: MODEL, elapsed: ((Date.now() - t0) / 1000).toFixed(1) + 's', at: new Date().toISOString() });"""
new_call = """    const t0 = Date.now();
    /* 主备双通道（2026-08-16）：Kimi 主、讯飞星火备——任一可用即出稿 */
    const providers = [
      { name: 'Kimi', base: BASE, key: KEY, model: MODEL, maxTokens: 6000, timeout: 150000 },
      { name: 'Spark', base: (process.env.LLM2_BASE_URL || 'https://spark-api-open.xf-yun.com/v1').replace(/\\/+$/, ''), key: process.env.LLM2_API_KEY || '', model: process.env.LLM2_MODEL || '4.0Ultra', maxTokens: 3000, timeout: 90000 }
    ].filter(x => x.key);
    let text = '', usedModel = '', usedBy = '', lastErr = '';
    for (const pv of providers) {
      try {
        const r2 = await _callOpenAiCompat(pv, prompt);
        if (r2.text) { text = r2.text; usedModel = pv.model; usedBy = pv.name; break; }
        lastErr = pv.name + ': ' + (r2.error || '空内容');
      } catch (e) { lastErr = pv.name + ': ' + e.message; }
      console.warn('[LLM] ' + pv.name + ' 失败，切换下一通道:', lastErr);
    }
    if (!text) {
      const friendly = /insufficient balance|exceeded_current_quota/i.test(lastErr) ? '大模型账户欠费停机，充值后立即可用'
        : /HMAC|does not match|Unauthorized|401/i.test(lastErr) ? '大模型密钥鉴权失败（请核对控制台完整密钥）'
        : (lastErr || '大模型调用失败');
      return res.status(502).json({ ok: false, error: friendly, raw: lastErr });
    }
    _llmCache = { at: Date.now(), key: sig, text: text, model: usedModel };
    res.json({ ok: true, text: text, model: usedModel + (usedBy === 'Spark' ? '（星火备援）' : ''), elapsed: ((Date.now() - t0) / 1000).toFixed(1) + 's', at: new Date().toISOString() });"""
assert s.count(old_call) == 1, 'call anchor'
s = s.replace(old_call, new_call)

# 2) 通用 OpenAI 兼容调用助手（插在端点前）
anchor2 = "let _llmCache = { at: 0, key: '', text: '', model: '' };"
helper = """/* OpenAI 兼容协议通用调用（Kimi/星火/其他兼容服务通用） */
function _callOpenAiCompat(pv, prompt) {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const body = JSON.stringify({ model: pv.model, messages: [{ role: 'user', content: prompt }], max_tokens: pv.maxTokens });
      const u = new URL(pv.base + '/chat/completions');
      const rq = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: pv.timeout, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pv.key, 'Content-Length': Buffer.byteLength(body) } }, (llmRes) => {
        const chunks = [];
        llmRes.on('data', c => chunks.push(c));
        llmRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let j = {};
          try { j = JSON.parse(raw); } catch (e) { return resolve({ text: '', error: '返回解析失败: ' + raw.slice(0, 160) }); }
          if (j.error || (j.code && j.code !== 0)) {
            const m = (j.error && j.error.message) || j.message || ('code ' + j.code);
            return resolve({ text: '', error: m });
          }
          const msg = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message : {};
          resolve({ text: msg.content || '', error: msg.content ? '' : '空内容' });
        });
      });
      rq.on('error', e => resolve({ text: '', error: e.message }));
      rq.on('timeout', () => { rq.destroy(); resolve({ text: '', error: '调用超时' }); });
      rq.end(body);
    } catch (e) { resolve({ text: '', error: e.message }); }
  });
}

let _llmCache = { at: 0, key: '', text: '', model: '' };"""
assert s.count(anchor2) == 1
s = s.replace(anchor2, helper)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
