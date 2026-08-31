// Focused regression for the VDS deployment contract.
// Ensures both HTTP and HTTPS serve Atlas static files while only API routes
// reach the loopback Node service, including upgrades from the legacy
// Certbot-generated catch-all proxy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFileSync(join(root, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertAtlasRouting(config, label) {
  assert(config.includes('DocumentRoot /opt/atlas-sync/app'), `${label}: static app DocumentRoot`);
  assert(config.includes('ProxyPass        /v1/ http://127.0.0.1:8787/v1/'), `${label}: /v1 API proxy`);
  assert(config.includes('ProxyPass        /health http://127.0.0.1:8787/health'), `${label}: /health API proxy`);
  assert(!/^\s*ProxyPass\s+\/\s+/m.test(config), `${label}: no catch-all API proxy`);
}

const httpConfig = read('deploy/vds/atlas-sync-apache.conf');
const httpsConfig = read('deploy/vds/atlas-sync-apache-ssl.conf');
const installer = read('deploy/vds/install-atlas-sync.sh');
const restoreRunbook = read('deploy/vds/RESTORE.md');
const bundleBuilder = read('tools/build-sync-deploy.mjs');

assertAtlasRouting(httpConfig, 'HTTP vhost');
assertAtlasRouting(httpsConfig, 'HTTPS vhost');
assert(httpsConfig.includes('SSLCertificateFile /etc/letsencrypt/live/__ATLAS_HOSTNAME__/fullchain.pem'), 'HTTPS vhost: managed certificate path');
assert(installer.includes('atlas-sync-apache-ssl.conf'), 'installer requires and renders HTTPS template');
assert(installer.includes('a2dissite atlas-sync-le-ssl'), 'installer disables legacy Certbot vhost');
assert(installer.includes('a2ensite atlas-sync-ssl'), 'installer enables managed HTTPS vhost');
assert(installer.includes('--cert-name "${ATLAS_HOSTNAME}"'), 'installer pins the certificate name used by the HTTPS template');
assert(installer.includes('systemctl restart atlas-sync.service'), 'installer restarts an already active service on upgrade');
assert(!installer.includes('systemctl enable --now atlas-sync.service'), 'installer does not mistake enable --now for an upgrade restart');
assert(restoreRunbook.includes('for attempt in {1..15}'), 'restore runbook waits for service readiness');
assert(restoreRunbook.includes('sleep 1'), 'restore readiness retry has a bounded delay');
assert(bundleBuilder.includes("'atlas-sync-apache-ssl.conf'"), 'bundle includes HTTPS template');

console.log('✓ VDS deployment keeps Studio/Capture routes on HTTP and HTTPS.');
