# Architecture notes for Atlas of life v0.2.6

This document outlines the key architectural improvements and foundations introduced in release 0.2.6. These changes are designed to prepare the project for future growth while preserving backwards compatibility with existing data and APIs.

## Migrations

To support evolving data models, a simple migration framework has been added to the storage layer. Saved state now includes a `schemaVersion` number. On load, the application runs an ordered list of migration functions that transform the persisted state from older versions to the current schema. Each migration checks the version and performs targeted mutations, then updates the version property.

Example migration:

```js
// src/core/storage/migrations.js
const MIGRATIONS = [
  (data) => {
    // 0 → 1: add an `archived` flag to domains
    if (!data.version || data.version < 1) {
      data.domains = data.domains.map(d => ({ ...d, archived: false }));
      data.version = 1;
    }
    return data;
  },
];
```

## Storage Adapter

Persisting state has been decoupled from the browser API. A storage adapter interface now defines `save` and `load` methods. The current implementation uses `localStorage`; an IndexedDB adapter can be added later. Switching storage backends requires only changing a single import.

Example adapter:

```js
export default {
  save(data) {
    localStorage.setItem('atlas-state', JSON.stringify(data));
  },
  load() {
    const raw = localStorage.getItem('atlas-state');
    return raw ? JSON.parse(raw) : null;
  },
};
```

## Theming

A light/dark theme system has been introduced using CSS custom properties. Core colours and sizing variables are defined on the `:root` element. Setting `data-theme="dark"` on the `<html>` element switches the values to their dark counterparts without any JavaScript logic. This provides a consistent, maintainable approach to styling.

Example:

```css
:root {
  --bg: #ffffff;
  --fg: #000000;
  --accent: #0066cc;
}
[data-theme="dark"] {
  --bg: #121212;
  --fg: #f5f5f5;
  --accent: #4499ff;
}
body {
  background-color: var(--bg);
  color: var(--fg);
}
```

## Analytics

The project now includes a small local telemetry module to aid debugging. It exposes a `logEvent` function that appends events to a circular buffer stored in `localStorage`. Only the last 100 events are retained. No data is sent to any server; this is purely local.

```js
export const logEvent = (event) => {
  const logs = JSON.parse(localStorage.getItem('atlas-logs') || '[]');
  logs.push({ event, time: Date.now() });
  localStorage.setItem('atlas-logs', JSON.stringify(logs.slice(-100)));
};
```

## State Facade

Direct access to the global `window.state` is being phased out. A state facade module exposes functions to retrieve a deep copy of the current state and to apply mutations. New code should call the facade rather than mutating the global object, allowing internal representation changes without impacting consumers.

```js
const _state = {
  tasks: [],
  domains: [],
  projects: [],
  // ...other collections
};

export const getState = () => JSON.parse(JSON.stringify(_state));

export const patchState = (mutator) => {
  mutator(_state);
  // persist changes via the storage adapter here
};
```

## Map Optimisations

Rendering performance on the map has been improved. Tasks and links outside the viewport are no longer drawn, and redraws triggered by wheel and drag events are throttled. A `fitActiveProject()` function has been implemented; double-clicking a project node now zooms into its bounding box. Legacy, unused branches from earlier layout experiments have been removed to simplify the codebase.

## Future Steps

- Continue refactoring to remove all direct references to the global state.
- Plan for a full restructure into feature-based modules (`src/core`, `src/features/inbox`, `src/features/today`, `src/features/map`).
- Swap `localStorage` for IndexedDB when datasets exceed the size/performance limits.
- Enhance the inspector and filters and add drag-and-drop sorting in the Today view.