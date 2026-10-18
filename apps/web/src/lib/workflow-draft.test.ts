import { describe, expect, it } from 'vitest';
import { normalizeWorkflowDraft, reconcileSavedDraft, sameWorkflowDraft } from './workflow-draft';

const base = { name: '번역', definition: { nodes: [{ id: 'entry', position: { x: 0, y: 0 }, config: { statusIds: ['a'] } }], edges: [] } };

describe('sameWorkflowDraft', () => {
  it('treats a rebuild of the same definition as unchanged', () => {
    expect(sameWorkflowDraft(structuredClone(base), base)).toBe(true);
  });
  it('notices a moved node', () => {
    const moved = structuredClone(base);
    moved.definition.nodes[0].position.x = 40;
    expect(sameWorkflowDraft(moved, base)).toBe(false);
  });
  it('notices a changed nested value', () => {
    const changed = structuredClone(base);
    changed.definition.nodes[0].config.statusIds.push('b');
    expect(sameWorkflowDraft(changed, base)).toBe(false);
  });
  it('notices an added key and a rename', () => {
    expect(sameWorkflowDraft({ ...structuredClone(base), name: '복사' }, base)).toBe(false);
    expect(sameWorkflowDraft({ name: base.name, definition: { ...base.definition, meta: {} } }, base)).toBe(false);
  });
});

describe('reconcileSavedDraft', () => {
  const sent = { ...base, baseVersion: 2 };
  it('clears only the exact edit that was saved', () => {
    expect(reconcileSavedDraft(structuredClone(sent), sent, 3)).toBeNull();
  });
  it('preserves typing during a save and rebases the next request', () => {
    expect(reconcileSavedDraft({ ...sent, name: '계속 편집' }, sent, 3)).toEqual({ ...sent, name: '계속 편집', baseVersion: 3 });
  });
  it('does not revive a discarded draft or rebase an unrelated revision', () => {
    expect(reconcileSavedDraft(null, sent, 3)).toBeNull();
    const later = { ...sent, name: '다른 버전', baseVersion: 4 };
    expect(reconcileSavedDraft(later, sent, 3)).toEqual(later);
  });
});

describe('normalizeWorkflowDraft', () => {
  const saved = { ...base, baseVersion: 2 };
  const sent = { ...structuredClone(base), name: '번역 개선', baseVersion: 2 };

  it('drops a no-op when there is no save in flight', () => {
    expect(normalizeWorkflowDraft(structuredClone(saved), saved, null)).toBeNull();
  });

  it('keeps an undo to the old saved state while another edit is saving', () => {
    const undo = structuredClone(saved);
    expect(normalizeWorkflowDraft(undo, saved, sent)).toEqual(undo);
    expect(reconcileSavedDraft(undo, sent, 3)).toEqual({ ...undo, baseVersion: 3 });
  });
});
