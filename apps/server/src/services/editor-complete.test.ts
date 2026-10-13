import { describe, expect, it } from 'vitest';
import { cleanReply } from './editor-complete.ts';

describe("the editor continuation's reply", () => {
  it('drops echoed labels, tags and quotes', () => {
    expect(cleanReply('TRANSLATION SO FAR: 아 진짜, 거기 가지 말았어야 했어.', 'I should never have gone.')).toBe('아 진짜, 거기 가지 말았어야 했어.');
    expect(cleanReply('<started>아 진짜</started>, 가지 말 걸.', 'x')).toBe('아 진짜, 가지 말 걸.');
    expect(cleanReply('"메타린은 먹었어?"', 'x')).toBe('메타린은 먹었어?');
  });
  it('keeps one line for a one-line source, all lines for a multi-line one', () => {
    expect(cleanReply('메타린은 먹었어?\n\nNote: casual tone.', 'Have you taken it?')).toBe('메타린은 먹었어?');
    expect(cleanReply('첫 줄\n둘째 줄', 'first\nsecond')).toBe('첫 줄\n둘째 줄');
  });
});
