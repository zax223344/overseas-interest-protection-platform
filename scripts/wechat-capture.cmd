@echo off
chcp 65001 >nul
title 微信抓包助手 (127.0.0.1:8080) - 别关这个窗口
cd /d "%~dp0"
echo ============================================
echo  微信 profile_ext 抓包助手
echo  监听 127.0.0.1:8080 ^| 只截 mp.weixin.qq.com
echo  抓到凭证会显示 [wechat-capture] 日志
echo  关闭本窗口即停止抓包
echo ============================================
echo.
"%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\mitmdump.exe" -s "%~dp0wechat-capture.py" --listen-host 127.0.0.1 --listen-port 8080 --set flow_detail=0
echo.
echo [异常退出] 请把上面的报错截图发给助手
pause
