import path from 'node:path';
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { eq } from 'drizzle-orm';
import { agentShellApp, createApp } from './app.ts';
import { setAgentShellUrl } from './services/cli-chat.ts';
import { config } from './config.ts';
import { openDatabase } from './db/index.ts';
import * as s from './db/schema.ts';
import { Runner } from './engine/runner.ts';
import { events } from './events.ts';
import { TermService } from './services/terms.ts';
import { closeStaleCalls } from './services/ai-calls.ts';
import { closeInterruptedProposals } from './services/proposals.ts';
import { computeLayouts, projectsMissingSections, projectsWithOldLayouts, projectsWithoutLayouts } from './services/layout.ts';
import { keyringStore, memoryStore } from './services/secrets.ts';
import { fillDefaultModels } from './services/routes.ts';
import { migrateApplyCandidate } from './services/workflow-migrations.ts';

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
// Jobs of the old analysis service (before #47 analyses are workflow runs) that a stop cut off.
db.update(s.analysisJobs).set({ status: 'failed', error: '서버가 다시 시작되어 중단되었습니다.', finishedAt: new Date() }).where(eq(s.analysisJobs.status, 'running')).run();
// AI nodes saved before their connection had a default model get it now (also done when a connection is saved).
fillDefaultModels(db);
// Workflows saved before #42 drop the status node's "apply candidate"; translations now write on the spot.
migrateApplyCandidate(db);
// Terms counted as used nowhere are counted again (speaker names were once missed); fillTermUsage counts lines that are null.
db.update(s.terms).set({ lines: null }).where(eq(s.terms.lines, 0)).run();
const runner = new Runner(db, secrets);
runner.start();

// Layouts interrupted by a restart are recomputed.
for (const layout of db.select().from(s.graphLayouts).where(eq(s.graphLayouts.status, 'pending')).all()) void computeLayouts(db, layout.projectId);
// Section layouts came later: projects laid out before get them once, without redoing the rest.
// Layouts made the old way are made again (whole and per section).
const outdated = new Set(projectsWithOldLayouts(db));
for (const projectId of outdated) void computeLayouts(db, projectId);
// Projects that never got a layout (imported outside the import route) get one now.
for (const projectId of projectsWithoutLayouts(db)) if (!outdated.has(projectId)) void computeLayouts(db, projectId);
for (const projectId of projectsMissingSections(db)) if (!outdated.has(projectId)) void computeLayouts(db, projectId, { sectionsOnly: true });

const app = createApp({ db, secrets, runner, terms: new TermService(db, secrets) });
if (existsSync(config.webDist)) {
  const root = path.relative(process.cwd(), config.webDist);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`loca → http://127.0.0.1:${info.port}  (data: ${config.dataDir})`);
});
// Codex's shell reaches only this (see agentShellApp); without IPv6 loopback, Codex chats refuse to start.
const agentShell = serve({ fetch: agentShellApp(app).fetch, hostname: '::1', port: 0 }, (info) => setAgentShellUrl(`http://[::1]:${info.port}`));
agentShell.on('error', (error) => console.error('agent tool listener on ::1 failed; Codex chats are off', error));

const shutdown = async () => {
  try {
    events.emit('shutdown');
    await runner.stop();
    server.close();
    agentShell.close();
  } catch (error) {
    console.error('shutdown failed', error);
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

