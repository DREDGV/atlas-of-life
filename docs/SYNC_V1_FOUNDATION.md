# Sync v1 — Foundation (Stage C0)

Обновлено: 2026-08-19. Версия: `0.11.0-alpha.1`.

Sync v1 синхронизирует **операции, а не замену всего JSON**. Первый вертикальный
контур — жизненный цикл Inbox/Processing, а не весь граф Atlas.

```text
Phone Capture → Inbox item → sync operation → Desktop → Processing
→ processed / discarded / routed result → sync operation → Phone
```

## Operation envelope

Базовый envelope (совместим с `js/core/operations.js`):

```json
{
  "schema": 1,
  "id": "op-<uuid>",
  "deviceId": "…",
  "timestamp": 1785700000000,
  "type": "inbox.capture | inbox.update | inbox.route_to_task | inbox.route_revert",
  "entityType": "inbox",
  "entityId": "…",
  "baseVersion": 1785700000000,
  "payload": { },
  "syncStatus": "pending"
}
```

- `id` (operationId) — глобально уникальный; единственный ключ идемпотентности.
- `deviceId` — устойчивый локальный идентификатор устройства (`js/core/device.js`).
- `sequence` — локальный монотонный счётчик устройства (`js/sync/device.js`),
  используется для локального порядка; глобальный порядок задаёт серверный
  `serverSequence` на relay.
- `baseVersion` — версия сущности, от которой отталкивалось изменение
  (`updatedAt`); используется для детекции конфликта.

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
- Состояния: `pending` → `sent` (отправлено, ждёт ack) → удаляется по ack;
  `retryable` (transient) → повторная попытка; `failed` (permanent, после
  `MAX_ATTEMPTS`), чтобы не крутиться бесконечно.
- Операция НЕ считается синхронизированной только потому, что HTTP-запрос
  отправлен: ack обязателен.

## Idempotency и deduplication

- Один `operationId`, полученный повторно, не применяется дважды.
- Применённые id хранятся в `atlas-sync-applied-v1` (bounded set).
- Relay дополнительно дедуплицирует по `operationId` при push.
- Повторная отправка после timeout/retry безопасна.

## Remote apply (только через Core)

Входящая операция применяется через `js/sync/apply.js`:
- `inbox.capture` → `addInboxLines` с оригинальными id/полями + `saveState()`;
- `inbox.update` → `updateInboxItem` (те же guard'ы: rawText immutable,
  lock routed-записей, валидация domainHintId);
- `inbox.route_to_task` → `status=processed` + `resultRef` (как ссылка на
  результат; сама Task в C0 не синхронизируется);
- `inbox.route_revert` → снять `resultRef`, `status=reviewed`.

Транспорт/Sync UI не делает `state.inbox.push(...)` / `saveState()` напрямую.

## Transport boundary

Интерфейс (`js/sync/relay.js`):

```text
pushOperations(ops)  → { ackedIds }
pullOperations(cursor) → { operations: [{serverSequence, operation}], newCursor }
acknowledge(opIds)   → void
```

В этом PR реализован **dev/local relay transport** (`createLocalRelay`):
глобальный `serverSequence` + pull по cursor. Это test/dev transport для
доказательства vertical slice двумя локальными клиентами, НЕ production
межустройственная интернет-синхронизация. Облачный backend/Firebase/Supabase
не подключаются.

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

## Что НЕ синхронизируется (остаётся на C1+)

Tasks, Projects, Domains, Map layout, settings, Today, Note/Thought entities,
attachments/audio, полная история, AI data. Не начинаются: accounts,
authentication, encryption, cloud integration, native Android sync service,
background push, WebSocket realtime.

## Минимальная наблюдаемость

`engine.getStatus()` → `{ deviceId, pending, cursor, lastSyncAt, lastError, conflicts }`.
Полноценный Sync Dashboard не строится.
