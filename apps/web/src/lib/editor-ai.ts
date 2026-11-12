import { client } from './api';
import { feed } from './feed';

/**
 * The editor's own AI calls on one line (설정 › 에디터: its models, context and instructions), not through the chat:
 * a continuation of what is typed, and AI 번역 / 다듬기. Each is a model call the person waits for and may cancel
 * (`signal` closes the request, which stops the call). A refusal is not thrown: its body says why and how long to
 * wait (a daily cap), which the editor shows in place.
 */
type Refused = { error?: string; retryAfterSeconds?: number };
export interface AiAnswer<T> {
  ok: boolean;
  body: Partial<T> & Refused;
}

/** The answer's body whatever its status and, for a call that wrote rows (a candidate), once the feed has brought them. */
async function answered<T>(projectId: string, request: Promise<Response>): Promise<AiAnswer<T>> {
  const response = await request;
  const body = (await response.json().catch(() => ({}))) as Partial<T> & Refused;
  const seq = response.headers.get('x-seq');
  if (response.ok && seq !== null) await feed.wait(projectId, Number(seq));
  return { ok: response.ok, body };
}

/** The whole line as the AI would write it, starting with `prefix`. Nothing is saved. */
export const completeLine = (projectId: string, unitId: string, prefix: string, signal: AbortSignal) =>
  answered<{ text: string }>(projectId, client.units[':unitId'].complete.$post({ param: { unitId }, json: { prefix } }, { init: { signal } }));

/**
 * AI 번역 / 다듬기 of a line: the answer becomes a candidate of the line (`suggest`: one that waits as its AI 제안).
 * `unchanged`: the AI's answer is the text the line already has.
 */
export const assistLine = (projectId: string, unitId: string, json: { mode: 'translate' | 'refine'; draft: string; suggest?: boolean }, signal?: AbortSignal) =>
  answered<{ text: string; reasons: string[]; unchanged: boolean }>(projectId, client.units[':unitId'].assist.$post({ param: { unitId }, json }, { init: { signal } }));
