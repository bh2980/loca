import { describe, expect, it } from 'vitest';
import { sameWorkflowDraft } from './workflow-draft';

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
