# Атлас Жизни — дорожная карта возрождения

Обновлено: 20 августа 2026 года.

## Видение продукта

«Атлас Жизни» — не ещё один список задач. Это личная пространственная система, в которой человек видит сферы жизни, проекты, текущие действия и накопившееся напряжение как единую живую карту.

Продукт развивается в двух режимах: мобильный **Atlas Capture** для быстрого текстового и голосового захвата на Android и настольный **Atlas Studio** для глубокой работы с картой. Общие данные и правила образуют **Atlas Core**.

## Продуктовые выводы реального использования

```text
Capture          = рецептор
Processing Center = маршрутизатор
Core             = память и правила
Today            = действие
Map              = понимание всей системы
```

Зафиксированные правила:

- manual processing должен быть качественным сам по себе, без AI;
- Capture-подсказки (hints) ≠ подтверждённая классификация;
- одна активная запись за раз — фокус вместо приборной панели;
- progressive disclosure вместо вываливания всех параметров;
- processing statuses преимущественно автоматические (capture → new, начал разбор → reviewed, обработано → processed, отброшено → discarded);
- keyboard workflow и batch processing входят в линейку 0.10.x;
- AI позже ускоряет хороший workflow, а не заменяет плохой UX;
- rawText никогда не уничтожается; связи resultRef ↔ sourceInboxId двусторонние;
- все persisted-изменения — только через Core-команды; UI-черновики ephemeral;
- рост функциональности должен сопровождаться ростом визуальной ясности;
- Processing Center не должен превращаться в перегруженную панель параметров.

## Принципы развития

- Сначала сохранность данных и ежедневная польза, затем визуальные эффекты.
- Каждая версия должна быть пригодна для реального использования.
- Локальные данные остаются локальными, пока пользователь явно не выбрал синхронизацию.
- Один PR — одна ограниченная тема; без массовых рефакторингов.

## Версионная дорожная карта (фактическая)

### 0.9.x — Capture Reliability ✅ ЗАВЕРШЕНО

- A0 PWA Alpha.2 — ✅
- A1 Capture Reliability — ✅
- A2 Physical Android Smoke — ✅
- A3/A4 field test — ✅

Результат: надёжный захват текста и голоса (ru-RU), draft lifecycle, offline, Share Target, shortcuts, 0 потерянного текста в mini-stress. Native Android больше не является автоматическим следующим этапом: PWA жизнеспособна, native-слой подключается только под конкретные возможности.

### 0.10.x — Processing Center Core ✅ ЗАВЕРШЕНО

- **B0 Foundation** — ✅ ЗАВЕРШЕНО (`0.10.0-alpha.1`): edit с сохранением rawText, `itemType` (task | thought | note | null) отдельно от `userHint`, processing status `new | reviewed | processed | discarded`, карточный ручной разбор.
- **B1 Processing Routing** — ✅ ЗАВЕРШЕНО (`0.10.0-alpha.2`): безопасный Inbox → Task (`resultRef` ↔ `sourceInboxId`), Domain/Project/Priority/Due, безопасный revert, валидация destination, блокировка routed-записей, inline создание Domain/Project, routing draft.
- **B2 Processing Flow UX** — ✅ ЗАВЕРШЕНО (`0.10.0-alpha.3`): очередь «К разбору / Разобранные / Все», автоматические статусы, progressive disclosure, одна активная карточка, keyboard workflow, batch processing, session defaults, provenance, поиск, empty states, visual clarity pass (семантические приоритеты, иерархия действий, маркеры приоритета в компактных строках, читаемые date/time, batch-mode visual state).

Развитие Processing внутри линейки:

```text
sequential manual processing
↓
batch processing
↓
deterministic assistance (session defaults, hints)
↓
suggestions
↓
AI / Auto Processing
```

AI не является условием Definition of Done для 0.10.x.

### 0.11.x — Sync v1 🔴 АКТИВНО

Первый сквозной контур: Phone Capture → Inbox → Processing → Desktop → результат → Phone. Синхронизируются операции, а не перезапись общего JSON. `operationId`, `deviceId`, `sequence`, idempotency, retry, ack, server cursor, deduplication.

- **C0 Sync Foundation / первый Inbox vertical slice** — ✅ ЗАВЕРШЕНО (`0.11.0-alpha.1`): архитектура (`docs/SYNC_V1_FOUNDATION.md`), device identity, durable outbox, idempotency/dedupe, transport abstraction + dev/local relay, Core sync-apply, cursor/pull, retry; синхронизируется жизненный цикл Inbox/Processing (creation, state, itemType, text/rawText, hints, discarded/processed, resultRef как ссылка). Полный Task sync — далее.
- **C1 Real Remote Sync** — ✅ ЗАВЕРШЕНО (`0.11.0-alpha.2`, Draft PR #17): настоящий remote transport — минимальный Atlas Sync service (Node HTTP + SQLite, ноль зависимостей, `server/`), реализующий C0-контракт (`/v1/ops/push`, `/v1/ops/pull`); минимальная изоляция данных через парную привязку (одноразовый код → bearer-токен устройства, SHA-256, отзыв) и admin bootstrap-токен только на сервере; клиент (`js/sync/http-transport.js` + `runtime.js`); Sync включён в рабочее приложение (Studio-чип + модал, info-панель Capture, статусы ожидание/ошибка/привязка); offline-first: ошибка pull не блокирует push, outbox durable, retry; деплой-пакет для VDS (`deploy/vds/`, HTTPS через certbot на `*.sslip.io`). VDS-деплой и физический прогон телефона отложены решением пользователя. Детали — `docs/SYNC_C1_REMOTE.md`.
- **C2 Task Result Bridge** — ✅ ЗАВЕРШЕНО (`0.11.0-alpha.3`, PR #20): результат обработки понятен на телефоне без Full Task Sync — read-only проекция routed Task (`state.taskProjections`) через операции `task.result.upsert`/`remove`; карточка результата в Capture («✓ Разобрана → Задача · title · Дача · Сад · Высокий · 24 августа»), определённое поведение при переименовании/изменении/удалении/отмене; десктоп — единственный писатель. Детали — `docs/SYNC_C2_RESULT_BRIDGE.md`.
- **C3 Conflicts & Recovery** — ▶ ТЕКУЩИЙ ЭТАП (`0.11.0-alpha.4`, Draft PR #21): человеческие конфликты вместо «detect+refuse» — классификация (base_version / deleted_race), действия в панели Sync (оставить локальную / принять удалённую / сохранить обе / восстановить и применить), resolution durable; синхронизация удаления/восстановления Inbox (W2); rename Domain/Project обновляет проекции на телефоне (W3); failed-ретраи после долгого офлайна. Детали — `docs/SYNC_C3_CONFLICTS.md`.
- **C4 Product Closure** — device management (список/имя/отключение), bootstrap нового устройства (replay), diagnostics export, disable/unlink, реальная эксплуатация — далее (`0.11.0-alpha.5`).

### 0.12.x — Today 2.0 (desktop + mobile)

Сейчас / Focus-3 / план дня / ёмкость / переносы / выполнено; задачи после Processing Center.

### 0.13.x — Smart Processing / Inbox Intelligence

Поверх готового Processing Core: правила пользователя, детерминированный parser, suggestions с confidence, первые AI-assist функции. Режимы Manual / Assist / Auto.

### 0.14.x — Native Android capabilities (условный этап)

Подключается только при доказанной продуктовой необходимости: widget, Quick Settings, notifications/reminders, native SpeechRecognizer, original audio, biometric lock. Если PWA продолжает закрывать сценарии — этап откладывается.

### 0.15.x — Map vNext + Entity Context

Performance, Inspector, aging, связи, Entity/Topic/Context представление, распределение внимания.

### 0.16.x — Full Sync + History

Tasks → Projects → Domains → Notes/Ideas/Entities; conflict resolution; durable history; фундамент обзоров.

### 0.17.x — Intelligence / Reviews / Atlas Q&A

AI Inbox/Processing, анализ дня, недельный обзор, проектный помощник, patterns, Atlas Q&A.

Сроки не фиксируются: этапы двигаются по результатам реального использования.

## Завершённое и устаревшее (не будущие работы)

- ✅ PWA Capture (установка, офлайн, service worker, кэш с версионированием).
- ✅ Голосовой прототип: микрофон → ru-RU распознавание → Inbox.
- ✅ Физический Android smoke (Stage A2, 0 потерянного текста).
- ✅ Базовая Capture reliability (draft lifecycle, Share Target, shortcuts, provenance `source/inputType/entryPoint`).
- ✅ Inbox MVP + миграции схемы (schema 2 → 4).
- ✅ Командный слой Atlas Core + локальный operation log (основа Sync).
- ✅ Undo переносов (`task.move.undo`), undo удаления Inbox.
- ✅ Экспорт/импорт JSON, нормализация тегов, избавление от `#undefined`.
- ✅ Браузерные smoke-тесты основных сценариев (Capture и Processing flow).

## Открытые следы (не блокируют 0.10.x)

- Автоматический локальный снимок перед импортом/миграцией/каскадным удалением.
- Перевод изменений и переносов проектов/доменов на команды.
- Универсальный Undo framework (сознательно не строится; у каждого flow своя обратимость).
- IndexedDB-хранилище с миграцией из localStorage.

## Правило пересмотра

После каждого этапа обновляем этот документ: отмечаем фактически завершённое, убираем потерявшие смысл пункты и уточняем следующий этап по результатам реального использования.
