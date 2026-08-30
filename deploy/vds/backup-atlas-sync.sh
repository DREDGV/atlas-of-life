#!/usr/bin/env bash
# Create one private, verified SQLite backup and retain daily backups for 30 days.
set -Eeuo pipefail
umask 077

readonly DB_PATH=/var/lib/atlas-sync/atlas-sync.sqlite
readonly BACKUP_DIR=/var/lib/atlas-sync/backups
readonly TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
readonly BACKUP_FILE="${BACKUP_DIR}/atlas-sync-${TIMESTAMP}.sqlite"

if [[ ! -f ${DB_PATH} ]]; then
  echo "Atlas Sync database does not exist: ${DB_PATH}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 0700 "${BACKUP_DIR}"

if [[ -e ${BACKUP_FILE} ]]; then
  echo "Backup already exists: ${BACKUP_FILE}" >&2
  exit 1
fi

cleanup_incomplete(){
  if [[ -f ${BACKUP_FILE} ]]; then
    rm -f -- "${BACKUP_FILE}"
  fi
}
trap cleanup_incomplete EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"
integrity=$(sqlite3 "${BACKUP_FILE}" 'PRAGMA integrity_check;')
if [[ ${integrity} != ok ]]; then
  echo "Backup integrity check failed: ${integrity}" >&2
  exit 1
fi

trap - EXIT INT TERM
find "${BACKUP_DIR}" \
  -maxdepth 1 \
  -type f \
  -name 'atlas-sync-*.sqlite' \
  -mmin +43200 \
  -delete

echo "Verified Atlas Sync backup: ${BACKUP_FILE}"
