param([string]$At = '02:00')
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'backup.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'Restaurant Local PostgreSQL Backup' -Action $action -Trigger $trigger -Settings $settings -Description 'Local database backup with archive validation and retention. Requires Docker access.'
