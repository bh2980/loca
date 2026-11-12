import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The web app's own alias, for its tests that import its modules.
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'apps/web/src') } },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/cli/src/**/*.test.ts', 'apps/web/src/lib/**/*.test.ts', 'apps/web/src/components/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // The timeout catches a hang, not a slow machine: with four files at once a test that opens a database and
    // drains a runner passes its usual second several times over. Speed is `pnpm budget`'s to check.
    testTimeout: 20_000,
    // Keep Windows scale checks from competing with the 5-second term benchmark.
    maxWorkers: process.platform === 'win32' ? 1 : 4,
  },
});
