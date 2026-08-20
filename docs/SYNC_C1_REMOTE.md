# Sync v1 — Real Remote (Stage C1)

Обновлено: 2026-08-20. Версия: `0.11.0-alpha.2`.

C1 превращает C0-контур (Phone Capture → Inbox → Processing → Desktop →
результат → Phone) из локального доказательства в реально работающую
межустройственную функцию. Механизм C0 (operations, durable outbox,
idempotency, ack, cursor, quarantine, Core remote-apply) не меняется —
меняется transport и появляется product layer.

## Архитектура

```text
Atlas Capture PWA (phone)          Atlas Studio (desktop)
  captureInbox/updateInbox          updateInbox/route/…
        │  durable outbox                 │
        ▼                                 ▼
  js/sync/http-transport.js (fetch, Bearer token, тот же C0-контракт)
        │                                 │
        └──────────────┬──────────────────┘
                       ▼ HTTPS
              Apache vhost (статика + /v1/* → 127.0.0.1:8787)
                       ▼
        server/sync-server.js (Node ≥ 22.13, node:sqlite, ноль npm-зависимостей)
                       │
                       ▼
        SQLite: sync_operations (operation_id UNIQUE, sequence AUTOINCREMENT),
                sync_devices (token_hash SHA-256), pairing_codes (HMAC, TTL 5 мин)
```

Один origin для приложения и API (аппликация и `/v1/*` на одном хосте) —
на реальных устройствах CORS не участвует; allowlist остаётся для
локальной разработки.

## Почему так, а не Firebase/Supabase/другое

- сервер — один файл + entry point, ноль зависимостей: нет supply chain,
  нет build, деплой — копирование файлов;
- C0-контракт ложится на HTTP один в один: push → `{ackedIds}`,
  pull(cursor) → `{operations, newCursor}`; engine не менялся;
- нет vendor lock-in: клиент зависит только от контракта, сервер можно
  заменить любым другим совместимым;
- простой pull/push + 30-секундный poll — предсказуемее realtime-магии;
  WebSocket не является целью;
- локальная разработка и диагностика тривиальны (`node server/start.js`,
  `curl /health`), на VDS уже подготовлен Node 22.22 linux x64.

## Безопасность (минимальная изоляция, без account-системы)

- **Admin bootstrap token** живёт только в `/etc/atlas-sync/atlas-sync.env`
  (генерируется установщиком, права 0640 root:atlas-sync). В Git, в клиенте,
  в логах его нет. Используется только для первого кода привязки или
  восстановления доступа.
- **Парная привязка**: устройство привязывается одноразовым 8-значным
  кодом (HMAC-SHA256 от admin-токена, TTL 5 минут, один активный код на
  создателя, rate limit 10 попыток / 5 минут / адрес) и получает свой
  bearer-токен (32 случайных байта). На сервере хранится только SHA-256.
  Повторная привязка того же deviceId инвалидирует старый токен.
- Каждый push валидируется: `deviceId` операции и батча должен совпадать с
  токеном; envelope ограничен (schema, типы операций, размер payload,
  длина rawText) — мусор не пишется в БД.
- Публичного чтения чужих операций нет: без валидного токена — 401;
  pull отдаёт только операции других устройств (свои — никогда), и только
  той же привязке (все устройства привязаны к одному серверу = один
  sync-space).
- HTTPS — Apache + Let's Encrypt на `*.sslip.io` (покупка домена не нужна);
  порт 8787 привязан к loopback, публичный вход — только Apache.
- Отзыв: устройство может само отключиться (`/v1/devices/revoke-self`);
  утрата токена чинится повторной привязкой.

Чего осознанно нет: E2E-шифрования на сервере, per-user account,
multi-space (одна инсталляция = один личный sync-space владельца VDS).

## Lifecycle в приложении

- Capture/обработка **никогда не ждут сеть**: команда сохраняет локально и
  кладёт операцию в durable outbox — сервис недоступен, работа не блокируется.
- `requestSync()` (debounced 2.5 с) вызывается после захвата, обработки в
  Processing Center и Quick Add; плюс boot-sync, `online`-событие,
  `visibilitychange`, polling 30 с и ручная кнопка «Синхронизировать сейчас».
- Push идёт даже если pull упал (offline-first fix в engine); ack обязателен;
  unacked записи восстанавливаются в `retryable` после перезапуска.
- Повторная доставка не создаёт дублей (dedupe по operationId на обеих
  сторонах + applied-set на клиенте).
- Состояние видно пользователю: Studio-чип «Синхронизация», Capture-шапка
  («Ожидают отправки: N», «Ошибка», «Нужна привязка»), панель со статусом,
  последней синхронизацией, конфликтами, кодом для нового устройства и
  отключением.

## Конфликты

Поведение C0 сохранено: `baseVersion` mismatch → detect + quarantine, без
silent last-write-wins; конфликты видны в панели Sync. Окончательный
conflict-resolution UI — задача C2+ (не раздувает этот PR).

## Проверка

- `node tests/sync-server.mjs` — сервис по реальному HTTP.
- `node tests/sync-http.mjs` — два независимых клиента через живой сервис
  (полный цикл, offline, retry после рестарта, отзыв + перепривязка).
- `node tools/smoke-c1.mjs` — двухбраузерный live smoke: Chromium (PWA) и
  Firefox (Studio), отдельные хранилища, реальный UI-захват и обработка,
  реальный HTTP; включает offline-отрезок и восстановление сервиса.
- Физическая проверка телефона — см. `deploy/vds/README.md` («Physical
  device check»).

## Деплой на VDS

`tools/build-sync-deploy.mjs` → `dist/atlas-sync-upload.tar.gz` (без
секретов), затем `deploy/vds/install-atlas-sync.sh` на сервере
(нужен Node 22 linux x64 архив). Изоляция: свой пользователь/systemd-юнит,
отдельный vhost, SQLite в `/var/lib/atlas-sync`, admin-токен в
`/etc/atlas-sync/atlas-sync.env`.

## Известные границы C1

- Одна инсталляция сервиса = один персональный sync-space (владелец VDS).
- ServerSequence монотонен благодаря AUTOINCREMENT и файловой БД; удаление
  БД сбрасывает счётчик — при пересоздании БД клиенты с продвинутым
  cursor'ом не увидят более старые операции (бэкап БД — обязанность
  владельца сервера).
- Реальная проверка «телефон ↔ ПК через интернет» требует установки на VDS
  и HTTPS-сертификата — выполняется по инструкции (требуются доступы).
