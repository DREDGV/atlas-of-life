# Atlas Inbox Sync on a VDS

Status: working Inbox push/pull implementation with short-code device pairing.

## Current boundary

Protocol v1 synchronizes only immutable `inbox.capture` operations. Domains,
projects, tasks, imports, deletes, processing statuses, and layout settings stay
local. This deliberately avoids replacing the full Atlas JSON with a
last-write-wins upload.

Both Studio and Capture always save locally first. A network failure leaves the
operation pending. Pending operations are never removed merely to enforce the
operation-log soft limit. Local capture still fails fast and rolls back if the
device itself cannot persist the updated state.

## Implemented data flow

```text
Android Capture / Desktop Studio
  -> localStorage atlas_v2_data
  -> pending inbox.capture journal
  -> authenticated HTTPS push
  -> Atlas Sync API
  -> dedicated SQLite database on the VDS
  -> monotonically sequenced pull
  -> merge by immutable Inbox item ID
  -> localStorage atlas_v2_data
```

The client stores the last server cursor in the same local state write as Inbox
records and acknowledgements. If that local write fails, array contents and
operation statuses roll back and the server request can be retried safely.

The server deduplicates by operation ID and item ID. Reusing either ID with
different content creates an explicit conflict and never overwrites a stored
record.

## API

- `GET /health` - public health check without capture contents.
- `POST /v1/pair/codes` - creates a single-use 8-digit code; requires an
  existing device credential or the server bootstrap credential.
- `POST /v1/pair/claim` - exchanges a valid code for a device credential.
- `POST /v1/devices/revoke-self` - revokes the caller's device credential.
- `POST /v1/inbox/push` - bearer-authenticated operation batch.
- `GET /v1/inbox/pull?after=<cursor>&limit=<1..200>` - bearer-authenticated
  cursor pull.

All payloads declare protocol version `1`. A server `sequence`, not a device
clock, defines pull order.

## Local verification

```powershell
npm run test:sync
powershell -ExecutionPolicy Bypass -File tools\verify-baseline.ps1
```

The end-to-end test starts the real HTTP API with a temporary SQLite database,
pushes a phone capture, pulls it into a desktop state, pushes a desktop capture,
pulls it into the phone state, repeats the cycle, and verifies no duplicates.
The server tests also verify authentication, conflict handling, persistence
across a process restart, one-time and expiring pairing codes, pairing attempt
limits, hashed credentials, device-ID binding, and immediate self-revocation.

## Isolated VDS deployment

Atlas uses `deploy/sync/compose.yml`. It has a dedicated container, named
volume, SQLite database, 256 MB memory limit, and a loopback-only port
`127.0.0.1:8787`. It does not read or reuse ChildWatch files, containers,
environment variables, ports, or database objects.

On the VDS:

```bash
cd deploy/sync
cp .env.example .env
openssl rand -hex 32
# Put the generated value in ATLAS_SYNC_TOKEN and set exact allowed origins.
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

Do not expose port 8787 directly. Publish it behind the existing reverse proxy
with HTTPS. Example Nginx location for a dedicated hostname:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

The production HTTPS endpoint is built into both applications. The bootstrap
credential remains server-side. To connect the first device, create one short
code locally on the VDS without printing the credential:

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

Enter the returned 8-digit code in Atlas Studio within five minutes. Once one
device is connected, it can generate another single-use code from the
"Синхронизация" dialog. Each device receives its own 256-bit credential; only
its SHA-256 hash is stored on the server. Disconnecting a device revokes that
credential immediately.

## Current security and product limitations

- The server bootstrap credential still exists for initial recovery and must
  remain only in `/etc/atlas-sync/atlas-sync.env`; account-based recovery and a
  full device-management screen are not implemented yet.
- Pairing codes are numeric for easy entry, expire after five minutes, are
  single-use, and have a per-client attempt limit. QR scanning is not yet
  implemented.
- Remote delete and Inbox processing status are not synchronized yet.
- Domain, project, task, and full-state synchronization are not enabled.
- Android background execution while the app is closed is not enabled.
- Server backup automation and tested disaster recovery are not configured yet.
- HTTPS termination must be provided by the VDS reverse proxy.

These limitations must remain visible until their corresponding tests and
deployment controls exist.
