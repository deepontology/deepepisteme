/**
 * test/layers.ts: the layer and state rules, as a gate.
 *
 * Three rules, each checked on the files themselves:
 *   1. No module-level `let` or `var` under src/kernel or in src/engine.ts.
 *      Configuration lives in a closure, never in module state.
 *   2. Nothing under src/kernel imports outside the kernel. kernel/time.ts
 *      imports nothing at all, so a browser bundle that needs dates pulls in
 *      no schema library.
 *   3. Nothing under src imports from examples/. A country lives outside the
 *      engine package.
 *
 * The check is textual: a module-level declaration is a `let`/`var` starting
 * in column 0 (optionally after `export`). Indented declarations inside a
 * function are ordinary local variables and pass.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');
const KERNEL = join(SRC, 'kernel');
const EXAMPLES = join(ROOT, 'examples');

const failures: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

const IMPORTS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm
];

/** Every module specifier a file names. */
function specifiers(text: string): string[] {
  const seen: string[] = [];
  for (const pattern of IMPORTS) {
    for (const match of text.matchAll(pattern)) {
      if (!seen.includes(match[1])) seen.push(match[1]);
    }
  }
  return seen;
}

/** Absolute path a relative specifier points at, or null for a bare import. */
function target(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return resolve(dirname(file), spec);
}

function inside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + sep);
}

// 1. No module-level let or var under src/kernel, nor in src/engine.ts.
{
  const scoped = [...walk(KERNEL), join(SRC, 'engine.ts')];
  for (const file of scoped) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^(?:export\s+)?(?:let|var)\s/.test(line)) {
          failures.push(`state: ${rel(file)}:${i + 1} declares module-level "${line.trim()}"`);
        }
      });
  }
}

// 2. The kernel is self-contained: relative imports stay inside it, the only
//    package it may name is zod, and time.ts imports nothing at all.
{
  const PACKAGES = new Set(['zod']);
  for (const file of walk(KERNEL)) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const abs = target(file, spec);
      if (abs === null) {
        if (!PACKAGES.has(spec)) {
          failures.push(`kernel: ${rel(file)} imports "${spec}", which is outside the kernel`);
        }
        continue;
      }
      if (!inside(abs, KERNEL)) {
        failures.push(`kernel: ${rel(file)} imports "${spec}", which resolves outside src/kernel`);
      }
    }
  }

  const time = readFileSync(join(KERNEL, 'time.ts'), 'utf8');
  const timeImports = specifiers(time);
  if (timeImports.length > 0) {
    failures.push(`kernel: src/kernel/time.ts must import nothing, found ${timeImports.join(', ')}`);
  }
}

// 3. Nothing under src imports from examples/.
{
  for (const file of walk(SRC)) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const abs = target(file, spec);
      if (abs !== null && inside(abs, EXAMPLES)) {
        failures.push(`layers: ${rel(file)} imports "${spec}" from examples/`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`\n  ✗ layers: ${failures.length} violation(s)\n`);
  for (const f of failures) console.error(`    • ${f}`);
  console.error('');
  process.exit(1);
}

console.log('  ✓ layers: no module state, no kernel escape, no example inside src');
