import { buildShareDraft, applyShareDraft } from '../js/capture/share-target.js';
import { readFileSync } from 'fs';
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

// Test 2: manifest contains icons 192 and 512
assert(Array.isArray(manifest.icons), 'Test 2: manifest should have icons array');
const has192 = manifest.icons.some(i => i.sizes === '192x192');
const has512 = manifest.icons.some(i => i.sizes === '512x512');
assert(has192, 'Test 2: manifest should have 192x192 icon');
assert(has512, 'Test 2: manifest should have 512x512 icon');
console.log('✓ Test 2: manifest contains icons 192 and 512');

// Test 3: manifest contains share_target with title/text/url
assert(manifest.share_target, 'Test 3: manifest should have share_target');
assert(manifest.share_target.action === './', 'Test 3: share_target action should be ./');
assert(manifest.share_target.method === 'GET', 'Test 3: share_target method should be GET');
assert(manifest.share_target.params.title === 'title', 'Test 3: share_target should have title param');
assert(manifest.share_target.params.text === 'text', 'Test 3: share_target should have text param');
assert(manifest.share_target.params.url === 'url', 'Test 3: share_target should have url param');
console.log('✓ Test 3: share_target contains title/text/url');

// Test 4: share-target parser builds expected draft
const draft1 = buildShareDraft('Заголовок', 'Текст', 'https://example.com');
assert(draft1.text.includes('Заголовок'), 'Test 4: draft should include title');
assert(draft1.text.includes('Текст'), 'Test 4: draft should include text');
assert(draft1.text.includes('https://example.com'), 'Test 4: draft should include url');
assert(draft1.userHint === 'note', 'Test 4: default userHint should be note');
assert(draft1.inputType === 'text', 'Test 4: default inputType should be text');
console.log('✓ Test 4: share-target parser builds expected draft');

// Test 5: share-target parser handles empty input
const draft2 = buildShareDraft(null, null, null);
assert(draft2.text === '', 'Test 5: empty input should produce empty text');
console.log('✓ Test 5: share-target parser handles empty input');

// Test 6: share-target parser handles URLs correctly
const draft4 = buildShareDraft('Title', 'Text', 'https://example.com');
assert(draft4.text.includes('https://example.com'), 'Test 6: https URL should be included');
console.log('✓ Test 6: share-target parser handles URLs correctly');

// Test 7: existing draft not replaced without action
const existing = { text: 'Existing draft', userHint: 'task', inputType: 'text' };
const shareDraft = { text: 'Shared text', userHint: 'note', inputType: 'text' };
const result = applyShareDraft(shareDraft, existing);
assert(result.action === 'choice', 'Test 7: should return choice when existing draft');
assert(result.draft === shareDraft, 'Test 7: should include share draft');
assert(result.existing === existing, 'Test 7: should include existing draft');
console.log('✓ Test 7: existing draft not replaced without action');

// Test 8: share replaces when no existing draft
const result2 = applyShareDraft(shareDraft, null);
assert(result2.action === 'replace', 'Test 8: should replace when no existing');
assert(result2.draft === shareDraft, 'Test 8: should include share draft');
console.log('✓ Test 8: share replaces when no existing draft');

// Test 9: share with empty draft returns cancel
const result3 = applyShareDraft({ text: '' }, null);
assert(result3.action === 'cancel', 'Test 9: empty share should cancel');
console.log('✓ Test 9: share with empty draft returns cancel');

// Test 10: version updated to 0.9.0-alpha.2
const { APP_VERSION } = await import('../js/version.js');
assert(APP_VERSION === '0.9.0-alpha.2', 'Test 10: version should be 0.9.0-alpha.2');
console.log('✓ Test 10: version updated to 0.9.0-alpha.2');

// Test 11: service worker cache allowlist
const swContent = readFileSync(join(projectRoot, 'capture', 'sw.js'), 'utf-8');
assert(!swContent.includes('addons'), 'Test 11: sw should not cache addons');
assert(!swContent.includes('view_map'), 'Test 11: sw should not cache view_map');
assert(!swContent.includes('inspector'), 'Test 11: sw should not cache inspector');
console.log('✓ Test 11: service worker cache allowlist correct');

console.log('\n✅ All PWA tests passed.');
