# Атлас Жизни — дорожная карта возрождения

Обновлено: 30 августа 2026 года.

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

### 0.11.x — Sync v1 🟠 КОД ГОТОВ, FIELD VALIDATION PENDING

Первый сквозной контур: Phone Capture → Inbox → Processing → Desktop → результат → Phone. Синхронизируются операции, а не перезапись общего JSON. `operationId`, `deviceId`, `sequence`, idempotency, retry, ack, server cursor, deduplication.

- **C0 Sync Foundation / первый Inbox vertical slice** — ✅ ЗАВЕРШЕНО (`0.11.0-alpha.1`): архитектура (`docs/SYNC_V1_FOUNDATION.md`), device identity, durable outbox, idempotency/dedupe, transport abstraction + dev/local relay, Core sync-apply, cursor/pull, retry; синхронизируется жизненный цикл Inbox/Processing (creation, state, itemType, text/rawText, hints, discarded/processed, resultRef как ссылка). Полный Task sync — далее.
- **C1 Real Remote Sync** — ✅ ЗАВЕРШЕНО (`0.11.0-alpha.2`, PR #17 merged): настоящий remote transport — минимальный Atlas Sync service (Node HTTP + SQLite, ноль зависимостей, `server/`), реализующий C0-контракт (`/v1/ops/push`, `/v1/ops/pull`); минимальная изоляция данных через парную привязку (одноразовый код → bearer-токен устройства, SHA-256, отзыв) и admin bootstrap-токен только на сервере; клиент (`js/sync/http-transport.js` + `runtime.js`); Sync включён в рабочее приложение (Studio-чип + модал, info-панель Capture, статусы ожидание/ошибка/привязка); offline-first: ошибка pull не блокирует push, outbox durable, retry. Детали — `docs/SYNC_C1_REMOTE.md`.
- **C2 Task Result Bridge** — ✅ ЗАВЕРШЕНО (`0.11.0-alpha.3`, PR #20): результат обработки понятен на телефоне без Full Task Sync — read-only проекция routed Task (`state.taskProjections`) через операции `task.result.upsert`/`remove`; карточка результата в Capture («✓ Разобрана → Задача · title · Дача · Сад · Высокий · 24 августа»), определённое поведение при переименовании/изменении/удалении/отмене; десктоп — единственный писатель. Детали — `docs/SYNC_C2_RESULT_BRIDGE.md`.
- **C3 Conflicts & Recovery** — ✅ CODE COMPLETE (`0.11.0-alpha.4` в составе `0.11.0-alpha.5` RC): человеческие конфликты вместо «detect+refuse»; terminal rejection; versioned tombstones; строгая provenance/link integrity; детерминированные delete/restore races; трёхклиентная сходимость compensating restore. Исторический Draft PR #21 не является самостоятельным merge-кандидатом: remediation находится в объединённом RC. Детали — `docs/SYNC_C3_CONFLICTS.md`.
- **C4 Product Closure** — ✅ CODE COMPLETE / VDS PASSED / PHONE PENDING (`0.11.0-alpha.5`, ветка `feat/sync-v1-alpha5-release`): device management, bootstrap нового устройства, secret-free diagnostics, безопасный unlink, recovery-safe VDS tooling (обязательный Certbot e-mail, ежедневный проверяемый SQLite backup, 30-дневное хранение, restore runbook). Реальный VDS прошёл HTTPS/loopback, backup и restore drill; исторические stacked C3/C4 ветки остаются review evidence, а не отдельными merge-кандидатами. Детали — `docs/SYNC_C4_CLOSURE.md`.
- **Локальные code-gates закрыты 30 августа:** `sync-v1/server/http/c2/c3/c4` tests; C3 и C4 multi-browser smokes; deployment bundle allowlist и shell syntax; версия остаётся `0.11.0-alpha.5`.
- **Closure-gates:** ✅ реальный VDS HTTPS `/health`, loopback-only `:8787`, Certbot renew dry-run; ✅ первый private backup + `PRAGMA integrity_check`; ✅ restore drill с сохранённым rollback и успешными local/public health-check; ⏳ остаётся физический phone Capture ↔ desktop Processing ↔ phone result, offline/reconnect, revoke/re-pair и diagnostics export. До phone-gate Sync v1 не называется production-ready и Stage C не переводится в DONE.

#### Field finding: Thought/Note после Processing не имеют продолжения

- **Наблюдение 3 сентября 2026:** «Сохранить как мысль/заметку» сейчас только
  выставляет исходной Inbox-записи `itemType` и `status: processed`. Отдельная
  persisted-сущность, `resultRef`, destination и Map-проекция не создаются;
  текущая Map строится из Tasks/Projects/Domains. Поэтому запись исчезает из
  очереди «К разбору», но фактически остаётся в «Разобранных» без следующего
  места назначения.
- Это **product-flow dead-end**, а не дефект Sync transport. Не закрывать его
  быстрым отображением processed Inbox на Map: сначала нужен отдельный domain
  decision — являются ли Thought/Note самостоятельными сущностями или единым
  Knowledge/Context-объектом, куда они маршрутизируются, как связаны с
  Domain/Project, как работают resultRef/revert/history и что синхронизируется.
- Решение включить в выбор следующего продуктового этапа перед Today 2.0 или
  новым Map actionability pass; реализацию не начинать без утверждённой модели.

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
