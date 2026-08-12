# Atlas Sync VDS deployment

This package deploys Atlas next to ChildWatch without changing ChildWatch's
directory, Node.js runtime, port, process, or Apache site.

## Isolation

- application releases: `/opt/atlas-sync/releases`;
- current symlink: `/opt/atlas-sync/current`;
- private Node.js runtime: `/opt/atlas-sync/runtime`;
- configuration and bearer token: `/etc/atlas-sync/atlas-sync.env`;
- SQLite database: `/var/lib/atlas-sync/atlas-sync.sqlite`;
- process identity: `atlas-sync`;
- loopback API port: `127.0.0.1:8787`;
- Apache site: `/etc/apache2/sites-available/atlas-sync.conf`.

The initial hostname is `atlas.31.28.27.96.sslip.io`. HTTPS must be enabled
before configuring a physical Android device.

## Install

Upload the unpacked deployment bundle and the verified Node.js 22 Linux x64
archive to `/root`, then run:

```bash
bash /root/atlas-sync-upload/deploy/vds/install-atlas-sync.sh \
  /root/atlas-sync-upload \
  /root/node-v22.22.0-linux-x64.tar.xz
```

The installer generates the server bootstrap credential once and preserves it
on later deployments. It is used only to pair the first device or recover
access. Never paste it into issue, chat, client settings, or service logs.

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
point. The current API synchronizes immutable Inbox captures only. It does not
yet synchronize deletions, tasks, domains, projects, or complete Atlas state.

## Pair the first device

Create a short-lived code without displaying the bootstrap credential:

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

Enter the returned eight-digit code in Atlas within five minutes. The code is
single-use. The paired device receives its own credential and can create codes
for other devices. Device credentials are stored as SHA-256 hashes in SQLite
and can be revoked independently.
