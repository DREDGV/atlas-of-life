import { access, copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, 'dist', 'android');

const requiredInputs = [
  'capture.html',
  'capture/index.html',
  'capture/manifest.webmanifest',
  'capture/sw.js',
  'js/capture/app.js',
  'styles/capture.css',
];

for (const relativePath of requiredInputs) {
  await access(join(projectRoot, relativePath));
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

// Capacitor requires index.html at webDir root. The existing capture.html
// redirects into capture/ while preserving query parameters and hash routes.
await copyFile(join(projectRoot, 'capture.html'), join(outputRoot, 'index.html'));

for (const directory of ['capture', 'js', 'styles']) {
  await cp(join(projectRoot, directory), join(outputRoot, directory), {
    recursive: true,
  });
}

console.log('Android web bundle prepared at dist/android.');
