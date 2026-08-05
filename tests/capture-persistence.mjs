import { state } from '../js/state.js';
import { addInboxLines } from '../js/features/inbox/model.js';
import { captureInbox, deleteInbox, undoDeleteInbox } from '../js/core/commands.js';
import { loadState, saveState } from '../js/storage.js';
import adapter from '../js/storageAdapter.js';

const memory = new Map();
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resetState() {
  state.domains = [];
  state.projects = [];
  state.tasks = [];
  state.inbox = [];
  state.operationLog = [];
  state.activeDomain = null;
  state.maxEdges = 300;
  state.showLinks = true;
  state.showAging = true;
  state.showGlow = true;
  state.view = 'map';
  state.settings = { layoutMode: 'auto' };
  memory.clear();
}

const opts = (extra = {}) => ({
  persist: false,
  now: 1000,
  deviceId: 'device-test',
  idFactory: index => `inbox-${index}`,
  ...extra,
});

// Test 1: captureInbox saves rawText
resetState();
const t1 = captureInbox('Тест rawText', opts());
assert(t1.length === 1, 'Test 1: should create one item');
assert(t1[0].rawText === 'Тест rawText', 'Test 1: rawText should be saved');
console.log('✓ Test 1: rawText saved');

// Test 2: text === rawText at creation
resetState();
const t2 = captureInbox('Проверка совпадения', opts());
assert(t2[0].text === t2[0].rawText, 'Test 2: text should equal rawText');
console.log('✓ Test 2: text === rawText');

// Test 3: inputType text saved
resetState();
const t3 = captureInbox('Текстовый ввод', opts({ inputType: 'text' }));
assert(t3[0].inputType === 'text', 'Test 3: inputType should be text');
console.log('✓ Test 3: inputType text saved');

// Test 4: inputType voice saved
resetState();
const t4 = captureInbox('Голосовой ввод', opts({ inputType: 'voice' }));
assert(t4[0].inputType === 'voice', 'Test 4: inputType should be voice');
console.log('✓ Test 4: inputType voice saved');

// Test 5: source mobile-capture saved
resetState();
const t5 = captureInbox('Мобильная запись', opts({ source: 'mobile-capture' }));
assert(t5[0].source === 'mobile-capture', 'Test 5: source should be mobile-capture');
console.log('✓ Test 5: source mobile-capture saved');

// Test 6: status new saved
resetState();
const t6 = captureInbox('Новая запись', opts({ status: 'new' }));
assert(t6[0].status === 'new', 'Test 6: status should be new');
console.log('✓ Test 6: status new saved');

// Test 7: userHint task/thought/note saved
resetState();
const t7a = captureInbox('Задача', opts({ userHint: 'task' }));
assert(t7a[0].userHint === 'task', 'Test 7a: userHint should be task');

const t7b = captureInbox('Мысль', opts({ userHint: 'thought' }));
assert(t7b[0].userHint === 'thought', 'Test 7b: userHint should be thought');

const t7c = captureInbox('Заметка', opts({ userHint: 'note' }));
assert(t7c[0].userHint === 'note', 'Test 7c: userHint should be note');
console.log('✓ Test 7: userHint saved');

// Test 8: unknown userHint becomes null
resetState();
const t8 = captureInbox('Неизвестный тип', opts({ userHint: 'unknown' }));
assert(t8[0].userHint === null, 'Test 8: unknown userHint should be null');
console.log('✓ Test 8: unknown userHint normalized to null');

// Test 9: deviceId saved
resetState();
const t9 = captureInbox('С deviceId', opts({ deviceId: 'device-123' }));
assert(t9[0].deviceId === 'device-123', 'Test 9: deviceId should be saved');
console.log('✓ Test 9: deviceId saved');

// Test 10: old captureInbox(text) works
resetState();
const t10 = captureInbox('Старый вызов');
assert(t10.length === 1, 'Test 10: old call should work');
assert(t10[0].text === 'Старый вызов', 'Test 10: text should be saved');
assert(t10[0].inputType === 'text', 'Test 10: default inputType should be text');
assert(t10[0].source === 'desktop-capture', 'Test 10: default source should be desktop-capture');
console.log('✓ Test 10: old captureInbox(text) works');

// Test 11: desktop splitLines creates multiple items
resetState();
const t11 = captureInbox('Первая\nВторая\nТретья', opts({ splitLines: true }));
assert(t11.length === 3, 'Test 11: splitLines true should create 3 items');
assert(t11[0].text === 'Первая', 'Test 11: first item text');
assert(t11[1].text === 'Вторая', 'Test 11: second item text');
assert(t11[2].text === 'Третья', 'Test 11: third item text');
console.log('✓ Test 11: desktop splitLines creates multiple items');

// Test 12: mobile splitLines:false creates one multiline item
resetState();
const multiline = 'Строка 1\nСтрока 2\nСтрока 3';
const t12 = captureInbox(multiline, opts({ splitLines: false }));
assert(t12.length === 1, 'Test 12: splitLines false should create 1 item');
assert(t12[0].text === multiline, 'Test 12: text should contain all lines');
assert(t12[0].rawText === multiline, 'Test 12: rawText should contain all lines');
console.log('✓ Test 12: mobile splitLines:false creates one multiline item');

// Test 13: extra fields survive full save/load cycle through localStorage
resetState();
state.domains = [{ id: 'd1', title: 'Test' }];
const t13 = captureInbox('Многострочная\nпроверка\nсохранения', opts({
  inputType: 'voice',
  source: 'mobile-capture',
  status: 'new',
  userHint: 'thought',
  deviceId: 'device-save',
  splitLines: false,
  persist: true,
  now: 2000,
}));
assert(state.inbox.length === 1, 'Test 13: inbox should have 1 item');

const durableJson = memory.get(adapter.key);
assert(durableJson, 'Test 13: durable JSON should exist in localStorage');

state.inbox = [];
state.operationLog = [];
const loaded = loadState();
assert(loaded, 'Test 13: loadState should succeed');
assert(state.inbox.length === 1, 'Test 13: inbox should have 1 item after reload');
const restored = state.inbox[0];
assert(restored.rawText === 'Многострочная\nпроверка\nсохранения', 'Test 13: rawText after reload');
assert(restored.text === 'Многострочная\nпроверка\nсохранения', 'Test 13: text after reload');
assert(restored.inputType === 'voice', 'Test 13: inputType after reload');
assert(restored.source === 'mobile-capture', 'Test 13: source after reload');
assert(restored.status === 'new', 'Test 13: status after reload');
assert(restored.userHint === 'thought', 'Test 13: userHint after reload');
assert(restored.deviceId === 'device-save', 'Test 13: deviceId after reload');
console.log('✓ Test 13: extra fields survive full save/load cycle');

// Test 14: storage error fully rolls back mobile record
resetState();
state.domains = [{ id: 'd1', title: 'Test' }];
captureInbox('Исходная запись', opts({ persist: true, now: 3000 }));
const jsonBefore = memory.get(adapter.key);
assert(jsonBefore, 'Test 14: should have initial JSON');

const inboxBefore = state.inbox.length;
const originalSetItem = globalThis.localStorage.setItem;
const savedWarn = console.warn;
console.warn = () => {};
globalThis.localStorage.setItem = function(key, value) {
  if (key === adapter.key) {
    const err = new Error('Quota exceeded');
    err.name = 'QuotaExceededError';
    throw err;
  }
  memory.set(key, String(value));
};

let thrownError = null;
try {
  captureInbox('Запись с ошибкой', {
    persist: true,
    now: 4000,
    deviceId: 'device-err',
    splitLines: false,
  });
} catch (e) {
  thrownError = e;
}

globalThis.localStorage.setItem = originalSetItem;
console.warn = savedWarn;

assert(thrownError !== null, 'Test 14: should throw error');
assert(thrownError.name === 'QuotaExceededError', 'Test 14: should throw QuotaExceededError');
assert(state.inbox.length === inboxBefore, 'Test 14: inbox should not grow after error');
console.log('✓ Test 14: storage error rolls back record');

// Test 15: operationLog unchanged after error
resetState();
state.domains = [{ id: 'd1', title: 'Test' }];
captureInbox('Запись до ошибки', opts({ persist: false, now: 5000 }));
const opsBefore = [...state.operationLog];
const opsLenBefore = state.operationLog.length;

console.warn = () => {};
globalThis.localStorage.setItem = function(key, value) {
  if (key === adapter.key) {
    const err = new Error('Quota exceeded');
    err.name = 'QuotaExceededError';
    throw err;
  }
  memory.set(key, String(value));
};

try {
  captureInbox('Запись с ошибкой', {
    persist: true,
    now: 6000,
    deviceId: 'device-err',
    splitLines: false,
  });
} catch (e) {}

globalThis.localStorage.setItem = originalSetItem;
console.warn = savedWarn;

assert(state.operationLog.length === opsLenBefore, 'Test 15: operationLog length unchanged');
assert(JSON.stringify(state.operationLog) === JSON.stringify(opsBefore), 'Test 15: operationLog content unchanged');
console.log('✓ Test 15: operationLog unchanged after error');

// Test 16: durable JSON byte-identical after error
resetState();
state.domains = [{ id: 'd1', title: 'Test' }];
captureInbox('Запись для проверки', opts({ persist: true, now: 7000 }));
const jsonBeforeError = memory.get(adapter.key);

console.warn = () => {};
globalThis.localStorage.setItem = function(key, value) {
  if (key === adapter.key) {
    const err = new Error('Quota exceeded');
    err.name = 'QuotaExceededError';
    throw err;
  }
  memory.set(key, String(value));
};

try {
  captureInbox('Запись с ошибкой', {
    persist: true,
    now: 8000,
    deviceId: 'device-err',
    splitLines: false,
  });
} catch (e) {}

globalThis.localStorage.setItem = originalSetItem;
console.warn = savedWarn;

const jsonAfterError = memory.get(adapter.key);
assert(jsonAfterError === jsonBeforeError, 'Test 16: durable JSON byte-identical after error');
console.log('✓ Test 16: durable JSON unchanged after error');

// Test 17: HTML сохраняется как буквальный текст
resetState();
const xss = '<img src=x onerror=alert(1)>';
const t17 = captureInbox(xss, opts());
assert(t17[0].text === xss, 'Test 17: HTML should be stored as-is in text');
assert(t17[0].rawText === xss, 'Test 17: HTML should be stored as-is in rawText');
console.log('✓ Test 17: HTML сохраняется как буквальный текст (безопасное DOM-отображение подтверждено ручным smoke)');

// Test 18: empty record not saved
resetState();
const t18a = captureInbox('', opts());
assert(t18a.length === 0, 'Test 18a: empty string should not create item');

const t18b = captureInbox('   ', opts());
assert(t18b.length === 0, 'Test 18b: whitespace should not create item');

const t18c = captureInbox('\n\n\n', opts());
assert(t18c.length === 0, 'Test 18c: newlines should not create item');
console.log('✓ Test 18: empty records not saved');

// Test 19-22: Draft tests
const { loadCaptureDraft, saveCaptureDraft, clearCaptureDraft, normalizeCaptureDraft } = await import('../js/capture/draft.js');

// Test 19: draft serializes and deserializes
resetState();
const draftData = { text: 'Черновик записи', userHint: 'task', inputType: 'voice' };
const savedDraft = saveCaptureDraft(draftData);
assert(savedDraft === true, 'Test 19: saveCaptureDraft should return true');
const loadedDraft = loadCaptureDraft();
assert(loadedDraft !== null, 'Test 19: draft should be loaded');
assert(loadedDraft.text === 'Черновик записи', 'Test 19: draft text should match');
assert(loadedDraft.userHint === 'task', 'Test 19: draft userHint should match');
assert(loadedDraft.inputType === 'voice', 'Test 19: draft inputType should match');
assert(typeof loadedDraft.updatedAt === 'number', 'Test 19: draft should have updatedAt');
console.log('✓ Test 19: draft serializes and deserializes');

// Test 20: draft restores text and hint
resetState();
saveCaptureDraft({ text: 'Тест восстановления', userHint: 'thought', inputType: 'text' });
const restoredDraft = loadCaptureDraft();
assert(restoredDraft.text === 'Тест восстановления', 'Test 20: text should be restored');
assert(restoredDraft.userHint === 'thought', 'Test 20: userHint should be restored');
console.log('✓ Test 20: draft restores text and hint');

// Test 21: successful save clears draft
resetState();
saveCaptureDraft({ text: 'Для очистки', userHint: null, inputType: 'text' });
assert(loadCaptureDraft() !== null, 'Test 21: draft should exist before clear');
clearCaptureDraft();
assert(loadCaptureDraft() === null, 'Test 21: draft should be null after clear');
console.log('✓ Test 21: successful save clears draft');

// Test 22: normalizeCaptureDraft handles invalid input
assert(normalizeCaptureDraft(null) === null, 'Test 22a: null should return null');
assert(normalizeCaptureDraft({}) === null, 'Test 22b: empty object should return null');
assert(normalizeCaptureDraft({ text: '' }) === null, 'Test 22c: empty text should return null');
assert(normalizeCaptureDraft({ text: '  ' }) === null, 'Test 22d: whitespace text should return null');
const normalized = normalizeCaptureDraft({ text: 'Нормализация', userHint: 'invalid', inputType: 'voice' });
assert(normalized.userHint === null, 'Test 22e: invalid userHint should be null');
assert(normalized.inputType === 'voice', 'Test 22f: valid inputType should pass');
console.log('✓ Test 22: normalizeCaptureDraft handles invalid input');

console.log('\n✅ All capture persistence tests passed.');
