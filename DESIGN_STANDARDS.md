# 🎨 Дизайнерские стандарты Atlas of Life

Этот файл содержит точные спецификации визуального дизайна всех элементов интерфейса для быстрого восстановления в случае сбоев.

---

## 📋 Общие принципы дизайна

### Цветовая схема
- **Фон**: темный космический (#0a0a0a, #1a1a2e)
- **Акценты**: космические цвета (синий, фиолетовый, бирюзовый)
- **Текст**: белый (#ffffff) с прозрачностью для иерархии
- **Границы**: контрастные цвета, автоматически подбираемые

### Стиль рендеринга
- **Основной стиль**: `projectVisualStyle = 'original'`
- **3D эффекты**: радиальные градиенты, внутреннее свечение
- **Анимации**: плавные переходы, пульсация для активных элементов
- **Глубина**: тени, внешние свечения, многослойность

---

## 🌌 Домены (Galaxies)

### Визуальные характеристики
- **Форма**: круг с радиальным градиентом
- **Граница**: пунктирная линия (4px dash, 4px gap)
- **Размер**: адаптивный (минимум 80px, растягивается под проекты)
- **Цвет**: по настроению домена (`n.color`)

### Код рендеринга
```javascript
// Радиальный градиент
const gradient = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
gradient.addColorStop(0, domainColor + "40");
gradient.addColorStop(0.7, domainColor + "20");
gradient.addColorStop(1, domainColor + "10");

// Заполнение
ctx.fillStyle = gradient;
ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
ctx.fill();

// Пунктирная граница
ctx.strokeStyle = domainColor;
ctx.lineWidth = 1.2 * DPR;
ctx.setLineDash([4 * DPR, 4 * DPR]);
ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
ctx.stroke();
ctx.setLineDash([]);
```

---

## 🪐 Проекты (Orbits)

### Визуальные характеристики
- **Форма**: простой круг
- **Граница**: тонкая контрастная линия
- **Размер**: адаптивный (минимум 40px, растягивается под задачи)
- **Цвет**: по типу проекта

### Код рендеринга
```javascript
// Основной круг
ctx.beginPath();
ctx.fillStyle = projectColor;
ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
ctx.fill();

// Тонкая граница
ctx.beginPath();
ctx.strokeStyle = getContrastColor(projectColor);
ctx.lineWidth = 1 * DPR;
ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
ctx.stroke();
```

---

## ⭐ Задачи (Planets)

### Визуальные характеристики
- **Форма**: круг с 3D эффектами
- **Размер**: 12-24px (зависит от приоритета)
- **Градиент**: радиальный от светлого к темному
- **Внутреннее свечение**: белое пятно для объемности
- **Внешнее свечение**: тонкое свечение для глубины
- **Граница**: контрастная, автоматически подбираемая

### Код рендеринга
```javascript
// Улучшенный градиент
const gradient = ctx.createRadialGradient(n.x - n.r/2, n.y - n.r/2, 0, n.x, n.y, n.r);
gradient.addColorStop(0, baseColor + "FF");
gradient.addColorStop(0.3, baseColor + "DD");
gradient.addColorStop(0.7, baseColor + "AA");
gradient.addColorStop(1, baseColor + "77");

// Основной круг
ctx.beginPath();
ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
ctx.fillStyle = gradient;
ctx.fill();

// Внутреннее свечение для 3D эффекта
const innerGradient = ctx.createRadialGradient(n.x - n.r/3, n.y - n.r/3, 0, n.x, n.y, n.r * 0.6);
innerGradient.addColorStop(0, "#ffffff40");
innerGradient.addColorStop(1, "#00000000");

ctx.beginPath();
ctx.fillStyle = innerGradient;
ctx.arc(n.x, n.y, n.r * 0.6, 0, Math.PI * 2);
ctx.fill();

// Контрастная граница
ctx.beginPath();
ctx.strokeStyle = getContrastColor(baseColor);
ctx.lineWidth = 1.5 * DPR;
ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
ctx.stroke();

// Внешнее свечение для глубины
ctx.beginPath();
ctx.strokeStyle = baseColor + "30";
ctx.lineWidth = 3 * DPR;
ctx.arc(n.x, n.y, n.r + 1 * DPR, 0, Math.PI * 2);
ctx.stroke();
```

### Статус-эффекты
- **"today"**: желтое кольцо (#f59e0b, 2px)
- **"doing"**: пульсирующее кольцо
- **hover**: белое кольцо (2px)
- **click**: эффект звездочки (8 лучей)

---

## 💫 Идеи (Nebulae)

### Визуальные характеристики
- **Форма**: круг с многослойным эффектом
- **Градиент**: радиальный с бликами
- **Размер**: 15px по умолчанию
- **Прозрачность**: 0.6-0.8

### Код рендеринга
```javascript
// Многослойный градиент
const gradient = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
gradient.addColorStop(0, ideaColor + "CC");
gradient.addColorStop(0.5, ideaColor + "66");
gradient.addColorStop(1, ideaColor + "22");

ctx.beginPath();
ctx.fillStyle = gradient;
ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
ctx.fill();
```

---

## 🪨 Заметки (Asteroids)

### Визуальные характеристики
- **Форма**: круг с объемным градиентом
- **Размер**: 12px по умолчанию
- **Тень**: для глубины
- **Стабильная форма**: без пульсации

### Код рендеринга
```javascript
// Объемный градиент
const gradient = ctx.createRadialGradient(n.x - n.r/3, n.y - n.r/3, 0, n.x, n.y, n.r);
gradient.addColorStop(0, noteColor + "DD");
gradient.addColorStop(0.7, noteColor + "88");
gradient.addColorStop(1, noteColor + "44");

ctx.beginPath();
ctx.fillStyle = gradient;
ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
ctx.fill();
```

---

## 🎯 Эффекты взаимодействия

### Hover эффекты
- **Задачи**: белое кольцо (2px, #ffffff)
- **Проекты**: увеличение размера на 10%
- **Домены**: усиление свечения

### Click эффекты
- **Задачи**: эффект звездочки (8 белых лучей)
- **Проекты**: пульсирующее кольцо
- **Домены**: волновой эффект

### Анимации
- **Пульсация**: для статуса "doing" (sin волна)
- **Затухание**: для click эффектов (0.8s)
- **Плавность**: все переходы с easing

---

## 📏 Адаптивные размеры

### Проекты
```javascript
function calculateProjectRadius(tasks) {
  const baseRadius = 32 * DPR;
  if (tasks.length === 0) return baseRadius;
  
  const maxTaskSize = Math.max(...tasks.map(task => sizeByImportance(task) * DPR));
  const taskCount = tasks.length;
  const minDist = maxTaskSize * 2.2 + 10 * DPR;
  
  // Для небольшого количества задач
  if (taskCount <= 3) {
    return Math.max(baseRadius, maxTaskSize * 2.5 + 16 * DPR);
  }
  
  // Для большего количества - кольцевая упаковка
  const maxTasksPerRing = 8;
  const ringsNeeded = Math.ceil(taskCount / maxTasksPerRing);
  // ... расчет радиуса
}
```

### Домены
```javascript
function calculateDomainRadius(projects) {
  const baseRadius = 80 * DPR;
  if (projects.length === 0) return baseRadius;
  
  const maxProjectSize = Math.max(...projects.map(project => project.r || 40 * DPR));
  const projectCount = projects.length;
  
  // Для небольшого количества проектов
  if (projectCount <= 2) {
    return Math.max(baseRadius, maxProjectSize * 2.0 + 32 * DPR);
  }
  
  // Для большего количества - по площади
  const totalProjectArea = projects.reduce((sum, project) => {
    const projectSize = project.r || 40 * DPR;
    return sum + Math.PI * projectSize * projectSize;
  }, 0);
  
  const areaWithPadding = totalProjectArea * 1.5;
  const radiusFromArea = Math.sqrt(areaWithPadding / Math.PI) + 32 * DPR;
  
  return Math.max(baseRadius, radiusFromArea);
}
```

---

## 🔧 Технические параметры

### DPR (Device Pixel Ratio)
- Все размеры умножаются на `DPR` для четкости
- `const DPR = window.devicePixelRatio || 1;`

### Цветовые функции
- `getContrastColor(color)` - автоматический подбор контрастного цвета
- `colorByAging(aging)` - цвет по возрасту объекта
- `colorByStatus(status)` - цвет по статусу

### Производительность
- **Culling**: отрисовка только видимых объектов
- **Throttling**: ограничение частоты обновлений
- **RAF**: использование requestAnimationFrame

---

## 🚨 Критические настройки

### Порядок отрисовки (важно!)
1. Домены (фон)
2. Проекты (средний план)
3. Задачи (передний план)
4. Эффекты клика (поверх всего)

### Переменные состояния
- `clickedNodeId` - ID кликнутого объекта
- `clickEffectTime` - время эффекта клика (0-1)
- `hoverNodeId` - ID объекта под курсором

### Файлы для восстановления
- `js/view_map.js` - основной рендеринг
- `js/state.js` - функции размеров и цветов
- `styles.css` - CSS стили

---

## 📝 Быстрое восстановление

### Если сломался дизайн:
1. Установить `projectVisualStyle = 'original'`
2. Восстановить код из этого файла
3. Проверить порядок отрисовки
4. Убедиться в правильности переменных

### Если не работают эффекты:
1. Проверить `clickedNodeId` и `clickEffectTime`
2. Убедиться, что эффекты рисуются в конце
3. Проверить логику `isClicked`

### Если объекты не адаптируются:
1. Проверить функции `calculateProjectRadius` и `calculateDomainRadius`
2. Убедиться в правильности `sizeByImportance`
3. Проверить обновление размеров в `layoutMap`

---

## 🎛️ Панели интерфейса

### Header (Верхняя панель)
- **Фон**: `var(--panel)` (#0f1624)
- **Высота**: 56px (min-height: 48px)
- **Граница**: `border-bottom: 1px solid var(--panel-2)`
- **Расположение**: `display: flex; align-items: center; gap: 8px; padding: 0 10px`

### Brand (Логотип)
- **Градиент**: `linear-gradient(45deg, #ff6b6b, #4ecdc4)`
- **Стиль**: `-webkit-background-clip: text; -webkit-text-fill-color: transparent`
- **Шрифт**: `font-weight: 700; letter-spacing: .3px`
- **Размер**: `max-width: 200px`

### Main Layout (Основная сетка)
- **Структура**: `grid-template-rows: 56px 1fr 56px`
- **Боковые панели**: `grid-template-columns: minmax(200px, 250px) 1fr minmax(250px, 300px)`
- **Левая панель**: `background: var(--panel); border-right: 1px solid var(--panel-2)`
- **Правая панель**: `background: var(--panel); border-left: 1px solid var(--panel-2)`

### Inspector (Правая панель)
- **Отступы**: `padding: 12px`
- **Переполнение**: `overflow: auto; word-wrap: break-word`
- **Заголовки**: `font-size: 16px; margin: 0 0 6px 0`
- **Метаданные**: `color: var(--muted); font-size: 12px`

### Footer (Нижняя панель)
- **Высота**: 56px
- **Фон**: `var(--panel)`
- **Граница**: `border-top: 1px solid var(--panel-2)`
- **Функция**: Информационная панель (не создание задач)

---

## 🔘 Кнопки и элементы управления

### Основные кнопки (.btn)
- **Отступы**: `padding: 6px 10px`
- **Радиус**: `border-radius: 8px`
- **Граница**: `border: 1px solid var(--panel-2)`
- **Фон**: `background: var(--panel-2)`
- **Цвет**: `color: var(--text)`
- **Переход**: `transition: all 0.2s ease`
- **Шрифт**: `font-size: 12px`

### Hover эффекты
- **Фон**: `background: var(--accent)`
- **Цвет**: `color: var(--bg)`
- **Трансформация**: `transform: translateY(-1px)`
- **Тень**: `box-shadow: 0 4px 12px rgba(0,0,0,0.3)`

### Типы кнопок
- **Primary**: `background: var(--accent); border-color: var(--accent); color: var(--bg)`
- **Danger**: `background: var(--danger); border-color: var(--danger); color: var(--bg)`
- **Warn**: `background: var(--warn); border-color: var(--warn); color: var(--bg)`
- **OK**: `background: var(--ok); border-color: var(--ok); color: var(--bg)`

### Кнопки добавления идей/заметок
- **Идеи**: `background: linear-gradient(135deg, #4ecdc4, #44a08d)`
- **Заметки**: `background: linear-gradient(135deg, #8b7355, #6c757d)`
- **Размер**: `padding: 8px 12px; font-size: 16px`
- **Радиус**: `border-radius: 6px`

### Статусные кнопки (.status-buttons)
- **Расположение**: `display: flex; gap: 4px; flex-wrap: wrap`
- **Размер**: `min-width: 60px; font-size: 12px; padding: 4px 8px`
- **Цвета статусов**:
  - **Backlog**: `#9ca3af` (серый)
  - **Today**: `#f59e0b` (желтый)
  - **Doing**: `#60a5fa` (синий)
  - **Done**: `#059669` (зеленый)

### Маленькие кнопки (.btn-small)
- **Размер**: `min-width: 28px; height: 28px`
- **Шрифт**: `font-size: 12px`
- **Выравнивание**: `display: flex; align-items: center; justify-content: center`
- **Hover**: `transform: scale(1.1); opacity: 0.9`

---

## 🎨 Цветовая схема (CSS переменные)

### Темная тема (по умолчанию)
```css
:root {
  --bg: #0b0f17;           /* Основной фон */
  --panel: #0f1624;        /* Фон панелей */
  --panel-2: #111a2a;      /* Вторичный фон */
  --text: #e6edf3;         /* Основной текст */
  --muted: #9db1c9;        /* Приглушенный текст */
  --accent: #56ccf2;       /* Акцентный цвет */
  --warn: #f2c94c;         /* Предупреждение */
  --danger: #ff6b6b;       /* Опасность */
  --ok: #19c37d;           /* Успех */
  --link: #7f9cf5;         /* Ссылки */
  --home: #2dd4bf;         /* Дом */
  --dacha: #f59e0b;        /* Дача */
}
```

### Светлая тема
```css
[data-theme="light"] {
  --bg: #f7fafc;           /* Светлый фон */
  --panel: #ffffff;        /* Белые панели */
  --panel-2: #f2f6fb;      /* Светло-серый */
  --text: #0b1220;          /* Темный текст */
  --muted: #6b7a90;         /* Приглушенный */
  --accent: #2563eb;        /* Синий акцент */
  --warn: #b7791f;          /* Оранжевый */
  --danger: #d14343;        /* Красный */
  --ok: #059669;            /* Зеленый */
  --link: #3b82f6;          /* Синие ссылки */
}
```

---

## 📝 Формы и поля ввода

### Поля ввода (.form-input, .form-textarea)
- **Фон**: `background: rgba(255, 255, 255, 0.05)`
- **Граница**: `border: 1px solid rgba(255, 255, 255, 0.2)`
- **Радиус**: `border-radius: 8px`
- **Отступы**: `padding: 12px`
- **Фокус**: `border-color: #4ecdc4; box-shadow: 0 0 0 3px rgba(78, 205, 196, 0.1)`

### Выпадающие списки (.autocomplete-dropdown)
- **Фон**: `background: var(--panel)`
- **Граница**: `border: 1px solid var(--panel-2)`
- **Радиус**: `border-radius: 8px`
- **Тень**: `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)`
- **Z-index**: `1000`

### Элементы автодополнения (.autocomplete-item)
- **Отступы**: `padding: 8px 12px`
- **Переход**: `transition: background-color 0.2s ease`
- **Hover**: `background: var(--panel-2)`
- **Граница**: `border-bottom: 1px solid var(--panel-2)`

---

## 🎯 Модальные окна

### Редакторы идей/заметок (.idea-editor, .note-editor)
- **Фон**: `background: linear-gradient(135deg, var(--panel) 0%, #1a1a2e 100%)`
- **Граница**: `border: 1px solid rgba(255, 255, 255, 0.1)`
- **Радиус**: `border-radius: 12px`
- **Тень**: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3)`
- **Размер**: `max-width: 600px; width: 95%`

### Заголовки модальных окон
- **Идеи**: `background: linear-gradient(135deg, #ff6b6b, #4ecdc4)`
- **Заметки**: `background: linear-gradient(135deg, #8b7355, #a0a0a0)`
- **Стиль**: `-webkit-background-clip: text; -webkit-text-fill-color: transparent`
- **Размер**: `font-size: 1.5em; font-weight: bold`

---

## 🔧 Технические детали UI

### Анимации и переходы
- **Стандартный переход**: `transition: all 0.2s ease`
- **Медленный переход**: `transition: all 0.3s ease`
- **Hover трансформации**: `transform: translateY(-1px)` или `scale(1.1)`
- **Активные состояния**: `transform: scale(0.95)`

### Z-index слои
- **Автодополнение**: `z-index: 1000`
- **Модальные окна**: `z-index: 1000+`
- **Тултипы**: `z-index: высокий`

### Адаптивность
- **Минимальная ширина**: `min-width: 600px`
- **Минимальная высота**: `min-height: 100vh`
- **Flexbox**: для гибкого расположения элементов
- **Grid**: для основной структуры приложения

---

*Последнее обновление: 17.01.2025*
*Версия: v0.3.9-fixed-click*
