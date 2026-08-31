// tools/build-sync-deploy.mjs — assemble the VDS upload bundle for the
// Atlas Sync service + Atlas app (Studio + Capture PWA).
//
// Output: dist/atlas-sync-upload.tar.gz
// The bundle contains NO secrets — the admin bootstrap token is generated
// on the server by the installer. The Node.js runtime archive is uploaded
// separately (see deploy/vds/README.md).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'dist', 'atlas-sync-upload');
const DEPLOY_FILES = [
  'README.md',
  'RESTORE.md',
  'install-atlas-sync.sh',
  'atlas-sync.service',
  'atlas-sync-apache.conf',
  'atlas-sync-apache-ssl.conf',
  'backup-atlas-sync.sh',
  'atlas-sync-backup.service',
  'atlas-sync-backup.timer',
];

function copy(from, to){
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function listFiles(directory){
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });

// Sync service
copy(join(ROOT, 'server'), join(STAGE, 'server'));
// Atlas app (Studio + Capture PWA)
copy(join(ROOT, 'js'), join(STAGE, 'js'));
copy(join(ROOT, 'styles'), join(STAGE, 'styles'));
copy(join(ROOT, 'styles.css'), join(STAGE, 'styles.css'));
copy(join(ROOT, 'addons'), join(STAGE, 'addons'));
copy(join(ROOT, 'capture'), join(STAGE, 'capture'));
copy(join(ROOT, 'index.html'), join(STAGE, 'index.html'));
// Deployment scaffolding is allowlisted: old archives and local runtime files
// under deploy/vds must never be nested into a new release bundle.
for (const name of DEPLOY_FILES) {
  copy(
    join(ROOT, 'deploy', 'vds', name),
    join(STAGE, 'deploy', 'vds', name)
  );
}

const forbidden = listFiles(STAGE).map(path => relative(STAGE, path).replaceAll('\\', '/'))
  .filter(path => /(^|\/)(atlas-sync\.env|[^/]+\.(?:sqlite|sqlite3|db)(?:-wal|-shm)?|[^/]+\.env)$/i.test(path));
if (forbidden.length > 0) {
  throw new Error(`Refusing to bundle private runtime data: ${forbidden.join(', ')}`);
}

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
