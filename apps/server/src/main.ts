import path from 'node:path';
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { eq } from 'drizzle-orm';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { openDatabase } from './db/index.ts';
import * as s from './db/schema.ts';
import { Runner } from './engine/runner.ts';
import { computeLayouts } from './services/layout.ts';
import { keyringStore, memoryStore } from './services/secrets.ts';

const db = openDatabase(path.join(config.dataDir, 'workbench.sqlite'));
const secrets = process.env.WORKBENCH_SECRETS === 'memory' ? memoryStore() : keyringStore;
const runner = new Runner(db, secrets);
runner.start();

// Layouts interrupted by a restart are recomputed.
for (const layout of db.select().from(s.graphLayouts).where(eq(s.graphLayouts.status, 'pending')).all()) void computeLayouts(db, layout.projectId);

const app = createApp({ db, secrets, runner });
if (existsSync(config.webDist)) {
  const root = path.relative(process.cwd(), config.webDist);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`loca → http://127.0.0.1:${info.port}  (data: ${config.dataDir})`);
});

const shutdown = async () => {
  await runner.stop();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
