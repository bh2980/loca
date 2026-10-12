import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { Deps, Env } from './context.ts';
import { events, type ChangeEvent } from './events.ts';
import { connectionRoutes, profileRoutes } from './routes/ai-settings.ts';
import { chatRoutes } from './routes/chat.ts';
import { knowledgeRoutes } from './routes/knowledge.ts';
import { projectRoutes } from './routes/projects.ts';
import { sourceRoutes } from './routes/source.ts';
import { workflowRoutes } from './routes/workflows.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { scriptRoutes } from './routes/script.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createApp(deps: Deps) {
  const api = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', deps);
      await next();
    })
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        // The client may be gone before the write: that is not an error worth crashing for.
        const send = (event: ChangeEvent) => void stream.writeSSE({ event: 'change', data: JSON.stringify(event) }).catch(() => {});
        events.on('change', send);
        stream.onAbort(() => void events.off('change', send));
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
    .route('/connections', connectionRoutes)
    .route('/profiles', profileRoutes);

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
