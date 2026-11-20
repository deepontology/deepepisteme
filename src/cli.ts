/**
 * cli.ts: `deepepisteme check <dir>` — the gate for one deployment directory.
 *
 *   tsx src/cli.ts check examples/ruritania
 *
 * `<dir>` is a deployment directory: a `deployment.ts` that default-exports a
 * Deployment, and a `data/` folder with one YAML list per registered kind
 * (a missing file is zero records, not a failure). Every record goes through
 * the engine's parse stage with the exception register in `<dir>/data/`
 * source-exceptions.yaml, when that file exists, then through resolve and every
 * rule in the engine's register: exit 0 when no finding is an error, exit 1
 * naming every finding otherwise.
 *
 * The deployment module is imported by path at run time, so this file names
 * no country and holds no example inside src/.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { createEngine, type Deployment, type RawDataset } from './engine.ts';
import type { ExceptionRegister } from './kernel/exceptions.ts';

interface RegisterEntry {
  rule: string;
  kind: string;
  id: string;
  deadline: string;
  reason: string;
  implied?: string;
  authored?: string;
}

/** The dated escape register, when the deployment ships one. */
function readRegister(dir: string, cutoff: number): ExceptionRegister | undefined {
  const path = join(dir, 'data', 'source-exceptions.yaml');
  if (!existsSync(path)) return undefined;
  const raw = parseYaml(readFileSync(path, 'utf8'));
  const entries: RegisterEntry[] = Array.isArray(raw) ? raw : [];
  const sourceExceptions = new Map<string, { rule: string; expires: string; reason: string }>();
  const basisOverrides = new Map<string, { reason: string; source: string }>();
  for (const entry of entries) {
    if (entry.rule === 'basis-override' && entry.implied && entry.authored) {
      basisOverrides.set(`${entry.kind}:${entry.id}:${entry.implied}>${entry.authored}`, {
        reason: entry.reason,
        source: entry.deadline
      });
    } else {
      sourceExceptions.set(`${entry.kind}:${entry.id}`, {
        rule: entry.rule,
        expires: entry.deadline,
        reason: entry.reason
      });
    }
  }
  return { sourceExceptions, basisOverrides };
}

async function main(): Promise<number> {
  const [command, dir] = process.argv.slice(2);
  if (command !== 'check' || !dir) {
    console.error('usage: deepepisteme check <deployment-dir>');
    return 2;
  }

  const deploymentPath = join(dir, 'deployment.ts');
  if (!existsSync(deploymentPath)) {
    console.error(`check: ${dir}/deployment.ts not found`);
    return 2;
  }
  const loaded = (await import(pathToFileURL(deploymentPath).href)) as {
    default: Deployment;
  };
  const engine = createEngine(loaded.default);

  const register = readRegister(dir, engine.time.cutoff);
  const raw: Record<string, unknown[]> = {};
  for (const def of engine.kinds.values()) {
    const path = join(dir, 'data', def.file);
    if (!existsSync(path)) continue;
    const parsed = parseYaml(readFileSync(path, 'utf8'));
    raw[def.kind] = Array.isArray(parsed) ? parsed : [];
  }

  const { findings, resolved } = engine.check(raw as RawDataset, register);
  const records = resolved?.records ?? engine.parse(raw as RawDataset, register).records;

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity !== 'error');
  for (const f of warnings) console.log(`  ⚠ ${f.rule} ${f.message}`);

  if (errors.length > 0) {
    console.error(`\n  ✗ check failed with ${errors.length} error(s):\n`);
    for (const f of errors) console.error(`    • ${f.rule} ${f.message}`);
    return 1;
  }

  const kept = Object.entries(records)
    .filter(([, list]) => list.length > 0)
    .map(([kind, list]) => `${list.length} ${kind}`)
    .join(', ');
  console.log(`  ✓ ${dir} checks clean — ${kept || 'no records'}`);
  return 0;
}

main().then((code) => {
  process.exit(code);
});
