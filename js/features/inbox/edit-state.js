// Stage B0: tiny UI state machine for the Processing card edit flow.
//
// Separates two concerns that were previously conflated:
// - `hasDraft(id)`  — an unsaved edit draft exists for the item;
// - `isActive(id)`  — the item is currently rendered in edit mode.
//
// Escape/Back leave edit mode but keep the draft; Save, Delete, and explicit
// discard clear both.
// Pure module (no DOM), so the state logic is regression-testable without a
// browser framework. Core/data model is untouched.
export function createEditState(){
  const drafts = new Map();
  let activeId = null;

  const hasDraft = id => drafts.has(id);
  const isActive = id => activeId === id;
  const seed = (id, text) => {
    if (!drafts.has(id)) drafts.set(id, String(text ?? ''));
  };
  const getDraft = (id, fallback) =>
    drafts.has(id) ? drafts.get(id) : String(fallback ?? '');
  const isDirty = (id, savedText) =>
    drafts.has(id) && drafts.get(id) !== String(savedText ?? '');
  const setDraft = (id, value) => {
    drafts.set(id, String(value ?? ''));
  };
  const enter = (id, text) => {
    seed(id, text);
    activeId = id;
  };
  const exit = () => {
    activeId = null;
  };
  const clear = id => {
    drafts.delete(id);
    if (activeId === id) activeId = null;
  };

  return { hasDraft, isActive, seed, getDraft, isDirty, setDraft, enter, exit, clear };
}
