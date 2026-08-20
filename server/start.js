// server/start.js — Atlas Sync v1 service entry point.
//
// Configuration comes from the environment (on the VDS it is written by
// deploy/vds/install-atlas-sync.sh into /etc/atlas-sync/atlas-sync.env):
//
//   ATLAS_SYNC_HOST        loopback bind address (default 127.0.0.1)
//   ATLAS_SYNC_PORT        loopback port (default 8787)
//   ATLAS_SYNC_DB_PATH     SQLite database path (default ./data/atlas-sync.sqlite)
//   ATLAS_SYNC_TOKEN       admin bootstrap token — REQUIRED, generated at install,
//                          never committed anywhere
//   ATLAS_SYNC_ALLOWED_ORIGINS  comma-separated CORS allowlist
import { createSyncServer } from './sync-server.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const port = Number.parseInt(process.env.ATLAS_SYNC_PORT || '8787', 10);
const host = process.env.ATLAS_SYNC_HOST || '127.0.0.1';
const token = process.env.ATLAS_SYNC_TOKEN || '';
const dbPath = process.env.ATLAS_SYNC_DB_PATH || './data/atlas-sync.sqlite';
const allowedOrigins = (process.env.ATLAS_SYNC_ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const server = createSyncServer({ token, dbPath, allowedOrigins });
server.listen(port, host, () => {
  console.log(`Atlas Sync listening on http://${host}:${port}`);
});

function shutdown(){
  server.close(error => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
