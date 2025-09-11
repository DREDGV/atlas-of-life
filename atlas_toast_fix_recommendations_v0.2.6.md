# Atlas of life — рекомендации по исправлению toast-уведомлений (v0.2.6)

Ниже собраны причины, из‑за которых toast-уведомления не видны, и пошаговые исправления. Правки локальные и не требуют изменения модели данных.

---

## 1) Почему toast «есть в DOM», но не виден

- **Некорректные inline-стили через JS.** В коде встречается `toast.style.display = "block !important"` и подобные. `!important` в inline‑стилях **не работает**, свойство игнорируется.
- **Неопределённые CSS‑переменные темы.** `--panel`, `--panel-2`, `--text` могут быть не заданы (фон = прозрачный, текст «сливается»).
- **Недостаточный z-index / перекрытие canvas.** `z-index: 60` не гарантирует верхний слой.
- **Контекст наложения у родителя.** Если `#toast` находится не в `<body>`, а в контейнере с `transform`/`filter`/`position`, `fixed` ведёт себя непредсказуемо.
- **Инспектор не обновляется после подтверждения.** Логика сработала, но панель показывает старые данные → ощущение «ничего не произошло».

---

## 2) Что именно исправить (по файлам)

### A. `js/view_map.js` — показываем/скрываем toast корректно
**Было (пример):**
```js
toast.className = "toast attach";
toast.style.display = "block !important";
toast.style.opacity = "1 !important";
toast.style.visibility = "visible !important";
toast.style.zIndex = "1000 !important";
```

**Стало (вариант 1 — только inline‑стили):**
```js
toast.className = "toast attach";           // классы без .show
toast.style.display = "block";               // без !important
toast.style.opacity = "1";
toast.style.visibility = "visible";
toast.style.zIndex = "1000";
```

**Стало (вариант 2 — через класс .show):**
```js
toast.className = "toast attach";     // не затираем другие классы
toast.classList.add("show");          // .toast.show { display:block; ... }
...
toast.classList.remove("show");       // при скрытии
```
> Выберите один из подходов и используйте его последовательно. Самый простой — вариант 1.

**Центрируем toast (надёжный вариант):**
```js
toast.style.position = "fixed";
toast.style.left = "50%";
toast.style.top = "50%";
toast.style.transform = "translate(-50%, -50%)";
toast.style.right = "auto";
```
*(Временный вариант диагностики — правый верхний угол: `top=20px; right=20px; transform=none;`)*

**После подтверждения перемещения — обновляем инспектор:**
```js
// внутри confirmProjectMove() после применения изменений
openInspectorFor(p);   // p — перенесённый проект
layoutMap();
drawMap();
```

### B. `styles.css` — задаём тему и слой
Добавьте (или проверьте) значения переменных и слой:
```css
:root {
  --panel: rgba(40,40,40,.85);
  --panel-2: rgba(255,255,255,.25);
  --text: #fff;
}

.toast {
  position: fixed;
  z-index: 1000;                 /* было 60 — мало */
  right: 16px;
  top: 16px;
  min-width: 220px;
  max-width: 60vw;
  background: var(--panel, #333); /* fallback на чёрный */
  border: 1px solid var(--panel-2, #555);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text, #fff);
  box-shadow: 0 10px 30px rgba(0,0,0,.4);
  font-size: 13px;
  backdrop-filter: blur(10px);
  display: none;
}
.toast.show {
  display: block;  /* если используете .show */
}
```
> Если в проекте есть другие модальные окна, убедитесь, что их `z-index` ниже/выше согласованно.

### C. `index.html` — размещение в DOM
Убедитесь, что `#toast` — **прямой потомок `<body>`**, после основных контейнеров (карта/инспектор), например:
```html
<body>
  <!-- ... ваш layout, canvas, панели ... -->
  <div id="toast" class="toast" role="dialog" aria-live="assertive"></div>
</body>
```
> Избегайте вложенности в контейнеры с `transform`, `filter`, `overflow:hidden` и т.п., чтобы `position:fixed` работал на весь вьюпорт.

### D. (Опционально) Блокируем карту на время диалога
Чтобы клики гарантированно попадали в toast, можно временно блокировать события на карте:
```js
document.body.classList.add("modal-open"); // при показе
document.body.classList.remove("modal-open"); // при скрытии
```
```css
.modal-open canvas { pointer-events: none; }
```
Или: `canvas.style.pointerEvents = 'none'` / `'auto'` в show/hide toast.

---

## 3) Проверка и диагностика (консоль)

```js
const toast = document.getElementById('toast');
console.log('computed:', getComputedStyle(toast).display, getComputedStyle(toast).zIndex);
console.log('rect:', toast.getBoundingClientRect());
console.log('colors:', getComputedStyle(document.documentElement).getPropertyValue('--panel'),
                       getComputedStyle(document.documentElement).getPropertyValue('--text'));
```
Ожидаем: `display: block` во время показа, ненулевые размеры, адекватные цвета. Если `rect` вне экрана или ширина/высота = 0 — проблема с позиционированием или содержимым.

---

## 4) Дополнительно: устойчивый DnD (основа под v0.2.6)

- Перейдите на `pointerdown/move/up` + `setPointerCapture(e.pointerId)` чтобы не «терять» `pointerup` за пределами canvas.
- Все хит‑тесты и зоны «магнита» считайте в **world‑координатах** (используйте одну матрицу `screenToWorld` / `worldToScreen`).
- Во время `dragging` отключите pan/zoom; `Esc`/ПКМ — отмена перетаскивания.
- Drop → либо сразу действие, либо toast‑подтверждение (как в этом документе).

Эти шаги не меняют модель данных и хорошо ложатся в минимальный релиз 0.2.6.

---

## 5) Краткая памятка по DoD (Definition of Done)

- Toast **виден** поверх карты, с контрастным фоном и читаемым текстом.
- Кнопки «Переместить» / «Отменить» **кликаются** и выполняют логику.
- Инспектор **показывает актуальные данные** сразу после подтверждения.
- DnD не «зависает»; отмена/повторный drag работает стабильно.
