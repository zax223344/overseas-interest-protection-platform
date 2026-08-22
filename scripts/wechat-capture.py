# -*- coding: utf-8 -*-
"""
微信公众号 profile_ext 凭证抓包助手（mitmproxy addon）
=====================================================
用途：PC 微信打开公众号「历史消息」页时，客户端会向
    mp.weixin.qq.com/mp/profile_ext?action=home / action=getmsg
发起请求。本脚本只截获这一个域名的这两类请求（域名+路径双重白名单，
绝不动其他流量），自动提取：
    __biz + Cookie + User-Agent + getmsg 完整查询参数(uin/key/pass_ticket 等)
并写入  server/.cache/wechat-biz.json ，供 server/wechat-profile.js 重放拉取。

启动（项目根目录）：
    scripts\\wechat-capture.cmd
或手动：
    mitmdump -s scripts/wechat-capture.py --listen-host 127.0.0.1 --listen-port 8080

用户操作：微信「设置-通用-网络代理」指向 127.0.0.1:8080（或系统代理），
安装 mitmproxy CA 证书后，依次点开各公众号历史消息页即可，每个号停留约 5 秒。
"""
import json
import os
import re
import time
from urllib.parse import urlparse, parse_qs

from mitmproxy import ctx, http

HOST = 'mp.weixin.qq.com'
PATH_PREFIX = '/mp/profile_ext'
HOST2 = 'channels.weixin.qq.com'   # 新版微信 4.x：公众号主页/历史消息改走视频号域
OUT_FILE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         '..', 'server', '.cache', 'wechat-biz.json'))
DBG_FILE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         '..', 'server', '.cache', 'wechat-capture-debug.log'))
DBG_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        '..', 'server', '.cache', 'wechat-dbg-resp'))

# 公众号昵称：历史消息页 HTML 里的几种真实出现形式（2026-08 实测 PC 微信 4.x）
_NICK_RES = [
    re.compile(r'var\s+nickname\s*=\s*["\']([^"\']+)["\']'),
    re.compile(r'"nickname"\s*:\s*"([^"]+)"'),
    re.compile(r'class="profile_nickname"[^>]*>\s*([^<]+?)\s*<'),
    re.compile(r'<title>([^<]+?)</title>'),
]


def _load():
    try:
        with open(OUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(db):
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    tmp = OUT_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT_FILE)


def _unescape_js(s):
    return s.replace('\\x26', '&').replace('\\u0026', '&').replace('&amp;', '&')


class WeChatProfileCapture:
    """只截 mp.weixin.qq.com/mp/profile_ext 的凭证，其他流量一律放行不记录。"""

    def request(self, flow: http.HTTPFlow):
        """诊断（2026-08-22）：把微信域名的请求路径全部落日志，用于判断
         * 新版 PC 微信是否还走 profile_ext、以及流量是否真的经过本代理。"""
        try:
            host = flow.request.pretty_host or ''
            if 'weixin' in host or 'wechat' in host:
                with open(DBG_FILE, 'a', encoding='utf-8') as f:
                    f.write('%d %s %s%s\n' % (int(time.time()), flow.request.method, host, flow.request.path[:220]))
                # 新版微信 4.x：公众号主页走 channels 域，存完整请求头供精确重放
                if host == HOST2 and '/web/' in flow.request.path and 'report' not in flow.request.path:
                    try:
                        os.makedirs(DBG_DIR, exist_ok=True)
                        with open(os.path.join(DBG_DIR, 'last-channels-request.json'), 'w', encoding='utf-8') as f:
                            json.dump({
                                'url': 'https://' + host + flow.request.path,
                                'headers': dict(flow.request.headers),
                                'at': int(time.time()),
                            }, f, ensure_ascii=False, indent=1)
                    except Exception:
                        pass
                # 新版微信 4.x：文章页内 XHR 自带 uin+key（profile_ext getmsg 的全部所需凭证），
                # 完整提取（不截断！），与同一 URL 里的 __biz 关联存库。
                p = flow.request.path
                if host == HOST and 'uin=' in p and 'key=' in p:
                    qs = parse_qs(urlparse(p).query)
                    uin = (qs.get('uin') or [''])[0]
                    key = (qs.get('key') or [''])[0]
                    biz = (qs.get('__biz') or qs.get('biz') or [''])[0]
                    if uin and key and len(key) >= 32:
                        db = _load()
                        sk = '_session'   # uin+key 是全账号通用的会话凭证，与 biz 无关
                        e = db.get(sk) or {}
                        e.update({'uin': uin, 'key': key,
                                  'cookie': flow.request.headers.get('cookie', e.get('cookie', '')),
                                  'ua': flow.request.headers.get('user-agent', e.get('ua', '')),
                                  # 新版微信可能把凭证放在 x-wechat-* 头里，全量存头便于精确重放
                                  'headers': {k: v for k, v in flow.request.headers.items()
                                              if k.lower() not in ('content-length', 'host', 'connection')},
                                  'sample_path': p[:400],
                                  'captured_at': int(time.time())})
                        db[sk] = e
                        if biz:
                            be = db.get(biz) or {'__biz': biz}
                            be['captured_at'] = int(time.time())
                            be['getmsg_captured'] = True   # 标记：该号已见过 biz，可配合会话凭证重放
                            db[biz] = be
                        _save(db)
                        ctx.log.info('[wechat-capture] session creds captured, biz=%s', biz or '?')
        except Exception:
            pass

    def response(self, flow: http.HTTPFlow):
        try:
            host = flow.request.pretty_host
            # —— 新版通道（微信 4.x）：公众号主页走 channels.weixin.qq.com/web/pages/mp_profile ——
            # 先把该域的响应落盘分析结构（2026-08-22 实测旧版 profile_ext 已不再被调用）
            if host == HOST2 and flow.response and flow.response.content:
                try:
                    os.makedirs(DBG_DIR, exist_ok=True)
                    u2 = urlparse(flow.request.path)
                    fn = re.sub(r'[^A-Za-z0-9_.-]', '_', (u2.path.strip('/') or 'root'))[:80]
                    fn = '%d_%s.txt' % (int(time.time() * 1000) % 10**10, fn)
                    with open(os.path.join(DBG_DIR, fn), 'wb') as f:
                        f.write(b'URL: ' + (host + flow.request.path).encode('utf-8', 'ignore') + b'\n')
                        f.write(b'COOKIE: ' + flow.request.headers.get('cookie', '').encode('utf-8', 'ignore') + b'\n')
                        ct = flow.response.headers.get('content-type', '')
                        f.write(b'CT: ' + ct.encode() + b'\n\n')
                        f.write(flow.response.content[:200000])
                except Exception:
                    pass
                return
            if host != HOST:
                return
            u = urlparse(flow.request.path)
            if not u.path.startswith(PATH_PREFIX):
                return
            qs = parse_qs(u.query)
            biz = (qs.get('__biz') or [''])[0]
            if not biz:
                return
            action = (qs.get('action') or [''])[0]

            db = _load()
            e = db.get(biz) or {'__biz': biz}
            e['captured_at'] = int(time.time())
            # 任何 profile_ext 请求都带登录态 Cookie，逐次刷新保证最新
            cookie = flow.request.headers.get('cookie', '')
            if cookie:
                e['cookie'] = cookie
            ua = flow.request.headers.get('user-agent', '')
            if ua:
                e['ua'] = ua

            if action == 'getmsg':
                # 完整保存真实 getmsg 查询参数模板（uin/key/pass_ticket/wxtoken 等）
                e['query'] = {k: v[0] for k, v in qs.items()
                              if k not in ('offset', 'count', '_')}
                e['getmsg_captured'] = True
                e.pop('stale', None)
                e.pop('stale_reason', None)

            if action == 'home' and flow.response and flow.response.content:
                html = flow.response.content.decode('utf-8', 'ignore')
                for rx in _NICK_RES:
                    m = rx.search(html)
                    if m and m.group(1).strip():
                        e['name'] = m.group(1).strip()
                        break

            db[biz] = e
            _save(db)
            ctx.log.info('[wechat-capture] %s biz=%s name=%s',
                         action or '?', biz, e.get('name', '(未知号)'))
        except Exception as exc:  # 抓包脚本绝不能让代理崩掉
            ctx.log.warn('[wechat-capture] error: %r' % (exc,))


addons = [WeChatProfileCapture()]
