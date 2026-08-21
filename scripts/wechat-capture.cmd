@echo off
rem 微信 profile_ext 凭证抓包助手启动器（监听 127.0.0.1:8080，只截 mp.weixin.qq.com）
"%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\mitmdump.exe" -s "%~dp0wechat-capture.py" --listen-host 127.0.0.1 --listen-port 8080 --set flow_detail=0
