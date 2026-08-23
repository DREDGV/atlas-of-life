// tools/build-sync-deploy.mjs — assemble the VDS upload bundle for the
// Atlas Sync service + Atlas app (Studio + Capture PWA).
//
// Output: dist/atlas-sync-upload.tar.gz
// The bundle contains NO secrets — the admin bootstrap token is generated
// on the server by the installer. The Node.js runtime archive is uploaded
// separately (see deploy/vds/README.md).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'dist', 'atlas-sync-upload');

function copy(from, to){
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });

// Sync service
copy(join(ROOT, 'server'), join(STAGE, 'server'));
// Atlas app (Studio + Capture PWA)
copy(join(ROOT, 'js'), join(STAGE, 'js'));
copy(join(ROOT, 'styles'), join(STAGE, 'styles'));
copy(join(ROOT, 'capture'), join(STAGE, 'capture'));
copy(join(ROOT, 'index.html'), join(STAGE, 'index.html'));
// Deployment scaffolding (installer + systemd + Apache)
copy(join(ROOT, 'deploy', 'vds'), join(STAGE, 'deploy', 'vds'));

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const archive = join(ROOT, 'dist', 'atlas-sync-upload.tar.gz');
execFileSync('tar', [
  '-czf', archive,
  '-C', join(ROOT, 'dist'),
  'atlas-sync-upload',
], { stdio: 'inherit' });

console.log(`Atlas Sync upload bundle: ${archive}`);
console.log('Upload it with the Node.js 22 Linux x64 archive and run');
console.log('  bash /root/atlas-sync-upload/deploy/vds/install-atlas-sync.sh \\');
console.log('    /root/atlas-sync-upload /root/node-v22.22.0-linux-x64.tar.xz');
