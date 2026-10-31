import { describe, expect, it } from 'vitest';
import { openDatabase } from './index.ts';

describe('0105: conditions on automatic tags that became row facts', () => {
  it('ask for the fact instead, inside and/or/not; other marks and rules stay', () => {
    const db = openDatabase(':memory:');
    const rewrite = (expression: unknown) => {
      const definition = JSON.stringify({ nodes: [{ id: 'c', type: 'condition', config: { expression } }, { id: 'a', type: 'ai', config: { expression: { in: ['ai', { var: 'unit.marks' }] } } }] });
      const row = db.$client.prepare('select fact_conditions(?) as value').get(definition) as { value: string };
      return JSON.parse(row.value).nodes as { config: { expression: unknown } }[];
    };
    const [condition, other] = rewrite({ and: [{ in: ['remaining', { var: 'unit.marks' }] }, { '!': [{ in: ['ai', { var: 'unit.marks' }] }] }, { in: ['unknownListener', { var: 'unit.marks' }] }, { in: ['noted', { var: 'unit.marks' }] }, { in: ['aiSuggestion', { var: 'unit.marks' }] }] });
    expect(condition!.config.expression).toEqual({
      and: [
        { '!': [{ '!!': [{ var: 'unit.final' }] }] },
        { '!': [{ '==': [{ var: 'unit.statusBy' }, 'ai'] }] },
        { '!!': [{ var: 'unit.listenerUnknown' }] },
        { '!!': [{ var: 'unit.noted' }] },
        { in: ['aiSuggestion', { var: 'unit.marks' }] },
      ],
    });
    // Only condition nodes are read.
    expect(other!.config.expression).toEqual({ in: ['ai', { var: 'unit.marks' }] });
  });
});
