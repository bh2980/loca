import jsonLogic from 'json-logic-js';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_TEMPLATES } from '@loca/shared';
import { describeRule } from './speech.ts';

const rule = { level: 'hage' as const, address: '자네, 민 군', sometimes: [{ level: 'hae' as const, when: '편할 때' }, { level: 'haera' as const, when: '급할 때' }], never: ['haeyo' as const], examples: ['자네, 정신 차리게.', ' '] };

describe('a speech rule with a spectrum', () => {
  it('reads to a model as conditions, not equal choices, with its lines in the voice', () => {
    expect(describeRule(rule)).toBe('기본 하게체. 편할 때 해체(반말), 급할 때 해라체 (그 밖에는 기본). 쓰지 않음: 해요체. 호칭 "자네" 또는 "민 군". 예: "자네, 정신 차리게."');
    // A rule of one level reads as before.
    expect(describeRule({ level: 'haeyo', address: '언니', sometimes: [], never: [], examples: [] })).toBe('해요체, 호칭 "언니"');
  });

  it('passes the default review\'s speech check for any level the rule uses, usual or sometimes', () => {
    const conditions = WORKFLOW_TEMPLATES.flatMap((template) => template.build({ model: { connectionId: 'c', model: 'm' }, issueTags: {} } as never).nodes)
      .flatMap((node) => (node.type === 'condition' && JSON.stringify(node.config.expression).includes('unit.speechLevels') ? [node.config.expression] : []));
    expect(conditions.length).toBeGreaterThan(0);
    const unit = { speechLevel: '하게체', speechLevels: ['하게체', '해체(반말)', '해라체'] };
    for (const expression of conditions) {
      expect(jsonLogic.apply(expression as jsonLogic.RulesLogic, { outputs: { speech: { value: '해라체' } }, unit })).toBe(true);
      expect(jsonLogic.apply(expression as jsonLogic.RulesLogic, { outputs: { speech: { value: '해요체' } }, unit })).toBe(false);
    }
  });
});
