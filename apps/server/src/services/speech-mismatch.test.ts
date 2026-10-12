import { describe, expect, it } from 'vitest';
import { speechMismatch } from './speech.ts';

const rule = (level: string) => ({ level }) as Parameters<typeof speechMismatch>[0];

describe('speechMismatch compares 존댓말/반말 only', () => {
  it.each(['안산다', '저녁먹는다!', '조사를 시작합시다', '그랬던가?', '알았어.', '네.', '용의자.'])('does not flag %j under a hae rule', (text) => {
    expect(speechMismatch(rule('hae'), text)).toBeNull();
  });

  it('still flags a polite ending that is not a "let\'s" under a hae rule', () => {
    expect(speechMismatch(rule('hae'), '그렇죠?')).not.toBeNull();
  });

  it('accepts any plain ending under every 반말 rule and any polite ending under every 존댓말 rule', () => {
    for (const level of ['hae', 'haera', 'hage']) for (const text of ['안산다', '알았어.', '자네도 왔는가?']) expect(speechMismatch(rule(level), text)).toBeNull();
    for (const level of ['hasipsio', 'haeyo', 'hao']) for (const text of ['알겠습니다.', '그렇죠?', '어서 오시오.']) expect(speechMismatch(rule(level), text)).toBeNull();
  });

  it('flags a real mismatch and names both sides', () => {
    expect(speechMismatch(rule('hae'), '알겠습니다.')).toBe('말투 규칙은 반말(해체)인데 번역은 존댓말(하십시오체)로 끝납니다(어미로 추정).');
    expect(speechMismatch(rule('haeyo'), '알았어.')).toBe('말투 규칙은 존댓말(해요체)인데 번역은 반말(해체)로 끝납니다(어미로 추정).');
  });

  it('skips other rules and unguessable text', () => {
    expect(speechMismatch(rule('other'), '알겠습니다.')).toBeNull();
    expect(speechMismatch(rule('hae'), null)).toBeNull();
  });
});
