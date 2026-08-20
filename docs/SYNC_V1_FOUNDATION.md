# Sync v1 — Foundation (Stage C0)

Обновлено: 2026-08-20. Версия: `0.11.0-alpha.2` (C0 — foundation, C1 — real remote).

Sync v1 синхронизирует **операции, а не замену всего JSON**. Первый вертикальный
контур — жизненный цикл Inbox/Processing, а не весь граф Atlas.

```text
Phone Capture → Inbox item → sync operation → Desktop → Processing
→ processed / discarded / routed result → sync operation → Phone
```

## Operation envelope

Immutable sync operation (создаётся в `js/core/operations.js`; `id` документирован
как canonical operationId):

```json
{
  "schema": 1,
  "id": "op-<uuid>",
  "deviceId": "…",
  "sequence": 42,
  "timestamp": 1785700000000,
  "type": "inbox.capture | inbox.update | inbox.route_to_task | inbox.route_revert",
  "entityType": "inbox",
  "entityId": "…",
  "baseVersion": 1785700000000,
  "payload": { }
}
```

- `id` (operationId) — глобально уникальный; единственный ключ идемпотентности.
- `deviceId` — устойчивый локальный идентификатор устройства (`js/core/device.js`).
- `sequence` — локальный монотонный счётчик устройства (`js/sync/device.js`),
  присваивается каждой операции при создании и присутствует в outbound
  operation; глобальный порядок задаёт серверный `serverSequence` на relay.
- `baseVersion` — версия сущности, от которой отталкивалось изменение
  (`updatedAt`); используется для детекции конфликта.

`syncStatus` / `attempts` / `lastError` — **локальные метаданные доставки** и
хранятся в записи durable outbox, а не в immutable operation.

## Разделение local history и durable outbox

| | `state.operationLog` | durable sync outbox |
|---|---|---|
| роль | ограниченная история (≤1000) | очередь исходящих sync-операций |
| обрезка | обрезается | не зависит от обрезки истории |
| хранилище | часть state blob | отдельный ключ `atlas-sync-outbox-v1` |
| жизненный цикл | append-only | pending → sent → acked (удаляется); retryable → failed |

Sync queue не зависит от того, что history когда-нибудь будет обрезана.

## Device identity

- `deviceId` создаётся один раз, сохраняется локально (`atlas-device-id`),
  не меняется при перезапуске, не содержит персональных данных.
- Локальный `sequence` (монотонный) — `atlas-sync-device-seq`.
- Никакого account/auth в этом PR.

## Durable outbox

- Persisted в localStorage (`atlas-sync-outbox-v1`), переживает reload/offline.
- Состояния (локальные метаданные доставки): `pending` → `sent` (отправлено,
  ждёт ack) → удаляется по ack; `retryable` (transient) → повторная попытка;
  `failed` (permanent, после `MAX_ATTEMPTS`), чтобы не крутиться бесконечно.
- Операция НЕ считается синхронизированной только потому, что HTTP-запрос
  отправлен: ack обязателен.
- **Долговечность**: unacked записи никогда не выбрасываются молча ради
  лимита — жёсткого cap у очереди нет (acked удаляются явно по ack). Ошибка
  записи outbox в storage пробрасывается как ошибка, а не проглатывается как
  успех (в командах она наблюдается через console.warn).

## Recovery для sent / awaiting_ack

- `sent`, не получивший ack (crash/reload между отправкой и ack, или partial
  ack), после перезапуска движка снова становится `retryable` (детерминированная
  recovery на `createSyncEngine`).
- Повторная отправка безопасна благодаря idempotency по operationId.
- Partial ack не считается успехом всего батча: только acked удаляются,
  остальные `sent` → `retryable`.

## Quarantine (persisted conflicts)

Операция, которую нельзя применить (conflict / invalid / unsupported),
записывается в durable quarantine `atlas-sync-conflicts-v1`:

```json
{ "operation": {…}, "serverSequence": 7, "reason": "…", "status": "conflict|invalid|unsupported", "detectedAt": … }
```

Cursor продвигается только после durable quarantine, чтобы одна плохая операция
не блокировала поток и не зацикливалась. Конфликт виден через
`engine.getStatus().conflicts` / `engine.getConflicts()`. Conflict resolution
UI — не в C0.

## Idempotency и deduplication

- Один `operationId`, полученный повторно, не применяется дважды.
- Применённые id хранятся в `atlas-sync-applied-v1` (bounded set).
- Relay дополнительно дедуплицирует по `operationId` при push.
- Повторная отправка после timeout/retry безопасна.

## Remote apply (только через Core)

Входящая операция применяется через **Core remote-apply команды**
(`applyRemoteInboxCapture / Update / Route / Revert` в `js/core/commands.js`):
атомарно (runAtomicCommand + saveState внутри команды, rollback при ошибке
persistence), без записи в локальный operation log и **без порождения новой
outbound sync-операции** (нет echo-loop).

- `inbox.capture` → `applyRemoteInboxCapture` (addInboxLines с оригинальными
  id/полями);
- `inbox.update` → `applyRemoteInboxUpdate` (те же guard'ы: rawText immutable,
  lock routed-записей, валидация domainHintId);
- `inbox.route_to_task` → `applyRemoteInboxRoute` (`status=processed` +
  `resultRef` как ссылка на результат; сама Task в C0 не синхронизируется);
- `inbox.route_revert` → `applyRemoteInboxRevert` (снять `resultRef`,
  `status=reviewed`).

`js/sync/apply.js` и transport не мутируют persisted state и не вызывают
`saveState()` напрямую.

## Transport boundary

Интерфейс (`js/sync/relay.js`):

```text
pushOperations(ops)  → { ackedIds }
pullOperations(cursor) → { operations: [{serverSequence, operation}], newCursor }
acknowledge(opIds)   → void
```

- **Dev/local relay transport** (`createLocalRelay`, C0) — глобальный
  `serverSequence` + pull по cursor в localStorage; тестовый механизм для
  доказательства vertical slice двумя локальными клиентами.
- **Remote HTTP transport** (`createHttpTransport`, C1) — тот же контракт
  поверх `fetch` против Atlas Sync service (`server/sync-server.js`):
  `POST /v1/ops/push`, `GET /v1/ops/pull?after&excludeDevice&limit`;
  Bearer-токен устройства; 401 → `unauthorized` для UX повторной привязки.
  Детали сервера, безопасности и деплоя — `docs/SYNC_C1_REMOTE.md`.

## Cursor / pull model

- Клиент запрашивает «всё после cursor X», а не весь журнал.
- Cursor обновляется только после успешного apply (или после явно
  разрешённой операции — conflict/unsupported записываются, но cursor
  продвигается, чтобы не зациклиться).
- Перезапуск не приводит к повторному применению подтверждённых операций.

## Retry

- Transient error → операция остаётся в очереди (`retryable`).
- Retry не создаёт дубликаты (dedupe по operationId на обеих сторонах).
- Permanent/invalid операция не крутится бесконечно: после `MAX_ATTEMPTS`
  помечается `failed`; невалидная входящая операция фиксируется и
  пропускается без повреждения состояния.

## Conflict behavior (C0)

Не решается универсальный conflict resolution. Поведение первой версии:

- ordering — по `serverSequence`;
- duplicate operation — применяется один раз (dedupe);
- update неизвестного entity — ошибка/пропуск (не создаёт фантом);
- `inbox.update` c `baseVersion` ≠ локальному `updatedAt` — **detect + refuse**:
  не применяется, фиксируется `conflict` (никакого silent last-write-wins);
- два устройства изменили одну Inbox-запись — тот же refuse через baseVersion.

Главный запрет: silent last-write-wins с возможной потерей данных.

## Что синхронизируется (vertical slice C0)

- Inbox creation (text/rawText, hints, provenance, id)
- Inbox processing state (status, itemType)
- text/current text (rawText сохраняется)
- discarded / processed
- `resultRef` как ссылка на результат (Task в C0 не синхронизируется)

## Что НЕ синхронизируется (остаётся на C2+)

Tasks, Projects, Domains, Map layout, settings, Today, Note/Thought entities,
attachments/audio, полная история, AI data. Не начинаются: accounts,
authentication (есть только парная привязка устройств, см. C1), encryption,
native Android sync service, background push, WebSocket realtime.

## Минимальная наблюдаемость

`engine.getStatus()` → `{ deviceId, pending, cursor, lastSyncAt, lastError, conflicts }`; `engine.getConflicts()` → durable quarantine (persisted). Полноценный Sync Dashboard не строится.
