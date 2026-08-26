#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GNews RSS 重定向链接解析助手（Node 调用）。
背景：Google News RSS 的 <link> 现在是指向 news.google.com 的包装页，
      无法直接抓取正文。本脚本调用 googlenewsdecoder 包，把包装 URL
      还原为真实出版商 URL。
用法：python decode-gnews.py <url>
输出：stdout 打印 JSON {ok:true, url:"..."} 或 {ok:false, error:"..."}
"""
import json
import sys

try:
    from googlenewsdecoder import gnewsdecoder
except ImportError as e:
    print(json.dumps({"ok": False, "error": "googlenewsdecoder not installed: " + str(e)}))
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing url argument"}))
        sys.exit(1)
    url = sys.argv[1].strip()
    if not url:
        print(json.dumps({"ok": False, "error": "empty url"}))
        sys.exit(1)
    try:
        r = gnewsdecoder(url, interval=None)
        if r.get("status") and r.get("decoded_url"):
            print(json.dumps({"ok": True, "url": r["decoded_url"]}))
        else:
            print(json.dumps({"ok": False, "error": r.get("message", "unknown decode error")}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
