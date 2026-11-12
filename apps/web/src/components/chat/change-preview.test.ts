// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangePreview } from './change-preview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function text(props: ComponentProps<typeof ChangePreview>) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ChangePreview, props)));
  return container.textContent ?? '';
}

const plan = { lines: { total: 40, excluded: 3 }, totals: { calls: { min: 2, expected: null, max: 9 } }, pace: { seconds: null, costUsd: null, subscription: false } };
const details = { items: [], refs: { w1: '번역', g1: '부두', g2: '창고', g3: '등대', g4: '시장', s1: '미번역', n1: 'AI 번역', c1: '내 연결' } };

describe('the card of a proposed run', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('says how much it takes in and what narrows it', async () => {
    const shown = await text({ name: 'start_run', input: { workflowId: 'w1', filter: { kind: 'ui', statuses: ['s1'], speakers: ['MIRA'], listeners: ['-'], q: 'tide' } }, details, run: { input: 'lines', plan } });
    expect(shown).toContain('번역');
    expect(shown).toContain('40줄 · AI 요청 2~9회');
    expect(shown).toContain('번역 제외 3줄');
    for (const said of ['UI', '미번역', 'MIRA', '청자 모름', 'tide']) expect(shown).toContain(said);
    expect(shown).not.toContain('프로젝트 전체');
  });

  it('says the whole project only when nothing narrows it, and never the conditions that no longer exist', async () => {
    const shown = await text({ name: 'start_run', input: { workflowId: 'w1' }, details, run: { input: 'lines', plan } });
    expect(shown).toContain('프로젝트 전체');
    expect(shown).not.toContain('진입');
    expect(shown).toContain('그대로 두고 실행 상세에 남김');
  });

  it('names a few scenes and counts the rest', async () => {
    const shown = await text({ name: 'start_run', input: { workflowId: 'w1', filter: { groups: ['g1', 'g2', 'g3', 'g4'] } }, details });
    expect(shown).toContain('부두, 창고, 등대 외 1개');
  });

  it('a terms run speaks of the glossary, with nothing about what a person decided on lines', async () => {
    const shown = await text({ name: 'start_run', input: { workflowId: 'w1' }, details, run: { input: 'terms', plan } });
    expect(shown).toContain('용어집 전체');
    expect(shown).toContain('40개');
    expect(shown).not.toContain('사람이 정한 것');
  });

  it('says which models a run picked, and asks about cost only while it waits', async () => {
    const input = { workflowId: 'w1', models: { n1: { connection: 'c1', model: 'gpt-x' } } };
    expect(await text({ name: 'start_run', input, details })).toContain('AI 번역 → 내 연결 · gpt-x');
    expect(await text({ name: 'start_run', input, details })).toContain('AI 호출 비용');
    expect(await text({ name: 'start_run', input, details, pending: false })).not.toContain('AI 호출 비용');
  });
});
