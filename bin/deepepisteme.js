#!/usr/bin/env node
/**
 * bin/deepepisteme.js: the `deepepisteme` command.
 *
 * The package ships TypeScript source, so the command runs src/cli.ts through
 * tsx, the same runner the package scripts name. tsx is resolved from this
 * package's own node_modules first, then from the working directory's, then
 * from PATH, so the command works from a clone of the package and from a
 * project that has tsx installed. The exit code is the CLI's own.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.ts');

const exe = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
const tsx = [join(root, 'node_modules', '.bin', exe), join(process.cwd(), 'node_modules', '.bin', exe)].find(existsSync) ?? exe;

const run = spawnSync(tsx, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (run.error) {
  console.error(
    `deepepisteme: cannot launch tsx (${run.error.message}); the package ships TypeScript source and needs tsx to run it`
  );
  process.exit(2);
}
process.exit(run.status ?? 1);
