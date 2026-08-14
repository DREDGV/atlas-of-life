import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const gradlePath = join(projectRoot, 'android', 'app', 'build.gradle');
const manifestPath = join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const requestedCode = process.env.ATLAS_ANDROID_VERSION_CODE || process.env.GITHUB_RUN_NUMBER || '1';
const versionCode = Number.parseInt(requestedCode, 10);

if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error('ATLAS_ANDROID_VERSION_CODE must be a positive integer.');
}

const current = await readFile(gradlePath, 'utf8');
let next = current
  .replace(/^\s*versionCode\s+\d+\s*$/m, `        versionCode ${versionCode}`)
  .replace(/^\s*versionName\s+"[^"]*"\s*$/m, `        versionName "${packageJson.version}"`);

const signingMarker = 'ATLAS_STABLE_SIGNING';
if (!next.includes(signingMarker)) {
  const signingConfig = `android {
    // ${signingMarker}: use one private key for installable updates from CI.
    signingConfigs {
        atlas {
            def atlasKeystorePath = System.getenv("ATLAS_ANDROID_KEYSTORE_PATH")
            if (atlasKeystorePath) {
                storeFile file(atlasKeystorePath)
                storePassword System.getenv("ATLAS_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ATLAS_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ATLAS_ANDROID_KEY_PASSWORD")
            }
        }
    }
`;
  next = next.replace('android {', signingConfig);
  next = next.replace(
    '    buildTypes {',
    `    buildTypes {
        debug {
            if (System.getenv("ATLAS_ANDROID_KEYSTORE_PATH")) {
                signingConfig signingConfigs.atlas
            }
        }`
  );
}

if (!next.includes(`versionCode ${versionCode}`) ||
    !next.includes(`versionName "${packageJson.version}"`) ||
    !next.includes(signingMarker)) {
  throw new Error('Could not configure Android version metadata.');
}

await writeFile(gradlePath, next, 'utf8');

const currentManifest = await readFile(manifestPath, 'utf8');
const recordAudioPermission = '<uses-permission android:name="android.permission.RECORD_AUDIO" />';
let nextManifest = currentManifest;

if (!nextManifest.includes(recordAudioPermission)) {
  nextManifest = nextManifest.replace(
    '<uses-permission android:name="android.permission.INTERNET" />',
    `<uses-permission android:name="android.permission.INTERNET" />\n    ${recordAudioPermission}`
  );
}

if (!nextManifest.includes('android:windowSoftInputMode="adjustResize"')) {
  nextManifest = nextManifest.replace(
      '<activity\n            android:configChanges',
      '<activity\n            android:windowSoftInputMode="adjustResize"\n            android:configChanges'
    );
}

if (!nextManifest.includes(recordAudioPermission) ||
    !nextManifest.includes('android:windowSoftInputMode="adjustResize"')) {
  throw new Error('Could not configure required Android manifest entries.');
}

await writeFile(manifestPath, nextManifest, 'utf8');
console.log(`Android package version configured: ${packageJson.version} (code ${versionCode}).`);
