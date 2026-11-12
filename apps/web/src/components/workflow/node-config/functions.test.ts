import { describe, expect, it } from 'vitest';
import { FUNCTION_NAMES } from '@tw/shared';
import { FUNCTION_ICON } from '../node-view';
import { FUNCTION_FORMS } from './function';

describe('function nodes in the editor', () => {
  it('has a settings form for every function in FUNCTIONS, and for nothing else', () => {
    expect(Object.keys(FUNCTION_FORMS).sort()).toEqual([...FUNCTION_NAMES].sort());
  });

  it('has an icon for every function in FUNCTIONS, and for nothing else', () => {
    expect(Object.keys(FUNCTION_ICON).sort()).toEqual([...FUNCTION_NAMES].sort());
  });
});
