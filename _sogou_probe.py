import re
html = open('/tmp/sogou.html', encoding='utf-8', errors='ignore').read()
# 结果块：txt-box
blocks = re.findall(r'<div class="txt-box">([\s\S]*?)</li>', html)
print('blocks:', len(blocks))
for b in blocks[:6]:
    m = re.search(r'<h3>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', b)
    if not m:
        continue
    href, title = m.group(1), re.sub(r'<[^>]+>', '', m.group(2)).strip()
    acc = re.search(r'account_name[^>]*>([\s\S]*?)</a>|class="account"[^>]*>([\s\S]*?)</a>', b)
    acc_t = ''
    if acc:
        acc_t = re.sub(r'<[^>]+>', '', acc.group(1) or acc.group(2) or '').strip()
    t = re.search(r'timeConvert\(\'?(\d{10})', b) or re.search(r'document.write\(timeConvert\(\'?(\d+)', b) or re.search(r't="(\d{10})"', b)
    print('-', title[:42], '|', href[:90], '|', acc_t, '| t=', t.group(1) if t else '')
# 看看有没有 sogou 跳转链接样式
print('--- sample hrefs ---')
for h in re.findall(r'href="(/link\?url=[^"]+)"', html)[:3]:
    print(h[:100])
