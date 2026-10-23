import { describe, expect, it } from 'vitest';
import { ATTACH_KINDS, fillPromptTarget, runKindsLeft, RUN_SCOPE_KINDS, shortLabel } from './attach.ts';
import { savedPromptsSchema } from './agent.ts';

describe('what a run can be pointed at', () => {
  it('a lines workflow takes scenes, lines, tags, statuses and people; a terms workflow takes terms', () => {
    expect(RUN_SCOPE_KINDS.lines).toEqual(['장면', '대사', '태그', '상태', '인물']);
    expect(RUN_SCOPE_KINDS.terms).toEqual(['용어']);
    for (const kind of [...RUN_SCOPE_KINDS.lines, ...RUN_SCOPE_KINDS.terms]) expect(ATTACH_KINDS).toContain(kind);
  });
  it('once a scene is picked lines and people leave the list, and the other way round; tags and statuses stay', () => {
    expect(runKindsLeft('lines', [])).toEqual(['장면', '대사', '태그', '상태', '인물']);
    expect(runKindsLeft('lines', [{ kind: '장면' }])).toEqual(['장면', '태그', '상태']);
    expect(runKindsLeft('lines', [{ kind: '대사' }])).toEqual(['대사', '태그', '상태', '인물']);
    expect(runKindsLeft('lines', [{ kind: '인물' }, { kind: '태그' }])).toEqual(['대사', '태그', '상태', '인물']);
    expect(runKindsLeft('lines', [{ kind: '태그' }])).toEqual(['장면', '대사', '태그', '상태', '인물']);
    expect(runKindsLeft('terms', [{ kind: '용어' }])).toEqual(['용어']);
  });
});

describe('{대상} in a saved prompt', () => {
  it('the first slot is replaced by the pick\'s name; text without one is unchanged', () => {
    expect(fillPromptTarget('{대상}에서 말투가 어색한 곳을 짚어 줘', '폐허의 만남')).toBe('폐허의 만남에서 말투가 어색한 곳을 짚어 줘');
    expect(fillPromptTarget('{대상}과 {대상}', 'A')).toBe('A과 {대상}');
    expect(fillPromptTarget('이 장면을 요약해 줘', 'A')).toBe('이 장면을 요약해 줘');
  });
  it('a saved prompt may use it and any name that has no space or slash', () => {
    expect(savedPromptsSchema.safeParse([{ name: '어색한곳', text: '{대상}에서 말투가 어색한 곳을 짚어 줘' }]).success).toBe(true);
  });
});

describe('short names', () => {
  it('collapses spaces, drops asset prefixes and cuts long names with an ellipsis', () => {
    expect(shortLabel('  Greywater   Ferry ')).toBe('Greywater Ferry');
    expect(shortLabel('asset-1a2b-3c · Hello')).toBe('Hello');
    expect(shortLabel('x'.repeat(40), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
