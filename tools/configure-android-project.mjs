import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const gradlePath = join(projectRoot, 'android', 'app', 'build.gradle');
const requestedCode = process.env.ATLAS_ANDROID_VERSION_CODE || process.env.GITHUB_RUN_NUMBER || '1';
const versionCode = Number.parseInt(requestedCode, 10);

if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error('ATLAS_ANDROID_VERSION_CODE must be a positive integer.');
}

const current = await readFile(gradlePath, 'utf8');
const next = current
  .replace(/^\s*versionCode\s+\d+\s*$/m, `        versionCode ${versionCode}`)
  .replace(/^\s*versionName\s+"[^"]*"\s*$/m, `        versionName "${packageJson.version}"`);

if (next === current || !next.includes(`versionName "${packageJson.version}"`)) {
  throw new Error('Could not configure Android version metadata.');
}

await writeFile(gradlePath, next, 'utf8');
console.log(`Android package version configured: ${packageJson.version} (code ${versionCode}).`);
