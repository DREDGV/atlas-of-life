# Sync v1 — Conflicts & Recovery (Stage C3)

Обновлено: 2026-08-29. Версия: `0.11.0-alpha.4`.

**Статус: Draft PR #21 (ветка `feat/sync-c3-conflicts-alpha4`), в
`revival-preparation` НЕ замержен.** Содержит также fixes по code review
(terminal `rejected`, delete/restore race, invariant guards).

C3 превращает «detect + refuse» из C0 в пригодные для человека конфликты и
recovery, не строя универсальный merge engine и CRDT (мастер-план §10.7).

## Модель конфликта (quarantine)

Каждая запись quarantine теперь несёт:

```js
{
  operation, serverSequence, reason, detectedAt,
  status,            // 'conflict' | 'invalid' | 'unsupported'
  conflictStatus,    // 'base_version' | 'deleted_race' | 'delete_restore_race'
                     // | 'linked_result_delete' | 'invalid' | 'unsupported'
  resolution,        // 'pending' | 'resolved'
  resolutionAction,  // keep_local | accept_remote | keep_both | keep_deleted
                     // | restore_apply | accept_delete | dismiss
  resolvedAt
}
```

- `conflicts` в статусе движка = число **неразрешённых** записей.
- Записи durable: resolution переживает reload (проверено тестом).
- Одна плохая операция не блокирует поток: cursor продвигается после
  durable quarantine (как в C0).

## Классификация реальных гонок

| Ситуация | Класс | Как определяется |
|---|---|---|
| update пришёл на запись, удалённую локально | `deleted_race` | запись не найдена при apply inbox.update / route / revert |
| два устройства изменили одну запись | `base_version` | `baseVersion` ≠ локальный `updatedAt` |
| delete с версией, не совпадающей с локальной записью | `delete_restore_race` | `inbox.delete.baseVersion` ≠ `item.updatedAt` (или tombstone) |
| restore с версией, не совпадающей с tombstone | `delete_restore_race` | `inbox.restore.baseVersion` ≠ `tombstone.baseVersion` |
| delete удалённой на этой стороне записи, связанной с результатом | `linked_result_delete` | `item.resultRef` присутствует |
| неизвестный тип операции | `unsupported` | switch default в apply |
| битый payload | `invalid` | throw при apply |

До C3 первые случаи попадали в quarantine как «invalid»/тихий пропуск;
теперь это явные классы с понятными действиями.

## Tombstones (delete ↔ restore race)

Persisted `state.inboxTombstones` = `{ id, baseVersion, deletedAt, removal }`:

- локальный delete пишет tombstone (версия на момент удаления); undo его
  удаляет;
- remote delete/restore несут `baseVersion` (envelope операции) и применяются
  только при совпадении версий — иначе `delete_restore_race` вместо
  server-order last-write-wins;
- delete для несуществующей записи без tombstone — идемпотентный no-op
  (запись могла быть удалена до нашей привязки).

## Действия пользователя (человеческие формулировки, без терминов)

- **base_version** (update vs update):
  - «Оставить локальную» — локальное состояние остаётся;
  - «Принять удалённую» — применяется состояние remote-операции;
  - «Сохранить обе» — копия локальной версии создаётся как новая запись
    (и доставляется остальным через inbox.capture), оригинал принимает
    удалённое состояние.
- **deleted_race** (update/route для локально удалённой записи):
  - «Оставить удалённой» — локальное удаление остаётся;
  - «Восстановить и применить» — запись восстанавливается (remote-состояние)
    и **восстановление доставляется остальным** (inbox.restore) — иначе
    устройства, честно применившие наше удаление, разошлись бы навсегда.
- **delete_restore_race** (inbox.delete): «Оставить запись» / «Удалить».
- **delete_restore_race** (inbox.restore): «Оставить удалённой» / «Восстановить»
  (восстановление идемпотентно и не рассылается повторно — другие устройства
  уже держат запись).
- **linked_result_delete**: «Пропустить» (удаление routed-записи запрещено
  инвариантом resultRef ↔ sourceInboxId; сначала «Вернуть в разбор»).
- **invalid / unsupported**: «Пропустить».

Все изменения состояния — через Core-команды (`resolveConflict`), атомарно,
без echo-цикла. После разрешения runtime сразу делает `requestSync()`, чтобы
порождённые операции (restore / copy capture) доехали немедленно.

## Terminal rejected (review P1)

Сервер отклоняет плохую outbound-операцию per-op (`invalid_operation`,
`operation_id_conflict`). Транспорт передаёт `conflicts` в engine; движок
переводит такие записи в **terminal `rejected`** (никогда не ретраятся —
в отличие от transient `failed`, которые возвращает W1-promoteFailed).
Статус/панель/диагностика показывают `rejected` count и серверные причины
(без payload и секретов).

## W2 — удаление/восстановление Inbox теперь синхронизируются

- `deleteInbox` / `undoDeleteInbox` ставят `inbox.delete` / `inbox.restore`
  в outbox (раньше операции журналировались, но не отправлялись);
- сервер принимает оба типа;
- remote apply идемпотентен в обе стороны (повторный delete/restore — no-op,
  без дублей, без echo);
- десктоп и телефон теперь сходятся по удалениям: удалил на телефоне →
  запись исчезает на ПК; «Отменить» на телефоне → восстанавливается везде.

## W3 — rename Domain/Project не оставляет телефон со старым именем

- Новые Core-команды `updateDomain` / `updateProject` (журнал
  `domain.update` / `project.update`) при переименовании пере-эмитят
  `task.result.upsert` для routed-задач этого домена/проекта — телефон
  обновляет домен·проект в карточке результата;
- обработчики переименования домена в Studio переведены на команды +
  мгновенный sync; задачи вне Inbox-потока не затрагиваются.

## Recovery (в рамках C3)

- **Долгий offline** (W1, исправлено в stabilize): `failed`-записи outbox
  автоматически возвращаются в доставку первым же успешным циклом.
- **Stale cursor / потеря истории на сервере**: документировано как
  обязанность бэкапа БД (`deploy/vds/README.md`); AUTOINCREMENT монотонен,
  пока файл БД жив.
- **Partial sync / зависимость отсутствует**: одна плохая операция
  карантинится и пропускается, поток не зацикливается (C0 invariant).
- **Resolution после reload**: конфликт не теряется (durable), действия
  доступны после перезапуска.

## Проверка

- `node tests/sync-c3.mjs` — delete/restore sync, классификация, матрица
  разрешения, durability, rename re-emit, live HTTP round trip.
- `node tools/smoke-c3.mjs` — двухбраузерный smoke: телефон удаляет →
  ПК применяет удаление; update ПК приходит на телефон как конфликт →
  панель Sync → «Восстановить и применить» → запись возвращается
  (processed) и сходится на обоих устройствах; без дублей и page errors.

## Границы C3

- Не CRDT/OT; конфликтные пары решаются простыми действиями.
- «Оставить локальную» может означать осознанное расхождение с другим
  устройством до следующего изменения (документированное поведение).
- Conflict-классификация покрывает Inbox/Processing поток (scope Stage C);
  Task-конфликты появятся вместе с Full Task Sync (поздний roadmap).
