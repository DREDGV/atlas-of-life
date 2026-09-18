// capture.mjs — visual verification for Atlas of Life.
//
// One command produces the evidence a UI change needs: screenshots of the real
// app in several states and viewports, plus a machine-readable measurement of
// the things that are actually measurable (theme tokens, font sizes, contrast,
// layout columns). It is deliberately NOT a test: it never asserts and never
// fails a build, because taste is not a build gate. It exists so that "looks
// fine" can be replaced by "here is what it looks like and what it measures".
//
// Usage:
//   node .agents/skills/atlas-visual-verification/capture.mjs
//   ATLAS_VIEWPORTS=1440x900,1024x768 ATLAS_THEMES=dark,light ATLAS_TAG=before \
//     node .agents/skills/atlas-visual-verification/capture.mjs
//
// Playwright is optional by design (the repository has no package.json): when it
// is missing or the browser cannot launch, this script prints a skip line and
// exits 0, so CI without a browser stays green.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStaticServer, closeAll } from '../../../tools/smoke-shared.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const OUT = process.env.ATLAS_OUT
  ? join(ROOT, process.env.ATLAS_OUT)
  : join(ROOT, 'output', 'visual');
const TAG = process.env.ATLAS_TAG || 'current';
const VIEWPORTS = (process.env.ATLAS_VIEWPORTS || '1440x900,1024x768').split(',').map(pair => {
  const [w, h] = pair.trim().split('x').map(Number);
  return { width: w || 1440, height: h || 900 };
});
const THEMES = (process.env.ATLAS_THEMES || 'dark,light').split(',').map(t => t.trim()).filter(Boolean);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⏭  visual capture skipped: playwright is not installed');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const { server, origin } = await startStaticServer();
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`⏭  visual capture skipped: headless Chromium unavailable (${error.message.split('\n')[0]})`);
  await closeAll({ server });
  process.exit(0);
}

const errors = [];
const report = { tag: TAG, capturedAt: new Date().toISOString(), screens: [], measurements: {} };

// The seed is deliberately narrow: three Domains covering the three shapes that
// render differently (one Project, two Projects + a "Без проекта" group, one
// Project alone), tasks in every status, and one overdue task.
async function seed(page) {
  await page.evaluate(async () => {
    const { createDomain, createProject, createTask, updateTask } = await import('/js/core/commands.js');
    const day = (offset) => {
      const d = new Date(Date.now() + offset * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const home = createDomain({ title: 'Дом' }).id;
    const work = createDomain({ title: 'Работа' }).id;
    const solo = createDomain({ title: 'Здоровье' }).id;
    const dacha = createProject({ title: 'Дача', domainId: home }).id;
    const flat = createProject({ title: 'Ремонт квартиры', domainId: home }).id;
    const launch = createProject({ title: 'Запуск продукта', domainId: work }).id;
    const form = createProject({ title: 'Форма', domainId: solo }).id;
    const t = (title, projectId, domainId, priority, due) =>
      createTask({ title, projectId, domainId, priority, due: due || null }).id;
    const dachaTasks = [
      t('Собрать урожай яблок', dacha, home, 2, { date: day(1), time: null }),
      t('Починить теплицу', dacha, home, 3),
      t('Заказать саженцы', dacha, home, 1),
      t('Проверить проводку в доме', dacha, home, 2),
    ];
    const flatTasks = [
      t('Купить плитку для ванной', flat, home, 2, { date: day(-2), time: null }),
      t('Найти бригаду', flat, home, 3),
    ];
    const launchTasks = [
      t('Подготовить релиз', launch, work, 2),
      t('Описать требования', launch, work, 2),
    ];
    ['Разобрать входящие', 'Позвонить в сервис', 'Купить лампочки'].forEach((title, i) =>
      t(title, null, home, 2 + (i % 2)));
    t('Купить витамины', null, solo, 2);
    t('Утренняя пробежка', form, solo, 3);
    updateTask(dachaTasks[0], { status: 'today', focus: true });
    updateTask(dachaTasks[1], { status: 'today' });
    updateTask(launchTasks[0], { status: 'doing' });
    updateTask(flatTasks[0], { status: 'doing' });
  });
  await page.waitForTimeout(700);
}

async function measure(page) {
  return page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const name of ['--bg', '--panel', '--panel-2', '--text', '--muted', '--accent', '--warn', '--danger', '--ok']) {
      tokens[name] = css.getPropertyValue(name).trim();
    }
    const parseRgb = (value) => {
      const text = String(value).trim();
      if (text.startsWith('#')) {
        const hex = text.replace('#', '');
        const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
        return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).concat([1]);
      }
      const match = text.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const luminance = (rgb) => {
      const [r, g, b] = rgb.slice(0, 3).map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratioOf = (a, b) => {
      const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Number(((l1 + 0.05) / (l2 + 0.05)).toFixed(2));
    };
    const parse = parseRgb;
    const ratio = (a, b) => ratioOf(parse(a) || [0, 0, 0, 1], parse(b) || [0, 0, 0, 1]);
    // The colour a person actually sees behind an element: walk up the tree and
    // blend every translucent layer, because many panels are color-mix(...).
    const effectiveBackground = (element) => {
      const layers = [];
      let node = element;
      while (node) {
        const background = parseRgb(getComputedStyle(node).backgroundColor);
        if (background && background[3] > 0) {
          layers.push(background);
          if (background[3] >= 0.999) break;
        }
        node = node.parentElement;
      }
      const base = layers.length && layers[layers.length - 1][3] >= 0.999
        ? layers.pop()
        : (parseRgb(getComputedStyle(document.body).backgroundColor) || [11, 15, 23, 1]);
      let result = base.slice(0, 3);
      for (const layer of layers.reverse()) {
        const a = layer[3];
        result = [0, 1, 2].map(i => layer[i] * a + result[i] * (1 - a));
      }
      return result.concat([1]);
    };
    const contrast = {
      'text on panel': ratio(tokens['--text'], tokens['--panel']),
      'muted on panel': ratio(tokens['--muted'], tokens['--panel']),
      'accent on panel': ratio(tokens['--accent'], tokens['--panel']),
      'text on bg': ratio(tokens['--text'], tokens['--bg']),
    };
    // Real elements, not only the palette: a token can pass while the element
    // that uses it fails, for example because its background is lighter.
    const elements = [];
    for (const [label, selector] of [
      ['header chip', 'header .chip:not(.active)'],
      ['header nav chip', '.chip-group .chip:not(.active)'],
      ['header popover summary', '.header-popover summary'],
      ['sidebar section title', '.section h3'],
      ['domain row name', '.domain-name'],
      ['domain counts', '.domain-counts'],
      ['sidebar hint', 'aside .hint'],
      ['quick dock preview', '.quick-preview'],
      ['quick dock mode', '.quick-mode:not(.active)'],
      ['inspector kv', '.kv'],
      ['inspector section label', '.inspector-section-label'],
      ['wip counter', '.wip'],
    ]) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const style = getComputedStyle(element);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      elements.push({
        label,
        selector,
        fontSize: style.fontSize,
        color: style.color,
        background: `rgb(${effectiveBackground(element).slice(0, 3).map(v => Math.round(v)).join(', ')})`,
        ratio: ratioOf(parseRgb(style.color) || [0, 0, 0, 1], effectiveBackground(element)),
        // AA: 3:1 is enough for large text (>=18.66px, or >=14px bold).
        required: (size >= 24 || (size >= 18.66) || (size >= 14 && bold)) ? 3 : 4.5,
      });
    }
    const fontSizes = {};
    for (const [label, selector] of [
      ['body', 'body'],
      ['hint', '.hint'],
      ['header chip', 'header .chip'],
      ['domain counts', '.domain-counts'],
      ['popover title', '.popover-title'],
      ['inspector kv', '.kv'],
      ['quick dock preview', '.quick-preview'],
    ]) {
      const el = document.querySelector(selector);
      if (el) fontSizes[label] = getComputedStyle(el).fontSize;
    }
    const main = document.querySelector('main');
    const columns = main ? getComputedStyle(main).gridTemplateColumns : null;
    const header = document.querySelector('header');
    return {
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      tokenValues: tokens,
      contrast,
      elements,
      fontSizes,
      layout: {
        columns,
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentScrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      },
      focusable: {
        canvasTabIndex: document.getElementById('canvas')?.getAttribute('tabindex') || null,
        canvasRole: document.getElementById('canvas')?.getAttribute('role') || null,
        canvasLabel: document.getElementById('canvas')?.getAttribute('aria-label') || null,
      },
      mapCounts: document.querySelectorAll('#mapEmpty').length
        ? { emptyOverlayHidden: document.getElementById('mapEmpty').hidden }
        : null,
    };
  });
}

async function shoot(page, name) {
  const file = join(OUT, `${TAG}-${name}.png`);
  await page.screenshot({ path: file });
  report.screens.push({ name, file: file.replace(`${ROOT}\\`, '').replace(/\\/g, '/') });
  return file;
}

try {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport,
        colorScheme: theme === 'light' ? 'light' : 'dark',
        locale: 'ru-RU',
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(`${viewport.width}x${viewport.height}/${theme}: ${error.message}`));
      await page.goto(origin, { waitUntil: 'networkidle' });
      if (theme === 'light') {
        await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
      }
      await seed(page);
      const suffix = `${viewport.width}x${viewport.height}-${theme}`;

      await shoot(page, `map-${suffix}`);
      report.measurements[suffix] = await measure(page);

      // Overview (the state a fresh session shows) and a deliberate zoom.
      await page.evaluate(async () => {
        const map = await import('/js/view_map.js');
        map.fitAll();
      });
      await page.waitForTimeout(420);
      await shoot(page, `map-fit-${suffix}`);

      await page.evaluate(() => {
        const slider = document.getElementById('zoomSlider');
        slider.value = '150';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(320);
      await shoot(page, `map-zoom150-${suffix}`);

      // Keyboard focus must be visible on the canvas.
      await page.evaluate(() => document.getElementById('canvas').focus());
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(320);
      await shoot(page, `focus-ring-${suffix}`);

      // The Inspector with a real object in it.
      await page.evaluate(async () => {
        const { state } = await import('/js/state.js');
        const { openInspectorFor } = await import('/js/inspector.js');
        const task = state.tasks.find(t => t.status === 'today') || state.tasks[0];
        openInspectorFor({ ...task, _type: 'task' });
      });
      await page.waitForTimeout(320);
      await shoot(page, `inspector-${suffix}`);

      // Today, on the same data.
      await page.evaluate(() => {
        document.querySelector('.chip[data-view="today"]')?.click();
      });
      await page.waitForTimeout(420);
      await shoot(page, `today-${suffix}`);

      await context.close();
    }
  }
} finally {
  await browser.close();
  await closeAll({ server });
}

report.pageErrors = errors;
const reportFile = join(OUT, `${TAG}-measurements.json`);
writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

console.log(`✅ visual capture: ${report.screens.length} screens → ${OUT}`);
for (const [key, value] of Object.entries(report.measurements)) {
  const thin = Object.entries(value.contrast).filter(([, r]) => r < 4.5).map(([k, r]) => `${k}=${r}:1`);
  const failing = (value.elements || []).filter(item => item.ratio < item.required);
  console.log(`   ${key}: columns=${value.layout.columns} overflow=${value.layout.horizontalOverflow} ` +
    `contrast<4.5:1 ${thin.length ? thin.join(', ') : 'none'}`);
  if (failing.length) {
    console.log(`      below AA: ${failing.map(item => `${item.label} ${item.ratio}:1 < ${item.required} (${item.fontSize})`).join('; ')}`);
  }
}
if (errors.length) console.log(`   page errors: ${errors.length}`);
console.log(`   report: ${reportFile.replace(`${ROOT}\\`, '').replace(/\\/g, '/')}`);
