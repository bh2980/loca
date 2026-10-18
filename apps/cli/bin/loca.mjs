#!/usr/bin/env node
// Runs the TypeScript entry through tsx, so the CLI needs no build step (like the server).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, '..', 'src', 'main.ts'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
