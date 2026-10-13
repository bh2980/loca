import { hc, type InferResponseType } from 'hono/client';
import type { AppType } from '@tw/server/app';

/** Told the topics a request changed (its x-changed header), to refetch them at once; set by main.tsx. */
let onChanged: (topics: string[]) => void = () => {};
export const setChangeListener = (listener: (topics: string[]) => void) => {
  onChanged = listener;
};

/** Every call through the client: a write's own answer says what it changed, so the screens never wait on the event stream. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
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
