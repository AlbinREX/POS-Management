param([Parameter(Mandatory=$true)][string]$BackupName, [Parameter(Mandatory=$true)][string]$NewDatabase)
$ErrorActionPreference = 'Stop'
if ($BackupName -notmatch '^restaurant-[0-9]{8}T[0-9]{6}Z\.dump$') { throw 'Invalid archive name' }
if ($NewDatabase -notmatch '^restaurant_restore_[a-z0-9_]+$') { throw 'Restore target must be a new restaurant_restore_* database' }
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archivePath = Join-Path $workspacePath "backups/$BackupName"
if (-not (Test-Path -LiteralPath $archivePath)) { throw 'Archive not found' }
$expectedHash = (Get-Content -LiteralPath "$archivePath.sha256").Trim()
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Archive checksum mismatch' }
Push-Location $workspacePath
try {
    docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T -e "RESTORE_DB=$NewDatabase" db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create new restore database; existing databases are never overwritten' }
    docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T -e "RESTORE_DB=$NewDatabase" -e "RESTORE_FILE=/backups/$BackupName" db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" --no-owner --no-acl --single-transaction --exit-on-error "$RESTORE_FILE"'
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not point applications at this database' }
    Write-Output "Restored to $NewDatabase. Run runtime provisioning, migrations and verification before any cutover."
} finally { Pop-Location }
