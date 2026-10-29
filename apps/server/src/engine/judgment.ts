import type * as ai from '@tw/ai';
import type { AiNode } from '@tw/shared';
import type { Outcome } from './ai-output.ts';

/** The choice key for "none of these" (a choice that allows none). */
const NONE = '__none__';

/**
 * An AI node's output as typed questions for a connection that judges instead of writing: 판정 is a
 * pass/fail choice, 선택 a choice among the node's options (and none, when it allows it), JSON a
 * yes/no question per true/false field. The node's instructions are the question.
 */
export function judgmentQuestions(node: AiNode, options: string[]): Record<string, ai.AskQuestion> {
  const instructions = node.config.instructions.trim();
  switch (node.config.output) {
    case 'verdict':
      return {
        verdict: {
          type: 'choice',
          instructions: instructions || 'Is this translation acceptable as is?',
          criteria: { pass: '번역이 원문의 의미·문맥·말투·용어를 지키며 그대로 써도 된다.', fail: '수정이 필요한 문제가 있다.' },
        },
      };
    case 'choice':
      return {
        value: {
          type: 'choice',
          ...(instructions && { instructions }),
          criteria: { ...Object.fromEntries(options.map((option) => [option, option])), ...(node.config.choice.allowNone && { [NONE]: '해당 없음' }) },
        },
      };
    default:
      return Object.fromEntries(node.config.fields.map((field) => [field.name, { type: 'noul' as const, instructions: [instructions, `${field.name}${field.description ? `: ${field.description}` : ''}`].filter(Boolean).join('\n') }]));
  }
}

/** The answers as the node's outcome, in the same shape a writing model's answer is read into (readAiOutput). */
export function judgmentOutcome(node: AiNode, answers: Record<string, ai.AskAnswer>): Outcome {
  switch (node.config.output) {
    case 'verdict': {
      const answer = answers.verdict;
      const passed = answer?.type === 'choice' && answer.choice === 'pass';
      const confidence = answer?.type === 'choice' ? answer.confidence : 0;
      const issues = passed ? [] : ['판정 연결이 수정 필요로 판정했습니다.'];
      return { port: passed ? 'pass' : 'fail', issues, output: { passed, issues, confidence } };
    }
    case 'choice': {
      const answer = answers.value;
      if (answer?.type !== 'choice') return { port: 'error', error: '판정 연결이 선택지로 답하지 않았습니다.', errorKind: 'invalid-output' };
      return { port: 'out', output: { value: answer.choice === NONE ? null : answer.choice, confidence: answer.confidence } };
    }
    default:
      return { port: 'out', output: Object.fromEntries(node.config.fields.map((field) => { const answer = answers[field.name]; return [field.name, answer?.type === 'noul' ? answer.yes >= 0.5 : false]; })) };
  }
}
