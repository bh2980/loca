import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, translationTemplate, workflowDefinitionSchema, type WorkflowDefinition } from '@tw/shared';
import { copyNodes, freeNodeId, withConnection, withCopies, withNodesMoved, withoutEdges, withoutFrame, withoutNodes } from './definition-edits';

const template = translationTemplate({ model: EMPTY_MODEL_CHOICE, untranslated: 'u', translated: 't', needsReview: 'needs-review', confirmed: 'c', issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' } });
const entry = template.nodes.find((node) => node.type === 'entry')!;
const work = template.nodes.filter((node) => node.type !== 'entry');
const ids = (definition: WorkflowDefinition) => definition.nodes.map((node) => node.id);
const touching = (definition: WorkflowDefinition, id: string) => definition.edges.filter((edge) => edge.source === id || edge.target === id);
/** A line between two work nodes, and one of them with more lines than that. */
const inner = template.edges.find((edge) => edge.source !== entry.id)!;
let made = 0;
const newEdgeId = () => `e-new${++made}`;

describe('deleting from a workflow', () => {
  it('deletes nodes with their lines and their places in frames, keeping the frames', () => {
    const gone = inner.target;
    const after = withoutNodes(template, [gone]);
    expect(ids(after)).not.toContain(gone);
    expect(touching(after, gone)).toEqual([]);
    expect(after.groups!.map((group) => group.id)).toEqual(template.groups!.map((group) => group.id));
    expect(after.groups!.flatMap((group) => group.nodeIds)).not.toContain(gone);
    expect(workflowDefinitionSchema.safeParse(after).success).toBe(true);
  });

  it('never deletes the entry, and deleting nothing is no edit', () => {
    expect(withoutNodes(template, [entry.id])).toBe(template);
    expect(ids(withoutNodes(template, [entry.id, work[0]!.id]))).toContain(entry.id);
  });

  it('keeps the workflow started somewhere when its first node goes', () => {
    const first = template.edges.find((edge) => edge.source === entry.id)!.target;
    const after = withoutNodes(template, [first]);
    expect(after.edges.some((edge) => edge.source === entry.id)).toBe(true);
  });

  it('deletes a frame with the nodes in it, and says which went', () => {
    const frame = template.groups![1]!;
    const { definition, removed } = withoutFrame(template, frame.id);
    expect([...removed].sort()).toEqual([...frame.nodeIds].sort());
    expect(definition.groups!.map((group) => group.id)).not.toContain(frame.id);
    for (const id of frame.nodeIds) expect(ids(definition)).not.toContain(id);
    expect(withoutFrame(template, 'no-such-frame').definition).toBe(template);
  });

  it('deletes lines by id', () => {
    const after = withoutEdges(template, [inner.id]);
    expect(after.edges.map((edge) => edge.id)).not.toContain(inner.id);
    expect(ids(after)).toEqual(ids(template));
  });
});

describe('drawing a line', () => {
  const [from, to] = [inner.source, work.find((node) => node.id !== inner.source && node.id !== inner.target)!.id];

  it('adds a line from an exit; an exit may have several', () => {
    const after = withConnection(template, { source: from, sourceHandle: inner.sourceHandle, target: to }, 'e-drawn');
    expect(after.edges.find((edge) => edge.id === 'e-drawn')).toEqual({ id: 'e-drawn', source: from, sourceHandle: inner.sourceHandle, target: to });
    expect(after.edges.filter((edge) => edge.source === from && edge.sourceHandle === inner.sourceHandle).length).toBeGreaterThan(1);
  });

  it('refuses an exact duplicate and a line from no exit', () => {
    expect(withConnection(template, { source: inner.source, sourceHandle: inner.sourceHandle, target: inner.target }, 'e-dup')).toBe(template);
    expect(withConnection(template, { source: from, sourceHandle: null, target: to }, 'e-none')).toBe(template);
  });
});

describe('moving nodes', () => {
  it('puts moved nodes where they were dropped and leaves the rest', () => {
    const moved = work[0]!;
    const at = { x: moved.position.x + 40, y: moved.position.y - 10 };
    const after = withNodesMoved(template, new Map([[moved.id, at]]), new Map([[moved.id, { dx: 40, dy: -10 }]]));
    expect(after.nodes.find((node) => node.id === moved.id)!.position).toEqual(at);
    expect(after.nodes.find((node) => node.id === work[1]!.id)!.position).toEqual(work[1]!.position);
    // Lines that do not touch the moved node are the same objects: nothing about them changed.
    for (const edge of template.edges.filter((item) => item.source !== moved.id && item.target !== moved.id)) expect(after.edges).toContain(edge);
  });
});

describe('copying nodes', () => {
  it('copies nodes with the lines among them, never the entry', () => {
    const copied = copyNodes(template, [entry.id, inner.source, inner.target]);
    expect(copied.nodes.map((node) => node.id).sort()).toEqual([inner.source, inner.target].sort());
    expect(copied.edges.map((edge) => edge.id)).toContain(inner.id);
    for (const edge of copied.edges) expect([inner.source, inner.target]).toEqual(expect.arrayContaining([edge.source, edge.target]));
    // The copy is its own: changing the workflow afterwards does not change it.
    expect(copied.nodes[0]).not.toBe(template.nodes.find((node) => node.id === copied.nodes[0]!.id));
  });

  it('pastes copies beside the originals under new ids, joined as the originals were', () => {
    const copied = copyNodes(template, [inner.source, inner.target]);
    const { definition, copies } = withCopies(template, copied, newEdgeId);
    expect(copies).toEqual([`${copied.nodes[0]!.id}-copy`, `${copied.nodes[1]!.id}-copy`]);
    const original = template.nodes.find((node) => node.id === copied.nodes[0]!.id)!;
    expect(definition.nodes.find((node) => node.id === copies[0])!.position).toEqual({ x: original.position.x + 240, y: original.position.y });
    expect(definition.edges.some((edge) => edge.source === `${inner.source}-copy` && edge.target === `${inner.target}-copy` && edge.sourceHandle === inner.sourceHandle)).toBe(true);
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it('pasting twice gives ids nothing has yet', () => {
    const copied = copyNodes(template, [inner.source]);
    const once = withCopies(template, copied, newEdgeId);
    const twice = withCopies(once.definition, copied, newEdgeId);
    expect(twice.copies).toEqual([`${inner.source}-copy2`]);
    expect(new Set(ids(twice.definition)).size).toBe(ids(twice.definition).length);
  });

  it('pasting nothing is no edit', () => {
    expect(withCopies(template, { nodes: [], edges: [] }, newEdgeId)).toEqual({ definition: template, copies: [] });
  });

  it('names a new node by its kind, numbered when taken', () => {
    expect(freeNodeId(new Set(['ai', 'ai2']), 'ai')).toBe('ai3');
    expect(freeNodeId(new Set(), 'gather')).toBe('gather');
  });
});
