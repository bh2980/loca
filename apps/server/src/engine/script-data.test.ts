import { describe, expect, it } from 'vitest';
import { validateScriptData } from './functions/index.ts';

describe('validateScriptData', () => {
  const fields = [
    { name: 'n', type: 'number' as const, description: '' },
    { name: 'b', type: 'boolean' as const, description: '' },
    { name: 's', type: 'string' as const, description: '' },
  ];
  it('fills missing fields with their type default and keeps extras', () => {
    expect(validateScriptData({ extra: 1 }, fields)).toEqual({ extra: 1, n: 0, b: false, s: '' });
    expect(validateScriptData(undefined, [])).toEqual({});
  });
  it('coerces numbers, booleans and strings', () => {
    expect(validateScriptData({ n: '3.5', b: 1, s: 7 }, fields)).toEqual({ n: 3.5, b: true, s: '7' });
  });
  it('names the field whose value is not a number', () => {
    expect(() => validateScriptData({ n: 'abc' }, fields)).toThrow("'n'");
  });
});
