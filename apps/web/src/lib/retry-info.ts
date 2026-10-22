import { ITEM_ERROR_KINDS, retryWaitText, type ItemErrorKind } from '@tw/shared';

/** The state of a line a 재요청 node sent back: "다시 보냄 2/3" (resends so far / the node's limit). */
export const retryState = (times: number, max: number) => `다시 보냄 ${times}/${max}`;

/** A message on one line, cut at `max` characters with "…". */
export function oneLine(message: string, max = 60) {
  const line = message.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

/**
 * Why a line waits, and for what: "사용량 한도 · 1분 뒤 · connection · model · 429 …". `waitsUntil` (ms) is how long
 * the 재요청 node still holds it (dropped once it is due), `model` the model it will be sent on when that node picked one.
 */
export function retryReason(retry: { kind: ItemErrorKind; message: string; waitsUntil?: number | null; model?: string | null }, now = Date.now()) {
  const seconds = retry.waitsUntil ? Math.ceil((retry.waitsUntil - now) / 1000) : 0;
  return [ITEM_ERROR_KINDS[retry.kind] ?? ITEM_ERROR_KINDS.other, seconds > 0 && `${retryWaitText(seconds)} 뒤`, retry.model, oneLine(retry.message)].filter(Boolean).join(' · ');
}

/** The label of a failed request's kind, for the AI 호출 tab. Requests from before kinds were kept have none. */
export const errorKindLabel = (kind: string | null | undefined) => (kind && kind in ITEM_ERROR_KINDS ? ITEM_ERROR_KINDS[kind as ItemErrorKind] : null);

/** The most common failure kind among lines being resent (ties: the first listed). */
export function topRetryKind(kinds: Record<string, number>): ItemErrorKind | undefined {
  const [top] = Object.entries(kinds).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  return top?.[0] as ItemErrorKind | undefined;
}

/** What a 재요청 node or its chip says while lines are being resent: "다시 보냄 12 · 출력 잘림". Empty when none are. */
export function retryLiveText(retrying?: { count: number; kinds: Record<string, number> }) {
  if (!retrying || retrying.count <= 0) return '';
  const kind = topRetryKind(retrying.kinds);
  return [`다시 보냄 ${retrying.count.toLocaleString()}`, kind && ITEM_ERROR_KINDS[kind]].filter(Boolean).join(' · ');
}
