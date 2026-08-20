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
- process identity: `atlas-sync`;
- loopback API port: `127.0.0.1:8787`;
- Apache site: `/etc/apache2/sites-available/atlas-sync.conf`.

The initial hostname is `atlas.31.28.27.96.sslip.io` (no DNS registration
needed — wildcard DNS of the VDS IP). HTTPS must be enabled before
configuring a physical phone: the Capture PWA requires a secure context.

## Install

Build the upload bundle locally (includes the app + sync service, no
secrets):

```bash
node tools/build-sync-deploy.mjs
# → dist/atlas-sync-upload.tar.gz
```

Upload the bundle and the verified Node.js 22 Linux x64 archive to `/root`
on the VDS, then run:

```bash
bash /root/atlas-sync-upload/deploy/vds/install-atlas-sync.sh \
  /root/atlas-sync-upload \
  /root/node-v22.22.0-linux-x64.tar.xz
```

The installer generates the admin bootstrap token once and preserves it on
later deployments. It is used only to create the first pairing code or
recover access. Never paste it into issues, chats, client settings or
service logs.

## HTTPS

After installing Certbot's Apache plugin, issue the certificate and redirect
HTTP to HTTPS:

```bash
certbot --apache \
  --domain atlas.31.28.27.96.sslip.io \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --redirect
```

Verify the endpoint and automatic renewal:

```bash
curl --fail --silent https://atlas.31.28.27.96.sslip.io/health
systemctl is-enabled certbot.timer
certbot renew --dry-run
```

## Operations

```bash
systemctl status atlas-sync.service --no-pager
journalctl -u atlas-sync.service --since today --no-pager
ss -ltnp | grep ':8787 '
```

Port 8787 must remain bound to `127.0.0.1`; Apache is the only public entry
point. The API synchronizes the Inbox/Processing lifecycle only (captures,
updates, routes, reverts) — Tasks/Projects/Domains are not synced yet.

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
  https://atlas.31.28.27.96.sslip.io/v1/pair/codes
unset ATLAS_SYNC_TOKEN
```

Enter the returned eight-digit code in Atlas (Studio: «Синхронизация» chip →
form; Capture: ⓘ → Синхронизация) within five minutes. The code is
single-use. The paired device receives its own credential and can create
codes for other devices from the UI («Код для нового устройства»). Device
credentials are stored as SHA-256 hashes in SQLite and can be revoked
independently («Отключить синхронизацию»).

## Physical device check (phone ↔ desktop)

1. Open `https://atlas.31.28.27.96.sslip.io/capture/` on the phone, install
   the PWA («Установить»), pair it.
2. Open `https://atlas.31.28.27.96.sslip.io/` on the PC, pair it.
3. Capture on the phone → the record appears in the Studio Inbox within the
   poll interval (default 30 s).
4. Process it in Studio (routed / processed / discarded) → the phone shows
   the new state after the next poll.
5. Offline test: airplane mode → capture → still saved locally
   («Ожидают отправки: 1»); restore network → delivered automatically.
