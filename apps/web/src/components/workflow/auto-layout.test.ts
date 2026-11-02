import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, nodePorts, translationTemplate, WORKFLOW_TEMPLATES, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@tw/shared';
import { workflowPortTone } from './node-view.tsx';
import { autoLayout } from './auto-layout';

const definition = translationTemplate({
  model: EMPTY_MODEL_CHOICE,
  untranslated: 'untranslated',
  translated: 'translated',
  needsReview: 'needs-review',
  confirmed: 'confirmed',
  issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' },
});

function sizesFor(direction: 'vertical' | 'horizontal') {
  return new Map(definition.nodes.map((node) => [node.id, node.type === 'entry'
    ? { width: direction === 'vertical' ? 224 : 288, height: 88 }
    : node.type === 'end'
      ? { width: direction === 'vertical' ? 224 : 288, height: 80 }
      : { width: direction === 'vertical' ? 224 : 288, height: direction === 'vertical' ? 148 : 164 }])) as Map<string, { width: number; height: number }>;
}

const nodeSize = (node: WorkflowNode, direction: 'vertical' | 'horizontal') => sizesFor(direction).get(node.id)!;
const rect = (node: WorkflowNode, direction: 'vertical' | 'horizontal') => {
  const size = nodeSize(node, direction);
  return { left: node.position.x, top: node.position.y, right: node.position.x + size.width, bottom: node.position.y + size.height };
};
const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const portLabel = (node: WorkflowNode, edge: WorkflowEdge) => nodePorts(node).find((port) => port.id === edge.sourceHandle)?.label ?? edge.sourceHandle;

function expectNoNodeOverlap(result: WorkflowDefinition, direction: 'vertical' | 'horizontal') {
  for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
    expect(overlaps(rect(result.nodes[i]!, direction), rect(result.nodes[j]!, direction)), `${result.nodes[i]!.id} overlaps ${result.nodes[j]!.id}`).toBe(false);
  }
}

function expectForwardSpacing(result: WorkflowDefinition, direction: 'vertical' | 'horizontal') {
  // The entry node is not drawn (its 시작 mark is on the first node), so the drawn path starts at 번역.
  const chain = ['translate', 'save', 'check', 'glossary', 'review', 'terms'];
  const gaps = chain.slice(1).map((id, index) => {
    const before = result.nodes.find((node) => node.id === chain[index])!;
    const after = result.nodes.find((node) => node.id === id)!;
    const beforeRect = rect(before, direction), afterRect = rect(after, direction);
    return direction === 'vertical' ? afterRect.top - beforeRect.bottom : afterRect.left - beforeRect.right;
  });
  expect(Math.min(...gaps), 'main path layers leave room for output labels and returns').toBeGreaterThanOrEqual(100);
}

function expectEdgesUseTheirDeclaredPorts(result: WorkflowDefinition, direction: 'vertical' | 'horizontal') {
  const nodes = new Map(result.nodes.map((node) => [node.id, node]));
  const pointFor = (edge: WorkflowEdge, end: 'source' | 'target') => end === 'source' ? edge.layout!.points[0]! : edge.layout!.points.at(-1)!;
  for (const edge of result.edges) {
    const source = nodes.get(edge.source)!;
    const target = nodes.get(edge.target)!;
    const path = edge.layout?.points;
    expect(path?.length, `${edge.id} has a saved ELK route`).toBeGreaterThanOrEqual(2);
    const start = pointFor(edge, 'source'), finish = pointFor(edge, 'target');
    const sourceRect = rect(source, direction), targetRect = rect(target, direction);
    const sourcePorts = nodePorts(source);
    const sourcePortIndex = sourcePorts.findIndex((port) => port.id === edge.sourceHandle);
    expect(sourcePortIndex, `${edge.id} uses a declared source port`).toBeGreaterThanOrEqual(0);
    if (direction === 'vertical') {
      expect(start.y).toBeCloseTo(sourceRect.bottom, 0);
      expect(start.x).toBeGreaterThanOrEqual(sourceRect.left);
      expect(start.x).toBeLessThanOrEqual(sourceRect.right);
      expect(start.x).toBeCloseTo(sourceRect.left + ((sourcePortIndex + 0.5) / sourcePorts.length) * (sourceRect.right - sourceRect.left), 0);
      expect(finish.y).toBeCloseTo(targetRect.top, 0);
      expect(finish.x).toBeGreaterThanOrEqual(targetRect.left);
      expect(finish.x).toBeLessThanOrEqual(targetRect.right);
    } else {
      expect(start.x).toBeCloseTo(sourceRect.right, 0);
      expect(start.y).toBeGreaterThanOrEqual(sourceRect.top);
      expect(start.y).toBeLessThanOrEqual(sourceRect.bottom);
      expect(start.y).toBeCloseTo(sourceRect.top + ((sourcePortIndex + 0.5) / sourcePorts.length) * (sourceRect.bottom - sourceRect.top), 0);
      expect(finish.x).toBeCloseTo(targetRect.left, 0);
      expect(finish.y).toBeGreaterThanOrEqual(targetRect.top);
      expect(finish.y).toBeLessThanOrEqual(targetRect.bottom);
    }
  }

  // Outgoing handles stay in the declared order; multiple edges from one handle share a port.
  for (const source of result.nodes) {
    const order = new Map(nodePorts(source).map((port, index) => [port.id, index]));
    const exits = [...new Set(result.edges.filter((edge) => edge.source === source.id).map((edge) => edge.sourceHandle))]
      .sort((a, b) => order.get(a)! - order.get(b)!);
    const coords = exits.map((handle) => pointFor(result.edges.find((edge) => edge.source === source.id && edge.sourceHandle === handle)!, 'source'));
    const cross = (point: { x: number; y: number }) => direction === 'vertical' ? point.x : point.y;
    for (let index = 1; index < coords.length; index++) expect(cross(coords[index]!)).toBeGreaterThanOrEqual(cross(coords[index - 1]!));
  }
}

function expectRoutesAvoidUnrelatedNodes(result: WorkflowDefinition, direction: 'vertical' | 'horizontal') {
  for (const edge of result.edges) {
    const points = edge.layout!.points;
    for (const node of result.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      const box = rect(node, direction);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!;
        const horizontal = a.y === b.y && a.y > box.top && a.y < box.bottom && Math.max(Math.min(a.x, b.x), box.left) < Math.min(Math.max(a.x, b.x), box.right);
        const vertical = a.x === b.x && a.x > box.left && a.x < box.right && Math.max(Math.min(a.y, b.y), box.top) < Math.min(Math.max(a.y, b.y), box.bottom);
        expect(horizontal || vertical, `${edge.id} crosses unrelated node ${node.id}`).toBe(false);
      }
    }
  }
}

/**
 * No two lines of different exits run along the same track for more than a few pixels (each line can be followed),
 * but lines into the same node merge before its input; and no line's mark sits on a track it shares.
 */
function expectNoSharedRuns(result: WorkflowDefinition) {
  type Run = { edge: string; exit: string; target: string; flat: boolean; at: number; low: number; high: number };
  const runs: Run[] = result.edges.flatMap((edge) => (edge.layout?.points ?? []).slice(1).map((point, index) => {
    const from = edge.layout!.points[index]!;
    const flat = Math.abs(from.y - point.y) < 0.5;
    return { edge: edge.id, exit: `${edge.source}:${edge.sourceHandle}`, target: edge.target, flat, at: flat ? from.y : from.x, low: Math.min(flat ? from.x : from.y, flat ? point.x : point.y), high: Math.max(flat ? from.x : from.y, flat ? point.x : point.y) };
  }));
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i]!, b = runs[j]!;
    if (a.exit === b.exit || a.flat !== b.flat || Math.abs(a.at - b.at) > 1) continue;
    const shared = Math.min(a.high, b.high) - Math.max(a.low, b.low);
    if (shared <= 8) continue;
    expect(a.target, `${a.edge} and ${b.edge} share a track`).toBe(b.target);
    // Only an exit with actions has a mark on its line.
    for (const run of [a, b].filter((item) => { const [node, port] = item.exit.split(':'); return result.nodes.find((candidate) => candidate.id === node)?.exits?.[port!]?.length; })) {
      const mark = result.edges.find((edge) => edge.id === run.edge)?.layout?.labelPosition;
      const on = mark && (run.flat ? Math.abs(mark.y - run.at) < 1 : Math.abs(mark.x - run.at) < 1) && (run.flat ? mark.x : mark.y) > Math.max(a.low, b.low) && (run.flat ? mark.x : mark.y) < Math.min(a.high, b.high);
      expect(on, `${run.edge}'s mark sits on the track it shares`).toBeFalsy();
    }
  }
}

function expectLabelsStayClear(result: WorkflowDefinition, direction: 'vertical' | 'horizontal') {
  const nodes = new Map(result.nodes.map((node) => [node.id, node]));
  const labels = result.edges.map((edge) => {
    expect(edge.layout?.labelPosition, `${edge.id} saves its output label position`).toBeDefined();
    const source = nodes.get(edge.source)!;
    const label = portLabel(source, edge) + (result.edges.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length > 1 ? ' · 모두 보냄' : '');
    return { edge, label, ...edge.layout!.labelPosition! };
  });
  for (const item of labels) {
    // Match the label box ELK measured (12px per Korean code point, 20px high).
    const width = Math.max(36, [...item.label].length * 12 + 8), height = 20;
    const labelRect = { left: item.x - width / 2, right: item.x + width / 2, top: item.y - height / 2, bottom: item.y + height / 2 };
    for (const node of result.nodes) expect(overlaps(labelRect, rect(node, direction)), `${item.edge.id} label overlaps node ${node.id}`).toBe(false);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i]!, b = labels[j]!;
    const aw = Math.max(36, [...a.label].length * 12 + 8), bw = Math.max(36, [...b.label].length * 12 + 8);
    const collide = Math.abs(a.x - b.x) * 2 < aw + bw && Math.abs(a.y - b.y) * 2 < 40;
    expect(collide, `${a.edge.id} and ${b.edge.id} labels overlap`).toBe(false);
  }
}

describe('workflow auto layout direction on the review-loop template', () => {
  it.each(['vertical', 'horizontal'] as const)('in frames: keeps the nodes apart, each frame together, and every line on its ports in %s mode', async (direction) => {
    const result = await autoLayout(definition, sizesFor(direction), direction);
    expectNoNodeOverlap(result, direction);
    expectEdgesUseTheirDeclaredPorts(result, direction);
    expectRoutesAvoidUnrelatedNodes(result, direction);
    expectNoSharedRuns(result);
    // Frames do not overlap: the boxes of their nodes stay apart.
    const boxes = (result.groups ?? []).map((group) => {
      const rects = group.nodeIds.map((id) => rect(result.nodes.find((node) => node.id === id)!, direction));
      return { id: group.id, left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.id} overlaps ${boxes[j]!.id}`).toBe(false);
  });

  // A node left out of every frame is a block of its own; frames of different widths that share a column stack, not overlap.
  it.each(['vertical', 'horizontal'] as const)('stores each frame\'s box, none overlapping, with a node out of every frame in %s mode', async (direction) => {
    const loose = { ...definition, groups: definition.groups!.map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => id !== 'check') })) };
    for (const input of [definition, loose]) {
      const result = await autoLayout(input, sizesFor(direction), direction);
      const boxes = (result.groups ?? []).map((group) => ({ id: group.id, left: group.box!.x, top: group.box!.y, right: group.box!.x + group.box!.width, bottom: group.box!.y + group.box!.height }));
      expect(boxes.length).toBe(input.groups!.length);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.id} overlaps ${boxes[j]!.id}`).toBe(false);
      for (const group of result.groups ?? []) for (const id of group.nodeIds) {
        const node = rect(result.nodes.find((item) => item.id === id)!, direction);
        expect(node.left >= group.box!.x && node.right <= group.box!.x + group.box!.width && node.top >= group.box!.y && node.bottom <= group.box!.y + group.box!.height, `${id} inside ${group.id}`).toBe(true);
      }
    }
  });

  // Every exit with actions has a mark of 120 × 22: on a line between frames it sits in the room between them, never in a
  // frame by the node; an exit no line leaves keeps its mark's room inside its frame.
  it.each(['vertical', 'horizontal'] as const)('puts the marks of lines between frames outside every frame and keeps room for end marks in %s mode', async (direction) => {
    const room = { width: 120, height: 22 };
    const marked = (nodeId: string, port: string) => (definition.nodes.find((node) => node.id === nodeId)?.exits?.[port]?.length ? room : undefined);
    const tagRoom = { edge: (edge: WorkflowEdge) => marked(edge.source, edge.sourceHandle), exit: marked };
    const result = await autoLayout(definition, sizesFor(direction), direction, tagRoom);
    const frameOf = (id: string) => result.groups!.find((group) => group.nodeIds.includes(id));
    const boxes = result.groups!.map((group) => group.box!);
    const crossing = result.edges.filter((edge) => frameOf(edge.source) && frameOf(edge.target) && frameOf(edge.source) !== frameOf(edge.target) && marked(edge.source, edge.sourceHandle));
    expect(crossing.length).toBeGreaterThan(0);
    for (const edge of crossing) {
      const at = edge.layout!.labelPosition!;
      const inside = boxes.some((box) => at.x > box.x && at.x < box.x + box.width && at.y > box.y && at.y < box.y + box.height);
      expect(inside, `${edge.id}'s mark ${JSON.stringify(at)} is outside every frame ${JSON.stringify(boxes)} ${JSON.stringify(edge.layout!.points)}`).toBe(false);
    }
    // AI 검수's 오류 ends the line (검토 필요): its frame keeps the room for the mark after the exit.
    const review = result.nodes.find((node) => node.id === 'review')!;
    const box = frameOf('review')!.box!;
    const size = nodeSize(review, direction);
    if (direction === 'vertical') expect(box.y + box.height - (review.position.y + size.height)).toBeGreaterThanOrEqual(room.height + 28);
    else expect(box.x + box.width - (review.position.x + size.width)).toBeGreaterThanOrEqual(room.width);
  });

  it.each(['vertical', 'horizontal'] as const)('places an empty frame after the block before it, apart from the others, in %s mode', async (direction) => {
    const groups = [...definition.groups!];
    groups.splice(1, 0, { id: 'empty', label: '빈 단계', nodeIds: [], box: { x: 0, y: 0, width: 320, height: 200 } });
    const result = await autoLayout({ ...definition, groups }, sizesFor(direction), direction);
    const boxes = result.groups!.map((group) => ({ id: group.id, left: group.box!.x, top: group.box!.y, right: group.box!.x + group.box!.width, bottom: group.box!.y + group.box!.height }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.id} overlaps ${boxes[j]!.id}`).toBe(false);
    const empty = boxes.find((box) => box.id === 'empty')!;
    const before = boxes.find((box) => box.id === groups[0]!.id)!;
    expect(direction === 'vertical' ? empty.left >= before.right : empty.top >= before.bottom).toBe(true);
  });

  it.each(['vertical', 'horizontal'] as const)('without frames: keeps all 12 nodes readable and routes their declared ports in %s mode', async (direction) => {
    const result = await autoLayout({ ...definition, groups: undefined }, sizesFor(direction), direction);

    expect(result.direction).toBe(direction);
    // The review-loop fixture: tags and statuses are exit actions, so only the real steps are nodes (12) and the failing exits of the checks all lead back to 재번역.
    expect(result.nodes).toHaveLength(12);
    expect(result.edges).toHaveLength(14);
    expectNoNodeOverlap(result, direction);
    expectForwardSpacing(result, direction);
    expectEdgesUseTheirDeclaredPorts(result, direction);
    expectRoutesAvoidUnrelatedNodes(result, direction);
    expectLabelsStayClear(result, direction);
  });

  it.each(['vertical', 'horizontal'] as const)('routes the revise loop\'s way back around unrelated node interiors in %s mode', async (direction) => {
    const result = await autoLayout({ ...definition, groups: undefined }, sizesFor(direction), direction);
    const feedback = result.edges.find((edge) => edge.id === 'revised-true-check')!;
    expect(feedback.source).toBe('revised');
    expect(feedback.target).toBe('check');
    expect(feedback.layout!.points.length).toBeGreaterThanOrEqual(2);
    expectRoutesAvoidUnrelatedNodes({ ...result, edges: [feedback] }, direction);
  });

  it.each(WORKFLOW_TEMPLATES.map((template) => template.key))('lays out the %s template top to bottom without overlaps, its main path in execution order', async (key) => {
    // The flat layout: a template's frames are laid out across, tested above.
    const template = { ...WORKFLOW_TEMPLATES.find((candidate) => candidate.key === key)!.build({ model: EMPTY_MODEL_CHOICE, issueTags: { format: 'f', term: 't', speech: 'sp', meaning: 'm', style: 'st', other: 'o', aiFailed: 'a' }, needsReview: 's' }), groups: undefined };
    const sizes = new Map(template.nodes.map((node) => [node.id, { width: 224, height: 148 }]));
    const result = await autoLayout(template, sizes, 'vertical');
    for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
      const a = result.nodes[i]!, b = result.nodes[j]!;
      const box = (node: WorkflowNode) => ({ left: node.position.x, top: node.position.y, right: node.position.x + 224, bottom: node.position.y + 148 });
      expect(overlaps(box(a), box(b)), `${a.id} overlaps ${b.id}`).toBe(false);
    }
    // Follow the first 'out' exit from the entry: every step lies below the one before.
    let node: WorkflowNode = result.nodes.find((candidate) => candidate.type === 'entry')!;
    for (;;) {
      const next = result.edges.find((edge) => edge.source === node.id && edge.sourceHandle === 'out');
      const target = next && result.nodes.find((candidate) => candidate.id === next.target);
      if (!target) break;
      expect(target.position.y, `${target.id} below ${node.id}`).toBeGreaterThan(node.position.y);
      node = target;
    }
  });

  it('keeps failure/false ports as warnings and runtime error ports as destructive', () => {
    expect(workflowPortTone('fail')).toBe('warning');
    expect(workflowPortTone('false')).toBe('warning');
    expect(workflowPortTone('error')).toBe('destructive');

    const aiNode = definition.nodes.find((node) => node.id === 'translate')!;
    expect(nodePorts(aiNode).map((port) => port.id)).toEqual(['out', 'error']);
    expect(nodePorts(aiNode).map((port) => port.label)).toEqual(['완료', '오류']);
  });
});
