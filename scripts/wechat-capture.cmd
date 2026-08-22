@echo off
chcp 65001 >nul
title WeChat Capture (127.0.0.1:8080)
cd /d "%~dp0"
echo ============================================
echo  WeChat profile_ext capture helper
echo  Listening 127.0.0.1:8080 ^| only mp.weixin.qq.com
echo  [wechat-capture] log = credential captured
echo  Close this window to stop
echo ============================================
echo.
"%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\mitmdump.exe" -s "%~dp0wechat-capture.py" --listen-host 127.0.0.1 --listen-port 8080 --set flow_detail=0
echo.
echo [ERROR] mitmdump exited. Screenshot this window and send to assistant.
pause
