# Atlas of Life — технический аудит возрождённой архитектуры

Дата аудита: 3 августа 2026 года  
Ветка: `revival-preparation`  
Контрольная точка: `1b188d0`  
Область проверки: Atlas Core, локальное хранение, Inbox, Studio UI, add-ons, готовность к Snapshot Store, Undo, Mobile/PWA и будущей синхронизации.

## 1. Executive Summary

Архитектурное направление выбрано верно: компактная модель `Domain → Project → Task`, независимые задачи `Domain → Task`, общий командный слой и отдельный мобильный Capture лучше соответствуют продукту, чем перенос поздней экспериментальной архитектуры из `origin/main`.

Текущая реализация является хорошим прототипом ядра, но пока не готова к доверию реальных пользовательских данных, Android Capture и синхронизации. Главный блокер — отсутствие атомарной границы между изменением памяти и долговременной записью. Команда может изменить `state`, добавить операцию и вернуть сущность как успешный результат после того, как `localStorage.setItem()` завершился ошибкой.

Второй блокер — загрузка не различает пустое, повреждённое и несовместимое состояние. При повреждённом JSON Studio показывает демо-данные как обычный Атлас. Немедленной перезаписи при старте нет, но первая пользовательская команда сохраняет демо-набор поверх повреждённого значения.

Третий системный риск — Atlas Core пока не является единственной точкой записи. Активные операции над доменами и проектами в `app.js` и `view_map.js`, а также подключённый `addons/today-plus.js`, меняют сущности напрямую. Поэтому журнал неполон даже до достижения лимита 1000 операций. Полное воспроизведение состояния из текущего `operationLog` невозможно.

Также подтверждены:

- отсутствие snapshots и транзакционного восстановления импорта;
- физическое уничтожение исходной записи Inbox после преобразования;
- использование `updatedAt` как `baseVersion`;
- нарушение инвариантов задачи через `task.update`;
- неполный Undo переноса проекта;
- несколько подтверждённых DOM XSS sinks с пользовательскими и импортированными значениями;
- зависимость storage от Studio render-функций;
- неполный глобальный контракт `window.mapApi`;
- desktop-only entry point, который всегда загружает карту, инспектор, add-ons и Experiments.

Рекомендуемый вывод: не начинать PWA, voice и sync до PR 1–10. Первый согласуемый PR — `fix/storage-fail-fast`. До его принятия импорт, миграции и каскадное удаление домена следует считать опасными операциями и выполнять только после ручного JSON-экспорта.

## 2. Проверенная архитектура

### 2.1. Фактический поток данных

Текущий основной поток:

```text
Studio UI
  → функция из js/core/commands.js
  → мутация глобального state
  → appendOperation()
  → saveState()
  → storageAdapter.save()
  → localStorage
  → вызовы Studio render-функций из storage
```

Фактические исключения:

```text
app.js / view_map.js / активные add-ons
  → прямая мутация state
  → иногда saveState(), иногда без сохранения
  → операция может отсутствовать
```

### 2.2. Что уже сделано хорошо

- `js/core/commands.js` объединяет захват Inbox, базовые действия с задачами, создание проекта и продвижение задачи в проект.
- `js/core/operations.js` создаёт снимок `payload`, поэтому последующая мутация сущности не меняет уже созданную операцию.
- `js/core/device.js` отделяет идентичность устройства от пользовательского экспорта.
- `moveTask()` централизует перенос задачи и удаляет `domainId` у проектной задачи.
- `task.promote_to_project` описан одной операцией и может стать хорошим образцом составной транзакции.
- `js/features/inbox/view.js` выводит пользовательский текст через `textContent`.
- `_type` удаляется на storage boundary; это покрыто `tests/storage-boundary.mjs`.
- `tools/verify-baseline.ps1` проверяет обязательные файлы, синтаксис всех активных JS и запускает regression-тесты.

### 2.3. Текущая модель

Поддерживаются две формы:

```text
Domain → Project → Task
Domain → independent Task
```

Возвращать универсальный `parentId` не следует. Текущая явная модель проще для валидации, восстановления, Undo и будущего обмена.

### 2.4. Покрытие командным слоем

Через команды проходят:

- `inbox.capture`, `inbox.delete`, `inbox.restore`, `inbox.convert_to_task`;
- `task.create`, `task.update`, `task.move`, `task.move.undo`, `task.delete`;
- `project.create`;
- `task.promote_to_project`.

Не проходят полностью:

- создание, переименование, перекраска, слияние и удаление домена;
- каскадное удаление проектов и задач;
- перенос проекта между доменами и изменение его позиции;
- редактирование задачи в активном `Сегодня+`;
- публичный helper `Atlas.renameTask`.

### 2.5. Версионирование

Версия сейчас продублирована:

- `js/app.js:42–43`;
- `index.html:12, 14, 19, 101`.

Для новой серии рекомендуется стандартный SemVer:

```js
// js/version.js
export const APP_VERSION = '0.9.0-alpha.1';
export const BUILD_COMMIT = '1b188d0';
```

Отображение:

```text
Atlas of Life 0.9.0-alpha.1
commit 1b188d0
```

Версию в рамках аудита не изменять.

## 3. Критические риски

### R1. Ложный успех при провале долговременного сохранения

- **Severity:** Critical.
- **Evidence:** `js/core/commands.js:13–15` (`finish`), `js/core/commands.js:127–150` (`createTask` и аналогичные команды), `js/storage.js:156–193` (`saveState`), `js/storageAdapter.js:10–20` (`save`).
- **Сценарий:** команда меняет массивы в памяти, добавляет операцию, `localStorage.setItem()` получает `QuotaExceededError`, адаптер проглатывает ошибку, команда возвращает созданную сущность. UI обновляется и показывает успех. После перезапуска изменение исчезает.
- **Проверка:** при искусственном исключении `setItem()` `createTask()` вернул сущность; в памяти остались 1 задача и 1 операция; durable copy не создана.
- **Исправление:** `storageAdapter.save()` должен возвращать подтверждённый результат или бросать типизированную ошибку. `saveState()` не должен скрывать ошибку. Команда должна выполняться через транзакционный executor: подготовить изменения и операцию, записать единый state envelope, затем опубликовать изменения и event. В переходном варианте executor хранит `before`, а при ошибке восстанавливает сущности и удаляет добавленную операцию.
- **Контракт:**

  ```js
  { ok: true, value, operation, changes }
  { ok: false, error, stateChanged: false }
  ```

- **Где rollback:** внутри `executeCommand()`/транзакционной границы Core, а не в UI, storage adapter или отдельной команде.
- **Размер:** M.
- **Зависимости:** первая работа; snapshots не являются заменой атомарности.

### R2. Повреждённое состояние маскируется демо-данными

- **Severity:** Critical.
- **Evidence:** `js/storageAdapter.js:7–8` превращает ошибку чтения в `null`; `js/storage.js:103–153` возвращает `false` для отсутствия значения, JSON error, migration error и невалидной структуры; `js/app.js:1052–1055` вызывает `initDemoData()` для любого `false`.
- **Сценарий:** пользователь открывает приложение с повреждённым JSON, видит правдоподобный демо-Атлас и не понимает, что загрузка не удалась. Исходное повреждённое значение сохраняется только до первой команды. Первая команда вызывает `saveState()` и перезаписывает его schema 4 демо-набором.
- **Проверка:** `loadState()` вернул `false`; в UI-состоянии появились домены «Дом» и «Дача»; исходный raw оставался повреждённым до первой команды; после неё storage содержал schema 4, два демо-домена и семь задач.
- **Исправление:** загрузка должна работать с временным объектом и возвращать discriminated result:

  ```js
  { status: 'empty' }
  { status: 'loaded', state, migrated }
  { status: 'corrupt', raw, error, stage }
  { status: 'unsupported', raw, schemaVersion }
  ```

  При `corrupt` не публиковать демо-состояние и не разрешать обычную запись.
- **Recovery Mode:** сохранить raw без изменений; показать ошибку и этап; дать скачать raw; показать валидные snapshots; разрешить повторить миграцию; пустой Атлас или сброс — только после явного подтверждения.
- **Размер:** M.
- **Зависимости:** R1; Snapshot Store расширит Recovery Mode, но базовая защита нужна раньше.

### R3. Импорт неатомарен и не имеет preflight snapshot

- **Severity:** Critical.
- **Evidence:** `js/storage.js:226–254` и `259–297`: импорт сначала присваивает коллекции глобальному `state`, затем вызывает `saveState()`, который не сообщает о провале, после чего Promise разрешается как `true`.
- **Сценарий:** импорт прошёл поверх текущего Атласа, запись нового состояния не удалась, вкладка показывает импортированные данные, а перезапуск возвращает старые. При частичной ошибке присваивания состояние может остаться смешанным. Предыдущего автоматического снимка нет.
- **Исправление:** parse → migrate → deep validate во временном объекте → snapshot `before-import` → атомарная durable запись → read-back verification → publish state. При любой ошибке текущий state и storage не изменяются.
- **Размер:** M.
- **Зависимости:** R1, Recovery Mode и Snapshot Store.

### R4. Журнал нельзя использовать для полного replay

- **Severity:** High.
- **Evidence:** `js/core/operations.js:4, 40–44` удаляет старейшие операции после 1000; `js/storage.js:10–26` повторно обрезает журнал; нет sequence/checkpoint/reducer; прямые мутации из таблицы ниже не создают операций.
- **Сценарий:** у состояния 1200 изменений. Первые create/move/delete удалены, а оставшиеся операции ссылаются на отсутствующие сущности. Восстановление на пустом state невозможно. Даже до лимита журнал неполон из-за прямых мутаций.
- **Вывод:** требование roadmap «воспроизвести журнал на пустом состоянии» сейчас не выполнено и не может быть выполнено текущим массивом.
- **Исправление:** модель `checkpoint snapshot + operations after checkpoint`, глобальный для данного `stateId` монотонный `localSequence`, явный `checkpointSequence`.
- **Безопасная компактация:**

  1. дождаться успешного durable сохранения state;
  2. создать snapshot с checksum на sequence N;
  3. перечитать и проверить snapshot;
  4. пометить его checkpoint;
  5. удалять только операции `sequence <= N`;
  6. сохранить минимум один предыдущий проверенный checkpoint;
  7. не удалять pending sync операции без подтверждения;
  8. протестировать replay `checkpoint + tail` до удаления старого журнала.

- **Размер:** L.
- **Зависимости:** snapshots, полный command coverage, стабильная operation schema, revisions.

### R5. `baseVersion` является временем, а не версией

- **Severity:** High.
- **Evidence:** `js/core/commands.js:185`, `217`, `254`, `313` и Inbox-команды используют `updatedAt`; в сущностях и `state` нет `revision`.
- **Сценарий:** два устройства меняют сущность с одинаковым millisecond timestamp, часы расходятся или пользователь меняет системное время. Нельзя однозначно установить число изменений и отличить последовательное изменение от конкурентного.
- **Исправление:** каждая сущность получает integer `revision`; операция содержит `baseRevision` и `resultRevision`. `updatedAt` остаётся пользовательским временем. Для multi-entity команды revisions входят в каждый `change`.
- **Ограничение:** integer revision обнаруживает конфликт, но сам по себе не разрешает конкурентные изменения с разных устройств; протокол sync должен отдельно выбрать политику.
- **Размер:** M.
- **Зависимости:** формальные инварианты и executor; до sync.

### R6. Atlas Core не является единственной точкой записи

- **Severity:** High.
- **Evidence:** активные мутации перечислены в разделе 5. Основные места: `js/app.js:201–278, 562–715`; `js/view_map.js:1265–1282, 1388–1417, 1467–1485`; `addons/today-plus.js:166–217`; `addons/inspector-plus.js:4–12`.
- **Сценарий:** сущность меняется без операции, Undo и revision. `Сегодня+` даже не вызывает `saveState()`: изменение видно в overlay, но может исчезнуть после reload; либо случайно сохраниться позже вместе с несвязанной командой.
- **Исправление:** сначала закрыть активные task bypasses, затем добавить domain/project commands и перевести только активные обработчики. Legacy-код инвентаризировать до удаления.
- **Размер:** L несколькими PR.
- **Зависимости:** R1 и invariants.

### R7. Исходная запись Inbox физически уничтожается

- **Severity:** High.
- **Evidence:** `js/features/inbox/model.js:33–38, 50–68`; `js/core/commands.js:110–124`. Исходник после conversion остаётся только в operation payload, который ограничен 1000 записями.
- **Сценарий:** голосовой transcript неверно интерпретирован и превращён в задачу. Через время операция обрезана; исходную формулировку и provenance восстановить невозможно.
- **Исправление:** не удалять capture record, а менять статус:

  ```js
  {
    id,
    rawText,
    status: 'new' | 'processed' | 'discarded',
    createdAt,
    updatedAt,
    processedAt,
    resultRefs: [{ type: 'task', id: '...' }],
    source: { kind: 'text' | 'voice', deviceId }
  }
  ```

  Рабочий Inbox фильтрует `status === 'new'`; хранение provenance не зависит от operationLog.
- **Размер:** M.
- **Зависимости:** schema migration, snapshots до миграции, Undo conversion.

### R8. Пользовательский текст попадает в `innerHTML` без экранирования

- **Severity:** High.
- **Evidence:**
  - Today: `js/view_today.js:14–21`;
  - Inspector: `js/inspector.js:64–81, 96–116, 173–209`;
  - Sidebar и domain dialogs: `js/app.js:134–159, 345–356, 562–569, 621–626, 661–670`;
  - map tooltip и move modal: `js/view_map.js:1115–1133, 1658–1669`;
  - autocomplete: `addons/autocomplete.js:89–121`;
  - `statusPill()` возвращает HTML с невалидированным fallback: `js/state.js:77–80`.
- **Безопасное место:** `js/features/inbox/view.js:124–179` создаёт элементы и использует `textContent`.
- **Сценарий:** title/tag из ручного ввода или JSON-импорта содержит HTML/event attribute. При открытии Today, Inspector, Sidebar или tooltip браузер создаёт активный DOM. После voice/sync число недоверенных источников увеличится.
- **Исправление:** по умолчанию DOM API + `textContent`; для небольших полностью контролируемых static templates допустима одна протестированная `escapeHtml()`. ID, color и значения атрибутов тоже валидировать, а не только экранировать.
- **Размер:** M.
- **Зависимости:** независимый security PR допустим сразу после data-safety PR; нужен regression-тест опасных строк.

### R9. `task.update` и создание сущностей могут нарушить ссылки

- **Severity:** High.
- **Evidence:** `js/core/commands.js:127–150` не проверяет существование входного `projectId/domainId`; `createProject()` на `261–280` не проверяет домен; `updateTask()` на `167–179` независимо применяет `projectId` и `domainId`.
- **Сценарии:**
  - `updateTask(id, { projectId: null })` оставляет задачу без гарантированного `domainId`;
  - `updateTask(id, { domainId: 'd2' })` может добавить `domainId` проектной задаче;
  - неизвестные ID создают orphan;
  - tolerant import чинит часть independent tasks молча и может скрыть исходную ошибку.
- **Исправление:** отдельный placement value/helper и централизованный validator. Изменение placement — только специальной командой `moveTask`; обычный `updateTask` не принимает `projectId/domainId`.
- **Размер:** M.
- **Зависимости:** schema/validator module; snapshots перед миграцией.

### R10. Undo переноса проекта неполон

- **Severity:** High.
- **Evidence:** `js/view_map.js:1181–1188` сохраняет `fromDomainId`; `1408–1415` кладёт его в undo item; `undoLastMove()` на `1477–1484` восстанавливает только `fromPos`, но не `fromDomainId`.
- **Сценарий:** проект перетащили в другой домен и нажали Ctrl+Z. Координаты восстановились, принадлежность домену — нет; UI сообщает «Отменено».
- **Исправление:** до Universal Undo — project move command с полным inverse. Не расширять локальный UI stack как конечную архитектуру.
- **Размер:** S после project commands.
- **Зависимости:** revisions и project.move command.

## 4. Риски средней важности

| ID | Severity | Evidence | Сценарий | Исправление | Размер | Зависимость |
|---|---|---|---|---|---|---|
| M1 Storage связан с Studio UI | Medium | `js/storage.js:178–186` | Storage вызывает map/sidebar/Today; callers повторяют draw/render (`app.js:1043–1046`, `inspector.js:222–255`, Inbox callback `app.js:1063–1070`). Возможны лишние render и невозможность чисто использовать Core в Capture. | Storage возвращает результат; executor публикует change descriptor/event; каждый entry point сам решает, что обновлять. | M | R1 |
| M2 Причина старых фризов не доказана | Medium | Дублирование render подтверждено, profile отсутствует | Лишние draw могут усугублять фризы, но причинность не измерена. | После разделения добавить performance marks и сценарий 1k/10k задач. | S | M1 |
| M3 Неполный `window.mapApi` | Medium | Inspector ожидает `refresh` (`js/inspector.js:16–18`), storage ожидает `layoutMap` (`js/storage.js:180`), но active exports `js/view_map.js:1595–1622` их не содержат | Создание проекта/задачи может draw старый layout; вызов выглядит успешным, но новая нода появляется позже. | Убрать глобальный API через явные UI adapters/events; до этого контрактный test. | S/M | storage/UI separation |
| M4 Shallow load validation | Medium | `js/storage.js:116–139` проверяет только truthy collections | Строка вместо массива, orphan links, duplicate IDs, неизвестный status или future schema приводят к частичному состоянию/падению UI. | Pure `validateState()` с error list; загрузка только после полной проверки; future schema → `unsupported`. | M | core schema |
| M5 Retention snapshots ещё не подтверждён реальными объёмами | Medium | Snapshot Store отсутствует; byteSize пользовательских Атласов не измерялся | Слишком агрессивная политика удалит полезную историю, слишком щедрая упрётся в browser quota. | Начать с политики раздела 7, сохранять byteSize и проверять её на реальных обезличенных размерах. | S после Snapshot Store | Snapshot Store |
| M6 Отсутствуют tombstones | Medium | Delete использует `splice/filter`: `commands.js:246–258`, `app.js:690–706` | Undo и sync не отличают удаление от «никогда не существовало»; каскад трудно восстановить. | `archivedAt/deletedAt`, physical purge отдельной обслуживающей операцией после retention. | M | data model |
| M7 Схема и версия размазаны | Medium | `SCHEMA_VERSION` локален в `storage.js:7`; operation limit дублируется в `storage.js:8` и `operations.js:4`; UI version в нескольких местах | Миграция, экспорт и UI могут расходиться. | `js/core/schema.js`, `js/version.js`, один источник лимитов. | S | PR core-invariants |
| M8 Snapshot payload operation может стать `null` молча | Medium | `js/core/operations.js:11–17` проглатывает serialization error | Операция существует, но не содержит данных для Undo/replay. | Не создавать операцию при невозможности сериализации; ошибка отменяет команду. | S | R1 |
| M9 Слабая генерация некоторых ID | Low | fallback в `device.js:4–7`, Inbox `model.js:8–9`, domain `app.js:213,261` | При высокой конкуренции/одинаковом времени возможны collision; domain ID не использует UUID. | Единый `createId(kind)` на `crypto.randomUUID`, fallback тестируется. | S | core schema |
| M10 Add-ons являются частью runtime без capability boundary | Medium | `index.html:102–111` всегда загружает Experiments и add-ons | Capture случайно унаследует desktop global scripts; add-on может обходить команды. | Инвентаризация, явный desktop registry и запрет загрузки в `capture.html`. | M | mobile boundary |
| M11 Демо не является явным onboarding mode | Medium | `app.js:1052–1055`, `state.js:20–38` | Новый пользователь не отличает временную демонстрацию от созданного Атласа; первая команда сохраняет весь demo. | `empty` экран с кнопками «Создать пустой Атлас» / «Открыть демо»; demo имеет отдельный transient state. | S | Recovery Mode |

## 5. Таблица прямых мутаций state

### 5.1. Активные пользовательские пути

| Действие | Файл/функция | Прямая мутация | Есть операция | Есть Undo | Риск |
|---|---|---|---|---|---|
| Создать домен кнопкой | `js/app.js`, `renderSidebar`, `btnSave.onclick`, 248–278 | `state.domains.push` | Нет | Нет | High |
| Создать домен Enter | `js/app.js`, local `createDomain`, 201–229, 280–284 | `state.domains.push` | Нет | Нет | High; дублированный активный путь |
| Переименовать домен | `js/app.js`, `openDomainMenuX`, 562–597 | `d.title`, `d.updatedAt` | Нет | Нет | High |
| Изменить цвет домена | `js/app.js`, `openDomainMenuX`, 599–613 | `d.color`, `d.updatedAt` | Нет | Нет | Medium |
| Слить домены | `js/app.js`, `openDomainMenuX`, 615–653 | `p.domainId`, filter `domains` | Нет | Нет | High; каскад |
| Удалить домен с переносом | `js/app.js`, `openDomainMenuX`, 655–715 | `p.domainId`, filter `domains` | Нет | Нет | Critical до snapshots |
| Удалить домен с проектами/задачами | там же, 690–706 | filter `tasks/projects/domains` | Нет | Нет | Critical; физический каскад |
| Перенести проект между доменами | `js/view_map.js`, mouseup, 1265–1282 | `p.domainId`, `p.updatedAt` | Нет | Частичный UI stack | High |
| Изменить позицию проекта | `js/view_map.js`, mouseup, 1388–1417 | `p.pos` | Нет | Частичный UI stack | Medium |
| Undo проекта | `js/view_map.js`, `undoLastMove`, 1477–1484 | `p.pos` | Нет | Неполный | High |
| Завершить/вернуть задачу в `Сегодня+` | `addons/today-plus.js`, checkbox, 166–173 | `real.status`, `updatedAt` | Нет | Нет | High; нет `saveState()` |
| Переименовать в `Сегодня+` | `addons/today-plus.js`, edit, 207–217 | `real.title`, `updatedAt` | Нет | Нет | High; нет `saveState()` |
| Публичный rename helper | `addons/inspector-plus.js`, `Atlas.renameTask`, 4–12 | `t.title`, `updatedAt` | Нет | Нет | Medium; загружен, текущих callers не найдено |
| Import | `js/storage.js`, `importJson*`, 226–297 | полная замена коллекций | Нет | Нет | Critical; boundary operation |
| Load/migration | `js/storage.js`, `loadState`, 103–153 | полная замена коллекций и repair | Нет | Нет | High; допустимо только как атомарная boundary |
| Demo fallback | `js/state.js`, `initDemoData`, 20–38 | замена 3 коллекций | Нет | Нет | High при corrupt flow |

### 5.2. Санкционированные мутации внутри Core

| Действие | Файл/функция | Прямая мутация | Есть операция | Есть Undo | Примечание |
|---|---|---|---|---|---|
| Inbox add/remove/restore/convert | `js/features/inbox/model.js:16–68` | push/splice/task push | При вызове через commands | Только delete restore | Model экспортируется публично и может быть вызван в обход command |
| Task create/update/move/delete | `js/core/commands.js:127–258` | push/assign/splice | Да | Только move | Это ожидаемое место мутации, но нет транзакционного executor |
| Project create | `js/core/commands.js:261–280` | push | Да | Нет | Нет проверки domainId |
| Promote task → project | `js/core/commands.js:283–321` | project push + task placement | Да, одна операция | Нет | Хороший кандидат для multi-change Undo |

### 5.3. Проверенные файлы без активного bypass

- `js/inspector.js` использует команды для create/update/delete/promote.
- `js/view_today.js` использует `updateTask()`.
- `js/features/inbox/view.js` использует Inbox-команды.
- Все подтверждаемые переносы задач в активном `js/view_map.js` используют `moveTask()`.

### 5.4. Legacy

`openDomainMenu_old()` и `domainActions_old()` в `js/app.js:379–529, 718–828`, а также `view_map.fixed.js`, `view_map.js.backup` и отключённый `addons/fixes-v0.2.6.js` содержат дополнительные прямые мутации. Они не входят в текущий active path. Их нельзя удалять до отдельной инвентаризации, но и нельзя использовать как источник для нового Core.

## 6. Предлагаемая модель данных

### 6.1. Инварианты Task

Ровно один вариант должен быть истинным:

```js
// A: задача проекта
task.projectId != null
project(task.projectId) exists and is not deleted
task.domainId is absent

// B: независимая задача
task.projectId == null
task.domainId != null
domain(task.domainId) exists and is not deleted
```

Дополнительные правила:

- `id` уникален внутри типа сущности и стабилен;
- `title` после trim не пуст;
- `status` входит в известный enum;
- `tags` — массив уникальных непустых строк;
- `createdAt <= updatedAt`;
- `revision` — целое число `>= 1`;
- обычный `task.update` не меняет placement;
- project всегда ссылается на существующий не удалённый domain.

### 6.2. Общие поля сущностей

```js
{
  id,
  revision,
  createdAt,
  updatedAt,
  archivedAt: null,
  deletedAt: null
}
```

`archivedAt` скрывает сущность из активной работы, сохраняя историю. `deletedAt` является tombstone для Undo/sync. Физическое удаление выполняется отдельной compact/purge процедурой только после retention и проверенного checkpoint.

### 6.3. State metadata

```js
{
  meta: {
    schemaVersion,
    stateId,
    createdAt,
    updatedAt,
    lastLocalSequence,
    lastSnapshotId
  },
  domains,
  projects,
  tasks,
  inbox,
  operationLog,
  settings
}
```

`stateId` отличает независимые Атласы. `lastLocalSequence` увеличивается один раз на атомарную команду. Для импорта с выбором «заменить Атлас» правила сохранения/смены `stateId` должны быть явными.

### 6.4. Operation

```js
{
  schema: 2,
  id,
  stateId,
  deviceId,
  localSequence,
  timestamp,
  type,
  undoOf: null,
  changes: [
    {
      entityType,
      entityId,
      baseRevision,
      resultRevision,
      before,
      after
    }
  ],
  syncStatus
}
```

Операция является immutable. `updatedAt` не участвует в optimistic concurrency.

### 6.5. Единый schema module

Вынести в `js/core/schema.js`:

- `SCHEMA_VERSION`;
- enums;
- validators и diagnostics;
- pure migrations registry;
- `validateTaskPlacement`;
- normalization rules;
- operation schema version.

Storage читает этот модуль, но schema module не импортирует storage или UI.

## 7. Snapshot Store

### 7.1. Границы модулей

```text
js/core/snapshots.js
  — правила создания, проверки, retention и restore orchestration

js/storage/indexeddb-snapshot-store.js
  — только IndexedDB CRUD

js/features/data-safety/view.js
  — Recovery/Snapshots UI для Studio
```

Активное состояние в первом этапе остаётся в `localStorage`. Переводить весь primary storage в IndexedDB в том же PR нельзя.

### 7.2. Формат snapshot

```js
{
  id,
  createdAt,
  reason,
  schemaVersion,
  appVersion,
  stateId,
  operationSequence,
  byteSize,
  checksum,        // SHA-256 от canonical serialized payload
  pinned,
  payload          // сериализованное полное состояние, без других snapshots
}
```

Причины:

- `manual`;
- `daily`;
- `before-import`;
- `before-migration`;
- `before-domain-delete`;
- `before-project-delete`;
- `before-restore`;
- `checkpoint`.

### 7.3. API

```js
createSnapshot(reason, options)
listSnapshots(options)
validateSnapshot(id)
restoreSnapshot(id, options)
deleteSnapshot(id)
pinSnapshot(id, pinned)
```

Рекомендуемые результаты:

```js
{ ok: true, snapshot }
{ ok: false, error, stage }
```

### 7.4. Retention

- 10 последних автоматических snapshots;
- до 3 pinned snapshots, не входящих в лимит 10;
- не более одного `daily` в календарный день и только если `lastLocalSequence` изменился;
- хранить последние 3 migration snapshots дольше обычных автоматических;
- всегда сохранять минимум один предыдущий валидный checkpoint;
- snapshots, на которые ссылается recovery/checkpoint, не удалять автоматической очисткой;
- удаление snapshot — отдельное действие с подтверждением для pinned.

### 7.5. Restore protocol

1. Прочитать snapshot во временный объект.
2. Проверить размер и checksum.
3. Распарсить payload.
4. Выполнить pure migrations во временном объекте.
5. Полностью валидировать entities, duplicate IDs, enums и ссылки.
6. Создать и проверить snapshot `before-restore` текущего состояния.
7. Выполнить атомарную durable запись нового state.
8. Перечитать primary storage.
9. Повторно проверить checksum/структуру и только затем опубликовать state/UI event.
10. При ошибке восстановить предыдущий durable state и вернуть Recovery Mode.

Snapshot считается созданным только после read-back validation.

## 8. Universal Undo

### 8.1. Целевой исполнитель

```js
executeCommand(command)
undoLastCommand()
redoLastCommand() // отдельный последующий этап
```

Команда возвращает:

```js
{
  ok: true,
  value,
  operation,
  inverseCommand,
  changes: [
    { entityType, entityId, before, after }
  ]
}
```

При ошибке:

```js
{
  ok: false,
  error,
  stateChanged: false
}
```

### 8.2. Правила

- Undo создаёт новую операцию; исходная запись не удаляется.
- `undoOf` ссылается на исходную operation.
- Каскад является одной транзакцией и одним пользовательским Undo.
- Перед Undo проверяется текущая `revision` каждой затронутой сущности.
- При несовпадении revision автоматический Undo запрещён; UI показывает конфликт и требует осознанного решения.
- `task.promote_to_project` одновременно удаляет созданный project/tombstone и возвращает исходное placement задачи.
- Domain delete/archive восстанавливает domain, projects и tasks одним действием.
- Inbox conversion возвращает capture record в `new` и удаляет/архивирует результат только если он не был изменён отдельно.
- In-memory undo stack не является источником истины; inverse строится из durable operation.

### 8.3. Очерёдность

1. `task.delete`;
2. `task.update`;
3. `project.delete/archive`;
4. `domain.delete/archive`;
5. `task.promote_to_project`;
6. `inbox.convert_to_task`;
7. project/task moves и остальные команды.

Текущий `task.move.undo` полезен как эксперимент, но не должен стать параллельной архитектурой.

## 9. Mobile/PWA boundaries

### 9.1. Почему текущий entry point не подходит

- `styles.css:21` задаёт `min-width: 600px`;
- `styles.css:30` и `index.html:50–73` строят desktop layout из трёх колонок;
- desktop header содержит карту, fit/center/fullscreen, legend, export/import и toggles;
- `js/app.js:4–14` импортирует `view_map.js` при любом запуске;
- используются `window.state`, `window.mapApi`, `window.renderSidebar`, `window.renderToday`;
- `index.html:102–111` всегда подключает Experiments и add-ons;
- Inbox — modal overlay поверх Studio, а не отдельный быстрый экран;
- storage вызывает Studio render-функции.

### 9.2. Отдельный entry point

```text
capture.html
js/capture/app.js
styles/capture.css
```

Capture импортирует:

- Atlas Core;
- storage/recovery boundary;
- Inbox commands/model;
- mobile Capture UI.

Capture не импортирует:

- `js/app.js`;
- `js/view_map.js`;
- `js/inspector.js`;
- desktop sidebar/header;
- `addons/*`;
- Experiments.

### 9.3. Этапы

**A. Mobile shell без PWA**

- один экран;
- поле raw capture;
- крупная кнопка записи;
- offline local save;
- очередь `new/processed`;
- Recovery state и явный индикатор сохранения.

**B. PWA**

- `manifest.webmanifest`;
- минимальный app shell service worker;
- offline launch;
- тест install/update на Android.

**C. Безопасное обновление**

- обнаружить waiting service worker;
- показать «Создать снимок и обновить»;
- создать и проверить snapshot;
- только затем активировать новую версию и reload;
- при migration error открыть Recovery Mode.

**D. Voice alpha**

```text
microphone
  → raw transcript
  → durable Inbox record
  → interpretation proposal
  → user confirmation
  → command
```

Текстовый fallback обязателен. Web Speech API может зависеть от браузера/сети; это нужно проверить на целевых Android-устройствах. До подтверждения не превращать transcript автоматически в задачи.

**E. Полевое испытание**

- 1–2 недели на реальном Android;
- метрики: время до capture, доля неудачных распознаваний, потерянные/дублированные записи, offline start, battery.

**F. PWA или Capacitor**

Решение принимается после испытания. Capacitor оправдан только если ограничения микрофона, background behavior, share target или уведомлений реально блокируют PWA.

## 10. Product differentiators

### 10.1. Объяснимая карта напряжения и внимания

Не абстрактный «AI score», а разложение по причинам:

- число aging commitments;
- overdue/due soon;
- WIP;
- запланированное и фактическое внимание;
- давно не пересматриваемые проекты.

Каждый цвет/сигнал должен отвечать на вопрос «почему это подсвечено?» и вести к конкретным сущностям.

### 10.2. Provenance: мысль → решение → действие

Сохранённая цепочка:

```text
raw Inbox / voice
  → интерпретация
  → Task
  → Project
  → Today
  → Done
```

Это отличает Atlas от обычного task list и позволяет возвращаться к исходному намерению, а не только к сформулированной задаче.

### 10.3. Недельный обзор баланса жизни

Обзор не просто перечисляет выполненное, а показывает:

- какие домены получали внимание 7/30 дней;
- где накопились aging commitments;
- какие обязательства переходят из недели в неделю;
- что пользователь сознательно откладывает/архивирует;
- 1–3 предлагаемых изменения на следующую неделю с объяснением.

### 10.4. Безопасная история траектории

Snapshots + operation history дают:

- сравнение состояния по неделям;
- безопасный эксперимент с планом;
- просмотр важных поворотов;
- восстановление после ошибочного массового действия;
- «что изменилось в моей жизни», а не только «какие задачи закрыты».

Фокус на одном домене является полезным режимом взаимодействия, но не отдельным главным differentiator: он поддерживает первые три возможности.

## 11. Рекомендуемый порядок PR

Каждый PR должен быть небольшим, отдельно проверяемым и не менять визуальный дизайн.

### 1. `fix/storage-fail-fast`

- **Цель:** подтверждённая durable запись или полный rollback без ложного успеха; закрыть прямые task writes в активном `Сегодня+`.
- **Файлы:** `js/storageAdapter.js`, `js/storage.js`, `js/core/commands.js`, небольшой transaction helper, `addons/today-plus.js`, `addons/inspector-plus.js`, новые tests.
- **Не менять:** schema shape, UI layout, domain flows, IndexedDB.
- **Тесты:** setItem/read-back failure, serialization failure, rollback entity + operationLog, success contract, add-on command use.
- **Manual smoke:** quick add, task edit/status, Inbox capture/convert, reload; затем искусственный storage failure с явной ошибкой и неизменённым UI/state.
- **Готово когда:** ни одна существующая Core-команда не сообщает success без durable copy; state и operationLog совпадают до/после failed command.
- **Откат:** один revert PR; schema не изменяется.

### 2. `feat/storage-recovery-mode`

- **Цель:** различать empty/loaded/corrupt/unsupported; не показывать demo при corrupt.
- **Файлы:** `js/storage.js`, startup orchestration в `js/app.js`, `js/features/data-safety/view.js`, tests/fixtures.
- **Не менять:** primary storage technology, user entity schema, дизайн карты.
- **Тесты:** empty, invalid JSON, migration throw, invalid structure, future schema, raw download.
- **Manual smoke:** чистый профиль; повреждённый JSON; запуск пустого Атласа только после подтверждения.
- **Готово когда:** corrupt raw не изменяется при старте и обычные команды заблокированы до решения Recovery Mode.
- **Откат:** revert UI/result contract вместе; перед merge сохранить совместимость чтения schema 4.

### 3. `feat/local-snapshot-store`

- **Цель:** изолированный IndexedDB Snapshot Store и manual snapshot.
- **Файлы:** `js/core/snapshots.js`, `js/storage/indexeddb-snapshot-store.js`, unit tests.
- **Не менять:** active state в localStorage, import/delete flows, service worker.
- **Тесты:** create/list/checksum/pin/delete/retention/read-back, unavailable IndexedDB.
- **Manual smoke:** создать 11 auto и 3 pinned snapshots; проверить retention и reload.
- **Готово когда:** snapshot можно создать, перечитать и валидировать независимо от primary storage.
- **Откат:** удалить новый store/modules; primary state не затронут.

### 4. `feat/preflight-snapshots`

- **Цель:** snapshots `before-import`, `before-migration`, destructive actions и `before-restore`; реализовать безопасный restore.
- **Файлы:** storage/import/startup, snapshot orchestration, data-safety UI.
- **Не менять:** domain command architecture и full IndexedDB migration.
- **Тесты:** import/restore success, bad checksum, bad migration, failed durable write, rollback, recovery fallback.
- **Manual smoke:** импорт старой fixture; restore; повреждённый snapshot; доменное удаление после snapshot.
- **Готово когда:** ни один destructive/migration flow не стартует без проверенного preflight snapshot либо явного отказа.
- **Откат:** отключить integrations feature flag; snapshots остаются читаемыми.

### 5. `refactor/storage-ui-separation`

- **Цель:** удалить map/sidebar/Today calls из storage; UI реагирует на command result/event.
- **Файлы:** `js/storage.js`, command executor/event bus, `js/app.js`, `js/inspector.js`, Inbox/Today/map adapters.
- **Не менять:** entity schema, визуал, command semantics.
- **Тесты:** storage работает без `window/document`; один change event на команду; render spy counts.
- **Manual smoke:** все create/edit/move flows; отсутствие stale map после project create.
- **Готово когда:** Core/storage можно импортировать в Capture без Studio globals.
- **Откат:** временный Studio adapter подписывается на общий event; storage остаётся UI-free.

### 6. `refactor/core-invariants`

- **Цель:** schema module, validators, task placement invariants, revisions и state.meta.
- **Файлы:** `js/core/schema.js`, migrations, state, commands, storage/tests, `js/version.js` только если отдельно согласована версия.
- **Не менять:** универсальный parentId, sync transport, visual design.
- **Тесты:** both Task variants, orphan/duplicate rejection, revision increments, future schema, migration schema 4.
- **Manual smoke:** загрузка текущего export, independent/project task moves, export/import.
- **Готово когда:** invalid placement нельзя создать через public Core API; migration имеет preflight snapshot.
- **Откат:** restore pre-migration snapshot и предыдущий app build; migration должна быть backward plan-aware.

### 7. `feat/domain-project-commands`

- **Цель:** команды create/update/archive/delete/merge domain, update/move/archive/delete project; перевести активные UI handlers.
- **Файлы:** commands/executor, `js/app.js`, `js/view_map.js`, inspector, tests.
- **Не менять:** legacy-файлы без инвентаризации, universal Undo UI, карту.
- **Тесты:** cascades как одна operation, revisions, validation, failed save rollback.
- **Manual smoke:** create/rename/color/merge/archive/delete domain; move/delete project; reload.
- **Готово когда:** active runtime не мутирует Domain/Project/Task вне Core, кроме load/import boundary.
- **Откат:** feature-by-feature UI handler revert; preflight snapshots защищают данные.

### 8. `feat/universal-undo`

- **Цель:** durable inverse operations, conflict check и единый Undo.
- **Файлы:** executor/operations/commands, Undo controller/UI, tests.
- **Не менять:** redo, sync transport, history visual redesign.
- **Тесты:** приоритетный список из раздела 8, multi-entity undo, conflict revision, failure rollback.
- **Manual smoke:** delete/update/promote/domain cascade/inbox conversion → reload → Undo.
- **Готово когда:** Undo переживает reload, создаёт `undoOf` и не перезаписывает более новую сущность молча.
- **Откат:** скрыть Universal Undo UI; операции остаются совместимыми и доступны для recovery.

### 9. `feat/checkpoint-replay`

- **Цель:** sequence, checkpoint snapshot, reducer и безопасная compaction.
- **Файлы:** operations, snapshot checkpoint integration, replay reducer, tests/tools.
- **Не менять:** network sync, automatic conflict resolution.
- **Тесты:** replay from empty/checkpoint, >1000 operations, interrupted compaction, pending sync preservation, state checksum equality.
- **Manual smoke:** synthetic large Atlas; checkpoint; reload/replay; compare export.
- **Готово когда:** `checkpoint + tail` воспроизводит идентичный canonical state до удаления старых operations.
- **Откат:** отключить compaction; хранить старый checkpoint/log до подтверждения новой версии.

### 10. `feat/inbox-provenance`

- **Цель:** raw records со статусом и resultRefs; migration существующего Inbox.
- **Файлы:** Inbox model/commands/view, schema migration, operations, tests.
- **Не менять:** voice API и AI interpretation.
- **Тесты:** capture/process/discard/filter, conversion Undo, provenance after log compaction.
- **Manual smoke:** capture → task → Today → done; открыть исходник; undo conversion.
- **Готово когда:** conversion не уничтожает rawText и provenance не зависит от operationLog.
- **Откат:** pre-migration snapshot; старый UI может игнорировать processed records, но не удалять их.

### 11. `feat/capture-mobile-shell`

- **Цель:** отдельный быстрый mobile entry point без карты/add-ons.
- **Файлы:** `capture.html`, `js/capture/app.js`, `styles/capture.css`, shared Core/storage imports.
- **Не менять:** Studio layout, PWA/service worker, voice.
- **Тесты:** dependency graph не содержит Studio modules; capture offline-after-load; failed save/recovery.
- **Manual smoke:** Android viewport, keyboard, 10 быстрых captures, reload, Studio видит те же Inbox records.
- **Готово когда:** Capture загружается независимо и durable capture занимает одно короткое действие.
- **Откат:** удалить отдельный entry point; shared schema остаётся.

### 12. `feat/capture-pwa`

- **Цель:** installable/offline Capture и безопасный update.
- **Файлы:** manifest, service worker, update controller, snapshot integration.
- **Не менять:** voice, background sync, automatic app update.
- **Тесты:** installability, offline launch, cache version, waiting worker, failed snapshot blocks update.
- **Manual smoke:** Android install; online/offline; update from N to N+1 через «Создать снимок и обновить».
- **Готово когда:** update не активируется без validated snapshot и Recovery Mode работает offline.
- **Откат:** unregister конкретный service worker/versioned caches; web Capture продолжает работать online.

### 13. `feat/capture-voice-alpha`

- **Цель:** microphone → raw transcript → Inbox → confirmation → command.
- **Файлы:** voice adapter, Capture UI, permission/error states, provenance metadata, tests.
- **Не менять:** автоматическое создание задач без подтверждения, AI planning, sync.
- **Тесты:** permission denied, no speech, offline/unsupported API, duplicate final result, save failure.
- **Manual smoke:** 1–2 целевых Android-устройства, шум/движение, airplane mode, reload после каждого capture.
- **Готово когда:** ни один transcript не теряется и не превращается в действие без подтверждения.
- **Откат:** feature flag отключает microphone; text capture остаётся полностью работоспособным.

## 12. Что категорически не делать сейчас

- Не переносить `origin/main` целиком и не менять основу ветки.
- Не выполнять массовый рефакторинг или переписывание на framework.
- Не вводить универсальный `parentId`.
- Не переводить primary state и snapshots в IndexedDB одним PR.
- Не начинать автоматическую синхронизацию до revisions, полного command coverage, checkpoints и recovery.
- Не выполнять destructive migration/delete без validated preflight snapshot.
- Не считать operationLog резервной копией.
- Не расширять текущий локальный move-only undo stack как универсальный Undo.
- Не загружать Studio, карту, add-ons и Experiments в Capture.
- Не делать автоматическое действие из voice transcript без сохранения raw и подтверждения.
- Не менять карту и визуальный дизайн до закрытия рисков сохранности.
- Не удалять `.backup`, `.fixed` и legacy add-ons без отдельной инвентаризации.
- Не менять версию до отдельного согласования.
- Не коммитить кодовые исправления вместе с этим отчётом.

## Приложение A. Результаты проверок

### 13.1. Baseline

Команда:

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify-baseline.ps1
```

Результат: **PASS**.

Пройдены:

- JavaScript syntax check;
- `tests/commands.mjs`;
- `tests/inbox-model.mjs`;
- `tests/operations.mjs`;
- `tests/state-normalization.mjs`;
- `tests/storage-boundary.mjs`;
- проверка обязательных файлов и ссылок из `index.html`.

### 13.2. Clean browser profile

Изолированная Chromium-сессия, не связанная с пользовательским профилем:

- загрузка `http://127.0.0.1:8000/` — PASS;
- title/version — `Atlas_of_life_v0.2.7.5 (modular)`;
- стартовый demo: 2 domains, 3 projects, 6 tasks;
- console: 0 errors, 0 warnings, 1 штатный Experiments log;
- quick add в тестовом профиле → reload → новый tag сохранился — PASS.

### 13.3. Export → import → compare

В отдельном изолированном профиле:

- export schema: 4;
- export: domains 2, projects 3, tasks 6, inbox 0, operations 0;
- после экспорта добавлена временная отличающаяся задача;
- экспорт импортирован обратно;
- после import: domains 2, projects 3, tasks 6, inbox 0, operations 0;
- временная задача отсутствует.

Результат: **PASS для проверенного schema 4 demo round-trip**. Глубокое сравнение всех возможных optional fields, больших файлов и повреждённых imports текущими тестами не покрыто.

### 13.4. Искусственная ошибка localStorage

Изолированный Node storage adapter:

```text
commandReturnedEntity: true
memoryTaskCount: 1
operationCount: 1
durableCopyCreated: false
```

Результат: **FAIL по требованиям сохранности**, риск R1 подтверждён.

### 13.5. Повреждённый JSON

Изолированный in-memory localStorage:

```text
loadState(): false
visible domains after app fallback: Дом, Дача
raw remains corrupt before first edit: true
after first command: schema 4, demo domains, 7 tasks
```

Результат:

- автоматической записи demo непосредственно при старте нет;
- UI не отличает corrupt от empty;
- первая команда перезаписывает повреждённый raw.

Риск R2 подтверждён.

### 13.6. Что не проверялось практически

- реальные quota limits и browser-specific eviction;
- причина исторических UI freezes на production-sized data;
- IndexedDB snapshots — ещё не реализованы;
- replay/checkpoint — ещё не реализованы;
- Android/PWA install/update/offline;
- microphone/Web Speech на реальном Android;
- multi-device clock/revision conflicts;
- sync security/privacy и encryption at rest;
- исполнение XSS payload намеренно не запускалось: небезопасные sinks подтверждены статическим code path.

## Приложение B. Подтверждённые риски и неподтверждённые гипотезы

### Подтверждено

1. Команды могут вернуть success после failed save.
2. Failed save оставляет изменённые memory state и operationLog.
3. Corrupt/empty/migration/invalid не различаются.
4. Corrupt raw перезаписывается первой командой после demo fallback.
5. Import меняет state до подтверждённой durable записи.
6. Operation log ограничен 1000 и не имеет checkpoint/sequence/replay reducer.
7. Журнал неполон из-за активных direct mutations.
8. `baseVersion` хранит timestamp `updatedAt`.
9. `task.update/create` способны нарушить placement invariants.
10. Inbox conversion физически удаляет raw record.
11. Project move Undo не восстанавливает domain.
12. Storage вызывает Studio render-функции, часть callers повторяет render.
13. Active `Сегодня+` меняет task без command, operation и save.
14. Несколько UI paths вставляют user/import values в `innerHTML`.
15. Текущий entry point всегда desktop и загружает карту/add-ons/Experiments.

### Пока только гипотезы

1. Что redundant renders были основной причиной старых фризов — нужен performance profile.
2. Как часто реальные пользователи столкнутся с localStorage quota/eviction — нужны telemetry-free diagnostics и browser tests.
3. Достаточен ли integer revision для будущего UX разрешения конфликтов — нужен протокол двух устройств.
4. Подойдёт ли Web Speech API для полевого Android Capture — нужен тест 1–2 недели.
5. Потребуется ли Capacitor — решать только после PWA alpha.
6. Какой объём и retention snapshots оптимальны на реальных данных — начать с предложенной политики и измерить byteSize.

---

Итоговая рекомендация: согласовать и выполнить только PR `fix/storage-fail-fast`, затем повторить baseline и негативные storage tests. Следующий PR не начинать до review результата первого.
