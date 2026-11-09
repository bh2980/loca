import { ITEM_ERROR_KINDS, nodeRetries, retrySummary, retryWaitText, type ItemErrorKind, type WorkflowDefinition, type WorkflowNode } from '@tw/shared';

/** The state of a line a retry rule sent back: "다시 보냄 2/3" (resends so far / the rule's limit). */
export const retryState = (times: number, max: number) => `다시 보냄 ${times}/${max}`;

/** A message on one line, cut at `max` characters with "…". */
export function oneLine(message: string, max = 60) {
  const line = message.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

/**
 * Why a line waits, and for what: "사용량 한도 · 1분 뒤 · connection · model · 429 …". `waitsUntil` (ms) is how long
 * the retry rule still holds it (dropped once it is due), `model` the model it will be sent on when that rule picked one.
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

/** What an AI node says while its retry rules resend lines: "다시 보냄 12 · 출력 잘림". Empty when none are. */
export function retryLiveText(retrying?: { count: number; kinds: Record<string, number> }) {
  if (!retrying || retrying.count <= 0) return '';
  const kind = topRetryKind(retrying.kinds);
  return [`다시 보냄 ${retrying.count.toLocaleString()}`, kind && ITEM_ERROR_KINDS[kind]].filter(Boolean).join(' · ');
}

/**
 * An AI node's retry rules on its card: "재시도 규칙 2개" (no one line is sent back that many times: each rule counts its own
 * failures), each rule in `detail`; "재시도 안 함" when it has none. Undefined for any other node.
 */
export function retryBadge(definition: Pick<WorkflowDefinition, 'settings'>, node: WorkflowNode): { text: string; detail?: string } | undefined {
  if (node.type !== 'ai') return undefined;
  const rules = nodeRetries(definition, node);
  if (!rules.length) return { text: '재시도 안 함' };
  return { text: `재시도 규칙 ${rules.length}개${node.config.retries ? '' : ' · 워크플로 기본'}`, detail: rules.map(retrySummary).join('\n') };
}
