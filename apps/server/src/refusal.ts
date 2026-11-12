import type { z } from 'zod';

/**
 * The one way server code says no to what it was asked. A service (or the engine) throws a Refusal that says what
 * kind of no it is and knows nothing of who asked; each surface words it in one place: the HTTP API gives the kind
 * a status (app.ts, onError) and a tool call answers `{ ok: false, error }` (agent-catalog.ts, catalogOf).
 * Anything else thrown is a fault of the server's, not a refusal, and stays one (a 500, a failed proposal).
 *
 * A function returns `{ ok: false, error }` instead only where its callers keep the outcome as data: a batch that
 * goes on and reports each item (knowledge and term saves), the change gate's check and verdict, and the start or
 * continuation of a run, which a run card, a proposal's check and the chat's picker show beside other things.
 */
export type RefusalKind =
  /** What was asked cannot be done as asked: a value out of range, a rule of the project it would break. */
  | 'invalid'
  /** The thing it names is not there. */
  | 'missing'
  /** It was made from a view that is no longer current (a line changed since it was read). */
  | 'conflict'
  /** Not allowed from where it came. */
  | 'forbidden'
  /** Over a quota for now; `detail.retryAfterSeconds` says when to come back. */
  | 'limited';

export class Refusal extends Error {
  constructor(
    readonly kind: RefusalKind,
    message: string,
    /** Facts the asker can act on, sent along with the message (e.g. retryAfterSeconds). */
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'Refusal';
  }
}

export const isRefusal = (error: unknown, kind?: RefusalKind): error is Refusal => error instanceof Refusal && (kind === undefined || error.kind === kind);

/** Typed `never`, so the code after a call is known unreachable. */
export const refuse: (kind: RefusalKind, message: string, detail?: Record<string, unknown>) => never = (kind, message, detail) => {
  throw new Refusal(kind, message, detail);
};
export const badRequest: (message: string) => never = (message) => refuse('invalid', message);
export const notFound: (what?: string) => never = (what = '항목') => refuse('missing', `${what}을(를) 찾을 수 없습니다.`);
export const conflict: (message: string) => never = (message) => refuse('conflict', message);
export const found = <T>(value: T | undefined, what?: string): T => (value === undefined ? notFound(what) : value);

/** `input` as the schema reads it. A service's own check of what it is handed: a value the schema does not take is refused, naming the first problem. */
export function valid<S extends z.ZodType>(schema: S, input: unknown, what = '입력'): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  return badRequest(`${what}이(가) 올바르지 않습니다: ${[issue?.path.join('.'), issue?.message].filter(Boolean).join(' ')}`);
}
