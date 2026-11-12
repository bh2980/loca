import type { RunCardPlan } from './chat-run.ts';
import type { RunCaps } from './run-scope.ts';
import type { Subject } from './subject.ts';
import { INPUT_TYPES } from './workflow.ts';

/**
 * A run's estimate and caps in words. One wording for every place that says them: the run dialog, the chat's run
 * card (the browser) and the card of a proposed run (the server writes its details).
 */
export interface PaceInput {
  totals: { calls: { min: number; expected: number | null; max: number } };
  pace: { seconds: number | null; costUsd: number | null; subscription: boolean };
}

export const duration = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds / 10) * 10)}초` : seconds < 5400 ? `${Math.round(seconds / 60)}분` : `${(seconds / 3600).toFixed(1)}시간`);

/** AI requests, time and money in plain words; only what is known (no time without history, no cost the provider never reported). */
export function paceParts(data: PaceInput) {
  const calls = data.totals.calls;
  const callText = calls.expected !== null ? `${calls.expected.toLocaleString()}회` : `${calls.min.toLocaleString()}~${calls.max.toLocaleString()}회`;
  const { seconds, costUsd, subscription } = data.pace;
  const money = subscription && !costUsd ? '구독 사용' : costUsd === null ? null : costUsd === 0 && !subscription ? '무료' : costUsd < 0.01 ? '1센트 미만' : `약 $${costUsd.toFixed(2)}${subscription ? ' + 구독' : ''}`;
  return { callText, time: seconds !== null ? duration(seconds) : null, money };
}

/** A run card's numbers in words: how many lines (or terms), requests, time and cost, as they were when the card was made. */
export function cardSummary(input: Subject, plan: RunCardPlan) {
  const unit = INPUT_TYPES[input].unit;
  const { callText, time, money } = paceParts(plan);
  return { targets: `${plan.lines.total.toLocaleString()}${unit}`, empty: plan.lines.total === 0, excluded: plan.lines.excluded, requests: callText, time, money };
}

/** A new run's caps in words, as starting it would set them: what it asks for over the suggestion; 없음 when it has none. */
export function startCaps(asked: RunCaps | undefined, suggested: { maxCalls?: number; maxInputTokens?: number } | undefined) {
  const pick = (key: 'maxCalls' | 'maxInputTokens') => (asked?.[key] === undefined ? suggested?.[key] : asked[key] ?? undefined);
  const calls = pick('maxCalls');
  const input = pick('maxInputTokens');
  const parts = [calls && `호출 ${calls.toLocaleString()}회`, input && `입력 토큰 ${input.toLocaleString()}`].filter(Boolean);
  return parts.length ? `${parts.join(' · ')}에서 멈춤` : '없음';
}
