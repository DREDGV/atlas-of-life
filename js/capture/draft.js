const DRAFT_KEY = 'atlas_capture_draft_v1';

const VALID_ENTRY_POINTS = new Set(['app', 'share', 'shortcut']);

function normalizeEntryPoint(value) {
  return VALID_ENTRY_POINTS.has(value) ? value : 'app';
}

export function loadCaptureDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return normalizeCaptureDraft(data);
  } catch (_) {
    return null;
  }
}

export function saveCaptureDraft(draft) {
  try {
    const data = {
      text: typeof draft.text === 'string' ? draft.text : '',
      userHint: ['task', 'thought', 'note'].includes(draft.userHint) ? draft.userHint : null,
      inputType: draft.inputType === 'voice' ? 'voice' : 'text',
      entryPoint: normalizeEntryPoint(draft.entryPoint),
      updatedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearCaptureDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

export function normalizeCaptureDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const text = typeof value.text === 'string' ? value.text : '';
  if (!text.trim()) return null;
  return {
    text,
    userHint: ['task', 'thought', 'note'].includes(value.userHint) ? value.userHint : null,
    inputType: value.inputType === 'voice' ? 'voice' : 'text',
    entryPoint: normalizeEntryPoint(value.entryPoint),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}
