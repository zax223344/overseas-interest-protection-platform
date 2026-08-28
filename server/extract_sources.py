# extract_sources.py — 解析 server/sources.yaml 生成 server/sources-registry.js
import io, json, sys

SRC = r"C:\Users\28737\Desktop\新建文件夹\server\sources.yaml"
OUT = r"C:\Users\28737\Desktop\新建文件夹\server\sources-registry.js"

yaml_text = io.open(SRC, encoding='utf-8').read()

entries = []
cur = {}
for line in yaml_text.split('\n'):
    if line.startswith('- id:'):
        if cur: entries.append(cur)
        cur = {'id': line.split(':', 1)[1].strip()}
    elif cur and line.startswith('    - '):
        url = line.strip()[2:].strip()
        if 'feeds' in cur: cur['feeds'].append(url)
    elif cur and line.startswith('  ') and ':' in line:
        key, _, val = line.strip().partition(':')
        key = key.strip(); val = val.strip()
        if key in ('name', 'country', 'region', 'language', 'stance', 'access', 'url'):
            cur[key] = val
        elif key == 'feeds':
            cur['feeds'] = []
        elif key == 'risk_topics':
            cur['risk_topics'] = [x.strip() for x in val.strip('[]').split(',') if x.strip()]
        elif key == 'api':
            cur['api'] = val.strip('"')
if cur: entries.append(cur)

print(f"parsed {len(entries)} sources")
print("by access:", {a: sum(1 for e in entries if e.get('access') == a) for a in ('feeds', 'web', 'api')})
print("by stance:", {s: sum(1 for e in entries if e.get('stance') == s) for s in 'GINWC'})
missing = [e['id'] for e in entries if not all(k in e for k in ('id', 'name', 'country', 'access', 'url'))]
print("missing required fields:", missing if missing else "none")

js = "/* sources-registry.js — 开源数据源注册表（2026-08-28 从用户工程包 sources.yaml 转换）\n"
js += " * stance 立场标签：G=政府控制 I=独立商业 N=非营利调查 W=西方中心 C=中国官方亲双边\n"
js += " * 证据链铁律：事件被 ≥2 个不同 stance 的源报道 → verified（多立场交叉验证）\n"
js += " * 接入方式：feeds 类由 sources-collector 直采；web/api 类标注待验证\n */\n"
js += "'use strict';\n\nconst SOURCES = " + json.dumps(entries, ensure_ascii=False, indent=2) + ";\n\n"
js += """function byStance(stance) { return SOURCES.filter(s => s.stance === stance); }
function rssSources() { return SOURCES.filter(s => s.access === 'feeds' && Array.isArray(s.feeds) && s.feeds.length); }
function get(id) { return SOURCES.find(s => s.id === id) || null; }
module.exports = { SOURCES, byStance, rssSources, get };
"""
io.open(OUT, 'w', encoding='utf-8').write(js)
print("written:", OUT)

rss = [e for e in entries if e.get('access') == 'feeds' and e.get('feeds')]
print(f"\nfeeds 类源 {len(rss)} 个")
