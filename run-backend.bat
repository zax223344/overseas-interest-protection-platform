@echo off
chcp 65001 >nul
title 海外利益保护情报预警平台 - 常驻服务

REM 设置后端运行所需环境变量
set NODE_PATH=C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules
set PGPASSWORD=orps_dev_pass_2026

REM 清理可能残留的 PID 文件
if exist "C:\Users\28737\pgsql\data\postmaster.pid" del /q "C:\Users\28737\pgsql\data\postmaster.pid"

REM 后台启动 PostgreSQL
start "PostgreSQL" /B "C:\Users\28737\pgsql\bin\postgres.exe" -D "C:\Users\28737\pgsql\data"

REM 等待数据库就绪
timeout /t 4 /nobreak >nul

REM 前台运行后端（进程不退出，任务保持运行，服务常驻）
C:\Users\28737\.workbuddy\binaries\node\versions\22.22.2\node.exe C:\Users\28737\Desktop\新建文件夹\server\server.js
