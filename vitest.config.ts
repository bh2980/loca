import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/web/src/lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Keep Windows scale checks from competing with the 5-second term benchmark.
    maxWorkers: process.platform === 'win32' ? 1 : 4,
  },
});
