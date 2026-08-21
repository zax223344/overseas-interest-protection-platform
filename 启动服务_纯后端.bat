@echo off
chcp 65001 >nul
title 海外利益保护情报预警平台 - 后端守护(纯后端/崩溃自启)
echo ============================================
echo   后端服务守护启动器 (无需 PostgreSQL)
echo   崩溃/退出将自动重启；关闭本窗口即停止
echo ============================================
echo.

SET NODE=C:\Users\28737\.workbuddy\binaries\node\versions\22.22.2\node.exe
SET SRV=C:\Users\28737\Desktop\新建文件夹\server\server.js
SET NODE_PATH=C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules

:LOOP
echo [%date% %time%] 启动后端服务...
"%NODE%" "%SRV%"
echo [%date% %time%] 后端服务已退出，3秒后自动重启...
timeout /t 3 /nobreak >nul
GOTO LOOP
