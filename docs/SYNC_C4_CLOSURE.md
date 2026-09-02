# Sync v1 — Product Closure (Stage C4)

Обновлено: 2026-09-03. Версия: `0.11.0-alpha.5`.

**Статус: C0–C4 code complete / field validation pending. Принятая C3/C4
линия публикуется одной non-stacked release-candidate веткой
`feat/sync-v1-alpha5-release`; исторические Draft PR #21/#22 отдельно не
merge'ятся. VDS/HTTPS, backup/restore proof и физический прогон телефон ↔ ПК
не выполнены. Sync v1 ещё не production-ready.**

C4 подготавливает закрытие Stage C: Sync становится законченной пользовательской
функцией, а не набором модулей. Фундамент (C0–C3) уже работает — C4 добавляет
управление устройствами, bootstrap, диагностику и явные границы
«отключить ≠ удалить локальные данные».

## Device management

- **Сервер**:
  - `GET /v1/devices` — список неотозванных устройств своего sync-space
    (`deviceId`, `deviceName`, `createdAt`, `lastSeenAt`); доступен любому
    привязанному устройству (один sync-space = один человек, список не
    секретен внутри него);
  - `POST /v1/devices/rename` — переименовать **себя**;
  - `POST /v1/devices/revoke {deviceId}` — **admin только** (путь
    восстановления при утере устройства; обычное устройство не может
    отозвать другие).
- **UI**: в панели Sync секция «Мои устройства» — список (имя, короткий id,
  последний вход), «Переименовать» для себя; отключение себя — через
  «Отключить синхронизацию» (revoke-self + очистка локальной конфигурации).

## Bootstrap нового устройства

Новый клиент привязывается и делает один полный sync: сервер отдаёт stream
от cursor 0, клиент воспроизводит **все** операции (captures, updates,
routes, deletes, restores, task-result проекции) и сходится к тому же
состоянию, что и остальные устройства. Проверено тестом (свежий клиент
реконструирует processed/routed запись + проекцию + удаления-восстановления)
и двухбраузерным smoke (третье устройство в одном sync воспроизводит всё).
Snapshot-сервис не строился — replay пока практически достаточен
(мастер-план §11.2).

## Diagnostics

«Экспорт диагностики» в панели Sync скачивает JSON:
`appVersion`, `deviceId`, `deviceName`, `endpoint`, `online`, `configured`,
`pending`, `failed`, `conflicts`, `cursor`, `lastSyncAt`, `lastError`,
`authFailed`. **Секретов нет** — токен никогда не покидает localStorage и не
входит в payload (проверено тестом).

## Disable / unlink

- «Отключить синхронизацию» = revoke-self (сервер) + очистка локальной
  конфигурации. **Локальные данные Atlas не удаляются** — подтверждение в
  диалоге это проговаривает.
- Повторная привязка того же устройства выдаёт свежий токен (старый
  инвалидируется).
- Admin может отозвать любое устройство (recovery).

## Версия и охват

`0.11.0-alpha.5`; PWA cache `atlas-capture-0.11.0-alpha.5`.

## Проверка

- 30 августа принят integrity head `c9325a1`, затем опубликованы whitespace
  hygiene `2043d34` и backup-safe VDS tooling `d84bfad` на C4 source-ветке.
- `node --no-warnings tests/sync-{v1,server,http,c2,c3,c4}.mjs` — все наборы
  прошли; C3 включает трёхклиентный compensating restore, numeric
  `baseVersion` и автоматическое закрытие matching quarantine entry.
- `node tools/smoke-c3.mjs` — Chromium + Firefox: обе delete/restore race
  модели разрешаются, клиенты сходятся без дублей, pending и page errors.
- `node tools/smoke-c4.mjs` — три независимых клиента: bootstrap из нуля,
  device management/rename, без pending, дублей и page errors.
- `node tools/build-sync-deploy.mjs` + archive inspection — allowlist из девяти
  VDS-файлов; нет вложенного runtime/archive, `.env`, SQLite, WAL или SHM.
- `node tests/vds-deploy.mjs` — HTTP/HTTPS vhost сохраняют static Studio/Capture,
  проксируют только `/v1/*` и `/health`, installer отключает старый Certbot
  catch-all vhost после безопасного получения или переиспользования сертификата
  и явно перезапускает уже активный Sync service при upgrade; restore runbook
  ждёт фактической готовности `/health`, а не только systemd `active`.
- `node tests/sync-server.mjs` — точная пустая legacy-схема первого Inbox VDS
  (`item_json`) мигрирует в Sync v1 с сохранением старой таблицы; непустая
  legacy-база блокируется до явного экспорта/переноса данных.
- Git Bash `bash -n` — installer и backup script синтаксически корректны.

## VDS recovery readiness

- `ATLAS_CERTBOT_EMAIL` обязателен; anonymous Certbot registration удалена.
- `atlas-sync-backup.timer` запускается ежедневно с `Persistent=true`.
- backup выполняется SQLite `.backup`, проверяет `PRAGMA integrity_check`,
  пишет с private permissions и удаляет только matching backups старше 30 дней.
- `RESTORE.md` останавливает timer/service, сохраняет текущие DB/WAL/SHM в
  rollback-каталог, устанавливает проверенную копию с `atlas-sync:atlas-sync`
  и `0640`, затем проверяет local/public `/health` и integrity.

## VDS field evidence — 31 августа 2026 UTC

- release `/opt/atlas-sync/releases/20260831T182600Z`, версия
  `0.11.0-alpha.5`; systemd service active/enabled, Node слушает только
  `127.0.0.1:8787`;
- managed HTTPS vhost активен, legacy Certbot vhost отключён; Studio `/`,
  Capture `/capture/`, local/public `/health` возвращают `200`; сертификат
  проходит TLS verification, Certbot timer enabled и renew dry-run успешен;
- первый автоматический backup
  `/var/lib/atlas-sync/backups/atlas-sync-20260831T182603Z.sqlite`: owner
  `atlas-sync:atlas-sync`, mode `0600`, 61 440 bytes, integrity `ok`, backup
  service `Result=success`;
- restore drill установил проверенный backup, сохранил исходные DB/WAL/SHM в
  `/var/lib/atlas-sync/pre-restore-20260831T183938Z`, восстановил service/timer,
  SQLite integrity и local/public `/health`;
- field drill выявил readiness race: `systemctl start` вернул управление за
  секунду до bind `:8787`. Данные и сервис не пострадали; runbook получил
  bounded `/health` retry и regression assertion.

## Closure-gates

1. ✅ VDS: HTTPS `/health`, loopback-only `:8787`, Certbot timer + renew dry-run.
2. ✅ Первый backup: файл создан, owner/mode корректны, integrity = `ok`.
3. ✅ Restore drill: rollback сохранён, local/public health-check успешны.
4. ⏳ Физический телефон ↔ ПК: pair, capture, desktop processing/route, phone
   result projection, offline/reconnect, revoke/re-pair, secret-free diagnostics.

Частичный field evidence 3 сентября: телефон и ПК привязаны; Capture с телефона
появляется в Studio, а routed Task result возвращается на телефон за 5–10 секунд.
Offline Capture сохраняет запись локально и показывает общий статус ожидания
сети. Наблюдение пользователя выявило недостающую per-record видимость pending:
correction добавляет локальные маркеры `Ждёт отправки` / `Ошибка отправки` /
`Не принято сервером`, производные только от durable outbox. Автодоставка после
reconnect, revoke/re-pair и diagnostics export ещё должны быть подтверждены.

Отдельный product finding, не подменяемый Sync closure: processed Thought/Note
сейчас не создают самостоятельную persisted-сущность или Map-проекцию и остаются
только финализированными Inbox-записями. Domain decision зафиксирован в roadmap.

## Что Stage C оставляет дальше (после closure-gates)

- Следующий этап выбирается отдельно: Today 2.0 discovery или новый Studio
  map-actionability pass; ни один не начинается автоматически.
- Full Sync (Tasks/Projects/Domains/History) — поздний этап, вместе с ним —
  task-конфликты.
- encryption at rest, background push, WebSocket realtime — осознанно не
  входят в Sync v1.
