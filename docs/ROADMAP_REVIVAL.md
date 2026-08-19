# Атлас Жизни — дорожная карта возрождения

Обновлено: 18 августа 2026 года.

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

### 0.10.x — Processing Center Core 🔴 АКТИВНО

- **B0 Foundation** — ✅ ЗАВЕРШЕНО (`0.10.0-alpha.1`): edit с сохранением rawText, `itemType` (task | thought | note | null) отдельно от `userHint`, processing status `new | reviewed | processed | discarded`, карточный ручной разбор.
- **B1 Processing Routing** — ✅ ЗАВЕРШЕНО (`0.10.0-alpha.2`): безопасный Inbox → Task (`resultRef` ↔ `sourceInboxId`), Domain/Project/Priority/Due, безопасный revert, валидация destination, блокировка routed-записей, inline создание Domain/Project, routing draft.
- **B2 Processing Flow UX** — ▶ ТЕКУЩИЙ ЭТАП (`0.10.0-alpha.3`): очередь «К разбору / Разобранные / Все», автоматические статусы, progressive disclosure («Что это?» → «Куда?» → «Дополнительно»), одна активная карточка, keyboard workflow (1/2/3, J/K, Enter), batch processing, session defaults, provenance «Исходник», локальный поиск, empty states. B2 включает visual clarity / interaction polish: clear active/compact/final states, semantic priority visualization, readable date/time controls, clear action hierarchy (primary/secondary/tertiary/destructive), batch-mode visual state, unified metadata format, improved provenance accordion.

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

### 0.11.x — Sync v1

Первый сквозной контур: Phone Capture → Inbox → Processing → Desktop → результат → Phone. Синхронизируются операции, а не перезапись общего JSON. `operationId`, `deviceId`, `sequence`, idempotency, retry, ack, server cursor, deduplication.

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
