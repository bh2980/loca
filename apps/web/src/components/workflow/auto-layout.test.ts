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
  aiFailedTag: 'ai-failed',
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
  const chain = ['entry', 'translate', 'save', 'check', 'review', 'confirm'];
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

describe('workflow auto layout direction on the relay retry pipeline', () => {
  it.each(['vertical', 'horizontal'] as const)('keeps all 28 nodes readable and routes their declared ports in %s mode', async (direction) => {
    const result = await autoLayout(definition, sizesFor(direction), direction);

    expect(result.direction).toBe(direction);
    // The review-loop fixture: two chained 재요청 nodes and a failure marker (검토 필요로 / AI 실패 태그) behind each of its four AI nodes, and the 태그 붙이기·떼기 node on each exit of the checks.
    expect(result.nodes).toHaveLength(28);
    expect(result.edges).toHaveLength(37);
    expectNoNodeOverlap(result, direction);
    expectForwardSpacing(result, direction);
    expectEdgesUseTheirDeclaredPorts(result, direction);
    expectRoutesAvoidUnrelatedNodes(result, direction);
    expectLabelsStayClear(result, direction);
  });

  it.each(['vertical', 'horizontal'] as const)('routes the retry feedback around unrelated node interiors in %s mode', async (direction) => {
    const result = await autoLayout(definition, sizesFor(direction), direction);
    const feedback = result.edges.find((edge) => edge.id === 'save-revision-out-check')!;
    expect(feedback.source).toBe('save-revision');
    expect(feedback.target).toBe('check');
    expect(feedback.layout!.points.length).toBeGreaterThanOrEqual(2);
    expectRoutesAvoidUnrelatedNodes({ ...result, edges: [feedback] }, direction);
  });

  it.each(WORKFLOW_TEMPLATES.map((template) => template.key))('lays out the %s template top to bottom without overlaps, its main path in execution order', async (key) => {
    const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.key === key)!.build({ model: EMPTY_MODEL_CHOICE, aiFailedTag: 't', needsReview: 's' });
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
