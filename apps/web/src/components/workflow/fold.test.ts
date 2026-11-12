import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, translationTemplate, workflowDefinitionSchema, workflowNodeSchema, type WorkflowDefinition, type WorkflowEdge } from '@tw/shared';
import {
  allFoldsOpen, computeFolds, foldContaining, foldedDefinition, foldIssues, foldLiveText, foldPlacements, foldText, isFoldOpen, NO_OPEN_FOLDS,
  openFoldContaining, setAllFolds, toggleFold, type Fold,
} from './fold';

const template = translationTemplate({ model: EMPTY_MODEL_CHOICE, untranslated: 'u', translated: 't', needsReview: 'needs-review', confirmed: 'c', issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' } });

const node = (id: string, type: string, config: unknown = {}, label?: string) => workflowNodeSchema.parse({ id, type, label, position: { x: 0, y: 0 }, config });
const fn = (id: string, name: string, params: Record<string, unknown> = {}, label?: string) => node(id, 'function', { fn: name, params }, label);
const edge = (source: string, sourceHandle: string, target: string): WorkflowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });
const definition = (nodes: ReturnType<typeof node>[], edges: WorkflowEdge[]) => workflowDefinitionSchema.parse({ nodes: [node('entry', 'entry'), ...nodes], edges: [edge('entry', 'out', nodes[0]!.id), ...edges] }) as WorkflowDefinition;
const ids = (folds: Fold[]) => folds.map((fold) => fold.id).sort();
const find = (folds: Fold[], id: string) => folds.find((fold) => fold.id === id);

describe('computeFolds on the 번역 template', () => {
  const folds = computeFolds(template);
  it('has nothing left to fold: tags and statuses are exit actions, not nodes, so every node is on the main path or loops back', () => {
    expect(folds).toEqual([]);
  });
  it('draws every node and line while no fold exists', () => {
    const drawn = foldedDefinition(template, folds, new Set());
    expect(drawn.definition).toBe(template);
    expect(drawn.hidden.size).toBe(0);
    expect(drawn.definition.edges.map((item) => item.id)).toContain('revised-true-check');
  });
});

describe('computeFolds on small definitions', () => {
  it('folds a dead-end chain on an error exit', () => {
    const d = definition([fn('a', 'http'), fn('h', 'http'), fn('m', 'saveCandidate', {}, '후보 저장'), fn('next', 'script')], [
      edge('a', 'out', 'next'), edge('a', 'error', 'h'), edge('h', 'out', 'm'),
    ]);
    const folds = computeFolds(d);
    expect(folds).toEqual([{ id: 'a:error', kind: 'branch', owner: 'a', port: 'error', nodeIds: ['h', 'm'] }]);
    expect(foldContaining(folds, 'm')?.id).toBe('a:error');
  });
  it('does not fold a branch that joins the main path again', () => {
    const d = definition([fn('a', 'http'), fn('b', 'script'), fn('side', 'script'), fn('main', 'script')], [
      edge('a', 'out', 'main'), edge('a', 'error', 'side'), edge('side', 'out', 'main'), edge('main', 'out', 'b'),
    ]);
    expect(computeFolds(d)).toEqual([]);
  });
  it('folds a dead end two side exits share into a chip on each, one fold', () => {
    const d = definition([fn('a', 'http'), fn('b', 'http'), fn('side', 'script')], [edge('a', 'out', 'b'), edge('a', 'error', 'side'), edge('b', 'error', 'side')]);
    expect(computeFolds(d)).toEqual([
      { id: 'end:side', kind: 'branch', owner: 'a', port: 'error', nodeIds: ['side'] },
      { id: 'end:side', kind: 'branch', owner: 'b', port: 'error', nodeIds: ['side'] },
    ]);
  });
  it('does not fold a shared node a main exit leads to, or one that leads on', () => {
    const main = definition([fn('a', 'http'), fn('b', 'http'), fn('side', 'script')], [edge('a', 'out', 'side'), edge('b', 'error', 'side'), edge('side', 'out', 'b')]);
    expect(computeFolds(main).filter((fold) => fold.nodeIds.includes('side'))).toEqual([]);
    const onward = definition([fn('a', 'http'), fn('b', 'http'), fn('side', 'script'), fn('c', 'script')], [edge('a', 'out', 'b'), edge('a', 'error', 'side'), edge('b', 'error', 'side'), edge('b', 'out', 'c'), edge('side', 'out', 'c')]);
    expect(computeFolds(onward)).toEqual([]);
  });
  it('does not fold more than 4 nodes', () => {
    const chain = (count: number) => {
      const extra = Array.from({ length: count }, (_, index) => fn(`s${index}`, 'script'));
      return definition([fn('a', 'http'), ...extra], [edge('a', 'error', 's0'), ...extra.slice(1).map((item, index) => edge(`s${index}`, 'out', item.id))]);
    };
    expect(computeFolds(chain(4))).toHaveLength(1);
    expect(computeFolds(chain(5))).toEqual([]);
  });
  it('never folds the main exit (a workflow\'s tail is not a side detail)', () => {
    const d = definition([fn('a', 'http'), fn('tail', 'script')], [edge('a', 'out', 'tail')]);
    expect(computeFolds(d)).toEqual([]);
  });
  it('never folds from or into the entry node', () => {
    const d = definition([fn('a', 'http'), fn('b', 'script')], [edge('a', 'out', 'b'), edge('b', 'out', 'entry')]);
    expect(computeFolds(d).filter((fold) => fold.nodeIds.includes('entry') || fold.owner === 'entry')).toEqual([]);
  });
});

describe('foldText', () => {
  it('joins the folded nodes\' names', () => {
    const d = definition([fn('a', 'http'), fn('h', 'http'), fn('m', 'saveCandidate', {}, '후보 저장'), fn('x', 'script')], [edge('a', 'out', 'x'), edge('a', 'error', 'h'), edge('h', 'out', 'm')]);
    expect(foldText(d, find(computeFolds(d), 'a:error')!)).toBe('HTTP 호출 → 후보 저장');
  });
  it('words a lone node by its name', () => {
    expect(foldText(sideDefinition, find(computeFolds(sideDefinition), 'end:side')!)).toBe('스크립트');
  });
});

// a: out → main, error → side; b: out → main, error → side; c: out → main, error → own (a dead end of two saves)
const sideDefinition = definition([fn('a', 'http'), fn('b', 'http'), fn('main', 'script'), fn('side', 'script'), fn('c', 'http'), fn('s1', 'saveCandidate'), fn('s2', 'saveCandidate')], [
  edge('a', 'out', 'b'), edge('b', 'out', 'c'), edge('c', 'out', 'main'),
  edge('a', 'error', 'side'), edge('b', 'error', 'side'),
  edge('c', 'error', 's1'), edge('s1', 'out', 's2'),
]);

describe('what a chip counts', () => {
  const folds = computeFolds(sideDefinition);
  it('has the shared end and the branch of c', () => {
    expect(ids(folds)).toEqual(['c:error', 'end:side', 'end:side']);
    expect(find(folds, 'c:error')?.nodeIds).toEqual(['s1', 's2']);
  });
  it('adds up the issues on the folded nodes', () => {
    const issues = [{ level: 'error' as const, nodeId: 'side' }, { level: 'warning' as const, nodeId: 'side' }, { level: 'error' as const, nodeId: 'a' }, { level: 'error' as const }];
    expect(foldIssues(find(folds, 'end:side')!, issues)).toEqual({ errors: 1, warnings: 1 });
  });
  it('adds up a run\'s live counts and leaves zeros out', () => {
    const live = new Map([['side', { queued: 3, running: 0, failed: 3 }], ['a', { queued: 9, running: 9, failed: 9 }], ['s2', { queued: 1, running: 0, failed: 0 }]]);
    expect(foldLiveText(find(folds, 'end:side')!, live)).toBe('대기 3 · 실패 3');
    expect(foldLiveText(find(folds, 'c:error')!, live)).toBe('대기 1');
    expect(foldLiveText(find(folds, 'c:error')!, new Map())).toBe('');
  });
});

describe('which folds are open', () => {
  const folds = computeFolds(sideDefinition);
  it('toggles a fold and opens or closes all of them', () => {
    const open = toggleFold(NO_OPEN_FOLDS, 'c:error');
    expect(isFoldOpen(open, 'c:error')).toBe(true);
    expect(isFoldOpen(toggleFold(open, 'c:error'), 'c:error')).toBe(false);
    expect(allFoldsOpen(folds, open)).toBe(false);
    const all = setAllFolds(folds, true);
    expect(allFoldsOpen(folds, all)).toBe(true);
    expect(setAllFolds(folds, false)).toEqual(NO_OPEN_FOLDS);
    expect(allFoldsOpen([], NO_OPEN_FOLDS)).toBe(false);
  });
  it('opens the fold of a selected folded node, and changes nothing otherwise', () => {
    const opened = openFoldContaining(NO_OPEN_FOLDS, folds, 'side');
    expect(opened.open).toEqual(['end:side']);
    expect(openFoldContaining(opened, folds, 'side')).toBe(opened);
    expect(openFoldContaining(NO_OPEN_FOLDS, folds, 'main')).toBe(NO_OPEN_FOLDS);
    expect(openFoldContaining(NO_OPEN_FOLDS, folds, undefined)).toBe(NO_OPEN_FOLDS);
  });
});

describe('foldPlacements', () => {
  it('keeps the stored places of an opened fold when they are free', () => {
    const d = definition([fn('a', 'http'), fn('s', 'script')], [edge('a', 'error', 's')]);
    d.nodes.find((n) => n.id === 'a')!.position = { x: 0, y: 0 };
    d.nodes.find((n) => n.id === 's')!.position = { x: 600, y: 0 };
    const folds = computeFolds(d);
    expect(foldPlacements(d, folds, new Set(folds.map((f) => f.id)), new Map(), 'vertical').size).toBe(0);
  });
  it('sets an opened fold beside its owner when its stored places are taken', () => {
    const d = definition([fn('a', 'http'), fn('s', 'script'), fn('other', 'script')], [edge('a', 'out', 'other'), edge('a', 'error', 's')]);
    for (const n of d.nodes) n.position = { x: 0, y: 0 };
    d.nodes.find((n) => n.id === 'other')!.position = { x: 0, y: 0 };
    const folds = computeFolds(d);
    const placed = foldPlacements(d, folds, new Set(folds.map((f) => f.id)), new Map(), 'vertical');
    expect(placed.get('s')).toEqual({ x: 224 + 48, y: 0 });
    expect(foldPlacements(d, folds, new Set(folds.map((f) => f.id)), new Map(), 'vertical')).toEqual(placed);
  });
});
