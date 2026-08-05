const DRAFT_KEY = 'atlas_capture_draft_v1';

export function loadCaptureDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      text: typeof data.text === 'string' ? data.text : '',
      userHint: ['task', 'thought', 'note'].includes(data.userHint) ? data.userHint : null,
      inputType: data.inputType === 'voice' ? 'voice' : 'text',
      updatedAt: Number(data.updatedAt) || Date.now(),
    };
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
  } catch (_) {}
}

export function normalizeCaptureDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!text) return null;
  return {
    text,
    userHint: ['task', 'thought', 'note'].includes(value.userHint) ? value.userHint : null,
    inputType: value.inputType === 'voice' ? 'voice' : 'text',
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}
