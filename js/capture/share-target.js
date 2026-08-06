const SHARE_MAX_LENGTH = 20000;
const SHARE_DRAFT_ACTION = 'atlas_capture_share_action';

export function initShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  
  if (action !== 'share') return null;
  
  const title = sanitizeText(params.get('title'));
  const text = sanitizeText(params.get('text'));
  const url = sanitizeUrl(params.get('url'));
  
  clearShareParams();
  
  if (!title && !text && !url) return null;
  
  return buildShareDraft(title, text, url);
}

export function buildShareDraft(title, text, url) {
  const parts = [];
  if (title) parts.push(title);
  if (text && text !== title) parts.push(text);
  if (url) parts.push(url);
  
  const combined = parts.join('\n\n').slice(0, SHARE_MAX_LENGTH);
  
  return {
    text: combined,
    userHint: 'note',
    inputType: 'text',
  };
}

export function applyShareDraft(draft, existingDraft) {
  if (!draft || !draft.text) return { action: 'cancel' };
  
  if (!existingDraft || !existingDraft.text) {
    return { action: 'replace', draft };
  }
  
  return { action: 'choice', draft, existing: existingDraft };
}

function sanitizeText(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().slice(0, SHARE_MAX_LENGTH);
}

function sanitizeUrl(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href.slice(0, SHARE_MAX_LENGTH);
    }
  } catch (_) {}
  return '';
}

function clearShareParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    url.searchParams.delete('title');
    url.searchParams.delete('text');
    url.searchParams.delete('url');
    window.history.replaceState({}, '', url.pathname + url.hash);
  } catch (_) {}
}
