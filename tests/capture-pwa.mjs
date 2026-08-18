import {
  buildShareDraft,
  applyShareDraft,
  mergeShareDrafts,
  mergeShareWithExisting,
  resolveShortcutEntryPoint,
} from '../js/capture/share-target.js';
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Test 1: manifest is valid JSON with required fields
const manifestContent = readFileSync(join(projectRoot, 'capture', 'manifest.webmanifest'), 'utf-8');
const manifest = JSON.parse(manifestContent);
assert(typeof manifest === 'object', 'Test 1: manifest should be an object');
assert(manifest.name === 'Atlas Capture', 'Test 1: manifest should have name');
assert(manifest.short_name === 'Atlas', 'Test 1: manifest should have short_name');
assert(manifest.start_url === './', 'Test 1: manifest should have start_url');
assert(manifest.display === 'standalone', 'Test 1: manifest should have standalone display');
assert(manifest.theme_color === '#0b0f17', 'Test 1: manifest should have theme_color');
console.log('✓ Test 1: manifest is valid JSON with required fields');

// Test 2: manifest icons exist on disk
for (const icon of manifest.icons) {
  const iconPath = join(projectRoot, 'capture', icon.src);
  assert(existsSync(iconPath), `Test 2: icon ${icon.src} should exist`);
}
console.log('✓ Test 2: all manifest icons exist');

// Test 3: PNG icons have correct sizes
function readPNGSize(filePath) {
  const buf = readFileSync(filePath);
  if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  return null;
}

const icon192Path = join(projectRoot, 'capture', 'icons', 'icon-192.png');
const icon512Path = join(projectRoot, 'capture', 'icons', 'icon-512.png');
const iconMaskablePath = join(projectRoot, 'capture', 'icons', 'icon-maskable-512.png');

const size192 = readPNGSize(icon192Path);
assert(size192 && size192.width === 192 && size192.height === 192, 'Test 3: icon-192.png should be 192x192');

const size512 = readPNGSize(icon512Path);
assert(size512 && size512.width === 512 && size512.height === 512, 'Test 3: icon-512.png should be 512x512');

const sizeMaskable = readPNGSize(iconMaskablePath);
assert(sizeMaskable && sizeMaskable.width === 512 && sizeMaskable.height === 512, 'Test 3: icon-maskable-512.png should be 512x512');
console.log('✓ Test 3: PNG icons have correct sizes');

// Test 4: maskable icon has purpose=maskable
const maskableIcon = manifest.icons.find(i => i.purpose === 'maskable');
assert(maskableIcon, 'Test 4: should have maskable icon');
assert(maskableIcon.src === 'icons/icon-maskable-512.png', 'Test 4: maskable icon should be icon-maskable-512.png');
console.log('✓ Test 4: maskable icon has purpose=maskable');

// Test 5: apple-touch-icon exists
const indexHtml = readFileSync(join(projectRoot, 'capture', 'index.html'), 'utf-8');
assert(indexHtml.includes('apple-touch-icon'), 'Test 5: should have apple-touch-icon');
assert(indexHtml.includes('icons/icon-192.png'), 'Test 5: should reference icon-192.png');
const appleTouchPath = join(projectRoot, 'capture', 'icons', 'icon-192.png');
assert(existsSync(appleTouchPath), 'Test 5: apple-touch-icon file should exist');
console.log('✓ Test 5: apple-touch-icon exists');

// Test 6: share_target.action contains action=share
assert(manifest.share_target, 'Test 6: manifest should have share_target');
assert(manifest.share_target.action.includes('action=share'), 'Test 6: share_target action should contain action=share');
console.log('✓ Test 6: share_target.action contains action=share');

// Test 7: parser accepts action=share
const draft1 = buildShareDraft('Title', 'Text', 'https://example.com');
assert(draft1.text.includes('Title'), 'Test 7: parser should accept title');
assert(draft1.text.includes('Text'), 'Test 7: parser should accept text');
assert(draft1.text.includes('https://example.com'), 'Test 7: parser should accept url');
assert(draft1.entryPoint === 'share', 'Test 7: shared draft should have share entryPoint');
console.log('✓ Test 7: parser accepts action=share');

// Test 8: parser accepts title/text/url without action
const draft2 = buildShareDraft('OnlyTitle', null, null);
assert(draft2.text === 'OnlyTitle', 'Test 8: parser should work with just title');
console.log('✓ Test 8: parser accepts title/text/url without action');

// Test 9: parser rejects empty input
const draft3 = buildShareDraft(null, null, null);
assert(draft3.text === '', 'Test 9: empty input should produce empty text');
console.log('✓ Test 9: parser rejects empty input');

// Test 10: append uses \n\n separator
const merged = mergeShareWithExisting('Existing', 'New');
assert(merged === 'Existing\n\nNew', 'Test 10: append should use \\n\\n separator');
console.log('✓ Test 10: append uses \\n\\n separator');

// Test 11: cancel result exists
const cancelResult = applyShareDraft({ text: '' }, null);
assert(cancelResult.action === 'cancel', 'Test 11: empty draft should return cancel');
console.log('✓ Test 11: cancel result exists');

// Test 11b: Share append/replace/reject provenance and shortcut rules
const existingVoiceDraft = {
  text: 'Existing',
  userHint: 'thought',
  inputType: 'voice',
  entryPoint: 'app',
};
const sharedDraft = buildShareDraft('', 'Shared', '');
const mergedDraft = mergeShareDrafts(existingVoiceDraft, sharedDraft);
assert(mergedDraft.text === 'Existing\n\nShared', 'Test 11b: append should merge text');
assert(mergedDraft.userHint === 'thought', 'Test 11b: append should preserve existing userHint');
assert(mergedDraft.inputType === 'voice', 'Test 11b: append should preserve existing voice inputType');
assert(mergedDraft.entryPoint === 'share', 'Test 11b: append should use share entryPoint');
const replaceResult = applyShareDraft(sharedDraft, null);
assert(replaceResult.draft.entryPoint === 'share', 'Test 11b: replace should use share entryPoint');
const choiceResult = applyShareDraft(sharedDraft, existingVoiceDraft);
assert(choiceResult.existing === existingVoiceDraft, 'Test 11b: reject path should preserve existing draft object');
assert(resolveShortcutEntryPoint(null) === 'shortcut', 'Test 11b: shortcut without draft should use shortcut');
assert(resolveShortcutEntryPoint(existingVoiceDraft) === 'app', 'Test 11b: shortcut should not replace existing provenance');
assert(resolveShortcutEntryPoint({ ...existingVoiceDraft, entryPoint: 'share' }) === 'share', 'Test 11b: shortcut should preserve share draft provenance');
console.log('✓ Test 11b: Share and shortcut provenance rules');

// Test 12: PRECACHE_ASSETS exist on disk
const swContent = readFileSync(join(projectRoot, 'capture', 'sw.js'), 'utf-8');
const precacheMatch = swContent.match(/const PRECACHE_ASSETS = \[([\s\S]*?)\]/);
assert(precacheMatch, 'Test 12: PRECACHE_ASSETS should be defined');
const precacheItems = precacheMatch[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
for (const item of precacheItems) {
  if (item === './' || item === './index.html') continue;
  const resolvedPath = join(projectRoot, 'capture', item);
  assert(existsSync(resolvedPath), `Test 12: precache asset ${item} should exist`);
}
console.log('✓ Test 12: PRECACHE_ASSETS exist on disk');

// Test 13: service worker does not have unconditional skipWaiting in install
const installMatch = swContent.match(/addEventListener\('install'[\s\S]*?\}\)/);
assert(!installMatch[0].includes('self.skipWaiting()'), 'Test 13: install should not have unconditional skipWaiting');
const pwaModuleContent = readFileSync(join(projectRoot, 'js', 'capture', 'pwa.js'), 'utf-8');
assert(
  pwaModuleContent.includes('flushDraftCallback() === false'),
  'Test 13: failed draft flush should postpone a user-confirmed update',
);
console.log('✓ Test 13: no unconditional skipWaiting in install');

// Test 13b: a failed flush keeps Update retryable without duplicate handlers
class FakeButton {
  constructor() {
    this.onclick = null;
    this.listeners = [];
  }

  addEventListener(type, handler, options = {}) {
    if (type === 'click') this.listeners.push({ handler, once: Boolean(options.once) });
  }

  click() {
    if (this.onclick) this.onclick();
    for (const listener of [...this.listeners]) {
      listener.handler();
      if (listener.once) {
        this.listeners = this.listeners.filter(candidate => candidate !== listener);
      }
    }
  }
}

const originalGlobals = {
  document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
};
const updateBanner = { hidden: true };
const updateButton = new FakeButton();
const laterButton = new FakeButton();
const updateMessages = [];
const updateToasts = [];
let flushAttempts = 0;
let controllerChangeListeners = 0;
const updateRegistration = {
  waiting: { postMessage: message => updateMessages.push(message) },
  addEventListener() {},
};

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    getElementById(id) {
      return {
        updateBanner,
        btnUpdate: updateButton,
        btnUpdateLater: laterButton,
      }[id] || null;
    },
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    serviceWorker: {
      controller: {},
      register: async () => updateRegistration,
      addEventListener(type) {
        if (type === 'controllerchange') controllerChangeListeners += 1;
      },
    },
  },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { reload() {} } },
});

try {
  const retryModule = await import('../js/capture/pwa.js?update-retry-regression');
  await retryModule.registerCaptureServiceWorker({
    flushDraft() {
      flushAttempts += 1;
      return flushAttempts > 1;
    },
    showToast(message) {
      updateToasts.push(message);
    },
  });

  retryModule.showUpdateAvailable();
  retryModule.showUpdateAvailable();
  updateButton.click();
  assert(flushAttempts === 1, 'Test 13b: duplicate banner setup must not duplicate update handlers');
  assert(updateMessages.length === 0, 'Test 13b: failed flush must not send SKIP_WAITING');
  assert(updateBanner.hidden === false, 'Test 13b: banner should stay visible after failed flush');
  assert(updateToasts.length === 1, 'Test 13b: failed flush should explain the delay');

  updateButton.click();
  assert(flushAttempts === 2, 'Test 13b: Update should retry the draft flush');
  assert(updateMessages.length === 1, 'Test 13b: successful retry should send SKIP_WAITING once');
  assert(updateMessages[0].type === 'SKIP_WAITING', 'Test 13b: successful retry should request activation');
  assert(controllerChangeListeners === 1, 'Test 13b: successful update should register one reload listener');
  assert(updateBanner.hidden === true, 'Test 13b: banner should hide after successful retry');
} finally {
  for (const [name, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
console.log('✓ Test 13b: failed draft flush keeps Update retryable without duplicate handlers');

// Test 14: service worker routing is scope-relative
assert(!swContent.includes("url.pathname.startsWith('/js/')"), 'Test 14: routing should not use absolute paths');
assert(!swContent.includes("url.pathname.startsWith('/styles/')"), 'Test 14: routing should not use absolute paths');
console.log('✓ Test 14: service worker routing is scope-relative');

// Test 15: service worker does not cache desktop addons/map/inspector
assert(!swContent.includes('addons'), 'Test 15: should not cache addons');
assert(!swContent.includes('view_map'), 'Test 15: should not cache view_map');
assert(!swContent.includes('inspector'), 'Test 15: should not cache inspector');
console.log('✓ Test 15: service worker does not cache desktop addons');

// Test 16: the complete Mobile Capture import graph is precached without desktop Inbox UI
const captureEntry = join(projectRoot, 'js', 'capture', 'app.js');

function collectStaticImportGraph(filePath, visited = new Set()) {
  if (visited.has(filePath)) return visited;
  visited.add(filePath);

  const source = readFileSync(filePath, 'utf-8');
  const importPattern = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(importPattern)) {
    if (!match[1].startsWith('.')) continue;
    collectStaticImportGraph(join(dirname(filePath), match[1]), visited);
  }

  return visited;
}

const captureGraph = collectStaticImportGraph(captureEntry);
const precachePaths = new Set(
  precacheItems.map(item => join(projectRoot, 'capture', item))
);
const missingCaptureModules = [...captureGraph].filter(filePath => !precachePaths.has(filePath));

assert(
  missingCaptureModules.length === 0,
  `Test 16: missing Capture modules in precache: ${missingCaptureModules.join(', ')}`
);
assert(
  ![...captureGraph].some(filePath =>
    filePath.endsWith(join('features', 'inbox', 'index.js')) ||
    filePath.endsWith(join('features', 'inbox', 'view.js'))
  ),
  'Test 16: Mobile Capture import graph should not contain desktop Inbox UI'
);
console.log('✓ Test 16: complete Mobile Capture import graph is isolated and precached');

// Test 17: version and cache are 0.10.0-alpha.2
const { APP_VERSION } = await import('../js/version.js');
assert(APP_VERSION === '0.10.0-alpha.2', 'Test 17: version should be 0.10.0-alpha.2');
assert(swContent.includes("const CACHE_NAME = 'atlas-capture-0.10.0-alpha.2'"), 'Test 17: SW cache should be alpha.2');
console.log('✓ Test 17: version and cache are 0.10.0-alpha.2');

// Test 18: lifecycle, permission and accessibility wiring exists in the Capture shell
const captureAppContent = readFileSync(join(projectRoot, 'js', 'capture', 'app.js'), 'utf-8');
assert(captureAppContent.includes("window.addEventListener('pagehide', flushCaptureDraft)"), 'Test 18: pagehide should flush draft');
assert(captureAppContent.includes("document.addEventListener('visibilitychange'"), 'Test 18: visibilitychange should be handled');
assert(captureAppContent.includes('flushDraft: flushCaptureDraft'), 'Test 18: SW update should use common draft flush');
assert(captureAppContent.includes("atlas_capture_mic_intro_v1"), 'Test 18: mic intro key should be explicit');
assert(captureAppContent.includes('queryMicrophonePermission(navigator)'), 'Test 18: microphone permission should be queried from platform');
assert(indexHtml.includes('id="micIntroDialog"'), 'Test 18: mic intro should use dialog');
assert(indexHtml.includes('id="micDeniedDialog"'), 'Test 18: denied UX should use dialog');
assert(indexHtml.includes('id="voiceStatus" aria-live="polite"'), 'Test 18: voice status should be announced accessibly');
assert(indexHtml.includes('id="infoMicrophone"'), 'Test 18: info panel should show microphone status');
console.log('✓ Test 18: lifecycle, permission and accessibility wiring');

console.log('\n✅ All PWA tests passed.');
