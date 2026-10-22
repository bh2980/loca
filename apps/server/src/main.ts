import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { and, eq, notLike } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { openDatabase } from './db/index.ts';
import * as s from './db/schema.ts';
import { Runner } from './engine/runner.ts';
import { events } from './events.ts';
import { closeStaleCalls } from './services/ai-calls.ts';
import { closeInterruptedProposals } from './services/proposals.ts';
import { computeLayouts, projectsMissingSections, projectsWithOldLayouts, projectsWithoutLayouts } from './services/layout.ts';
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
// Requests a stopped server never heard back from are closed as failed in the AI log.
closeStaleCalls(db);
// Proposals a stopped server was still applying are closed as failed, not run again (see closeInterruptedProposals).
closeInterruptedProposals(db);
const runner = new Runner(db, secrets);
runner.start();

// Layouts interrupted by a restart are recomputed in their stored direction.
const pendingDirections = Map.groupBy(db.select().from(s.graphLayouts).where(and(eq(s.graphLayouts.status, 'pending'), notLike(s.graphLayouts.section, 'view:%'))).all(), (layout) => layout.projectId);
for (const [projectId, layouts] of pendingDirections) for (const direction of new Set(layouts.map((layout) => layout.direction))) void computeLayouts(db, projectId, { direction });
// Section layouts came later: projects laid out before get them once, without redoing the rest.
// Layouts made the old way are made again (whole and per section).
const oldLayouts = projectsWithOldLayouts(db);
const outdated = new Set(oldLayouts.map((layout) => layout.projectId));
for (const layout of oldLayouts) void computeLayouts(db, layout.projectId, { direction: layout.direction });
// Projects that never got a layout (imported outside the import route) get one now.
for (const projectId of projectsWithoutLayouts(db)) if (!outdated.has(projectId)) void computeLayouts(db, projectId);
for (const projectId of projectsMissingSections(db)) if (!outdated.has(projectId)) void computeLayouts(db, projectId, { sectionsOnly: true });

const app = createApp({ db, secrets, runner });
if (existsSync(config.webDist)) {
  // The built app is served as it is: one built before the latest pull shows yesterday's screens.
  const built = statSync(path.join(config.webDist, 'index.html'), { throwIfNoEntry: false })?.mtimeMs ?? 0;
  const source = newestChange(path.join(config.webDist, '..', 'src'));
  if (source > built) console.warn(`웹 빌드(${config.webDist})가 소스보다 오래됐습니다. 이 주소의 화면은 예전 것입니다: pnpm build 를 다시 하거나 pnpm dev 의 주소를 쓰세요.`);
  const root = path.relative(process.cwd(), config.webDist);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`loca → http://127.0.0.1:${info.port}  (data: ${config.dataDir})`);
});

const shutdown = async () => {
  try {
    events.emit('shutdown');
    await runner.stop();
    server.close();
    await ai.stopIdleAgents(true);
  } catch (error) {
    console.error('shutdown failed', error);
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

/** The latest change under a folder (its files' modification times), 0 when it is missing. */
function newestChange(folder: string): number {
  if (!existsSync(folder)) return 0;
  let newest = 0;
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    newest = Math.max(newest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}
