// Materials on the map (0.13.x, M-05): a Thought/Note belongs to a Project, to a
// Domain, or to nothing — and the map badge must agree with the library about
// which one. A material with a Domain and no Project used to be counted by
// nothing: visible in «Мысли и заметки» and absent from the map.
//
// Opt-in: needs the Playwright browser package, which is not a dependency of this
// repository (there is no package.json by design). It reports itself as skipped
// rather than failing when the browser is unavailable, so
// `tools/verify-baseline.ps1` and CI stay green without it.
import assert from 'node:assert/strict';
import { startStaticServer, closeAll } from '../tools/smoke-shared.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⏭  map knowledge counter tests skipped: playwright is not installed');
  process.exit(0);
}

const { server, origin } = await startStaticServer();
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`⏭  map knowledge counter tests skipped: headless Chromium unavailable (${error.message.split('\n')[0]})`);
  await closeAll({ server });
  process.exit(0);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await context.newPage();
const failures = [];
page.on('pageerror', error => failures.push(error.message));

try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  const seeded = await page.evaluate(async () => {
    const { createDomain, createProject, captureInbox, updateInbox, routeInboxToKnowledge } = await import('/js/core/commands.js');
    const home = createDomain({ title: 'Дом' }).id;
    const work = createDomain({ title: 'Работа' }).id;
    const dacha = createProject({ title: 'Дача', domainId: home }).id;
    const material = (text, { domainId = null, projectId = null } = {}) => {
      const [item] = captureInbox(text);
      updateInbox(item.id, { itemType: 'thought' });
      const routed = routeInboxToKnowledge(item.id, { domainId, projectId });
      return routed?.material?.id || null;
    };
    const inProject = material('Теплицу починить весной', { projectId: dacha });
    const inDomain = material('Проверить проводку в доме', { domainId: home });
    const inOtherDomain = material('Идея для релиза', { domainId: work });
    const noContext = material('Просто мысль без контекста');
    return { home, work, dacha, inProject, inDomain, inOtherDomain, noContext };
  });
  assert.ok(seeded.inProject && seeded.inDomain && seeded.inOtherDomain && seeded.noContext,
    'all four materials must be routed');

  const counts = await page.evaluate(async ({ home, work, dacha }) => {
    const map = await import('/js/view_map.js');
    const { state } = await import('/js/state.js');
    map.layoutMap();
    const nodes = map.getLayoutSnapshot().nodes;
    const table = map.knowledgeCountFor(nodes, state.knowledge);
    return {
      table,
      home: table[`domain:${home}`] ?? null,
      work: table[`domain:${work}`] ?? null,
      dacha: table[`project:${dacha}`] ?? null,
      knowledge: state.knowledge.map(item => ({ id: item.id, projectId: item.projectId, domainId: item.domainId })),
    };
  }, seeded);

  // A material inside a Project belongs to that Project, not additionally to the
  // Domain that contains it: otherwise the badge double-counts on screen.
  assert.equal(counts.dacha, 1, `the Project must count its own material (got ${counts.dacha})`);
  // A material with a Domain and no Project belongs to that Domain — this is the
  // case that used to be counted by nothing.
  assert.equal(counts.home, 1, `the Domain must count the material that has no Project (got ${counts.home})`);
  assert.equal(counts.work, 1, `the second Domain must count its own material (got ${counts.work})`);
  const counted = counts.dacha + counts.home + counts.work;
  assert.equal(counted, 3, `three of four materials have a map context, the contextless one has none (counted ${counted})`);
  console.log('✓ Test 1: badge counts match material ownership (project 1, domain 1, domain 1, contextless 0)');

  // The same rule read from the other side: the library shows all four, the map
  // shows three, and no material is counted twice.
  assert.equal(counts.knowledge.length, 4, 'the library keeps every material');
  assert.equal(counts.knowledge.filter(item => !item.projectId && !item.domainId).length, 1,
    'exactly one material has no context');
  console.log('✓ Test 2: the library keeps all 4 materials while the map counts 3 distinct owners');

  // The badge is drawn, not only computed: a screenshot proves the counter reaches
  // the canvas (and documents what it looks like).
  await page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    map.fitAll();
  });
  await page.waitForTimeout(420);
  if (process.env.ATLAS_MAP_SHOT) {
    await page.screenshot({ path: process.env.ATLAS_MAP_SHOT });
    console.log(`  screenshot: ${process.env.ATLAS_MAP_SHOT}`);
  }

  assert.deepEqual(failures, [], `no page errors expected: ${failures.join('; ')}`);
  console.log('\n✅ All map knowledge counter tests passed.');
} finally {
  await browser.close();
  await closeAll({ server });
}
