/** The parts of a preflight's estimate that fit in a sentence: shared by the run dialog and the chat's run card. */
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
