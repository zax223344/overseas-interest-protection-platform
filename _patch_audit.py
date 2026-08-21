# -*- coding: utf-8 -*-
# 闸门埋点：_postGate / 写入闸 / 哨兵 / 服务端生成器
import io
p = 'server/server.js'
s = io.open(p, encoding='utf-8').read()

# 1) _postGate 各拒绝点
subs = [
 ("""async function _postGate(item) {
  if (!item || !item.title) return 'empty';
  if (_POST_BLOCK_RE.test(String(item.title || '') + ' ' + String(item.title_zh || ''))) return 'blocked';""",
  """async function _postGate(item) {
  if (!item || !item.title) { _gateAudit('入库闸', 'empty', ''); return 'empty'; }
  if (_POST_BLOCK_RE.test(String(item.title || '') + ' ' + String(item.title_zh || ''))) { _gateAudit('入库闸', 'blocked-blacklist', item.title); return 'blocked'; }"""),
 ("""      if (rows.length) return 'dup-exact-title';""",
  """      if (rows.length) { _gateAudit('入库闸', 'dup-exact-title', item.title); return 'dup-exact-title'; }"""),
 ("""  if (contentLooksEmpty) return 'shell-content';""",
  """  if (contentLooksEmpty) { _gateAudit('入库闸', 'shell-content', item.title); return 'shell-content'; }"""),
 ("""  if (!_isFreshEnough(item)) return 'stale';""",
  """  if (!_isFreshEnough(item)) { _gateAudit('入库闸', 'stale', item.title); return 'stale'; }"""),
]
for o, n in subs:
    c = s.count(o)
    print('postGate anchor:', c, o[40:70].replace('\n', ' '))
    if c == 1: s = s.replace(o, n, 1)

# 2) 写入闸各拒绝点
subs2 = [
 ("""        if (!a) return false;
        const txt = String(a.title || '') + String(a.title_zh || '');
        if (!a.url && _POST_BLOCK_RE.test(txt)) return false;""",
  """        if (!a) return false;
        const txt = String(a.title || '') + String(a.title_zh || '');
        if (!a.url && _POST_BLOCK_RE.test(txt)) { _gateAudit('写入闸', 'blacklist', a.title); return false; }"""),
 ("""        if (_isShellAlert(a)) return false; /* 模板空壳一律拒收（旧客户端自我造血终局拦截） */""",
  """        if (_isShellAlert(a)) { _gateAudit('写入闸', 'shell', a.title); return false; } /* 模板空壳一律拒收 */"""),
 ("""        if (_isRuUaNoLink(a)) return false; /* 俄乌无涉华关联一律拒收 */""",
  """        if (_isRuUaNoLink(a)) { _gateAudit('写入闸', 'ruua-nolink', a.title); return false; }"""),
 ("""        if (_alertInterestScore(a).score < 20) return false; /* 全级别利益关联闸（2026-08-17）：无关联即非预警 */""",
  """        if (_alertInterestScore(a).score < 20) { _gateAudit('写入闸', 'no-interest', a.title); return false; }"""),
]
for o, n in subs2:
    c = s.count(o)
    print('writeGate anchor:', c, o[8:60].replace('\n', ' '))
    if c == 1: s = s.replace(o, n, 1)

# 3) 哨兵移出埋点
o = """    if (demoted.length) {
      await query('UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2', [JSON.stringify(kept), 'alerts']);
      console.log('[VALUE-SENTINEL] 移出无利益关联低烈度预警 ' + demoted.length + ' 条，保留 ' + kept.length + ' 条（红/橙全保留）');
    }"""
n = """    if (demoted.length) {
      demoted.forEach(a => _gateAudit('哨兵', 'demote', a.title));
      await query('UPDATE datahub_store SET data_json=$1::jsonb, updated_at=now() WHERE collection=$2', [JSON.stringify(kept), 'alerts']);
      console.log('[VALUE-SENTINEL] 移出无利益关联低烈度预警 ' + demoted.length + ' 条，保留 ' + kept.length + ' 条（红/橙全保留）');
    }"""
c = s.count(o); print('sentinel anchor:', c)
if c == 1: s = s.replace(o, n, 1)

# 4) 服务端生成器跳过埋点
subs4 = [
 ("      if (lv === 'blue') continue;",
  "      if (lv === 'blue') { _gateAudit('预警生成', 'blue-level', it.title); continue; }"),
 ("      if (it.interestLinked === false) continue;",
  "      if (it.interestLinked === false) { _gateAudit('预警生成', 'not-linked', it.title); continue; }"),
 ("      if (_isShellAlert(it)) continue; /* 模板空壳永不生成预警 */",
  "      if (_isShellAlert(it)) { _gateAudit('预警生成', 'shell', it.title); continue; }"),
 ("      if (_isRuUaNoLink(it)) continue; /* 俄乌无涉华关联不入预警（2026-08-17 用户指令） */",
  "      if (_isRuUaNoLink(it)) { _gateAudit('预警生成', 'ruua-nolink', it.title); continue; }"),
 ("      if (_srvAlertScore(it) < 20) continue;",
  "      if (_srvAlertScore(it) < 20) { _gateAudit('预警生成', 'low-interest', it.title); continue; }"),
]
for o, n in subs4:
    c = s.count(o)
    print('gen anchor:', c, o[:44])
    if c == 1: s = s.replace(o, n, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
