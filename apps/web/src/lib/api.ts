import { hc, type InferResponseType } from 'hono/client';
import type { AppType } from '@tw/server/app';

/** Told the topics a request changed (its x-changed header), to refetch them at once; set by main.tsx. */
let onChanged: (topics: string[]) => void = () => {};
export const setChangeListener = (listener: (topics: string[]) => void) => {
  onChanged = listener;
};

/** Refetch these topics now, for changes whose response could not say so (a streamed chat turn). */
export const notifyChanged = (topics: string[]) => onChanged(topics);

/**
 * This tab's id, sent with every call (x-client): the server names it on an event made only by this
 * tab's own writes, whose answers already refetched those topics, so the tab skips it (#20, lib/live.ts).
 */
// randomUUID needs a secure context; a page opened over plain http on another host still gets an id.
export const CLIENT_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Every call through the client: a write's own answer says what it changed, so the screens never wait on the event stream. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-client', CLIENT_ID);
  const response = await fetch(input, { ...init, headers });
  const changed = response.headers.get('x-changed');
  if (changed) onChanged(changed.split(','));
  return response;
}

/** Typed client generated from the server's Hono routes. */
export const client = hc<AppType>('/', { fetch: apiFetch }).api;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Await a client call and return its JSON body, throwing the server's error message on failure. */
export async function unwrap<T extends Response & { json(): Promise<unknown> }>(request: Promise<T>): Promise<Awaited<ReturnType<T['json']>>> {
  const response = await request;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; success?: boolean; error_?: unknown };
    const message = typeof body.error === 'string' ? body.error : `요청이 실패했습니다 (HTTP ${response.status})`;
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as Awaited<ReturnType<T['json']>>;
}

export type { InferResponseType };
