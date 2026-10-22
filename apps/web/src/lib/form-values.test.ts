import { describe, expect, it } from 'vitest';
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
});
