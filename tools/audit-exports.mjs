// Audit imports/exports using es-module-lexer + fast-glob
import { parse } from 'es-module-lexer';
import fg from 'fast-glob';
import fs from 'node:fs/promises';
import path from 'node:path';

const files = await fg(['js/**/*.js'], { dot: false });
const exportsMap = new Map();
const imports = [];

for (const f of files) {
  const src = await fs.readFile(f, 'utf8');
  const [imps, exps] = parse(src);
  exportsMap.set(path.resolve(f), new Set(exps.map(e => e.n || 'default')));
  for (const imp of imps) {
    const spec = src.slice(imp.s, imp.e);
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const from = path.resolve(f);
    const to = path.resolve(path.dirname(f), spec.endsWith('.js') ? spec : spec + '.js');
    const names = [];
    if (imp.n) names.push(imp.n);
    if (imp.a) for (const a of imp.a) names.push(a.n);
    imports.push({ from, to, names });
  }
}

let failed = false;
for (const { from, to, names } of imports) {
  const exp = exportsMap.get(to);
  if (!exp) { console.error('Missing file:', to, '←', from); failed = true; continue; }
  for (const name of names) if (!exp.has(name)) {
    console.error(`Export "${name}" not found in ${to} ← used by ${from}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);


