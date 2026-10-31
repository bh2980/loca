import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { Deps, Env } from './context.ts';
import { rowChangesOf } from './db/row-changes.ts';
import { events, trackChanges, type ChangeEvent } from './events.ts';
import { feedRows } from './feed.ts';
import { connectionRoutes, modelTestRoutes } from './routes/ai-settings.ts';
import { appSettingsRoutes } from './routes/app-settings.ts';
import { chatRoutes } from './routes/chat.ts';
import { knowledgeRoutes } from './routes/knowledge.ts';
import { projectRoutes } from './routes/projects.ts';
import { sourceRoutes } from './routes/source.ts';
import { workflowRoutes } from './routes/workflows.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { scriptRoutes } from './routes/script.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createApp(deps: Deps) {
  // The row feed: the database notes each changed row of the browser's collections, and the change
  // event that follows carries them (feed.ts).
  rowChangesOf(deps.db.$client).listener = (projectId, seq) => events.rowsChanged(projectId, seq);
  events.rowSource = (projectId) => feedRows(deps.db, deps, projectId);
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
        const send = (event: ChangeEvent) => void stream.writeSSE({ event: 'change', data: JSON.stringify(event) }).catch(() => {});
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
      if (!LOCAL_HOSTS.has(host)) throw new HTTPException(403, { message: 'localhost에서만 접근할 수 있습니다.' });
      await next();
    })
    .use('/api/*', bodyLimit({ maxSize: 256 * 1024 * 1024 }))
    // JSON only: a 50k-line dialogue graph is 27 MB raw, 6.6 MB gzipped. Event streams (change
    // events, chat) must not be buffered by a compressor.
    .use('/api/*', compress({ contentTypeFilter: /^application\/json/ }))
    .route('/api', api)
    .onError((error, c) => {
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
      console.error(error);
      return c.json({ error: error instanceof Error ? error.message : '알 수 없는 오류' }, 500);
    });
}

export type AppType = ReturnType<typeof createApp>;
