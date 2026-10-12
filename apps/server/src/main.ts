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
import { AnalysisService } from './services/analysis.ts';
import { TermService } from './services/terms.ts';
import { computeLayouts, projectsMissingSections } from './services/layout.ts';
import { keyringStore, memoryStore } from './services/secrets.ts';

// A stray rejected promise (a client that vanished, a failed background job) must not take the server down.
process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason));
// After an uncaught exception Node's state is unreliable: log and exit.
process.on('uncaughtException', (error) => {
  console.error('uncaught exception', error);
  process.exit(1);
});

const db = openDatabase(path.join(config.dataDir, 'workbench.sqlite'));
const secrets = process.env.WORKBENCH_SECRETS === 'memory' ? memoryStore() : keyringStore;
const runner = new Runner(db, secrets);
runner.start();

// Layouts interrupted by a restart are recomputed.
for (const layout of db.select().from(s.graphLayouts).where(eq(s.graphLayouts.status, 'pending')).all()) void computeLayouts(db, layout.projectId);
// Section layouts came later: projects laid out before get them once, without redoing the rest.
for (const projectId of projectsMissingSections(db)) void computeLayouts(db, projectId, { sectionsOnly: true });

const app = createApp({ db, secrets, runner, analysis: new AnalysisService(db, secrets), terms: new TermService(db, secrets) });
if (existsSync(config.webDist)) {
  const root = path.relative(process.cwd(), config.webDist);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`loca → http://127.0.0.1:${info.port}  (data: ${config.dataDir})`);
});

const shutdown = async () => {
  try {
    await runner.stop();
    server.close();
  } catch (error) {
    console.error('shutdown failed', error);
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

