# backup-db.ps1
# Nightly DHS database backup with automatic rotation (keeps the last 30
# backups so the drive doesn't slowly fill up). Run by Windows Task
# Scheduler every night — see WINDOWS_ONPREM_SETUP.md for how it's wired up.

$ErrorActionPreference = "Stop"

# ---- Settings you may need to adjust for your machine ----
$PgBinPath   = "C:\Program Files\PostgreSQL\16\bin"   # adjust version number if different
$DbName      = "dhs_pharmacy"
$DbUser      = "postgres"
$BackupDir   = "C:\DHSPharmacy\Backups"
$KeepCount   = 30
# ------------------------------------------------------------

if (!(Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$backupFile = Join-Path $BackupDir "dhspharmacy_backup_$timestamp.sql"

$env:PGPASSWORD = $env:DHS_DB_PASSWORD  # set once via setup-service.ps1 as a machine env var, never hardcoded here

& "$PgBinPath\pg_dump.exe" -U $DbUser -d $DbName -f $backupFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "Backup failed — check that PostgreSQL is running and DHS_DB_PASSWORD is set correctly."
    exit 1
}

Write-Output "Backup written to $backupFile"

# Rotate: keep only the most recent $KeepCount backups
$allBackups = Get-ChildItem -Path $BackupDir -Filter "dhspharmacy_backup_*.sql" | Sort-Object LastWriteTime -Descending
if ($allBackups.Count -gt $KeepCount) {
    $toDelete = $allBackups | Select-Object -Skip $KeepCount
    foreach ($file in $toDelete) {
        Remove-Item $file.FullName -Force
        Write-Output "Removed old backup: $($file.Name)"
    }
}

Write-Output "Done. $($allBackups.Count) backup(s) currently kept in $BackupDir."
Write-Output "REMINDER: periodically copy this Backups folder to a USB drive or cloud-synced folder (OneDrive/Google Drive) — a backup that only lives on the same machine as the database doesn't protect you if that machine fails."
