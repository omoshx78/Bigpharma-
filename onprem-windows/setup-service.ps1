# setup-service.ps1
# Run this ONCE, as Administrator, after you've completed the manual
# install steps in WINDOWS_ONPREM_SETUP.md (Node.js, PostgreSQL, npm
# install/build, .env file, seed). This script:
#   1. Registers the DHS backend as an auto-starting, auto-restarting
#      Windows Service using NSSM.
#   2. Creates a nightly scheduled task that backs up the database.
#
# It does NOT install Node.js or PostgreSQL — those are manual, one-time,
# standard Windows installers (see the guide). This script only wires up
# the "keep it running unattended" part.

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Please right-click this script and choose 'Run with PowerShell as Administrator'."
    exit 1
}

# ---- Settings — adjust these three paths if your folders differ ----
$AppDir      = "C:\DHSPharmacy\hms-backend"
$NssmExe     = "C:\DHSPharmacy\tools\nssm.exe"
$ServiceName = "DHSPharmacyBackend"
# ----------------------------------------------------------------------

if (!(Test-Path $NssmExe)) {
    Write-Error "NSSM not found at $NssmExe. Download it from https://nssm.cc/download, extract nssm.exe (the win64 version) into C:\DHSPharmacy\tools\, then re-run this script."
    exit 1
}

if (!(Test-Path "$AppDir\dist\index.js")) {
    Write-Error "$AppDir\dist\index.js not found. Run 'npm run build' inside $AppDir first (see WINDOWS_ONPREM_SETUP.md)."
    exit 1
}

$nodeExe = (Get-Command node).Source
if (-not $nodeExe) {
    Write-Error "Node.js not found on PATH. Install it from https://nodejs.org first."
    exit 1
}

Write-Output "Registering Windows Service '$ServiceName'..."
& $NssmExe install $ServiceName $nodeExe "dist\index.js"
& $NssmExe set $ServiceName AppDirectory $AppDir
& $NssmExe set $ServiceName AppStdout "$AppDir\service-out.log"
& $NssmExe set $ServiceName AppStderr "$AppDir\service-err.log"
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName Start SERVICE_AUTO_START
& $NssmExe set $ServiceName AppExit Default Restart
& $NssmExe set $ServiceName AppRestartDelay 5000

Write-Output "Starting service..."
& $NssmExe start $ServiceName

Start-Sleep -Seconds 3
$status = & $NssmExe status $ServiceName
Write-Output "Service status: $status"

# ---- Nightly backup scheduled task ----
Write-Output "Setting up nightly backup task..."

$dbPassword = Read-Host "Enter the PostgreSQL 'postgres' user password (set during PostgreSQL install) — this is stored as a protected machine environment variable, not in any file" -AsSecureString
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))
[Environment]::SetEnvironmentVariable("DHS_DB_PASSWORD", $plainPassword, "Machine")

$backupScript = "C:\DHSPharmacy\onprem-windows\backup-db.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "DHSPharmacyNightlyBackup" -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Output ""
Write-Output "=========================================================="
Write-Output "Done. The DHS backend now runs as a Windows Service and will"
Write-Output "start automatically every time this computer starts, and"
Write-Output "restart itself automatically if it ever crashes."
Write-Output ""
Write-Output "A nightly backup will run at 2:00 AM into C:\DHSPharmacy\Backups."
Write-Output ""
Write-Output "Next: open a browser on THIS machine and confirm you see the"
Write-Output "login page at http://localhost:4000 — then try the same"
Write-Output "address from another computer on your network using this"
Write-Output "machine's IP address instead of 'localhost'."
Write-Output "=========================================================="
