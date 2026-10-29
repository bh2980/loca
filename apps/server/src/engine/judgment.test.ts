import { describe, expect, it } from 'vitest';
import { judgmentProblem, workflowNodeSchema, type AiNode } from '@tw/shared';
import { judgmentOutcome, judgmentQuestions } from './judgment.ts';

const node = (config: Record<string, unknown>) => workflowNodeSchema.parse({ id: 'n', type: 'ai', position: { x: 0, y: 0 }, config }) as AiNode;

describe('a judging connection fills the generic outputs', () => {
  it('asks a choice among the options (and none) and reads it back as a choice output', () => {
    const choice = node({ output: 'choice', instructions: '이 번역의 말투는?', choice: { source: 'speechLevels', values: [], allowNone: true } });
    const questions = judgmentQuestions(choice, ['해요체', '해체(반말)']);
    expect(questions.value).toMatchObject({ type: 'choice', instructions: '이 번역의 말투는?', criteria: { 해요체: '해요체', '해체(반말)': '해체(반말)', __none__: '해당 없음' } });
    expect(judgmentOutcome(choice, { value: { type: 'choice', choice: '해요체', confidence: 0.92, probabilities: {} } })).toEqual({ port: 'out', output: { value: '해요체', confidence: 0.92 } });
    expect(judgmentOutcome(choice, { value: { type: 'choice', choice: '__none__', confidence: 0.6, probabilities: {} } }).output).toEqual({ value: null, confidence: 0.6 });
  });

  it('reads a verdict as pass/fail and true/false fields as yes/no', () => {
    const verdict = node({ output: 'verdict' });
    expect(judgmentOutcome(verdict, { verdict: { type: 'choice', choice: 'fail', confidence: 0.8, probabilities: {} } }).port).toBe('fail');
    const json = node({ output: 'json', fields: [{ name: 'isTerm', type: 'boolean', description: 'UI 용어로 쓰였나' }] });
    expect(judgmentQuestions(json, []).isTerm).toMatchObject({ type: 'noul' });
    expect(judgmentOutcome(json, { isTerm: { type: 'noul', yes: 0.7 } }).output).toEqual({ isTerm: true });
  });

  it('refuses what it cannot fill', () => {
    expect(judgmentProblem(node({ output: 'text' }).config)).toMatch(/문장/);
    expect(judgmentProblem(node({ output: 'json', fields: [{ name: 'note', type: 'string' }] }).config)).toMatch(/참\/거짓/);
    expect(judgmentProblem(node({ output: 'choice', choice: { source: 'custom', values: ['a'] } }).config)).toBeNull();
  });
});
