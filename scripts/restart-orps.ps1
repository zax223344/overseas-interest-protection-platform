# Restart ORPS backend

$PROJECT_ROOT = "C:\Users\28737\Desktop\新建文件夹"
$PM2          = "C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules\.bin\pm2.cmd"

function Start-PostgreSQL {
    $pgDir  = "C:\Users\28737\pgsql"
    $pgData = "$pgDir\data"
    $pgLog  = "$pgDir\pg.log"
    $pgCtl  = "$pgDir\bin\pg_ctl.exe"

    if (-not (Test-Path $pgCtl)) { return $false }
    & $pgCtl status -D $pgData >$null 2>&1
    if ($LASTEXITCODE -eq 0) { return $true }
    & $pgCtl start -D $pgData -l $pgLog
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Path $PM2)) {
    Write-Host "[ERROR] PM2 not found" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Ensuring PostgreSQL is running..."
Start-PostgreSQL | Out-Null

Write-Host "[INFO] Restarting ORPS backend..."
& $PM2 restart orps-server
if ($LASTEXITCODE -ne 0) {
    Write-Host "[INFO] Process not running, starting fresh..."
    & $PM2 start "$PROJECT_ROOT\server\ecosystem.config.js"
    & $PM2 save
}

Write-Host "[OK] ORPS backend restarted" -ForegroundColor Green
