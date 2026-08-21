@echo off
REM Start local PostgreSQL portable instance if not already running

set "PGDIR=C:\Users\28737\pgsql"
set "PGDATA=%PGDIR%\data"
set "PGLOG=%PGDIR%\pg.log"

if not exist "%PGDIR%\bin\pg_ctl.exe" (
  echo [ERROR] pg_ctl.exe not found: %PGDIR%\bin\pg_ctl.exe
  exit /b 1
)

"%PGDIR%\bin\pg_ctl.exe" status -D "%PGDATA%" >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] PostgreSQL already running
  exit /b 0
)

echo [INFO] Starting PostgreSQL...
"%PGDIR%\bin\pg_ctl.exe" start -D "%PGDATA%" -l "%PGLOG%"
if %errorlevel% neq 0 (
  echo [ERROR] PostgreSQL failed to start, check log: %PGLOG%
  exit /b 1
)

echo [OK] PostgreSQL started
exit /b 0
