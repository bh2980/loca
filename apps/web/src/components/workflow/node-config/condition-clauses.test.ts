import { describe, expect, it } from 'vitest';
import { conditionExpression, parseCondition, type Condition } from './condition-clauses';

describe('condition rows', () => {
  it('reads every row kind back from the JSON Logic it writes', () => {
    const condition: Condition = {
      join: 'or',
      clauses: [
        { kind: 'status', statusId: 's1' },
        { kind: 'lineKind', value: 'ui' },
        { kind: 'tag', tagId: 't1' },
        { kind: 'mark', mark: 'ai' },
        { kind: 'visits', nodeId: 'review', limit: 3 },
        { kind: 'field', nodeId: 'listener', field: 'confidence', op: '>=', value: 0.7 },
        { kind: 'field', nodeId: 'check', field: 'passed', op: '==', value: true },
        { kind: 'field', nodeId: 'listener', field: 'value', op: 'filled', value: '' },
        { kind: 'listenerKnown' },
        { kind: 'candidate' },
      ],
    };
    expect(parseCondition(conditionExpression(condition))).toEqual(condition);
  });

  it('reads the default workflows’ conditions, including the object form of "!!"', () => {
    expect(parseCondition({ and: [{ '!!': [{ var: 'outputs.listener.value' }] }, { '>=': [{ var: 'outputs.listener.confidence' }, 0.7] }] })).toEqual({
      join: 'and',
      clauses: [
        { kind: 'field', nodeId: 'listener', field: 'value', op: 'filled', value: '' },
        { kind: 'field', nodeId: 'listener', field: 'confidence', op: '>=', value: 0.7 },
      ],
    });
    expect(parseCondition({ '!!': { var: 'candidate' } })).toEqual({ join: 'and', clauses: [{ kind: 'candidate' }] });
    expect(parseCondition({ '!=': [{ var: 'outputs.listener.value' }, null] })).toEqual({ join: 'and', clauses: [{ kind: 'field', nodeId: 'listener', field: 'value', op: 'filled', value: '' }] });
    expect(parseCondition({ var: 'listenerKnown' })).toEqual({ join: 'and', clauses: [{ kind: 'listenerKnown' }] });
  });

  it('writes one row as the rule itself and none as null', () => {
    expect(conditionExpression({ join: 'and', clauses: [{ kind: 'candidate' }] })).toEqual({ '!!': [{ var: 'candidate' }] });
    expect(conditionExpression({ join: 'and', clauses: [] })).toBeNull();
  });

  it('leaves what rows cannot say to JSON', () => {
    expect(parseCondition({ and: [{ var: 'listenerKnown' }, { '>': [{ var: 'issues.length' }, 2] }] })).toBeNull();
    expect(parseCondition({ if: [true, 1, 2] })).toBeNull();
  });
});
