// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProposalDetail } from '@tw/shared';
import { ChangePreview } from './change-preview';

// The chip reads the project's mark colours through the router and a query; here only which marks are shown matters.
vi.mock('@/components/status', () => ({ MarkChip: ({ mark }: { mark: string }) => createElement('span', null, `#${mark}`) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function text(props: ComponentProps<typeof ChangePreview>) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ChangePreview, props)));
  return container.textContent ?? '';
}

/** One detail of every kind: a kind added to ProposalDetail without an entry here does not compile. */
const EVERY: { [K in ProposalDetail['kind']]: Extract<ProposalDetail, { kind: K }> } = {
  fields: { kind: 'fields', rows: [{ label: '워크플로', value: '번역' }, { label: '서식 규칙', value: '{\n  "a": 1\n}', code: true }] },
  changes: { kind: 'changes', items: [{ title: '수정 · 인물 · Alice', changes: [{ field: '프로필', before: '밝은 성격', after: '조용한 성격' }] }, { title: '추가 · 노트 · 세계관', changes: [] }] },
  list: { kind: 'list', title: '용어', items: ['추가 · Relay → 중계소'], more: 3 },
  text: { kind: 'text', format: 'plain', text: '{ "from": "a" }' },
  marks: { kind: 'marks', label: '표시', marks: ['aiSuggestion'] },
  lines: { kind: 'lines', total: 60, translations: 30, statuses: 30, tagged: 2, shown: [{ key: 'k0', change: '→ 완료 +#검수' }, { key: 'k1', translation: '번역 1' }] },
  note: { kind: 'note', tone: 'danger', text: '수락하면 바로 지워집니다.', whilePending: true },
};

describe('a proposal\'s card draws what the server says the change does', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('draws every kind of detail by its shape', async () => {
    const shown = await text({ details: Object.values(EVERY) });
    for (const said of ['워크플로', '번역', '"a": 1', '수정 · 인물 · Alice', '밝은 성격', '→ 조용한 성격', '바뀌는 내용이 없습니다.', '추가 · Relay → 중계소', '외 3개', '{ "from": "a" }', '표시', '#aiSuggestion', '대사 60개 · 번역 30 · 상태 30 · 태그 2', '처음 2개만 표시', 'k0', '→ 완료 +#검수', '번역 1', '수락하면 바로 지워집니다.']) expect(shown).toContain(said);
  });

  it('says what accepting does only while the proposal waits; a plain remark stays', async () => {
    const details: ProposalDetail[] = [EVERY.note, { kind: 'note', tone: 'muted', text: '원본은 바뀌지 않습니다.' }];
    expect(await text({ details })).toContain('수락하면 바로 지워집니다.');
    const decided = await text({ details, pending: false });
    expect(decided).not.toContain('수락하면 바로 지워집니다.');
    expect(decided).toContain('원본은 바뀌지 않습니다.');
  });
});
