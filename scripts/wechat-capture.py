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
OUT_FILE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         '..', 'server', '.cache', 'wechat-biz.json'))

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

    def response(self, flow: http.HTTPFlow):
        try:
            if flow.request.pretty_host != HOST:
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
