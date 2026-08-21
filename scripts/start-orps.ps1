# Start ORPS backend: PostgreSQL + Node/PM2

$PROJECT_ROOT = "C:\Users\28737\Desktop\新建文件夹"
$SERVER_DIR   = "$PROJECT_ROOT\server"
$NODE         = "C:\Users\28737\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$PM2          = "C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules\.bin\pm2.cmd"
$NODE_PATH    = "C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules"

function Start-PostgreSQL {
    $pgDir  = "C:\Users\28737\pgsql"
    $pgData = "$pgDir\data"
    $pgLog  = "$pgDir\pg.log"
    $pgCtl  = "$pgDir\bin\pg_ctl.exe"

    if (-not (Test-Path $pgCtl)) {
        Write-Host "[ERROR] pg_ctl.exe not found: $pgCtl" -ForegroundColor Red
        return $false
    }

    & $pgCtl status -D $pgData >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] PostgreSQL already running" -ForegroundColor Green
        return $true
    }

    Write-Host "[INFO] Starting PostgreSQL..."
    & $pgCtl start -D $pgData -l $pgLog
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] PostgreSQL failed to start, check log: $pgLog" -ForegroundColor Red
        return $false
    }
    Write-Host "[OK] PostgreSQL started" -ForegroundColor Green
    return $true
}

if (-not (Start-PostgreSQL)) { exit 1 }

if (-not (Test-Path $PM2)) {
    Write-Host "[ERROR] PM2 not found: $PM2" -ForegroundColor Red
    Write-Host "[INFO] Install first: cd C:\Users\28737\.workbuddy\binaries\node\workspace ; npm install pm2"
    exit 1
}

Write-Host "[INFO] Starting ORPS backend under PM2..."
$env:NODE_PATH = $NODE_PATH
Set-Location -Path $SERVER_DIR
& $PM2 start ecosystem.config.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] PM2 start failed" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Saving PM2 process list..."
& $PM2 save

Write-Host "[OK] ORPS backend started. URL: http://localhost:3000/index.html" -ForegroundColor Green
