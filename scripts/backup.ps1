param([int]$RetentionDays = 14)
$ErrorActionPreference = 'Stop'
if ($RetentionDays -lt 1) { throw 'RetentionDays must be at least 1' }
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backupPath = Join-Path $workspacePath 'backups'
New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
$backupPath = (Resolve-Path -LiteralPath $backupPath).Path
if (-not $backupPath.StartsWith($workspacePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup directory escaped workspace' }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$name = "restaurant-$stamp.dump"
Push-Location $workspacePath
try {
    docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T -e "BACKUP_FILE=/backups/$name.partial" db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --file="$BACKUP_FILE"'
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; existing backups retained' }
    docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T db pg_restore --list "/backups/$name.partial" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Backup archive validation failed' }
    Move-Item -LiteralPath (Join-Path $backupPath "$name.partial") -Destination (Join-Path $backupPath $name)
    $hash = (Get-FileHash -LiteralPath (Join-Path $backupPath $name) -Algorithm SHA256).Hash
    Set-Content -LiteralPath (Join-Path $backupPath "$name.sha256") -Value $hash
    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -LiteralPath $backupPath -File -Filter 'restaurant-*.dump' | Where-Object { $_.LastWriteTime -lt $cutoff -and $_.Name -ne $name } | ForEach-Object {
        $targetPath = $_.FullName
        if (-not $targetPath.StartsWith($backupPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe retention path' }
        Remove-Item -LiteralPath $targetPath
        if (Test-Path -LiteralPath "$targetPath.sha256") { Remove-Item -LiteralPath "$targetPath.sha256" }
    }
    # A machine-readable status file lets scheduled runs and the operations endpoint
    # report backup age and the last outcome without parsing console text. It records no
    # credential, connection string or archive content.
    $status = [ordered]@{
        lastAttemptAt = (Get-Date).ToUniversalTime().ToString('o')
        lastSuccessAt = (Get-Date).ToUniversalTime().ToString('o')
        archive       = $name
        sizeBytes     = (Get-Item -LiteralPath (Join-Path $backupPath $name)).Length
        sha256        = $hash
        retentionDays = $RetentionDays
        outcome       = 'success'
        error         = $null
    }
    [IO.File]::WriteAllText((Join-Path $backupPath 'backup-status.json'), ($status | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding $false))
    Write-Output "Backup saved: $name. Perform a restore drill before relying on this archive."
} catch {
    # Record the failure for the operator and the status endpoint, then keep failing:
    # a silent backup failure is the most dangerous outcome in this whole system.
    $message = $_.Exception.Message
    $failure = [ordered]@{
        lastAttemptAt = (Get-Date).ToUniversalTime().ToString('o')
        lastSuccessAt = $null
        archive       = $null
        outcome       = 'failed'
        error         = $message
    }
    if (Test-Path -LiteralPath (Join-Path $backupPath 'backup-status.json')) {
        try {
            $previous = Get-Content -LiteralPath (Join-Path $backupPath 'backup-status.json') -Raw | ConvertFrom-Json
            $failure.lastSuccessAt = $previous.lastSuccessAt
            $failure.archive = $previous.archive
        } catch { }
    }
    [IO.File]::WriteAllText((Join-Path $backupPath 'backup-status.json'), ($failure | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding $false))
    # Partial archives are never left to be mistaken for a usable backup.
    Get-ChildItem -LiteralPath $backupPath -File -Filter '*.partial' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Error "Backup FAILED: $message"
    exit 1
} finally { Pop-Location }
