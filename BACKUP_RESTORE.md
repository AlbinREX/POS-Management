# Backup and recovery

## Policy

The local PostgreSQL volume is not a backup. Use scheduled logical archives plus an encrypted copy on a different device/location. Suggested starting retention is 14 daily archives; agree actual retention and privacy requirements with the operator. Phase 1 includes scripts, not an installed or verified production backup service.

`scripts/backup.ps1` creates a custom-format `pg_dump` inside the PostgreSQL container, checks its table of contents, writes a SHA-256 sidecar and only then applies retention to matching archives in the workspace backup directory. It never purges existing backups after a failed dump. It avoids piping binary archives through Windows PowerShell text redirection.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1 -RetentionDays 14
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/schedule-backup.ps1 -At 02:00
```

Scheduling is an explicit deployment action; no host scheduled task is installed by repository creation. The Windows task uses the current user's default task identity and therefore requires a logged-in Docker-capable operator. For unattended operation, configure a dedicated approved service identity and test execution while no operator is logged in. Docker Desktop availability after reboot must be verified.

Archives contain personal identity data and password hashes. Restrict the `backups/` directory, encrypt the disk and off-device copies, and store secret/certificate recovery material separately. The scripts do not implement backup encryption or offsite upload.

## Restore into a new database

Never overwrite the active restaurant database as the first recovery action. Verify the SHA-256 sidecar, then:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/restore.ps1 -BackupName restaurant-20260910T020000Z.dump -NewDatabase restaurant_restore_drill
```

The script accepts only a new `restaurant_restore_*` database, uses `pg_restore --single-transaction --exit-on-error`, and stops on any failure. An existing target causes failure. It never deletes or replaces existing databases. The restored database is not automatically made live.

1. Isolate the restored database from restaurant clients.
2. Point `MIGRATION_DATABASE_URL` to the new database and apply migrations/provision runtime grants with `scripts/migrate.mjs`.
3. Verify organization, branches, users, memberships, roles, terminals, audit counts and source timestamps. In later phases also reconcile order/payment/refund totals and stock movements against the archive source.
4. Test login with an authorized recovery account and the restricted runtime connection. Verify audit append-only guards remain active.
5. Rotate JWT secrets and revoke restored sessions before cutover to avoid replay of previously revoked sessions from an older backup. A privileged operator can run `UPDATE "AuthSession" SET "revokedAt" = now(), "updatedAt" = now() WHERE "revokedAt" IS NULL;` and insert an operator recovery audit event.
6. Stop writes to the old database, preserve it for diagnosis, update runtime connections to the verified restored database and restart services. Record the recovery action, restored archive, cutoff time, checks and responsible operator.

## Failure scenarios and drills

Internet failure: continue using the LAN server. Database/server failure: stop accepting mutations and restore local service; no client may pretend a payment succeeded. Disk failure: use off-device backup and separately retained deployment configuration. Lost local admin access: use a documented operator credential reset with session revocation and audit; there is no unauthenticated password reset endpoint.

Measure recovery point and recovery time during a drill. A daily-only schedule can lose up to a day of changes. Commercial operations may need shorter intervals, WAL archiving/PITR and a UPS; those are Phase 13 decisions. Run restore drills after schema changes and periodically, and alert on missing archives, nonzero scheduled-task exit codes and low disk space.
