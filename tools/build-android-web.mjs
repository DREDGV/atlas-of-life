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

// Capacitor serves its webDir fallback for navigation requests. Using the
// browser redirect page here makes /capture/ resolve back to that fallback
// and creates an endless /capture/capture/... loop. Put the real capture
// document at the web root instead.
await copyFile(join(projectRoot, 'capture', 'index.html'), join(outputRoot, 'index.html'));
await copyFile(join(projectRoot, 'capture', 'manifest.webmanifest'), join(outputRoot, 'manifest.webmanifest'));
await copyFile(join(projectRoot, 'capture', 'sw.js'), join(outputRoot, 'sw.js'));
await cp(join(projectRoot, 'capture', 'icons'), join(outputRoot, 'icons'), {
  recursive: true,
});

for (const directory of ['js', 'styles']) {
  await cp(join(projectRoot, directory), join(outputRoot, directory), {
    recursive: true,
  });
}

console.log('Android web bundle prepared at dist/android.');
