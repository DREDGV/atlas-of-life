# Changelog

История версий (релизы) + дорожная карта (планы/идеи). Формат релизов: Atlas_of_life_vX.Y.Z. В UI версия берётся по первой секции `## Atlas_of_life_vX.Y.Z` сверху.

### Backlog / Plans / Ideas

- Undo при удалении задач (toast 5–10 сек).
- Drag&Drop сортировка и батч‑операции в «Сегодня».
- Двойной клик по проекту = Fit проект.
- RU‑парсер: «послезавтра 8:30», «через 1.5 часа», интервалы.
- IndexedDB (offline‑хранилище) + миграции схемы.
- Частичный экспорт/импорт (по доменам/проектам).
- Метрики продуктивности: время в статусе, aging‑heatmap.
- Эксперименты по раскладке: force‑layout / grid‑кольца.
- Reversible Inbox → Task conversion (см. docs/PROCESSING_B0_FOLLOWUP.md).

---

## 0.11.0-alpha.5 - 2026-08-26

### Stage C4 — Sync v1 Product Closure

#### Добавлено
- **Device management**: сервер `GET /v1/devices` (список устройств sync-space: имя, последний вход), `POST /v1/devices/rename` (себя), `POST /v1/devices/revoke` (admin — путь восстановления при утере устройства); UI — секция «Мои устройства» в панели Sync (список, переименование себя)
- **Bootstrap нового устройства**: свежий клиент привязывается и в один sync воспроизводит **весь** stream с нуля (captures, updates, routes, deletes, restores, проекции результата) — без ручного JSON-импорта; snapshot-сервис не строится (replay достаточно, мастер-план §11.2)
- **Экспорт диагностики**: кнопка в панели Sync → JSON (appVersion, deviceId, endpoint, pending/failed/conflicts, cursor, lastSyncAt, lastError, …) **без секретов** (проверено тестом)
- **Disable/unlink явно отделён от удаления данных**: «Отключить синхронизацию» = revoke-self + очистка конфигурации; локальные данные Atlas не трогаются (подтверждение в диалоге)

#### Техническое
- `tests/sync-c4.mjs` — device management (list/rename/admin-revoke), bootstrap-replay свежего клиента, diagnostics без секретов, renameSelf без потери токена
- `tools/smoke-c4.mjs` — три независимых браузера: новое устройство bootstrap'ится из нуля, панель «Мои устройства» показывает все три, переименование применяется на сервере и в конфиге
- **Версия** `0.11.0-alpha.5`; PWA cache `atlas-capture-0.11.0-alpha.5`

#### Stage C закрыт
- 0.11.x Sync v1: C0 Foundation → C1 Remote → C2 Result Bridge → C3 Conflicts → C4 Closure.
- Следующий крупный этап — 0.12.x Today 2.0 (по roadmap; не начинается без команды).
- Остаётся на будущее: Full Sync (Tasks/Projects/Domains/History), encryption at rest, background push, WebSocket realtime.

---

## 0.11.0-alpha.4 - 2026-08-26

### Stage C3 — Conflicts & Recovery

#### Добавлено
- **Человеческие конфликты вместо «detect + refuse»**: quarantine обогащён (`conflictStatus`: base_version / deleted_race / unsupported / invalid; `resolution`: pending / resolved; `resolutionAction`; `resolvedAt`); `conflicts` в статусе = число неразрешённых; resolution durable (переживает reload)
- **Действия разрешения в панели Sync** (без технических терминов): base_version — «Оставить локальную» / «Принять удалённую» / «Сохранить обе» (копия локальной версии создаётся и доставляется через inbox.capture, оригинал принимает remote); deleted_race — «Оставить удалённой» / «Восстановить и применить» (запись восстанавливается с remote-состоянием и **восстановление доставляется остальным** через inbox.restore — иначе устройства разошлись бы); invalid/unsupported — «Пропустить»
- **W2 — удаление/восстановление Inbox синхронизируется**: `inbox.delete` / `inbox.restore` enqueue + серверные типы + идемпотентный remote apply; удалил на телефоне → исчезает на ПК, «Отменить» → восстанавливается везде; update/route для локально удалённой записи → `deleted_race` (раньше падал/quarantine-invalid)
- **W3 — rename Domain/Project обновляет телефон**: Core-команды `updateDomain` / `updateProject` пере-эмитят `task.result.upsert` для routed-задач домена/проекта (проекция не показывает старое имя); обработчики rename в Studio переведены на команды + мгновенный sync
- Capture PWA: удаление/восстановление записи триггерят мгновенный sync (как захват)

#### Исправлено
- `failed`-записи outbox больше не застревают навсегда после долгого офлайна — первый успешный цикл возвращает их в доставку (W1, stabilize)

#### Техническое
- `tests/sync-c3.mjs` — delete/restore sync, классификация гонок, матрица разрешения, durability, rename re-emit, live HTTP round trip
- `tools/smoke-c3.mjs` — двухбраузерный smoke: delete-синхронизация → deleted_race → разрешение в панели → сходимость; без дублей
- **Версия** `0.11.0-alpha.4`; PWA cache `atlas-capture-0.11.0-alpha.4`

#### Не в этом PR (C4+)
- Device management, initial bootstrap, diagnostics export, Full Task Sync, CRDT

---

## 0.11.0-alpha.3 - 2026-08-20

### Stage C2 — Task Result Bridge

#### Добавлено
- **Read-only проекция routed Task** (`state.taskProjections`, persisted): телефон получает понятный результат обработки («✓ Разобрана → Задача · title · Дача · Сад · Высокий · 24 августа · ✓ Выполнено») **без репликации Task CRUD** — на телефоне нет копии задачи, нет второй истины о Task, десктоп остаётся единственным писателем
- **Новые sync-операции** `task.result.upsert` / `task.result.remove`: эмитятся при routing (вместе с `inbox.route_to_task`), при update/move/delete задач, рождённых из Inbox (`sourceInboxId`), и при revert (если задача удалена); revert изменённой задачи не эмитит ничего (refused)
- **Remote-apply через Core** (`applyRemoteTaskResultUpsert/Remove`): атомарно, без echo, со stale-guard (старая доставка не откатывает более новую проекцию); dedupe по operationId как обычно
- **Обработка изменений после routing** (§9.5 мастер-плана): переименование/приоритет/срок/статус/перемещение следуют на телефон; удаление Task → определённый fallback «Результат недоступен на этом устройстве»; route revert → проекция удаляется
- **Сервер** принимает новые типы (`entityType`: inbox | task)
- **Live refresh после sync**: runtime отдаёт `pulled`; Studio обновляет список Inbox (не прерывая открытую карточку обработки), Capture обновляет списки

#### Изменено
- `storage.js`: load/save/export/import учитывают `taskProjections`; structured `due` (`{date,time}`) сохраняется как есть
- Capture PWA: статусные бейджи обработки в списке Входящих (К разбору / ✓ Разобрана · тип / Отброшена)

#### Техническое
- `tests/sync-c2.mjs`: эмиссия, содержимое проекции (titles из Domains/Projects), revert/refused, remote apply guard'ы, live HTTP — проекция следует desktop→phone при update/delete
- `tools/smoke-c2.mjs`: двухбраузерный smoke результата (Chromium phone + Firefox desktop): route → карточка результата → update (done) → delete → fallback; `tools/smoke-shared.mjs` — общий scaffolding smokes
- **Версия**: `0.11.0-alpha.3`; PWA cache `atlas-capture-0.11.0-alpha.3`

#### Не в этом PR (C3+)
- Conflict-resolution UX, device management, initial bootstrap, Full Task Sync

---

## 0.11.0-alpha.2 - 2026-08-20

### Stage C1 — Real Remote Sync

#### Добавлено
- **Удалённый Sync-сервис** (`server/sync-server.js` + `server/start.js`): минимальный Node.js HTTP + SQLite (`node:sqlite`, ноль npm-зависимостей) сервис, говорящий на том же транспортном контракте, что и C0 dev relay (`pushOperations` / `pullOperations(cursor)`): `POST /v1/ops/push` (дедупликация по operationId, монотонный `serverSequence`, per-op валидация с ограничением размера), `GET /v1/ops/pull?after&excludeDevice&limit`, `GET /health`
- **Минимальная изоляция данных (без account-системы)**: admin bootstrap-токен только в окружении сервера (генерируется при установке, в Git не попадает); парная привязка устройств — одноразовый 8-значный код (HMAC, TTL 5 мин) → персональный bearer-токен устройства (хранится как SHA-256, можно отозвать, повторная привязка инвалидирует старый); push требует совпадения deviceId с токеном; rate limit на привязку; CORS только по явному allowlist
- **Клиентский транспорт** (`js/sync/http-transport.js`): C0-контракт поверх fetch; 401 → `code: 'unauthorized'` для UX «нужна привязка»
- **Конфигурация** (`js/sync/config.js`): endpoint + токен устройства в localStorage; https обязателен (http — только localhost для разработки); секретов в репозитории нет
- **Runtime** (`js/sync/runtime.js`): boot-sync, debounced `requestSync()` после локальных изменений, триггеры `online` / `visibilitychange`, polling 30 с, защита от параллельных циклов, pair/unpair/createPairingCode, подписки на статус
- **UX статуса Sync** (`js/sync/ui.js` + интеграция): Studio — чип «Синхронизация» в шапке + модал (форма привязки, статусные строки, «Код для нового устройства», отключение, список конфликтов); Capture PWA — секция «Синхронизация» в info-панели + статус в шапке («Ожидают отправки: N», «Ошибка», «Нужна привязка»)
- **Deploy-пакет для VDS** (`deploy/vds/`): systemd-юнит (isolated user, ProtectSystem), Apache vhost (статический Atlas + проксирование `/v1/*` — один origin, без CORS на реальных устройствах), установщик, README; `tools/build-sync-deploy.mjs` собирает upload-бандл; HTTPS через certbot на `*.sslip.io` (без покупки домена)

#### Изменено
- **Engine** (`js/sync/engine.js`): ошибка pull больше не блокирует push (offline-first); `lastSyncAt` персистентный и ставится только при реально успешном направлении; `failed` и `authFailed` видны в статусе; счётчик конфликтов инициализируется из durable quarantine
- Capture PWA: `window.state` для отладки (как в Studio)

#### Техническое
- `tests/sync-server.mjs` — сервис через реальный HTTP (pairing, push/pull, дедуп, валидация, CORS, rate limit)
- `tests/sync-http.mjs` — два независимых клиента через живой сервис: полный цикл Phone→Remote→Desktop→Remote→Phone, offline-долговечность, retry после рестарта сервера, отзыв + повторная привязка
- `tools/smoke-c1.mjs` — двухбраузерный live smoke (Chromium + Firefox, реальный UI Capture, реальный HTTP): полный round trip, без дублей, offline + доставка после восстановления сервиса
- PWA precache дополнен модулями sync (офлайн-граф остаётся полным); **версия** `0.11.0-alpha.2`, кэш `atlas-capture-0.11.0-alpha.2`

#### Не в этом PR (C2+)
- Full Task/Project/Domain sync, полная история, conflict-resolution UI, encryption at rest, background push, WebSocket realtime

---

## 0.11.0-alpha.1 - 2026-08-19

### Stage C0 — Sync v1 Foundation

#### Добавлено
- **Sync-архитектура**: `docs/SYNC_V1_FOUNDATION.md` — операции вместо замены всего JSON; operation envelope, device identity, durable outbox, remote apply через Core, idempotency/dedupe, ack, retry, cursor, conflict behavior
- **Device identity**: устойчивый локальный `deviceId` (переиспользует `js/core/device.js`) + локальный монотонный `sequence` (`js/sync/device.js`)
- **Durable Sync Outbox** (`js/sync/outbox.js`): persisted очередь, не зависит от обрезки `operationLog`; состояния `pending` → `sent` → acked; `retryable` → `failed` (после MAX_ATTEMPTS)
- **Idempotency/dedupe** (`js/sync/apply.js`): применённые operationId хранятся отдельно; повторная операция не применяется дважды
- **Transport boundary** (`js/sync/relay.js`): интерфейс `pushOperations` / `pullOperations(cursor)` / `acknowledge` + dev/local relay transport (явно test/dev, не production backend)
- **Sync engine** (`js/sync/engine.js`): pull → apply (Core sync-apply) → push → ack; cursor обновляется после успешного apply, не регрессирует; retry без дублей; developer-visible status (deviceId/pending/cursor/lastSync/lastError/conflicts)
- **Первый vertical slice**: Inbox creation / processing state / itemType / text+rawText / hints / discarded+processed / `resultRef` как ссылка на результат (Task пока не синхронизируется); remote apply идёт только через Core (не прямые state мутации)
- **Conflict behavior C0**: ordering по `serverSequence`, dedupe по operationId, `baseVersion` mismatch → detect+refuse (без silent last-write-wins)

#### Не в этом PR (C1+)
- Full sync (Tasks/Projects/Domains/Map/settings/Today/attachments/history/AI)
- accounts, authentication, encryption, cloud integration, native Android sync, background push, WebSocket realtime

#### Техническое
- `js/core/commands.js`: syncable Inbox-команды ставят операцию в outbox после успешного сохранения
- Focused regression tests: `tests/sync-v1.mjs`
- **Версия**: `0.11.0-alpha.1`; PWA cache `atlas-capture-0.11.0-alpha.1`

---

## 0.10.0-alpha.3 - 2026-08-18

### Stage B2 — Processing Flow UX

#### Добавлено
- **Очередь упрощена**: фильтры «К разбору | Разобранные | Все» (К разбору = new + reviewed); прогресс «К разбору: N» вместо технической статистики; статусы остаются в модели, но уходят из главного UI
- **Автоматические processing-переходы**: Capture → `new`; начало реального разбора (открытие активной карточки) → `reviewed`; успешная обработка → `processed`; явное «Отбросить» → `discarded`. Ручные status-кнопки убраны из интерфейса
- **Progressive disclosure**: сначала главный вопрос «Что это?» (Задача / Мысль / Заметка); для Задачи раскрывается «Куда?» (Domain/Project + «Создать задачу»), приоритет и срок спрятаны за «▸ Дополнительно» (блок реально скрывается); для Мысли/Заметки — «Сохранить как мысль» / «Сохранить как заметку» (itemType + processed, без Task)
- **Финальные состояния**: processed Мысль/Заметка показываются как «💭 Мысль · Разобрана» / «📝 Заметка · Разобрана», отброшенные — «Отброшена»; действие «Вернуть в разбор» (Core → reviewed) с сохранением text/rawText/itemType/provenance; routed Task — прежний linked-result
- **Keyboard-first разбор**: `1/2/3` — тип активной записи, `J`/`↓` / `K`/`↑` — следующая/предыдущая, `Enter` — однозначное главное действие (Мысль/Заметка), `Esc` — закрывает edit/сворачивает блоки и не закрывает центр изнутри записи; не срабатывает при вводе в полях; подсказки клавиш в UI
- **Batch processing**: [Выбрать несколько] → назначить тип / отбросить / назначить Domain / (для Task-группы) Domain+Project+Priority → [Создать N задач]; последовательная обработка с остановкой на первой ошибке, без дублей и без повреждения очереди
- **Session defaults**: последние явно выбранные Domain/Project/Priority предлагаются следующей записи (in-memory, без авто-подтверждения; `domainHintId` приоритетнее; Project только если принадлежит выбранному Domain)
- **«▸ Исходник»**: read-only исходник (rawText, источник, ввод, время захвата; «Текущий текст» при отличии от rawText)
- **Поиск по Inbox**: «Найти во входящих…» (text / rawText / itemType / название domainHint), работает с фильтрами очереди; empty-state «Ничего не найдено»
- **Empty states**: «Всё разобрано» + [Записать новую мысль], «Пока ничего не разобрано»
- **Последовательный разбор**: одна активная/раскрытая карточка, остальные компактные (кликабельные, с `›`); после обработки запись уходит из «К разбору» и следующая становится основной
- **Quick Capture «+ Уточнить»**: свёрнутое уточнение — подсказка типа (Задача/Мысль/Заметка, `userHint`) и домен (`domainHintId`, nullable, валидация на существующий Domain, неизвестный → null); пометка «Уточнение применится ко всем записям» для многострочного ввода; без Project и без обязательного выбора
- **Подсказки Capture при разборе**: «Подсказка: Задача / Предложенный домен: Дача»; при выборе Задачи `domainHintId` предзаполняет routing draft, решение всегда можно изменить
- **Естественный следующий шаг**: после сохранения — «✓ Сохранено N записей» + [Разобрать сейчас] (открывает очередь «К разбору»)
- **Визуальная чистка**: одна очевидная primary-кнопка на шаг, вторичные действия визуально слабее; «Создано 02:43 · изменено 02:54» вместо непонятных «изм.»; тонкий тёмный scrollbar содержимого Processing Center; строка Project скрыта при отсутствии доменов

#### Техническое
- `InboxItem.domainHintId` — Capture-подсказка домена (hint, не финальный route); нормализация в `addInboxLines` и строгая валидация в `updateInboxItem`
- Все persisted-изменения по-прежнему через Core-команды (`inbox.update`): авто-reviewed, processed для Thought/Note, discarded, domainHintId
- UI-черновики (routing draft, capture hints, session defaults, batch selection) остаются ephemeral и не пишутся в storage
- Focused regression tests: `tests/processing-b2.mjs`, `tests/processing-b2-product.mjs` (restore to review, batch без дублей, sourceInboxId/resultRef, ошибка batch не портит очередь, domainHintId-валидация)
- `docs/ROADMAP_REVIVAL.md` приведён к фактическому состоянию (0.9.x завершено; 0.10.x активно: B0/B1 завершены, B2 текущий; Sync/Today/Smart Processing/Native/Map/Full Sync/Intelligence как следующие линии; завершённые старые пункты отмечены)
- **Версия**: `0.10.0-alpha.3`; PWA cache `atlas-capture-0.10.0-alpha.3`

#### Ограничения (осознанно)
- Отдельные сущности Note/Thought не проектируются: Мысль/Заметка помечаются processed, исходная запись сохраняется
- AI-классификация, Auto Processing, Sync и прочие направления не начинались

---

## 0.10.0-alpha.2 - 2026-08-18

### Stage B1 — Processing Routing

#### Добавлено
- **Маршрутизация Task**: для записи с типом «Задача» в карточке Processing Center — выбор Domain → Project (фильтруется по домену) → Priority (Низкий / Обычный / Высокий / Критичный) → Due (дата + опциональное время) → «Создать задачу»; без отдельной формы
- **Безопасный Inbox → Task**: исходная запись не уничтожается, получает `status: processed` и `resultRef: { type: 'task', id }`; Task хранит `sourceInboxId` — двусторонняя восстанавливаемая связь; `rawText` неизменен
- **Повторная обработка**: разобранная карточка показывает «Разобрана → Задача: …» с Domain/Project, приоритетом и сроком; действия [Открыть задачу] [Вернуть в разбор]; повторное создание Task из того же результата блокируется
- **Вернуть в разбор**: удаляет связанную Task (только если `task.sourceInboxId` совпадает), снимает `resultRef`, возвращает запись в `reviewed`
- **Очередь разбора**: фильтры Новые | В работе | Разобранные | Все (по `new / reviewed / processed+discarded`), счётчик «Осталось разобрать», дефолтный акцент на неразобранных
- **Linked Result UX**: кнопка «Открыть задачу» открывает Task в существующем Inspector; пометка «Источник: Входящие» в Inspector задачи

#### Техническое
- Новая Core-команда `inbox.route_to_task` (атомарная: Task + Inbox status + двусторонняя связь в одной операции) и `inbox.route_revert`
- `Task.due` — структурированное `{ date: 'YYYY-MM-DD', time: 'HH:MM' | null } | null` (не в тексте задачи); приоритет — существующая шкала 1..4
- Деструктивная кнопка «В задачу» (`inbox.convert_to_task`) заменена на routing flow в UI; команда пока оставлена для обратной совместимости
- Focused regression tests: `tests/processing-b1.mjs` (routing, двусторонние ссылки, блок повторного создания, revert, rollback при save failure)
- **Версия**: `0.10.0-alpha.2`; PWA cache `atlas-capture-0.10.0-alpha.2`

#### Ограничения (осознанно)
- Thought / Note не превращаются в Task и не имеют routing-контролов (только тип + статус); отдельные сущности Note/Thought не проектируются
- «Открыть задачу» открывает Inspector, но не центрирует карту на задаче
- Универсальный Undo framework не строится — только обратимость конкретного routing flow

---

## 0.10.0-alpha.1 - 2026-08-18

### Stage B0 — Processing Center Foundation

#### Добавлено
- **Редактирование Inbox-записи**: правка текста через Core command; `rawText` остаётся оригиналом захвата и не перезаписывается (явный guard в команде)
- **Подтверждённый тип `itemType`**: отделён от Capture-подсказки `userHint`; закрытый набор `task | thought | note | null`, по умолчанию `null`
- **Processing state**: используются существующие `new | reviewed | processed | discarded` — без параллельной системы статусов
- **Processing UI (карточный разбор)**: каждая запись — открыть / отредактировать (inline, с сохранением черновика правки при возврате) / выбрать тип (Задача / Мысль / Заметка / Без типа) / отметить статус; без большой формы
- **Дата и время**: сегодняшние записи — время, старые — дата + время; маркер «изм.» по `updatedAt`
- **Визуальное различие типов**: label + icon + accent (Задача / Мысль / Заметка), компактно, без redesign

#### Техническое
- Новая Core-команда `inbox.update` (edit / itemType / status): атомарная, одна операция `inbox.update` в operation log с `before/after`, no-op не плодит операции
- Нормализация `itemType`/`status` на чтении (`getInboxItems`) — старые записи без полей читаются как `itemType: null`, `status: new`; миграции не требуются
- **Строгая write-валидация `itemType`**: `inbox.update` принимает только `task | thought | note | null` — неизвестное значение бросает ошибку и не меняет запись (чтение legacy остаётся lenient)
- `rawText`-инвариант: команда отклоняет попытки записи в `rawText`
- Focused regression tests: `tests/processing-b0.mjs` (edit/rawText, itemType normalization, old compat, processing status, atomic rollback, operation log)

#### Follow-up (зафиксировано, не в этом PR)
- **Reversible Processing flow**: текущий `inbox.convert_to_task` деструктивен (запись удаляется, без Undo и ссылки на источник) — безопасный обратимый конверсионный поток спроектирован отдельно в `docs/PROCESSING_B0_FOLLOWUP.md`

#### Изменено
- **Версия**: обновлена до `0.10.0-alpha.1`
- **PWA cache**: `atlas-capture-0.10.0-alpha.1`

---

## 0.9.0-alpha.3 - 2026-08-16

### Добавлено
- **Voice controller**: модульная state machine для browser speech с понятными состояниями и ошибками
- **Microphone UX**: проверка permission перед каждой сессией, одноразовое объяснение Atlas и denied-инструкция
- **Capture provenance**: `entryPoint` для обычного запуска, Android Share и manifest shortcut
- **Диагностика**: статусы Voice, Microphone, Storage, сети и Service Worker

### Исправлено
- **Надёжность черновика**: единый немедленный flush при final voice result, background, pagehide, обновлении SW и ошибке сохранения
- **Точность текста**: черновик сохраняет исходные пробелы и переносы строк; final transcript не дублируется
- **Совместимость**: старые черновики и Inbox-записи без `entryPoint` безопасно получают значение `app`

### Изменено
- **Версия**: обновлена до `0.9.0-alpha.3`
- **PWA cache**: новый voice-модуль включён в полный offline import graph

---

## 0.9.0-alpha.2 - 2026-08-06

### Добавлено
- **PWA установка**: Atlas Capture устанавливается на главный экран Android
- **Офлайн-режим**: приложение работает без сети, записи сохраняются локально
- **Share Target**: получение текста и ссылок из других Android-приложений через «Поделиться»
- **Обновление приложения**: ненавязчивое уведомление о новом service worker
- **Информационная панель**: версия, статус онлайн/офлайн, состояние service worker
- **Ярлыки**: «Новая запись» и «Входящие» из меню приложения

### Изменено
- **Структура**: Capture перенесён в `capture/` с собственным `index.html`, `manifest.webmanifest`, `sw.js`
- **Версия**: обновлена до 0.9.0-alpha.2

---

## 0.9.0-alpha.1 - 2026-08-05

### Добавлено
- **Atlas Capture**: автономный мобильный интерфейс захвата
- **Текстовый захват**: быстрое сохранение мыслей в локальный Inbox
- **Голосовой ввод**: распознавание речи средствами браузера (ru-RU)
- **Подсказки типа**: Задача, Мысль, Заметка (необязательный выбор)
- **Многострочная запись**: сохранение длинного текста как единого объекта
- **Список входящих**: просмотр и удаление записей с Undo
- **Единый модуль версии**: `js/version.js` для desktop и mobile
- **Восстановление черновика**: незавершённый текст сохраняется локально и восстанавливается при reload
- **Раскрытие карточек**: длинные записи раскрываются по нажатию

### Изменено
- **Модель Inbox**: расширена поддержкой полей rawText, inputType, source, status, userHint, deviceId
- **Обратная совместимость**: старые вызовы captureInbox(text) работают без изменений

### Техническое
- Начата revival alpha-линия версий
- Mobile Capture использует общий storageAdapter и localStorage key
- Desktop index.html обновлён для использования js/version.js

---

## Atlas_of_life_v0.2.7.5 - 2025-09-09

### Улучшения интерфейса
- **Компактный header**: Уменьшены отступы и размеры кнопок для экономии места
- **Градиентный логотип**: Добавлен красивый градиент для названия приложения
- **Улучшенные статусы**: Статусы задач теперь с подсветкой и подсказками
- **Анимированное поле ввода**: Поле быстрого добавления с эффектами фокуса

### Исправлено
- **Версия приложения**: Исправлено отображение версии v0.2.7.5 в интерфейсе
- **Перенос текста**: Исправлен перенос текста в статусах (например, "в работе")
- **Кэширование**: Добавлены скрипты для принудительного обновления кэша

### Техническое
- Улучшена система обновления timestamp для обхода кэша браузера
- Оптимизированы CSS стили для более компактного отображения
- Исправлена логика отображения версии в модальном окне "О версии"

---

## Atlas_of_life_v0.2.7 - 2025-09-09

### Исправлено
- **DnD баги**: Независимые задачи теперь прикрепляются к домену при перетаскивании внутрь
- **Инспектор**: Исправлено отображение домена для всех задач
- **Привязка к проекту**: Добавлена корректная установка domainId при привязке задач к проектам
- **fitActiveProject()**: Полностью переписана сломанная функция подгонки вида к проекту
- **Обработка ошибок**: Улучшена обработка ошибок в операциях перетаскивания

### Техническое
- Консолидация логики confirmDetach() в единую реализацию
- Исправление CSS селекторов и классов toast
- Глобальное экспонирование функций для кросс-модульного доступа

---

## Atlas_of_life_v0.2.6 - 2025-09-06

### Добавлено
- Миграции хранилища (SCHEMA_VERSION + MIGRATIONS).
- Слой адаптеров хранилища (localStorageAdapter); заглушка IndexedDB.
- Локальный логгер аналитики (последние 100 событий в Local Storage).
- Inbox: автодополнение #/@.
- Today: бейдж срока и сортировка (срок → приоритет → updatedAt).
- Карта: двойной клик — fit проекта.

### Изменено
- Перерисовка карты сглажена (throttle); отсечение объектов вне области видимости.
- Тема через CSS‑переменные и переключатель (сохранение состояния).

### Исправлено
- Удалены «мертвые» ветви в раскладке карты.
- Убраны предупреждения о встроенных стилях (fileImport/viewToday/modal/toast/zoom slider).

## Atlas_of_life_v0.2.5 - 2025-09-04

Добавлено/изменено

- Новый алгоритм размещения задач внутри проектов: задачи группируются по кольцам, равномерно распределяются по окружности, что исключает пересечения.
- Динамический расчет радиусов проектов в зависимости от количества задач.
- Магнитное поведение при перетаскивании задачи внутрь проекта: задача примагничивается к краю круга.
- Возможность вытаскивать задачи из проекта с подтверждением пользователя.
- Исправлены синтаксические ошибки и дублирующиеся блоки кода, влияющие на отображение карты.

## Atlas_of_life_v0.2.4 - 2025-09-04 13:26

Добавлено/изменено

- Единая русская терминология в UI: легенда статусов в шапке — «план / сегодня / в работе / готово» (вместо backlog/today/doing/done).
- Переводы элементов в хедере: «Свечение» вместо Glow; «Подогнать домен/проект» вместо Fit.

## Atlas_of_life_v0.2.3 - 2025-09-04 13:20

Добавлено

- Сохранение пользовательских переключателей и вида: `Связи/Давность/Свечение` и активный `вид` (карта/сегодня) сохраняются в storage и восстанавливаются при запуске.
- Today/Inspector: отметка задач чекбоксом и «в Today» теперь сохраняются (добавлен saveState).

Изменено

- Удалены дубли CSS правил `.domenu`.
- Старые функции контекстного меню помечены как устаревшие (не используются), чтобы не мешать навигации в коде.

## Atlas_of_life_v0.2.2 - 2025-09-04 03:03

Добавлено

- Скрипт авто‑бампа версии: `tools/bump-version.ps1` — обновляет `CHANGELOG.md` и `js/app.js`.

Изменено

- Заголовок релиза содержит дату и время: `YYYY-MM-DD HH:mm`.
- Скрипт теперь вставляет НОВУЮ секцию релиза вверху, сохраняя историю (не перезаписывает предыдущую).

Добавлено

- CRUD доменов: создать, переименовать, изменить цвет (палитра), слить с…, удалить (перенос проектов / удаление вместе с задачами). Контекстное меню (⋯ / ПКМ).
- Fit/Focus: кнопки и хоткеи; двойной клик по домену — фокус.
- Кнопка «О версии»: модалка с номером версии и ссылкой на CHANGELOG; авто‑подхват версии из CHANGELOG.

Изменено

- Карта: зум к курсору, константная скорость панорамирования, единая матрица трансформации.
- Фильтры: домен/тег влияют на видимые узлы и рёбра.
- Размещение задач: «золотой угол», меньше наложений.
- Связи: адаптивная кривизна Безье (длинные — прямее).

Производительность

- Динамический cap рёбер + Glow с гистерезисом, FPS‑оверлей (Ctrl+Shift+F).

I18N/UX

- Очищены русские строки; улучшена читаемость ссылок в модалках.

Быстрый ввод

- RU‑парсер для #/@/~ p1..p4 и !сегодня/завтра/через N мин/ч, дни недели.

## Atlas_of_life_v0.2.1 - 2025-09-04 02:41

- Полировка доменов и навигации карты: мягкие подсказки при создании/переименовании, мгновенный пересчёт счётчиков, плавный Fit/Focus с ограничением масштаба, палитра цвета с немедленным применением, безопасное удаление/слияние доменов и тосты со сводкой переносов/удалений.

## Atlas_of_life_v0.1.0 — 2025‑08‑XX

Первый релиз (MVP)

- Карта, экран «Сегодня», экспорт/импорт JSON, демо‑данные.

## [Unreleased]

### Added
- Storage migrations and adapter layer.
- Light/dark theme via CSS variables and toggle.
- Local analytics (ring buffer in localStorage).
- Map: dbl-click project to fit bbox.
- Map: viewport culling of tasks/links.
- Inbox autocomplete (#/@), Today sorting + due badge, .ics export.

### Changed
- Throttled redraws on wheel/drag.
- Minor CSS variable refinements.

### Fixed
- Removed dead branches in map code.
- Reduced potential lag spikes on interactions.
