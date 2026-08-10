import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(projectRoot, 'capacitor.config.json'), 'utf8'));

assert(packageJson.engines.node === '>=22', 'Android build must require Node.js 22+.');
assert(packageJson.dependencies['@capacitor/core'] === '8.5.0', 'Capacitor core must be pinned.');
assert(packageJson.dependencies['@capacitor/android'] === '8.5.0', 'Capacitor Android must be pinned.');
assert(packageJson.devDependencies['@capacitor/cli'] === '8.5.0', 'Capacitor CLI must be pinned.');
assert(config.appId === 'com.dredgv.atlas.capture', 'Unexpected Android application ID.');
assert(config.appName === 'Atlas Capture', 'Unexpected Android application name.');
assert(config.webDir === 'dist/android', 'Capacitor webDir must use the generated bundle.');

for (const relativePath of [
  'capture.html',
  'capture/index.html',
  'js/capture/app.js',
  'styles/capture.css',
  'tools/build-android-web.mjs',
]) {
  assert(existsSync(join(projectRoot, relativePath)), `Missing Android input: ${relativePath}`);
}

console.log('Android preparation checks passed.');
