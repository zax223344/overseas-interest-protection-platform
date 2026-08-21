' Silent start ORPS backend (called by Windows Task Scheduler)
Dim WShell, psFile, cmd
Set WShell = CreateObject("WScript.Shell")
psFile = "C:\Users\28737\Desktop\新建文件夹\scripts\start-orps.ps1"
cmd = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psFile & """"
WShell.Run cmd, 0, False
Set WShell = Nothing
