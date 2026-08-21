@echo off
chcp 65001 >nul
title 海外利益保护情报预警平台 - 服务启动器

echo ============================================
echo   海外利益保护情报预警平台
echo   PostgreSQL + 后端服务启动器
echo ============================================
echo.

REM 检查 PostgreSQL 是否已在运行
"C:\Users\28737\pgsql\bin\pg_isready.exe" -h 127.0.0.1 -q 2>nul
IF %ERRORLEVEL%==0 (
    echo [OK] PostgreSQL 已在运行
) ELSE (
    echo [1/3] 启动 PostgreSQL...
    REM 清理旧的PID文件
    IF EXIST "C:\Users\28737\pgsql\data\postmaster.pid" DEL /Q "C:\Users\28737\pgsql\data\postmaster.pid"
    
    REM 用 start 命令启动独立进程
    start "PostgreSQL" /B "C:\Users\28737\pgsql\bin\postgres.exe" -D "C:\Users\28737\pgsql\data"
    
    REM 等待启动
    echo       等待数据库就绪...
    SET /a count=0
    :WAIT_PG
    "C:\Users\28737\pgsql\bin\pg_isready.exe" -h 127.0.0.1 -q 2>nul
    IF %ERRORLEVEL%==0 (
        echo       [OK] PostgreSQL 已就绪
        GOTO PG_READY
    )
    SET /a count+=1
    IF %count% GTR 15 (
        echo       [FAIL] PostgreSQL 启动超时
        pause
        exit /b 1
    )
    timeout /t 1 /nobreak >nul
    GOTO WAIT_PG
)

:PG_READY
echo.
echo [2/3] 启动后端服务...
REM 设置环境变量
SET NODE_PATH=C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules
SET PGPASSWORD=orps_dev_pass_2026

REM 启动后端（独立窗口，关闭窗口即停止服务）
start "后端服务 - ORPS Backend" /MIN cmd /c "cd /d C:\Users\28737\Desktop\新建文件夹\server && SET NODE_PATH=C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules && C:\Users\28737\.workbuddy\binaries\node\versions\22.22.2\node.exe server.js"

REM 等待后端就绪
echo       等待后端服务就绪...
SET /a count=0
:WAIT_BE
curl -s -o nul -w "%%{http_code}" http://localhost:3000/ 2>nul | findstr "200" >nul
IF %ERRORLEVEL%==0 (
    echo       [OK] 后端服务已就绪
    GOTO BE_READY
)
SET /a count+=1
IF %count% GTR 15 (
    echo       [WARN] 后端服务启动较慢，请稍等...
    GOTO BE_READY
)
timeout /t 1 /nobreak >nul
GOTO WAIT_BE

:BE_READY
echo.
echo ============================================
echo   系统启动完成!
echo ============================================
echo.
echo   PostgreSQL : 127.0.0.1:5432  [运行中]
echo   后端服务   : http://localhost:3000  [运行中]
echo   管理员账号 : admin / admin123
echo.
echo   请在浏览器中打开: http://localhost:3000
echo.
echo   注意:
echo   - 后端服务在最小化的命令行窗口中运行
echo   - 关闭该窗口会停止后端服务
echo   - PostgreSQL 作为后台进程运行
echo   - 停止 PostgreSQL: 在任务管理器结束 postgres.exe 进程
echo.
echo   按任意键打开浏览器...
pause >nul

REM 打开浏览器
start "" "http://localhost:3000"

echo.
echo   浏览器已打开。此窗口可以关闭。
echo   如需停止所有服务，请运行: stop-services.bat
pause >nul
