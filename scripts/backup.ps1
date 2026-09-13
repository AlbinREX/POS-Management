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
    Write-Output "Backup saved: $name. Perform a restore drill before relying on this archive."
} finally { Pop-Location }
