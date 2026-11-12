import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, translationTemplate, type WorkflowDefinition } from '@loca/shared';
import { addFrame, fitFrames, frameAt, frameBox, frameNodes, groupNodes, groupOf, moveFrame, moveIntoGroup, pruneGroups, renameGroup, resizeFrame, ungroup } from './frames';

const template = translationTemplate({ model: EMPTY_MODEL_CHOICE, untranslated: 'u', translated: 't', needsReview: 'needs-review', confirmed: 'c', issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' } });
const labels = (definition: WorkflowDefinition) => (definition.groups ?? []).map((group) => group.label);
const holding = (definition: WorkflowDefinition, id: string) => definition.groups?.find((group) => group.id === groupOf(definition.groups, id))?.label;

describe('frame edits', () => {
  const first = template.groups![0]!;
  const second = template.groups![1]!;
  const [a, b] = second.nodeIds;

  it('groups nodes into a new frame where the first of them was, taking them out of their old one', () => {
    const { definition, groupId } = groupNodes(template, [a!, b!], {}, '검사 둘', 'g-new');
    expect(groupId).toBe('g-new');
    expect(labels(definition)).toEqual([first.label, '검사 둘', ...labels(template).slice(1)]);
    expect(holding(definition, a!)).toBe('검사 둘');
    expect(definition.groups!.find((group) => group.id === second.id)?.nodeIds).not.toContain(a);
  });

  it('keeps a frame that its nodes all left, empty (only ungrouping removes one)', () => {
    const definition = moveIntoGroup(template, second.nodeIds, first.id);
    expect(definition.groups!.find((group) => group.id === second.id)?.nodeIds).toEqual([]);
    expect(holding(definition, a!)).toBe(first.label);
  });

  it('moves nodes out of every frame with null, and ungrouping keeps the nodes', () => {
    expect(groupOf(moveIntoGroup(template, [a!], null).groups, a!)).toBeUndefined();
    const ungrouped = ungroup(template, second.id);
    expect(labels(ungrouped)).not.toContain(second.label);
    expect(ungrouped.nodes).toEqual(template.nodes);
  });

  it('renames one frame', () => {
    expect(labels(renameGroup(template, first.id, '초벌'))[0]).toBe('초벌');
  });

  it('prunes deleted nodes, keeping the frame they leave', () => {
    const kept = template.nodes.filter((node) => !second.nodeIds.includes(node.id));
    expect(pruneGroups(template.groups, kept)!.find((group) => group.id === second.id)?.nodeIds).toEqual([]);
  });
});

describe('frameAt', () => {
  const shown = [{ id: 'x', position: { x: 0, y: 0 } }, { id: 'y', position: { x: 600, y: 0 } }];
  const frames = frameNodes(shown, [{ id: 'one', label: '1', nodeIds: ['x'] }, { id: 'two', label: '2', nodeIds: ['y'] }], {});
  it('finds the frame whose box holds a point, or none', () => {
    expect(frameAt(frames, { x: 100, y: 30 })).toBe('frame:one');
    expect(frameAt(frames, { x: 700, y: 30 })).toBe('frame:two');
    expect(frameAt(frames, { x: 400, y: 30 })).toBeUndefined();
    expect(frameAt(frames, { x: 100, y: 30 }, 'frame:one')).toBeUndefined();
  });
});

describe('stored frame boxes', () => {
  const nodes = [{ id: 'x', position: { x: 0, y: 0 } }, { id: 'y', position: { x: 600, y: 0 } }];
  const group = { id: 'one', label: '1', nodeIds: ['x'], box: { x: -100, y: -100, width: 500, height: 400 } };
  it('stands at its box, grown only to hold a node of its own outside it', () => {
    expect(frameBox(group, nodes, {})).toEqual(group.box);
    expect(frameBox({ ...group, nodeIds: ['x', 'y'] }, nodes, {})).toEqual({ x: -100, y: -100, width: 600 + 224 + 32 + 100, height: 400 });
    expect(frameBox({ ...group, box: undefined }, nodes, {})).toEqual({ x: -32, y: -64, width: 224 + 64, height: 66 + 96 });
  });
  it('keeps its edge still while nodes are dragged (frozen)', () => {
    const [frame] = frameNodes([{ id: 'x', position: { x: 900, y: 900 } }], [group], {}, undefined, new Map([['one', group.box]]));
    expect(frame!.position).toEqual({ x: -100, y: -100 });
  });
  it('moves with its nodes, resizes, and is stored grown by fitFrames', () => {
    const definition = { ...template, nodes: template.nodes.map((node) => (node.id === template.groups![0]!.nodeIds[0] ? { ...node, position: { x: 0, y: 0 } } : node)), groups: [{ ...template.groups![0]!, nodeIds: [template.groups![0]!.nodeIds[0]!], box: { x: 10, y: 10, width: 50, height: 50 } }] } as WorkflowDefinition;
    expect(moveFrame(definition, definition.groups![0]!.id, 5, 7).groups![0]!.box).toMatchObject({ x: -32 + 5, y: -64 + 7 });
    expect(resizeFrame(definition, definition.groups![0]!.id, { x: 0, y: 0, width: 300, height: 200 }).groups![0]!.box).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(fitFrames(definition, {}).groups![0]!.box).toEqual({ x: -32, y: -64, width: 288, height: 162 });
  });
});

describe('resizeFrame', () => {
  const definition = {
    ...template,
    nodes: template.nodes.map((node, index) => ({ ...node, position: { x: index * 300, y: 0 } })),
  } as WorkflowDefinition;
  const [a, b, c] = definition.nodes.filter((node) => node.type !== 'entry');
  const framed = { ...definition, groups: [{ id: 'one', label: '1', nodeIds: [a!.id, b!.id] }, { id: 'two', label: '2', nodeIds: [] as string[] }] };
  it('takes in a free node it now covers and lets go of one it no longer does', () => {
    const free = { ...framed, groups: [framed.groups[0]!] };
    const box = { x: b!.position.x - 20, y: -40, width: 900, height: 200 };
    const result = resizeFrame(free, 'one', box);
    expect(result.groups![0]!.box).toEqual(box);
    expect(result.groups![0]!.nodeIds).not.toContain(a!.id);
    expect(result.groups![0]!.nodeIds).toContain(c!.id);
  });
  it('leaves a node of another frame where it is', () => {
    const other = { ...framed, groups: [framed.groups[0]!, { id: 'two', label: '2', nodeIds: [c!.id] }] };
    const result = resizeFrame(other, 'one', { x: -20, y: -40, width: 2000, height: 200 });
    expect(result.groups![0]!.nodeIds).not.toContain(c!.id);
    expect(result.groups![1]!.nodeIds).toEqual([c!.id]);
  });
});

describe('addFrame', () => {
  const nodes = template.nodes.map((node, index) => ({ ...node, position: { x: index * 300, y: 0 } }));
  const drawn = nodes.filter((node) => node.type !== 'entry');
  const shown = new Set(drawn.map((node) => node.id));
  it('stands where drawn, takes in the free nodes it covers, and leaves framed ones', () => {
    const [free, framed] = drawn;
    const definition = { ...template, nodes, groups: [{ id: 'one', label: '1', nodeIds: [framed!.id] }] } as WorkflowDefinition;
    const box = { x: Math.min(free!.position.x, framed!.position.x) - 10, y: -10, width: 1000, height: 120 };
    const { definition: next, groupId } = addFrame(definition, box, {}, shown, 'vertical', '새 단계', 'g-drawn');
    const made = next.groups!.find((group) => group.id === groupId)!;
    expect(made.box).toEqual(box);
    expect(made.nodeIds).toContain(free!.id);
    expect(made.nodeIds).not.toContain(framed!.id);
  });
  it('can be empty, and is listed by where it stands across the reading direction', () => {
    const definition = { ...template, nodes, groups: [{ id: 'left', label: 'L', nodeIds: [drawn[0]!.id] }, { id: 'right', label: 'R', nodeIds: [drawn[5]!.id] }] } as WorkflowDefinition;
    const { definition: next } = addFrame(definition, { x: drawn[2]!.position.x, y: 5000, width: 200, height: 120 }, {}, shown, 'vertical', '빈 단계', 'g-empty');
    expect(next.groups!.map((group) => group.id)).toEqual(['left', 'g-empty', 'right']);
    expect(next.groups![1]!.nodeIds).toEqual([]);
    expect(frameNodes([], next.groups, {}).map((frame) => frame.id)).toContain('frame:g-empty');
  });
});
