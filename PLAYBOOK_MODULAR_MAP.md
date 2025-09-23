# Плейбук постепенной модульной карты (Atlas of Life)

Источник: рекомендации внешнего ИИ. Этот документ фиксирует правила, шаги и критерии приёмки, чтобы проект оставался рабочим при эволюции.

## 0) Входные условия и запреты

- База: репозиторий `DREDGV/atlas-of-life`, рабочая точка: тег `v0.2.5-working` (или `main`, если код совпадает)
- Главный модуль карты неизменен по пути: `js/view_map.js`

Запреты:
- Не менять публичные пути существующих файлов
- В `index.html` один вход: `<script type="module" src="./js/app.js"></script>`
- Только именованные экспорты (никаких `export default`)
- Только относительные пути с расширением `.js`
- Не «консолидировать всё сразу» — только шаги ниже

## 1) Безопасные правила проекта

- Один входной скрипт в HTML
- Единый стиль импортов: `import { x } from './state.js'`
- Фича‑флаги для новых реализаций: `?map=v2` или `localStorage.setItem('mapV2','1')`
- Версионирование: `v0.2.6-alpha.N` → `-rc.1` → `v0.2.6`
- Commits: Conventional Commits

## 2) Страховочные инструменты

2.1. Аудит импортов/экспортов — `npm run audit:exports` (см. `tools/audit-exports.mjs`).
Только именованные экспорты; `export default` — запрещён во всех новых файлах.

2.2. Смоук‑тест карты — `tests/smoke.html` + `tests/smoke.js` (холст не пустой за 2 кадра)

2.3. CI (минимум) — `.github/workflows/audit.yml` запускает аудит на push/PR

## 3) Целевая структура (вводим постепенно)

```
js/
  app.js
  state.js
  view_map.js            # фасад, путь сохраняем
  view_map/
    camera.js
    input/
      fsm.js
      hit-test.js
    render/
      draw-utils.js
      text.js
      cache.js
    layers/
      domains.js
      projects.js
      tasks.js
      links.js
      effects-aging.js
    scenegraph.js
    perf.js
```

## 4) Пошаговый план (каждый шаг — отдельный PR + тег)

Критерии приёмки каждого шага (копировать в PR):
- Консоль без ошибок (Errors=0)
- `npm run audit:exports` — зелёный
- Карта отображается и реагирует на пан/клик так же, как в `v0.2.5-working`
- Смоук‑тест «холст не пустой» проходит

Шаг A. «Каркас без изменений поведения» — ветка `feature/map-scaffold`
- Создать папку `js/view_map/` и пустые модули из структуры выше
- В `js/view_map.js` только импортировать эти модули (без изменения логики)
- PR: `chore(view): scaffold for modular map`, тег `v0.2.6-alpha.1`

Шаг B. Вынести «чистые» утилиты — ветка `refactor/map-utils-out`
- Переместить математические/рисовальные утилиты в `render/*`
- Обновить импорты, поведение не меняется
- PR: `refactor(view): extract pure draw/text utils`, тег `v0.2.6-alpha.2`

Шаг C. Камера — ветка `refactor/map-camera`
- Ввести `view_map/camera.js` с API `createCamera(canvas)`
- Заменить внутренние вызовы на методы камеры
- PR: `refactor(view): introduce camera module`, тег `v0.2.6-alpha.3`

Шаг D. FSM ввода — ветка `refactor/map-input-fsm`
- Ввести `input/fsm.js` и `input/hit-test.js`
- Подключить обработчики к canvas
- PR: `feat(view): robust input FSM (no ghost pan/drag)`, тег `v0.2.6-alpha.4`

Шаг E. Слои отрисовки — ветка `refactor/map-layers`
- Ввести `layers/*` и цикл отрисовки по слоям
- PR: `refactor(view): layerized rendering pipeline`, тег `v0.2.6-alpha.5`

Шаг F. Scenegraph + кэш хит‑теста — ветка `feat/map-scenegraph`
- Собрать кэш мировых позиций/радиусов
- PR: `feat(view): scenegraph + cached hit-test`, тег `v0.2.6-alpha.6`

Шаг G. События состояния — ветка `feat/state-events`
- Минимальный pub/sub в `state.js`
- Карта подписывается и обновляет кэш
- PR: `feat(state): lightweight event bus`, тег `v0.2.6-alpha.7`

Шаг H. Включить v2 по умолчанию — ветка `switch/map-v2-default`
- Новый пайплайн по умолчанию, `?map=v1` — старый
- PR: `feat(view): map v2 as default, v1 behind flag`, тег `v0.2.6-rc.1` → `v0.2.6`

## 5) Контроль качества

- Консоль чистая (Errors=0)
- Аудит импортов — зелёный
- FPS без деградации на пан/зум
- Функционал: выбор/перетаскивание/пан как раньше
- В PR — список перенесённых функций и стабильный публичный API

## 6) Навигация кода

- input/* — хит‑тест и FSM
- render/* — математика/отрисовка
- layers/* — «что рисовать» по типам
- camera.js — преобразования координат
- scenegraph.js — кэш мирового состояния
- state.js — шина событий

## 7) Шаблоны промптов для ИИ

«Работай на ветке X от `v0.2.5-working`. Вынеси из `js/view_map.js` чистые функции рисования и текста в `js/view_map/render/*.js`. Обнови импорты. Поведение не меняй. Проверь: консоль чистая; `npm run audit:exports` зелёный; карта рисуется и реагирует как ранее. Подготовь PR Y.»

## 8) Итоговая польза

- Путь `js/view_map.js` сохраняется — публичный API стабилен
- Внутри — модульные границы, понятные человеку и ИИ
- Импорт‑ошибки предотвращены правилом именованных экспортов + аудитом
- Стабильность подтверждается смоук‑тестом


