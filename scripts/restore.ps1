param([string]$BackupName, [string]$NewDatabase, [string]$MediaArchive)
$ErrorActionPreference = 'Stop'
if (-not $BackupName -and -not $MediaArchive) { throw 'Name a -BackupName with -NewDatabase, a -MediaArchive, or both' }
if ($BackupName -and $BackupName -notmatch '^restaurant-[0-9]{8}T[0-9]{6}Z\.dump$') { throw 'Invalid archive name' }
if ($BackupName -and $NewDatabase -notmatch '^restaurant_restore_[a-z0-9_]+$') { throw 'Restore target must be a new restaurant_restore_* database' }
if ($MediaArchive -and $MediaArchive -notmatch '^restaurant-[0-9]{8}T[0-9]{6}Z\.media\.tar\.gz$') { throw 'Invalid media archive name' }
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Assert-Archive([string]$name) {
    $path = Join-Path $workspacePath "backups/$name"
    if (-not (Test-Path -LiteralPath $path)) { throw "Archive not found: $name" }
    $expectedHash = (Get-Content -LiteralPath "$path.sha256").Trim()
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $expectedHash) { throw "Archive checksum mismatch: $name" }
}
if ($BackupName) { Assert-Archive $BackupName }
if ($MediaArchive) { Assert-Archive $MediaArchive }
Push-Location $workspacePath
try {
    if ($BackupName) {
        docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T -e "RESTORE_DB=$NewDatabase" db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
        if ($LASTEXITCODE -ne 0) { throw 'Could not create new restore database; existing databases are never overwritten' }
        docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T -e "RESTORE_DB=$NewDatabase" -e "RESTORE_FILE=/backups/$BackupName" db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" --no-owner --no-acl --single-transaction --exit-on-error "$RESTORE_FILE"'
        if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not point applications at this database' }
        Write-Output "Restored to $NewDatabase. Run runtime provisioning, migrations and verification before any cutover."
    }
    if ($MediaArchive) {
        # Menu images are added to the live volume, never replaced: every file has a
        # unique random name and is written once, so an existing file is already correct.
        # --touch stamps them as new, so unused-image cleanup gives them its full grace
        # period. Run this at cutover, when the restored database starts referencing them.
        docker compose --env-file .env -f infrastructure/docker/compose.yml exec -T -e "MEDIA_FILE=/backups/$MediaArchive" api sh -c 'tar -xzf "$MEDIA_FILE" -C /var/lib/restaurant/media --skip-old-files --touch --no-same-owner'
        if ($LASTEXITCODE -ne 0) { throw 'Menu image restore failed; existing images are unchanged' }
        Write-Output "Menu images from $MediaArchive added. Existing images were left untouched."
    }
} finally { Pop-Location }
