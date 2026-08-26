// tools/smoke-shared.mjs — shared scaffolding for the Stage C browser smokes.
//
// Two independent browser clients (separate storage) talk over real HTTP to
// a live Atlas Sync service while the apps are served over HTTP on loopback.
// The smoke scripts import: createStaticServer, startSyncServer, createCode,
// pairDevice, waitFor, log, assert, ADMIN_TOKEN.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { createSyncServer } from '../server/sync-server.js';

export const ROOT = join(import.meta.dirname, '..');

export function makeAdminToken(){
  return `smoke-admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function assert(condition, message){
  if (!condition) throw new Error(message);
}

export function log(step, message){
  console.log(`  [smoke] ${step}: ${message}`);
}

export async function waitFor(fn, { timeout = 20000, interval = 300, label = 'condition' } = {}){
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

function mimeFor(file){
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  return map[extname(file).toLowerCase()] || 'application/octet-stream';
}

// Minimal static file server for the apps (no directory listing, no dotfiles).
export function createStaticServer(){
  return createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = normalize(join(ROOT, pathname));
      if (!file.startsWith(ROOT) || pathname.includes('..') || pathname.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const body = readFileSync(file);
      response.writeHead(200, { 'Content-Type': mimeFor(file), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (_) {
      response.writeHead(404).end('not found');
    }
  });
}

export async function startStaticServer(){
  const server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

export async function startSyncServer({ token, dbPath, allowedOrigins }){
  if (dbPath && existsSync(dbPath)) rmSync(dbPath, { force: true });
  if (dbPath) mkdirSync(dirname(dbPath), { recursive: true });
  const server = createSyncServer({ token, dbPath: dbPath || ':memory:', allowedOrigins });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, endpoint: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

// Create a one-time pairing code with the admin bootstrap token — the same
// action the operator performs on the VDS.
export async function createCode(endpoint, token){
  const response = await fetch(`${endpoint}/v1/pair/codes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(response.ok, `pairing code request failed (${response.status})`);
  return (await response.json()).code;
}

// Pair a browser page through the app's own runtime (the real pairing path).
export async function pairDevice(page, endpoint, token, deviceName){
  const code = await createCode(endpoint, token);
  await page.evaluate(async ({ endpoint: url, code: pairingCode, deviceName: name }) => {
    await window.atlasSync.pair({ endpoint: url, code: pairingCode, deviceName: name });
  }, { endpoint, code, deviceName });
  await waitFor(async () => {
    const s = await page.evaluate(() => window.atlasSync.getStatus());
    return s.configured && !s.lastError;
  }, { label: `${deviceName} sync configured and healthy` });
  return code;
}

export async function closeAll(...servers){
  for (const entry of servers) {
    try {
      await new Promise(resolve => entry.server.close(resolve));
    } catch (_) {}
  }
}
