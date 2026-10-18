import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { STYLE_AXES } from '@tw/shared';
import { DraftEditor } from './editor';
import type { Field, KindSpec, Row } from './table';

// Keep real property rows and controls; only the editor's persistence and surrounding data are stubbed.
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock('@/lib/drafts', () => ({ useDraft: (_key: string, saved: string) => [saved, vi.fn(), vi.fn()] }));
vi.mock('@/components/changed-elsewhere', () => ({ ChangedElsewhere: () => null }));
vi.mock('@/components/knowledge/evidence', () => ({ Evidence: () => null }));
vi.mock('@/components/knowledge/table', () => ({
  KINDS: { documents: '문서' },
  SourceBadge: () => null,
  confirmLabel: () => '확정',
  fail: vi.fn(),
  text: (value: unknown) => typeof value === 'string' ? value : '',
}));

function editor(fields: Field[], values: Record<string, unknown> = {}, id = 'item-1') {
  const row: Row = { id, status: 'candidate', origin: 'ai', statusBy: 'ai', evidence: [], ...values };
  const spec: KindSpec = { fields, rows: [row], columns: [], label: () => '자료', save: vi.fn(), remove: vi.fn() };
  return createElement(DraftEditor, { projectId: 'project-1', kind: 'documents', spec, row, characters: [{ id: 'character-1', name: '인물' }], onDecide: vi.fn(), embedded: true });
}

/** A real HTML label gives its target an accessible name and native click-to-focus behavior. */
function labelledControl(html: string, label: string) {
  const match = html.match(new RegExp(`<label\\b[^>]*\\bfor="([^"]+)"[^>]*>${label}</label>`));
  expect(match, `visible label for ${label}`).not.toBeNull();
  const id = match![1];
  const controls = [...html.matchAll(/<(?:input|textarea|button)\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes(` id="${id}"`));
  expect(controls, `one control associated with ${label}`).toHaveLength(1);
  return controls[0];
}

describe('knowledge editor field labels', () => {
  it.each(['text', 'key', 'list', 'chips'] as const)('connects a %s property label to its input', (type) => {
    const html = renderToStaticMarkup(editor([{ name: 'value', label: '입력 이름', type }]));
    expect(labelledControl(html, '입력 이름')).toMatch(/^<input\b/);
  });

  it.each(['docKind', 'character', 'gender', 'ageBand', 'role', 'level'] as const)('connects a %s property label to its select trigger', (type) => {
    const html = renderToStaticMarkup(editor([{ name: 'value', label: '선택 이름', type }]));
    expect(labelledControl(html, '선택 이름')).toContain('role="combobox"');
  });

  it('connects boolean property labels and keeps long text labels', () => {
    const html = renderToStaticMarkup(editor([
      { name: 'enabled', label: '문맥에 넣기', type: 'bool' },
      { name: 'body', label: '본문', type: 'long' },
    ]));
    expect(labelledControl(html, '문맥에 넣기')).toContain('role="switch"');
    expect(labelledControl(html, '본문')).toMatch(/^<textarea\b/);
  });

  it('gives every style axis its own visible label and select target', () => {
    const html = renderToStaticMarkup(editor([{ name: 'style', label: '문체', type: 'style' }]));
    for (const { label } of Object.values(STYLE_AXES)) {
      const control = labelledControl(html, label);
      expect(control).toContain('role="combobox"');
      expect(control).toContain(`aria-label="${label}"`);
    }
  });

  it('keeps repeated field names associated with their own embedded editor', () => {
    const fields: Field[] = [{ name: 'name', label: '이름', type: 'text' }, { name: 'style', label: '문체', type: 'style' }];
    const html = renderToStaticMarkup(createElement(Fragment, null, editor(fields, {}, 'first'), editor(fields, {}, 'second')));
    const ids = [...html.matchAll(/<(?:input|textarea|button)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((match) => match[1]);
    expect(labels.length).toBeGreaterThan(0);
    for (const target of labels) expect(ids.filter((id) => id === target)).toHaveLength(1);
  });
});
