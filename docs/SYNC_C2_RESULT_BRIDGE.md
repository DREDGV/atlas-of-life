# Sync v1 — Task Result Bridge (Stage C2)

Обновлено: 2026-08-20. Версия: `0.11.0-alpha.3`.

C2 делает результат Processing понятным на телефоне: после routing на
десктопе телефон показывает «✓ Разобрана → Задача · title · Дача · Сад ·
Высокий · 24 августа · ✓ Выполнено» — **без репликации Task CRUD**.

## Выбранный подход (Вариант B мастер-плана)

Read-only **Task Result Projection**:

- десктоп остаётся **единственным писателем** Task — никакой второй истины
  о задаче, никакого конкурирующего состояния;
- другие устройства хранят только проекцию для отображения в
  `state.taskProjections` (persisted через Core, выживает reload/offline);
- телефон **не создаёт Task** и не редактирует её — проекция применяется
  только входящими sync-операциями.

```text
Desktop (писатель)                          Phone (отображение)
  routeInboxToTask  ── inbox.route_to_task ──▶ resultRef = { type:'task', id }
        │                                        + taskProjections[id] (карточка)
        └── task.result.upsert {projection} ──▶
  updateTask/moveTask ─ task.result.upsert ──▶ проекция обновляется
  deleteTask        ── task.result.remove ───▶ проекция удаляется → fallback
  revertInboxRoute  ── inbox.route_revert ───▶ resultRef снят
        └── task.result.remove ───────────────▶ проекция удаляется
```

## Операции

- `task.result.upsert` — payload `{ projection: { id, title, sourceInboxId,
  domainId/domainTitle, projectId/projectTitle, priority, due {date,time},
  status, updatedAt } }`. Эмитится рядом с `inbox.route_to_task` и при
  update/move **только задач, рождённых из Inbox** (`sourceInboxId`).
- `task.result.remove` — payload `{ id, sourceInboxId }`. Эмитится при
  удалении routed-задачи и при route revert (если задача удалена revert'ом);
  refused revert (задача изменена) ничего не эмитит.
- Задачи, созданные вне Inbox-потока (Quick Add и т.п.), проекций не
  эмитят — scope discipline, не Full Task Sync.

## Remote apply

`applyRemoteTaskResultUpsert/Remove` в Core (`js/core/commands.js`):
атомарно, без записи в локальный operation log, без порождения outbound
операции (нет echo). Upsert идемпотентен по operationId (dedupe upstream) и
защищён stale-guard'ом: более старая доставка (`updatedAt`) не откатывает
более новую проекцию. Remove неизвестного id — безвредный no-op.

Проекция — derived data с одним писателем: конфликтной машинерии (baseVersion
и т.п.) не требуется, серверная валидация ограничивает размер payload.

## Поведение после routing (таблица)

| Событие на десктопе | Операции | Телефон |
|---|---|---|
| route → Task | `inbox.route_to_task` + `task.result.upsert` | resultRef + карточка результата |
| переименование / priority / due / status | `task.result.upsert` | карточка обновляется |
| перемещение (project/domain) | `task.result.upsert` | новые Дача · Сад в карточке |
| удаление Task | `task.result.remove` | fallback «Результат недоступен на этом устройстве» |
| route revert (задача не изменена) | `inbox.route_revert` + `task.result.remove` | запись снова «К разбору», проекция удалена |
| route revert (задача изменена) | отказ (refused), операций нет | состояние не меняется |

## UX телефона (Capture PWA)

- Статусный бейдж: «К разбору» / «✓ Разобрана · Мысль/Заметка» / «Отброшена».
- Карточка результата (routed): title, строка размещения («Сад и огород · Дача»
  или домен), строка «Высокий · 24 августа, 10:00» (приоритет + structured
  due), «✓ Выполнено» для done.
- Отсутствие проекции — честный fallback «Результат недоступен на этом
  устройстве» (битых ссылок нет).
- Live refresh: после цикла sync с применёнными операциями (`pulled > 0`)
  Studio обновляет список Inbox (не прерывая открытую карточку обработки),
  Capture обновляет списки.

## Границы C2

- Нет Task CRUD на телефоне; нет синхронизации Projects/Domains (только
  названия в проекции).
- Полный Task Sync, history, entity sync — поздние этапы roadmap.
- Conflict-resolution UX — C3.

## Проверка

- `node tests/sync-c2.mjs` — эмиссия, содержимое проекции, revert/refused,
  remote-apply guard'ы, live HTTP desktop→phone (route → update → delete).
- `node tools/smoke-c2.mjs` — двухбраузерный smoke: карточка результата на
  телефоне, следование за update (done) и delete (fallback); на телефоне
  нет копии Task.
