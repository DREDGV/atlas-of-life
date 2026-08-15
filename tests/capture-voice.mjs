import {
  VOICE_STATES,
  appendFinalTranscript,
  createVoiceController,
  mapSpeechRecognitionError,
  queryMicrophonePermission,
} from '../js/capture/voice.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const unsupported = createVoiceController({ scope: {} });
assert(!unsupported.isSupported(), 'Unsupported browser should be detected');
assert(unsupported.getState() === VOICE_STATES.UNSUPPORTED, 'Unsupported state should be explicit');
console.log('✓ SpeechRecognition unsupported');

for (const state of ['granted', 'prompt', 'denied']) {
  const actual = await queryMicrophonePermission({
    permissions: { query: async () => ({ state }) },
  });
  assert(actual === state, `Permission ${state} should be preserved`);
}
assert(await queryMicrophonePermission({}) === 'unknown', 'Missing Permissions API should be unknown');
assert(
  await queryMicrophonePermission({ permissions: { query: async () => { throw new Error('unsupported'); } } }) === 'unknown',
  'Rejected permission query should be unknown',
);
assert(
  await queryMicrophonePermission({ permissions: { query: async () => ({ state: 'unexpected' }) } }) === 'unknown',
  'Unexpected permission state should be unknown',
);
console.log('✓ Permission granted/prompt/denied/unknown mapping');

const errorCases = new Map([
  ['not-allowed', VOICE_STATES.DENIED],
  ['service-not-allowed', VOICE_STATES.DENIED],
  ['no-speech', VOICE_STATES.NO_SPEECH],
  ['audio-capture', VOICE_STATES.AUDIO_ERROR],
  ['network', VOICE_STATES.NETWORK_ERROR],
  ['language-not-supported', VOICE_STATES.LANGUAGE_ERROR],
  ['language-unavailable', VOICE_STATES.LANGUAGE_ERROR],
  ['aborted', VOICE_STATES.ABORTED],
  ['anything-else', VOICE_STATES.GENERIC_ERROR],
]);
for (const [browserError, expectedState] of errorCases) {
  assert(mapSpeechRecognitionError(browserError) === expectedState, `${browserError} should map to ${expectedState}`);
}
console.log('✓ Speech error mapping');

assert(appendFinalTranscript('', '  Новая мысль  ') === 'Новая мысль', 'Append to empty text');
assert(appendFinalTranscript('Купить фильтр', 'проверить насос') === 'Купить фильтр проверить насос', 'Append to ordinary text');
assert(appendFinalTranscript('Купить фильтр ', 'проверить насос') === 'Купить фильтр проверить насос', 'Append after trailing space');
assert(appendFinalTranscript('Купить фильтр\n', 'проверить насос') === 'Купить фильтр\nпроверить насос', 'Append after newline');
assert(appendFinalTranscript('  исходный текст', 'результат') === '  исходный текст результат', 'Existing outer whitespace should remain');
console.log('✓ Final transcript append preserves textarea formatting');

let mockInstance = null;
class MockRecognition {
  constructor() {
    mockInstance = this;
  }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onerror?.({ error: 'aborted' }); this.onend?.(); }
}

const states = [];
const finals = [];
const controller = createVoiceController({
  scope: { SpeechRecognition: MockRecognition },
  onState: state => states.push(state),
  onFinal: transcript => finals.push(transcript),
});
assert(controller.start(), 'Supported controller should start');
assert(controller.getState() === VOICE_STATES.LISTENING, 'onstart should enter listening');

const finalResult = [{ transcript: 'Проверить насос' }];
finalResult.isFinal = true;
const finalEvent = { resultIndex: 0, results: [finalResult] };
mockInstance.onresult(finalEvent);
mockInstance.onresult(finalEvent);

assert(finals.length === 1, 'Duplicate final result index should be processed once per session');
assert(finals[0] === 'Проверить насос', 'Final callback should receive transcript');
assert(controller.getState() === VOICE_STATES.RESULT, 'Final transcript should enter result state');
mockInstance.onend();
assert(controller.getState() === VOICE_STATES.RESULT, 'onend should not erase result state');
assert(states.includes(VOICE_STATES.REQUESTING), 'Controller should expose requesting state');
assert(states.includes(VOICE_STATES.LISTENING), 'Controller should expose listening state');
console.log('✓ Controller states and duplicate-final protection');

console.log('\n✅ All capture voice tests passed.');
