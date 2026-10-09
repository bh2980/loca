#!/usr/bin/env node
// Runs the TypeScript entry through tsx, so the CLI needs no build step (like the server).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const result = spawnSync(process.execPath, [tsx, join(here, '..', 'src', 'main.ts'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
