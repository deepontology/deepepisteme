/**
 * test/cli.ts: the `deepepisteme check <dir>` command, as a child process.
 *
 * The bin launcher is what a caller runs (`npx deepepisteme check <dir>`), so
 * the test spawns it with node and reads its exit code and output: 0 on the
 * example deployment, 1 on a copy with one record broken. The copy is built
 * in the OS temp directory and removed afterwards; its deployment's imports
 * are rewritten to the engine's absolute paths, because the relative path
 * only resolves inside examples/.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'deepepisteme.js');

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

/** One run of the command, as a child process, from the package root. */
function check(dir: string) {
  return spawnSync(process.execPath, [BIN, 'check', dir], { cwd: ROOT, encoding: 'utf8' });
}

// Exit 0 on the example deployment, the one a clone ships with.
{
  const run = check(join('examples', 'ruritania'));
  assert('the command exits 0 on the example deployment', run.status === 0, `${run.status} ${run.stdout}${run.stderr}`);
  assert('the command reports what it checked', /checks clean/.test(run.stdout), `${run.stdout}${run.stderr}`);
}

// Exit 1 on a copy with one record broken: a second company carrying the
// registration number the example already uses, V3's unique half. No schema
// sees it, so the finding has to come from the rule register.
{
  const work = mkdtempSync(join(tmpdir(), 'deepepisteme-check-'));
  try {
    const copy = join(work, 'ruritania');
    cpSync(join(ROOT, 'examples', 'ruritania'), copy, { recursive: true });

    const dep = readFileSync(join(copy, 'deployment.ts'), 'utf8');
    writeFileSync(
      join(copy, 'deployment.ts'),
      dep.replaceAll('../../src/', `${pathToFileURL(join(ROOT, 'src')).href}/`)
    );

    const companies = readFileSync(join(copy, 'data', 'companies.yaml'), 'utf8');
    writeFileSync(
      join(copy, 'data', 'companies.yaml'),
      `${companies}
- id: ruritania-railways-again
  legal_name_en: "Ruritanian Railways Company (a second record)"
  registration: { registry: company-register, number: "CRN-1001", date: "1962-09-01" }
  sources: [gazette-2022-decree-44]
`
    );

    const run = check(copy);
    assert('the command exits 1 on the broken copy', run.status === 1, `${run.status} ${run.stdout}${run.stderr}`);
    assert(
      'the failure names V3 and the record that broke it',
      /V3/.test(run.stderr) && /ruritania-railways-again/.test(run.stderr),
      run.stderr
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n${passes}/${passes + failures} checks passed\n`);
if (failures) process.exit(1);
