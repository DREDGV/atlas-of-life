// Stage B1: local UI state for an unfinished Task-routing selection
// (Domain / Project / Priority / Due date / Due time), keyed by Inbox item id.
//
// Temporary UI state only — never persisted to Core/storage, exactly like the
// edit draft. Closing the Processing Center, switching the queue filter or any
// re-render must not lose it; it is cleared after a successful "Создать
// задачу", after "Вернуть в разбор" or when the Inbox item is deleted.
export function createRoutingDraftState(){
  const drafts = new Map();

  const get = id => {
    const draft = drafts.get(id);
    return draft ? { ...draft } : null;
  };
  const set = (id, value) => {
    drafts.set(id, { ...(value || {}) });
  };
  const has = id => drafts.has(id);
  const clear = id => {
    drafts.delete(id);
  };

  return { get, set, has, clear };
}
