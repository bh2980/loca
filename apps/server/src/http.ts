import type { ErrorHandler, ValidationTargets } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import type { Db } from './db/index.ts';
import type { SecretStore } from './domain/secrets.ts';
import type { Runner } from './engine/runner.ts';
import { badRequest, Refusal, type RefusalKind } from './refusal.ts';

/*
 * The HTTP side of the server: what every route is given, how its input is checked, and what a service's
 * "no" is as a response. Only this module, app.ts, feed.ts and routes/ know the web framework.
 */

/** What the app is made with (createApp) and every route reads from `c.var.deps`. */
export interface Deps {
  db: Db;
  secrets: SecretStore;
  runner: Runner;
}

export type Env = { Variables: { deps: Deps } };

// Refusals live in a leaf module that knows nothing of HTTP (refusal.ts); routes reach them here.
export { badRequest, found, notFound } from './refusal.ts';

/**
 * zod validation that fails with a readable 400 instead of returning the raw parse error,
 * which also keeps error shapes out of the typed RPC responses.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(target: Target, schema: Schema) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      badRequest(`입력이 올바르지 않습니다: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim());
    }
  });

/** What each kind of refusal is over HTTP. */
const REFUSAL_STATUS = { invalid: 400, missing: 404, conflict: 409, forbidden: 403, limited: 429 } as const satisfies Record<RefusalKind, number>;

/**
 * The API's error handler, and the one place a service's "no" (refusal.ts) gets an HTTP status: the app answers
 * every route's errors with it (app.ts), and so does a test that mounts routes on their own.
 */
export const onError: ErrorHandler = (error, c) => {
  // A refusal's detail rides along (retryAfterSeconds of a quota), beside the message every client reads.
  if (error instanceof Refusal) return c.json({ ...error.detail, error: error.message }, REFUSAL_STATUS[error.kind]);
  // Hono's own (a body over the limit, a malformed request).
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: error instanceof Error ? error.message : '알 수 없는 오류' }, 500);
};
