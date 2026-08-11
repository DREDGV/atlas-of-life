import { createInboxSyncServer } from './inbox-sync-server.js';
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

const server = createInboxSyncServer({ token, dbPath, allowedOrigins });
server.listen(port, host, () => {
  console.log(`Atlas Inbox sync listening on http://${host}:${port}`);
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
