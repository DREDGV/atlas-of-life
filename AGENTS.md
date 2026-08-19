# AGENTS.md — конституция разработки Atlas of Life

Для AI coding agents. Короткая сводка обязательных правил; актуальное состояние продукта и этапов — в `docs/ROADMAP_REVIVAL.md`, детали ядра — в `docs/ATLAS_CORE.md`.

## Product

Atlas of Life — не generic task manager, а личная пространственная система управления жизнью (домены → проекты → задачи/идеи на карте).

```text
Capture          = рецептор
Processing Center = маршрутизатор
Core             = память и правила
Today            = действие
Map              = понимание системы
Intelligence     = помощник поверх структуры
```

Главный жизненный поток:

```text
Capture → Inbox → Processing → Task / Thought / Note / context → Today → Action → History / Review → Map
```

## Architecture

- Persisted data меняется **только через Core commands** (`js/core/commands.js`). Новые прямые UI mutations persisted state запрещены.
- Сохранять существующие инварианты (если код эволюционировал — правило формулируется по текущему фактическому состоянию):
  - `rawText` immutable;
  - Inbox `resultRef` ↔ Task `sourceInboxId` (двусторонняя связь);
  - безопасные routing/revert (routed-записи залочены по типу/статусу; revert не удаляет изменённую Task);
  - валидация destination (Project/Domain существуют);
  - operation log (`js/core/operations.js`).
- Capture hints (`userHint`, `domainHintId`) — persisted-подсказки: после успешного Capture сохраняются в Inbox item, но **не являются confirmed classification / final route** (подтверждённый тип — `itemType`).
- Ephemeral UI state (не пишется в storage): routing drafts, session UI defaults, незавершённый Quick Capture hint selection.
- Хранилище: `localStorage` через `js/storageAdapter.js`; схема версионируется миграциями в `js/storage.js`.

## Versioning

- SemVer `MAJOR.MINOR.PATCH-prerelease` (например `0.10.0-alpha.3`).
- Версия централизована через существующий version module (`js/version.js`); PWA cache — `capture/sw.js` (зеркалится тестом).
- Не менять версию за мелкий correction commit внутри одного prerelease. Новая версия появляется только при начале нового осмысленного product milestone.

## Roadmap discipline

- Перед работой читать `docs/ROADMAP_REVIVAL.md` — это источник актуального состояния этапов.
- Не начинать следующий roadmap stage самовольно. Не забегать вперёд (AI, Sync, Native Android, Today 2.0, Map redesign и другие будущие направления) только потому, что это технически интересно.
- Netlify / preview-deployment не является частью текущего workflow.

## Product development

- Приоритет: полезный продуктовый результат → focused verification → commit/push.
- Тесты поддерживают разработку, а не заменяют её; не начинать общий аудит проекта после каждой небольшой правки.
- Реальные наблюдения пользователя при работе с приложением — полноценный источник product requirements.
- UX/visual defects, мешающие понимать интерфейс или выполнять действие, — часть основной разработки, а не «косметика на потом». При этом вкусовые мелочи не превращать в redesign.
- Focused regression обязателен для критичных data-инвариантов; CSS автоматическими тестами не обкладывать без пользы; browser/visual smoke предпочтительнее искусственных CSS assertions.

## Git safety

- Перед работой: `git status --short`, `git status -sb`, `git log -1 --oneline`.
- Запрещено уничтожать неизвестные локальные изменения. Никогда без явного разрешения пользователя: `git clean -fd`, `git reset --hard`, удаление unrelated/untracked файлов, force push.
- Никогда не использовать `git add .` или `git add -A`, если рабочее дерево содержит unrelated-файлы; добавлять в commit только явно относящиеся к задаче пути.
- Законченный осмысленный кусок: focused checks → commit → push → сообщить HEAD. Не держать ценную работу только локально.

## PR

- Агент не merge PR без явной команды пользователя. Большие feature PR по умолчанию создавать Draft.
- Перед завершением работы сообщать: branch, HEAD, изменённые области, проверки, CI, найденные ограничения. После отчёта не начинать следующий этап.

## Как начать

1. Прочитай этот файл и `docs/ROADMAP_REVIVAL.md`.
2. Определи branch / PR / HEAD, проверь `git status`.
3. Для обычной разработки используй skill `atlas-development` (`.agents/skills/atlas-development/SKILL.md`); для UI/UX задач — `atlas-ui-review` (`.agents/skills/atlas-ui-review/SKILL.md`).