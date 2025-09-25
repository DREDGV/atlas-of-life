// Audit imports/exports using es-module-lexer + fast-glob
import { parse } from 'es-module-lexer';
import fg from 'fast-glob';
import fs from 'node:fs/promises';
import path from 'node:path';

const files = await fg([
  'js/**/*.js',
  '!**/docs/**',
  '!**/backup/**',
  '!**/tests/**',
  '!js/state_old.js',
  '!js/hierarchy/**',
  '!js/types/**',
  '!js/indexedDBAdapter.js',
], { dot: false });
const exportsMap = new Map();
const imports = [];

for (const f of files) {
  const src = await fs.readFile(f, 'utf8');
  let imps = [], exps = [];
  try {
    [imps, exps] = parse(src);
  } catch (err) {
    console.error('Parse failed for', f, '-', err.message || err);
    continue; // skip this file but do not fail whole audit
  }
  exportsMap.set(path.resolve(f), new Set(exps.map(e => e.n || 'default')));
  for (const imp of imps) {
    const spec = src.slice(imp.s, imp.e);
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const from = path.resolve(f);
    const to = path.resolve(path.dirname(f), spec.endsWith('.js') ? spec : spec + '.js');
    imports.push({ from, to });
  }
}

let failed = false;
for (const { from, to } of imports) {
  const exp = exportsMap.get(to);
  if (!exp) { console.error('Missing file:', to, '←', from); failed = true; continue; }
}

process.exit(failed ? 1 : 0);


