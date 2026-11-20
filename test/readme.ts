/**
 * test/readme.ts: the rule register in README.md is the engine's own.
 *
 * The table under "The rule register" is one row per rule in engine.rules,
 * id and title, in register order. This test rebuilds the rows from the
 * engine and fails when the README list drifts from the code, so a rule
 * cannot land without its line and a line cannot outlive its rule.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, type Rule } from '../src/engine.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let passes = 0;

function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

/** The row the README carries for one rule: its ids and its one-line title. */
function row(rule: Rule): string {
  const ids = [rule.id, ...(rule.covers ?? [])].join(' / ');
  return `| ${ids} | ${rule.title} |`;
}

const expected = createEngine(ruritania).rules.map(row);

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const found = readme.split('\n').filter((line) => /^\| V\d/.test(line));

assert(
  'the README lists one row per rule in the engine register',
  found.length === expected.length,
  `README has ${found.length} rule rows, the engine runs ${expected.length}: ${expected.join(' ; ')}`
);
for (let i = 0; i < Math.max(found.length, expected.length); i++) {
  const want = expected[i];
  const got = found[i];
  assert(
    `the README rule row ${i + 1} matches the register`,
    want !== undefined && got === want,
    `README: ${got ?? '(missing)'} / engine: ${want ?? '(no rule)'}`
  );
}

console.log(`\n${passes}/${passes + failures} checks passed\n`);
if (failures) process.exit(1);
