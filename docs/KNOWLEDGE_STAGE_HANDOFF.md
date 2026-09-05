# Handoff: 0.12.x — Processing Destinations / Knowledge Foundation

Назначение: подготовка к этапу 0.12.x. Здесь зафиксировано **текущее** поведение
кода (без проектирования будущей реализации), где именно возникает
Thought/Note dead-end, какие инварианты нельзя нарушить и какие файлы/функции
относятся к будущей работе. Решения о модели сущностей и schema — за следующим
агентом, после утверждения domain-модели.

## 1. Текущее поведение

Единая точка входа записей — **Inbox**. Вся persisted-структура хранится в
`localStorage` (адаптер `js/storageAdapter.js`) и меняется **только** через Core
commands (`js/core/commands.js`, обёртки `runAtomicCommand` + `finish()` +
`appendOperation` → operation log). UI-черновики (routing drafts, edit state)
ephemeral и в storage не пишутся.

### InboxItem (запись в `state.inbox`)

Создаётся только командой `captureInbox` (и remote-apply). Форма записи
задаётся в `js/features/inbox/model.js` (`addInboxLines`):

- `text`, `rawText` — `rawText` неизменяем (явный guard в `updateInboxItem`);
- `status`: `new | reviewed | processed | discarded` (закрытое множество);
- `userHint`: `task | thought | note | null` — **подсказка** при Capture, не
  классификация;
- `itemType`: `task | thought | note | null` — **подтверждённый** тип, ставится
  в Processing (закрытое множество, `VALID_ITEM_TYPES`);
- `domainHintId`, `deviceId`, `entryPoint`, `inputType`, `source` — provenance;
- `resultRef` — ссылка на результат маршрутизации (сегодня только
  `{ type: 'task', id }`);
- `createdAt`, `updatedAt`.

### Два потока после Processing

**Task** (полноценный): `routeInboxToTask` создаёт Task, проставляет
`InboxItem.resultRef = {type:'task', id}` ↔ `Task.sourceInboxId`, статус →
`processed`. Task попадает в Domain/Project → Today/Map.

**Thought/Note** (dead-end): в Processing пользователь нажимает «Сохранить как
мысль/заметку»; единственное, что происходит — `updateInbox(item.id,
{ itemType, status: 'processed' })`. Никакой новой persisted-сущности,
`resultRef`, destination не создаётся. Запись остаётся в `state.inbox` со
статусом `processed` и видна только в «Разобранных».

## 2. Где именно возникает dead-end

- UI Processing Center: `js/features/inbox/view.js`
  - `renderDisplayRow`: для `itemType === 'thought' | 'note'` рисуется только
    кнопка финализации («Сохранить как мысль/заметку»), которая вызывает
    `updateInbox(..., { itemType, status: 'processed' })` (≈ строки 824–844);
  - `buildFinalizedResult`: «Разобрана»-карточка для thought/note без
    `resultRef` (≈ строки 549–579), из действий — только «Вернуть в разбор»
    (возврат `status` в `reviewed`);
  - очередь «К разбору / Разобранные / Все» — `computeVisibleItems`
    (строка ~1112);
  - batch: `batchSetType` (тип, без финализации) и клавиатурный обработчик
    (~1566–1582), который для thought/note тоже просто ставит
    `itemType` + `status: processed`.
- Core: **нет команды** «создать Thought/Note» — в `js/core/commands.js`
  существуют только Inbox/Task/Project/Domain команды; `updateInbox` лишь
  патчит Inbox-запись.
- Storage: в `state` нет коллекции Thought/Note — см. `js/state.js`
  (`domains, projects, tasks, inbox, operationLog, taskProjections,
  inboxTombstones`).
- Map и Inspector не читают thought/note вообще (см. §5).

## 3. Существующие инварианты (не нарушать)

- `rawText` записи Inbox неизменяем.
- `resultRef ↔ sourceInboxId` — двусторонняя связь; не рвать по одной стороне.
- Routed-записи залочены: `itemType`/`status` меняются только через
  revert-команду (`updateInboxItem` бросает ошибку для routed-записей);
  `deleteInbox` для routed-записи запрещён.
- Revert (`revertInboxRoute`) удаляет Task только если он не изменялся с момента
  создания (`updatedAt === createdAt`); изменённый Task не удаляется (refused).
- Валидация destination: Domain/Project должны существовать
  (`applyTaskPlacement` + явная проверка domain).
- Все persisted-изменения — только Core commands (никаких прямых UI mutation
  persisted state); одна команда = одна atomic операция в operation log +
  outbound sync при успехе.
- Storage версионируется: `SCHEMA_VERSION = 5`, миграции в `js/storage.js`
  (`MIGRATIONS`, прогон в `loadState`); новые persisted-коллекции добавляются
  только через миграцию + нормализацию (`normalize*` функции) + смену версии.
- Sync-контракт: operation log (`js/core/operations.js`), типы операций
  (`inbox.*`, `task.*`), C2 read-only проекции `taskProjections` (телефон без
  Task-модели), C3 tombstones `inboxTombstones`.

## 4. Ключевые файлы и функции будущей работы

- `js/features/inbox/model.js` — InboxItem: `addInboxLines`, `updateInboxItem`,
  `normalizeItemType`, `VALID_ITEM_TYPES/STATUSES`.
- `js/core/commands.js` — команды Inbox: `captureInbox`, `updateInbox`,
  `deleteInbox`/`undoDeleteInbox`, `routeInboxToTask`, `revertInboxRoute`;
  remote-apply: `applyRemoteInbox*`, `applyRemoteTaskResult*`; Task-команды:
  `createTask`, `updateTask`, `moveTask`, `deleteTask`, `promoteTaskToProject`;
  Project/Domain-команды.
- `js/features/inbox/view.js` — Processing Center UI (вся маршрутизация,
  финализация thought/note, очереди, batch).
- `js/features/inbox/{index.js, routing-draft.js, edit-state.js}` — экспорт,
  routing draft (ephemeral), edit draft (ephemeral).
- `js/storage.js` — schema 5, `MIGRATIONS`, `loadState`/`saveState`/`exportJson`,
  `normalizeInboxEntries` и другие `normalize*`.
- `js/state.js` — persisted state, `byId`, `project`, `domainOf`,
  `tasksOfProject` и др. хелперы.
- `js/inspector.js` — `openInspectorFor(obj)` по `_type` domain|project|task.
- `js/view_map.js` — canvas-карта (Domains → Projects → Tasks); API наружу —
  `window.mapApi` (`layoutMap`, `drawMap`, `setSelectedNode`, `fit*`, `refresh`).
  `js/view_map.fixed.js` — **не используется** (не импортируется), не трогать.
- Sync: `js/sync/{engine.js, outbox.js, apply.js, capabilities.js,
  http-transport.js, runtime.js, ui.js}`; `js/capture/app.js` — телефон
  принимает только C2-проекции routed Task.
- Вход в приложение: `js/app.js` (`initInbox`, интеграция Inspector/Map/Today);
  `index.html` подключает `js/app.js`.

## 5. Что уже можно переиспользовать от Task routing

- Паттерн атомарной команды: валидация → snapshot `before` → мутация →
  `appendOperation` → `finish` → `enqueueOutbound` (см. `routeInboxToTaskMutation`,
  `revertInboxRouteMutation`).
- Паттерн безопасного revert «refused, если объект изменён» (для future
  Thought/Note revert).
- Паттерн destination-валидации и размещения (Domain/Project, «без контекста» —
  сегодня это domainId/projectId = null у Task; для Thought/Note «без контекста»
  нужно определить отдельно).
- Инвариант блокировки routed-записей и требование revert перед удалением.
- C2-механика read-only проекций результата (`task.result.upsert/remove`) —
  образец для «результат виден на телефоне» без полной синхронизации сущности.
- Проверки link-integrity в remote-apply (валидация `sourceInboxId` на
  принимающей стороне).

## 6. Области, которые нельзя случайно сломать

- Inbox-инварианты и команды (см. §3) — любые изменения processing flow
  затрагивают их напрямую.
- Sync: типы операций и порядок `enqueueOutbound`; телефонная сборка
  (`js/capture/app.js`) живёт без Task-модели; C3-конфликты/tombstones.
- Storage-миграции: бездумное добавление полей/коллекций без миграции ломает
  старые данные; `SCHEMA_VERSION` повышается осознанно.
- Map/Inspector/Today рендерят только Tasks/Projects/Domains — появление новой
  сущности не должно ломать существующие узлы/статистику.
- `styles.css`, `styles/capture.css` — в рабочем дереве есть **незакоммиченные**
  изменения (не относятся к этапу; не включать в коммиты этапа).

## 7. Блокеры

Технического блокера для основной разработки нет. Перед реализацией требуется
domain-решение (см. ROADMAP 0.12.x): единая Knowledge/Context-сущность или
раздельные Thought/Note, destination-модель, revert/history, рамки Sync.
Реализацию (сущность, команды, routing, Map/Inspector, Sync) не начинать без
утверждённой модели.
