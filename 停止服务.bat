@echo off
chcp 65001 >nul
title 停止所有服务

echo ============================================
echo   停止所有服务
echo ============================================
echo.

echo [1/2] 停止后端服务...
taskkill /FI "WINDOWTITLE eq 后端服务*" /F 2>nul
IF %ERRORLEVEL%==0 (
    echo       [OK] 后端服务已停止
) ELSE (
    echo       [INFO] 后端服务未运行
)

echo.
echo [2/2] 停止 PostgreSQL...
"C:\Users\28737\pgsql\bin\pg_ctl.exe" -D "C:\Users\28737\pgsql\data" stop -m fast 2>nul
IF %ERRORLEVEL%==0 (
    echo       [OK] PostgreSQL 已停止
) ELSE (
    echo       [INFO] PostgreSQL 可能已停止或未运行
)

echo.
echo ============================================
echo   所有服务已停止
echo ============================================
echo.
pause
