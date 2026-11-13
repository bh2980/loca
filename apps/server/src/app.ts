import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { streamSSE } from 'hono/streaming';
import type { JSONParsed } from 'hono/utils/types';
import type { z } from 'zod';
import { FEED_EVENT, type ChangeEvent } from '@loca/shared';
import { onError, type Deps, type Env } from './http.ts';
import { rowChangesOf } from './db/row-changes.ts';
import { eventsOf, trackChanges } from './events.ts';
import { feedRows } from './feed.ts';
import { refuse } from './refusal.ts';
import { connectionRoutes, modelTestRoutes } from './routes/ai-settings.ts';
import { appSettingsRoutes } from './routes/app-settings.ts';
import { chatRoutes } from './routes/chat.ts';
import { knowledgeRoutes } from './routes/knowledge.ts';
import { projectRoutes } from './routes/projects.ts';
import { sourceRoutes } from './routes/source.ts';
import { workflowRoutes } from './routes/workflows.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { scriptRoutes } from './routes/script.ts';
import { onRunEnded } from './engine/run-end.ts';
import type { AgentTools } from './services/agent-tools.ts';
import { continueAfterRunEnd } from './services/chat-turn.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createApp(deps: Deps) {
  // The row feed: the database notes each changed row of the browser's collections, and the change
  // event that follows carries them (feed.ts).
  const events = eventsOf(deps.db);
  rowChangesOf(deps.db).listener = (projectId, seq) => events.rowsChanged(projectId, seq);
  events.rowSource = (projectId) => feedRows(deps.db, deps, projectId);
  onRunEnded(deps.db, (sessionId, _runId, status) => continueAfterRunEnd(deps, sessionId, status));
  const api = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', deps);
      // x-client: the browser tab's id, so the event for its own change can say it came from there (#20).
      const changed = await trackChanges(next, c.req.header('x-client')?.slice(0, 64));
      if (changed.topics.size) c.res.headers.set('x-changed', [...changed.topics].join(','));
      // x-seq: the feed's count after this request's last row change; the browser's write waits for an event that far.
      if (changed.seq !== undefined) c.res.headers.set('x-seq', String(changed.seq));
    })
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        // The client may be gone before the write: that is not an error worth crashing for.
        const send = (event: ChangeEvent) => void stream.writeSSE({ event: FEED_EVENT, data: JSON.stringify(event) }).catch(() => {});
        // Shutting down ends the stream cleanly, so browsers reconnect instead of reporting a cut-off response.
        const close = () => stream.abort();
        events.on('change', send);
        events.once('shutdown', close);
        stream.onAbort(() => {
          events.off('change', send);
          events.off('shutdown', close);
        });
        while (!stream.aborted) {
          await stream.writeSSE({ event: 'ping', data: '' }).catch(() => stream.abort());
          await stream.sleep(20_000);
        }
      }),
    )
    .route('/projects', projectRoutes)
    .route('/projects/:projectId', knowledgeRoutes)
    .route('/', sourceRoutes)
    .route('/', workflowRoutes)
    .route('/', chatRoutes)
    .route('/', proposalRoutes)
    .route('/', scriptRoutes)
    .route('/projects/:projectId/connections', connectionRoutes)
    .route('/app/connections', connectionRoutes)
    .route('/', modelTestRoutes)
    .route('/', appSettingsRoutes);

  return new Hono()
    // A local app: refuse other hosts so a web page cannot reach the API via DNS rebinding.
    .use(async (c, next) => {
      const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host)) refuse('forbidden', 'localhost에서만 접근할 수 있습니다.');
      await next();
    })
    .use('/api/*', bodyLimit({ maxSize: 256 * 1024 * 1024 }))
    // JSON only: a 50k-line dialogue graph is 27 MB raw, 6.6 MB gzipped. Event streams (change
    // events, chat) must not be buffered by a compressor.
    .use('/api/*', compress({ contentTypeFilter: /^application\/json/ }))
    .route('/api', api)
    .onError(onError);
}

export type AppType = ReturnType<typeof createApp>;
/** The browser's collections' row types, each from its reader. */
export type { FeedRow } from './feed.ts';
/** What each agent tool takes and answers over this API (`POST /projects/:projectId/tools/:name`, after JSON), by tool name, for the `loca` CLI's typed reads. */
export type ToolInputs = { [K in keyof AgentTools]: z.input<AgentTools[K]['inputSchema']> };
export type ToolResults = { [K in keyof AgentTools]: AgentTools[K] extends { execute?: (...args: never[]) => infer R } ? JSONParsed<Awaited<R>> : never };
