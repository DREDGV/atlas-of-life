# Atlas Sync VDS deployment

This package deploys Atlas (Studio + Capture PWA + Sync API) on the VDS next
to existing sites without changing their directories, runtimes, ports,
processes or Apache sites.

## Isolation

- application releases: `/opt/atlas-sync/releases`;
- current symlink: `/opt/atlas-sync/current`;
- private Node.js runtime: `/opt/atlas-sync/runtime`;
- static app (Studio + Capture PWA): `/opt/atlas-sync/app` (symlink into
  `current`, DocumentRoot of the Apache vhost);
- configuration and admin bootstrap token: `/etc/atlas-sync/atlas-sync.env`;
- SQLite database: `/var/lib/atlas-sync/atlas-sync.sqlite`;
- private SQLite backups: `/var/lib/atlas-sync/backups` (30-day retention);
- process identity: `atlas-sync`;
- loopback API port: `127.0.0.1:8787`;
- Apache site: `/etc/apache2/sites-available/atlas-sync.conf`;
- managed HTTPS site: `/etc/apache2/sites-available/atlas-sync-ssl.conf`;
- daily backup timer: `atlas-sync-backup.timer`.

The live database, WAL and shared-memory files are owned by
`atlas-sync:atlas-sync` with mode `0640`; the service uses `UMask=0027` so a
restart cannot recreate them as world-readable files.

`ATLAS_HOSTNAME` holds the final public hostname. An `sslip.io` hostname can be
used for the first deployment when its address resolves to the VDS. HTTPS must
be enabled before configuring a physical phone: the Capture PWA requires a
secure context.

## Install

Build the upload bundle locally (includes the app + sync service, no
secrets):

```bash
node tools/build-sync-deploy.mjs
# → dist/atlas-sync-upload.tar.gz
```

The bundle is assembled from an allowlist of deployment files and rejects
`.env`, SQLite and database files. The Node.js runtime archive is intentionally
not embedded. Upload the bundle and the verified Node.js 22 Linux x64 archive
to `/root` on the VDS.

Install the required system packages (exact package names shown for Debian /
Ubuntu), then run the installer with the final hostname and a real Certbot
contact e-mail:

```bash
apt-get update
apt-get install --yes apache2 certbot python3-certbot-apache sqlite3

export ATLAS_HOSTNAME=atlas.example.com
export ATLAS_CERTBOT_EMAIL=admin@example.com
bash /root/atlas-sync-upload/deploy/vds/install-atlas-sync.sh \
  /root/atlas-sync-upload \
  /root/node-v22.22.0-linux-x64.tar.xz
unset ATLAS_CERTBOT_EMAIL
```

The installer generates the admin bootstrap token once and preserves it on
later deployments. It is used only to create the first pairing code or
recover access. Never paste it into issues, chats, client settings or
service logs. The installer refuses to continue without
`ATLAS_CERTBOT_EMAIL`, obtains or reuses the HTTPS certificate, enables the
daily backup timer and creates one verified first backup.

After Certbot obtains or reuses the certificate, the installer enables the
managed `atlas-sync-ssl` vhost and disables the legacy
`atlas-sync-le-ssl` vhost when present. This keeps Studio, Capture and the API
on the same routing contract during upgrades from older API-only deployments.

## HTTPS

The installer runs Certbot with `--email "$ATLAS_CERTBOT_EMAIL"` and enables
the HTTP → HTTPS redirect. Verify the endpoint and automatic renewal after the
installer finishes:

```bash
curl --fail --silent "https://${ATLAS_HOSTNAME}/health"
systemctl is-enabled certbot.timer
certbot renew --dry-run
```

## Operations

```bash
systemctl status atlas-sync.service --no-pager
journalctl -u atlas-sync.service --since today --no-pager
ss -ltnp | grep ':8787 '
systemctl status atlas-sync-backup.timer --no-pager
systemctl list-timers atlas-sync-backup.timer --no-pager
ls -l /var/lib/atlas-sync/backups
```

Port 8787 must remain bound to `127.0.0.1`; Apache is the only public entry
point. The API synchronizes the Inbox/Processing lifecycle only (captures,
updates, routes, reverts) — Tasks/Projects/Domains are not synced yet.

The backup job uses SQLite's online `.backup`, verifies
`PRAGMA integrity_check`, writes with private permissions and deletes only
matching backups older than 30 days. Before deployment acceptance, perform a
test restore during the maintenance window using [`RESTORE.md`](RESTORE.md).

## Pair the first device

Create a short-lived code with the admin bootstrap token, without printing
the token:

```bash
set -a
source /etc/atlas-sync/atlas-sync.env
set +a
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${ATLAS_SYNC_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "https://${ATLAS_HOSTNAME}/v1/pair/codes"
unset ATLAS_SYNC_TOKEN
```

Enter the returned eight-digit code in Atlas (Studio: «Синхронизация» chip →
form; Capture: ⓘ → Синхронизация) within five minutes. The code is
single-use. The paired device receives its own credential and can create
codes for other devices from the UI («Код для нового устройства»). Device
credentials are stored as SHA-256 hashes in SQLite and can be revoked
independently («Отключить синхронизацию»).

## Physical device check (phone ↔ desktop)

1. Open `https://<ATLAS_HOSTNAME>/capture/` on the phone, install
   the PWA («Установить»), pair it.
2. Open `https://<ATLAS_HOSTNAME>/` on the PC, pair it.
3. Capture on the phone → the record appears in the Studio Inbox within the
   poll interval (default 30 s).
4. Process it in Studio (routed / processed / discarded) → the phone shows
   the new state after the next poll.
5. Offline test: airplane mode → capture → still saved locally
   («Ожидают отправки: 1»); restore network → delivered automatically.
6. Revoke one device, confirm it can no longer sync, then re-pair it and export
   diagnostics; the export must contain no bootstrap token or device token.
