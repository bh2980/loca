import { describe, expect, it } from 'vitest';
import { errorKindLabel, oneLine, retryLiveText, retryReason, retryState, topRetryKind } from './retry-info';

describe('retry info', () => {
  it('words a resent line', () => {
    expect(retryState(2, 3)).toBe('다시 보냄 2/3');
    expect(retryReason('cut-off', '모델 출력이\n잘렸습니다')).toBe('출력 잘림 · 모델 출력이 잘렸습니다');
    expect(oneLine('가'.repeat(80), 10)).toBe(`${'가'.repeat(10)}…`);
  });
  it('names the most common kind', () => {
    expect(topRetryKind({ timeout: 2, 'cut-off': 5 })).toBe('cut-off');
    expect(topRetryKind({})).toBeUndefined();
    expect(retryLiveText({ count: 12, kinds: { 'cut-off': 9, timeout: 3 } })).toBe('다시 보냄 12 · 출력 잘림');
    expect(retryLiveText({ count: 0, kinds: {} })).toBe('');
    expect(retryLiveText()).toBe('');
  });
  it('labels a failed request, if its kind was kept', () => {
    expect(errorKindLabel('timeout')).toBe('시간 초과');
    expect(errorKindLabel(null)).toBeNull();
    expect(errorKindLabel('nope')).toBeNull();
  });
});
