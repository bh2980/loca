import { describe, expect, it } from 'vitest';
import { connectionInputSchema } from '@tw/shared';
import { numberOrNull, numberOrUndefined } from './form-values';

describe('number fields', () => {
  it('reads an empty field as no number, whether it is typed empty or mounts with the stored null', () => {
    for (const empty of ['', null, undefined, '   ', 'abc']) {
      expect(numberOrNull(empty)).toBeNull();
      expect(numberOrUndefined(empty)).toBeUndefined();
    }
    expect(numberOrNull('50000')).toBe(50000);
    expect(numberOrNull(2)).toBe(2);
  });

  it('lets a connection be saved with 입력·출력 토큰 left empty (the model default)', () => {
    const fields = { name: 'OpenAI', inputTokens: numberOrNull(null), outputTokens: numberOrNull(''), maxAttempts: numberOrUndefined('2') };
    expect(connectionInputSchema.omit({ kind: true }).safeParse(fields).success).toBe(true);
    // The old reading turned the mounted null into 0, which the limits refuse.
    expect(connectionInputSchema.omit({ kind: true }).safeParse({ ...fields, inputTokens: Number(null) }).success).toBe(false);
  });
});
