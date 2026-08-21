# ORPS - Windows Scheduled Tasks Installer
# Run as admin: powershell -ExecutionPolicy Bypass -File "C:\Users\28737\Desktop\新建文件夹\scripts\install-scheduled-tasks.ps1"

$projectRoot = "C:\Users\28737\Desktop\新建文件夹"
$taskFolder  = "\ORPS"

function Register-ORPSTask {
    param(
        [string]$TaskName,
        [string]$Description,
        [string]$Execute,
        [string]$Argument = "",
        [string]$TriggerType,
        [int]$DelaySeconds = 0
    )

    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

    if ($Argument) {
        $action = New-ScheduledTaskAction -Execute $Execute -Argument $Argument
    } else {
        $action = New-ScheduledTaskAction -Execute $Execute
    }

    if ($TriggerType -eq "Boot") {
        $trigger = New-ScheduledTaskTrigger -AtStartup
    } else {
        $trigger = New-ScheduledTaskTrigger -AtLogon
    }

    if ($DelaySeconds -gt 0) {
        $trigger.Delay = "PT${DelaySeconds}S"
    }

    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Highest

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -Hidden `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask `
        -TaskPath $taskFolder `
        -TaskName $TaskName `
        -Description $Description `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Force

    Write-Host "[OK] Created scheduled task: $taskFolder$TaskName"
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Please run this script as Administrator!"
    exit 1
}

Register-ORPSTask `
    -TaskName "PostgresBoot" `
    -Description "ORPS: start local PostgreSQL at system boot" `
    -Execute "$projectRoot\scripts\start-postgres.bat" `
    -TriggerType "Boot" `
    -DelaySeconds 0

Register-ORPSTask `
    -TaskName "ServerBoot" `
    -Description "ORPS: start Node/PM2 backend and collection engine after logon" `
    -Execute "wscript.exe" `
    -Argument "\"$projectRoot\scripts\start-orps-silent.vbs\"" `
    -TriggerType "Logon" `
    -DelaySeconds 30

$projPosix = "/" + (($projectRoot -replace '\\','/') -replace '^C:','c')

Register-ORPSTask `
    -TaskName "TunnelBoot" `
    -Description "ORPS: cloudflared tunnel keepalive + gh-pages json auto-update" `
    -Execute "C:\Users\28737\.workbuddy\binaries\PortableGit\versions\1.2.0\usr\bin\bash.exe" `
    -Argument "-lc 'HTTP_PROXY= HTTPS_PROXY= NODE_OPTIONS= bash $projPosix/scripts/tunnel-keepalive.sh'" `
    -TriggerType "Logon" `
    -DelaySeconds 45

Write-Host ""
Write-Host "[Done] ORPS auto-start tasks installed. Check: Task Scheduler -> Task Scheduler Library -> ORPS"
Write-Host "[Tip]  Reboot to verify, or manually run: $projectRoot\scripts\start-orps.bat"
