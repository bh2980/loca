import { describe, expect, it } from 'vitest';
import { FUNCTIONS, FUNCTION_NAMES } from '@loca/shared';
import { FUNCTION_IMPLEMENTATIONS } from './index.ts';

describe('function implementations', () => {
  it('has one for every function in FUNCTIONS, and for nothing else', () => {
    expect(Object.keys(FUNCTION_IMPLEMENTATIONS).sort()).toEqual([...FUNCTION_NAMES].sort());
  });

  it.each(FUNCTION_NAMES)('%s runs the way FUNCTIONS says: at once, or as a call out', (fn) => {
    const implementation = FUNCTION_IMPLEMENTATIONS[fn];
    expect('callsOut' in implementation).toBe(FUNCTIONS[fn].callsOut);
    expect('instant' in implementation).toBe(!FUNCTIONS[fn].callsOut);
  });
});
