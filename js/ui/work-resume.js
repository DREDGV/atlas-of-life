const storageKey = 'atlas.studio.resume.v1';
let references;

function storedReferences() {
  if (references) return references;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (value && ['task', 'inbox'].includes(value.recent)) {
      references = {
        recent: value.recent,
        task: typeof value.task === 'string' ? value.task : null,
        inbox: typeof value.inbox === 'string' ? value.inbox : null,
      };
    }
  } catch (_) { /* Navigation is optional when browser storage is unavailable. */ }
  return references ??= {};
}

export function rememberWork(kind, id) {
  id = String(id);
  const previous = storedReferences();
  if (previous.recent === kind && previous[kind] === id) return;
  references = { ...previous, recent: kind, [kind]: id };
  try { localStorage.setItem(storageKey, JSON.stringify(references)); } catch (_) {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('atlas:resume-work'));
}

export function isPendingInbox(item) {
  return !item.resultRef && (item.status === 'new' || item.status === 'reviewed');
}

export function workToResume(atlas) {
  const { recent, task, inbox } = storedReferences();
  const pending = atlas.inbox.find(item => String(item.id) === inbox && isPendingInbox(item));
  const openTask = atlas.tasks.find(item => String(item.id) === task && item.status !== 'done');
  const inboxTarget = item => ({ kind: 'inbox', id: item.id, title: item.text });
  if (recent === 'inbox' && pending) return inboxTarget(pending);
  if (openTask) return { kind: 'task', id: openTask.id, title: openTask.title };
  const unfinished = pending || atlas.inbox.find(isPendingInbox);
  return unfinished ? inboxTarget(unfinished) : null;
}
