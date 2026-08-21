@echo off
chcp 65001 >nul
REM Setup ORPS auto-start scheduled tasks (run as Administrator)

set "PROJECT_ROOT=C:\Users\28737\Desktop\新建文件夹"
set "TASK_FOLDER=ORPS"

schtasks /delete /tn "%TASK_FOLDER%\PostgresBoot" /f >nul 2>&1
schtasks /delete /tn "%TASK_FOLDER%\ServerBoot" /f >nul 2>&1

schtasks /create /tn "%TASK_FOLDER%\PostgresBoot" /tr "\"%PROJECT_ROOT%\scripts\start-postgres.bat\"" /sc onstart /ru "%USERNAME%" /rl highest /f
if %errorlevel% neq 0 (
  echo [ERROR] Failed to create PostgresBoot task. Run as Administrator.
  exit /b 1
)

schtasks /create /tn "%TASK_FOLDER%\ServerBoot" /tr "wscript.exe \"%PROJECT_ROOT%\scripts\start-orps-silent.vbs\"" /sc onlogon /delay 0000:30 /ru "%USERNAME%" /rl highest /f
if %errorlevel% neq 0 (
  echo [ERROR] Failed to create ServerBoot task. Run as Administrator.
  exit /b 1
)

echo [OK] ORPS auto-start tasks installed.
echo [INFO] Check: Task Scheduler -> Task Scheduler Library -> %TASK_FOLDER%
pause
