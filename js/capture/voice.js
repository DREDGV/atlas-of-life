export const VOICE_STATES = Object.freeze({
  UNSUPPORTED: 'unsupported',
  IDLE: 'idle',
  REQUESTING: 'requesting',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  RESULT: 'result',
  NO_SPEECH: 'no-speech',
  DENIED: 'denied',
  AUDIO_ERROR: 'audio-error',
  NETWORK_ERROR: 'network-error',
  LANGUAGE_ERROR: 'language-error',
  GENERIC_ERROR: 'generic-error',
  ABORTED: 'aborted',
});

const ACTIVE_STATES = new Set([
  VOICE_STATES.REQUESTING,
  VOICE_STATES.LISTENING,
  VOICE_STATES.PROCESSING,
]);

export function getSpeechRecognitionConstructor(scope = globalThis) {
  return scope?.SpeechRecognition || scope?.webkitSpeechRecognition || null;
}

export async function queryMicrophonePermission(navigatorLike = globalThis.navigator) {
  try {
    if (!navigatorLike?.permissions?.query) return 'unknown';
    const status = await navigatorLike.permissions.query({ name: 'microphone' });
    return ['granted', 'prompt', 'denied'].includes(status?.state)
      ? status.state
      : 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

export function mapSpeechRecognitionError(error) {
  const code = typeof error === 'string' ? error : error?.error;
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return VOICE_STATES.DENIED;
  }
  if (code === 'no-speech') return VOICE_STATES.NO_SPEECH;
  if (code === 'audio-capture') return VOICE_STATES.AUDIO_ERROR;
  if (code === 'network') return VOICE_STATES.NETWORK_ERROR;
  if (code === 'language-not-supported' || code === 'language-unavailable') {
    return VOICE_STATES.LANGUAGE_ERROR;
  }
  if (code === 'aborted') return VOICE_STATES.ABORTED;
  return VOICE_STATES.GENERIC_ERROR;
}

export function appendFinalTranscript(existingText, finalTranscript) {
  const existing = typeof existingText === 'string' ? existingText : '';
  const finalText = typeof finalTranscript === 'string' ? finalTranscript.trim() : '';
  if (!finalText) return existing;
  if (!existing) return finalText;
  return /\s$/.test(existing) ? `${existing}${finalText}` : `${existing} ${finalText}`;
}

export function createVoiceController({
  lang = 'ru-RU',
  onState = () => {},
  onInterim = () => {},
  onFinal = () => {},
  onError = () => {},
  scope = globalThis,
} = {}) {
  const Recognition = getSpeechRecognitionConstructor(scope);
  let recognition = null;
  let state = Recognition ? VOICE_STATES.IDLE : VOICE_STATES.UNSUPPORTED;
  let processedFinalIndexes = new Set();
  let recognitionRunning = false;

  function setState(nextState) {
    state = nextState;
    onState(nextState);
  }

  function ensureRecognition() {
    if (!Recognition) return null;
    if (recognition) return recognition;

    recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      recognitionRunning = true;
      setState(VOICE_STATES.LISTENING);
    };
    recognition.onspeechend = () => {
      if (state === VOICE_STATES.LISTENING) setState(VOICE_STATES.PROCESSING);
    };
    recognition.onaudioend = () => {
      if (state === VOICE_STATES.LISTENING) setState(VOICE_STATES.PROCESSING);
    };
    recognition.onresult = event => {
      let interim = '';
      const finalParts = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || '';
        if (result?.isFinal) {
          if (!processedFinalIndexes.has(index)) {
            processedFinalIndexes.add(index);
            finalParts.push(transcript);
          }
        } else {
          interim += transcript;
        }
      }

      if (interim) onInterim(interim);
      if (finalParts.length > 0) {
        const finalTranscript = finalParts.map(part => part.trim()).filter(Boolean).join(' ');
        setState(VOICE_STATES.RESULT);
        onFinal(finalTranscript);
      }
    };
    recognition.onerror = event => {
      const nextState = mapSpeechRecognitionError(event);
      setState(nextState);
      onError(nextState, event?.error || 'unknown');
    };
    recognition.onend = () => {
      recognitionRunning = false;
      if (ACTIVE_STATES.has(state)) setState(VOICE_STATES.IDLE);
    };

    return recognition;
  }

  function start() {
    if (!Recognition) {
      setState(VOICE_STATES.UNSUPPORTED);
      return false;
    }
    if (recognitionRunning || ACTIVE_STATES.has(state)) return false;

    processedFinalIndexes = new Set();
    setState(VOICE_STATES.REQUESTING);
    try {
      recognitionRunning = true;
      ensureRecognition().start();
      return true;
    } catch (error) {
      recognitionRunning = false;
      setState(VOICE_STATES.GENERIC_ERROR);
      onError(VOICE_STATES.GENERIC_ERROR, error?.name || 'start-failed');
      return false;
    }
  }

  function stop() {
    if (!recognition || !recognitionRunning) return false;
    try {
      recognition.stop();
      if (state === VOICE_STATES.LISTENING) setState(VOICE_STATES.PROCESSING);
      return true;
    } catch (_) {
      return false;
    }
  }

  function abort() {
    if (!recognition || !recognitionRunning) return false;
    try {
      recognition.abort();
      setState(VOICE_STATES.ABORTED);
      return true;
    } catch (_) {
      return false;
    }
  }

  function destroy() {
    if (recognition) {
      try {
        if (recognitionRunning) recognition.abort();
      } catch (_) {}
      recognition.onstart = null;
      recognition.onspeechend = null;
      recognition.onaudioend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition = null;
      recognitionRunning = false;
    }
    setState(Recognition ? VOICE_STATES.IDLE : VOICE_STATES.UNSUPPORTED);
  }

  return {
    start,
    stop,
    abort,
    destroy,
    getState: () => state,
    isSupported: () => Boolean(Recognition),
  };
}
