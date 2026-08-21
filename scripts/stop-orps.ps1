# Stop ORPS backend (PostgreSQL keeps running)

$PM2 = "C:\Users\28737\.workbuddy\binaries\node\workspace\node_modules\.bin\pm2.cmd"

if (-not (Test-Path $PM2)) {
    Write-Host "[ERROR] PM2 not found" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Stopping ORPS backend..."
& $PM2 stop orps-server
& $PM2 delete orps-server

Write-Host "[OK] ORPS backend stopped" -ForegroundColor Green
