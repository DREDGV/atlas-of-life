# Restore Atlas Sync SQLite on the VDS

Use this runbook only with a backup from `/var/lib/atlas-sync/backups` that
passes SQLite integrity validation. Run every command as `root` during the
approved maintenance window. The procedure preserves the current database and
WAL files in a timestamped rollback directory before installing the backup.

## 1. Select and verify the backup

```bash
BACKUP=/var/lib/atlas-sync/backups/atlas-sync-YYYYMMDDTHHMMSSZ.sqlite
test -f "$BACKUP"
test "$(sqlite3 "$BACKUP" 'PRAGMA integrity_check;')" = ok
```

Do not continue unless the last command exits successfully.

## 2. Stop Sync and preserve the current database

```bash
systemctl stop atlas-sync-backup.timer atlas-sync.service
RESTORE_ID=$(date -u +%Y%m%dT%H%M%SZ)
ROLLBACK_DIR="/var/lib/atlas-sync/pre-restore-${RESTORE_ID}"
install -d -m 0700 -o root -g root "$ROLLBACK_DIR"

for path in \
  /var/lib/atlas-sync/atlas-sync.sqlite \
  /var/lib/atlas-sync/atlas-sync.sqlite-wal \
  /var/lib/atlas-sync/atlas-sync.sqlite-shm; do
  if test -e "$path"; then
    mv -- "$path" "$ROLLBACK_DIR/"
  fi
done
```

## 3. Install the verified copy and start Sync

```bash
install \
  -m 0640 \
  -o atlas-sync \
  -g atlas-sync \
  "$BACKUP" \
  /var/lib/atlas-sync/atlas-sync.sqlite

systemctl start atlas-sync.service
systemctl start atlas-sync-backup.timer
```

## 4. Verify the restored service and database

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/health
test "$(sqlite3 /var/lib/atlas-sync/atlas-sync.sqlite 'PRAGMA integrity_check;')" = ok
systemctl --no-pager --full status atlas-sync.service
```

Also verify the public endpoint from another machine:

```bash
ATLAS_HOSTNAME=atlas.example.com
curl --fail --silent --show-error "https://${ATLAS_HOSTNAME}/health"
```

## Roll back the restore if verification fails

Stop the service, move the failed restored database aside, copy the preserved
`atlas-sync.sqlite` from `$ROLLBACK_DIR` back with owner
`atlas-sync:atlas-sync` and mode `0640`, then start the service and repeat both
integrity and `/health` checks. Keep the rollback directory until the physical
phone ↔ desktop acceptance flow has passed.
