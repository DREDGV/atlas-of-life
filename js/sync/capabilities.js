// js/sync/capabilities.js — per-app sync client capabilities.
//
// A capability flag must NOT be inferred from runtime data shape (e.g. an
// empty state.tasks does not mean "no task model"). Both apps set their
// capability explicitly at bootstrap:
//
//   - Atlas Studio  : hasTaskModel = true  → route conflict resolution
//     VALIDATES resultRef.id → Task.sourceInboxId (even when state.tasks is
//     currently empty);
//   - Atlas Capture : hasTaskModel = false → a routed resultRef is accepted
//     only as a C2 projection reference (the phone never owns Tasks).
//
// Default is the SAFE Studio-like behaviour (validate): a client that forgot
// to declare itself must not silently accept broken result references.
export const syncCapabilities = {
  hasTaskModel: true,
};
