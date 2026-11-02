import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL_CHOICE, translationTemplate, workflowDefinitionSchema, workflowNodeSchema, type WorkflowDefinition, type WorkflowEdge } from '@tw/shared';
import {
  allFoldsOpen, computeFolds, foldContaining, foldedDefinition, foldIssues, foldLiveText, foldPlacements, foldText, isFoldOpen, NO_OPEN_FOLDS,
  openFoldContaining, setAllFolds, toggleFold, type Fold,
} from './fold';

const template = translationTemplate({ model: EMPTY_MODEL_CHOICE, untranslated: 'u', translated: 't', needsReview: 'needs-review', confirmed: 'c', issueTags: { format: 'format-tag', term: 'term-tag', speech: 'speech-tag', meaning: 'meaning-tag', style: 'style-tag', other: 'other-tag', aiFailed: 'ai-failed' } });
const statusNames = new Map([['needs-review', '검토 필요']]);

const node = (id: string, type: string, config: unknown = {}, label?: string) => workflowNodeSchema.parse({ id, type, label, position: { x: 0, y: 0 }, config });
const fn = (id: string, name: string, params: Record<string, unknown> = {}, label?: string) => node(id, 'function', { fn: name, params }, label);
const tag = (id: string, params: Record<string, unknown> = {}) => fn(id, 'tagLines', { action: 'add', map: { tag: 'categories' }, ...params }, id);
const edge = (source: string, sourceHandle: string, target: string): WorkflowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });
const definition = (nodes: ReturnType<typeof node>[], edges: WorkflowEdge[]) => workflowDefinitionSchema.parse({ nodes: [node('entry', 'entry'), ...nodes], edges: [edge('entry', 'out', nodes[0]!.id), ...edges] }) as WorkflowDefinition;
const ids = (folds: Fold[]) => folds.map((fold) => fold.id).sort();
const find = (folds: Fold[], id: string) => folds.find((fold) => fold.id === id);

describe('computeFolds on the 번역 template', () => {
  const folds = computeFolds(template);
  it('folds the one 검토 필요 end onto every exit that leads to it, the AI 실패 marker and the tag nodes on lines', () => {
    expect([...new Set(ids(folds))]).toEqual([
      'end:needs-review', 'pass:tag-format', 'pass:tag-review', 'pass:tag-term', 'pass:untag-format', 'pass:untag-review', 'pass:untag-revised', 'pass:untag-term', 'terms:error',
    ]);
  });
  it('puts a chip for the shared end on each exit, all one fold', () => {
    const ends = folds.filter((fold) => fold.id === 'end:needs-review');
    expect(ends.map((fold) => `${fold.owner}:${fold.port}`).sort()).toEqual(['review:error', 'revise-again:false', 'revise:error', 'revised:false', 'translate:error']);
    expect(ends.every((fold) => fold.nodeIds.join() === 'needs-review')).toBe(true);
    expect(find(folds, 'terms:error')?.nodeIds).toEqual(['terms-failed']);
  });
  it('hides 10 side nodes (완료로 rides on the line with the tag node before it) and keeps the main path', () => {
    const hidden = new Set(folds.flatMap((fold) => fold.nodeIds));
    expect(hidden.size).toBe(10);
    expect(find(folds, 'pass:untag-review')).toMatchObject({ nodeIds: ['untag-review', 'confirm'], owner: 'review', target: 'terms' });
    for (const id of ['translate', 'save', 'check', 'glossary', 'review', 'terms', 'save-terms', 'revise-again', 'revise', 'save-revision', 'revised']) expect(hidden.has(id)).toBe(false);
  });
  it('draws a tag node as one line from its source to its target, keeping the id of the line into it', () => {
    const fold = find(folds, 'pass:tag-format')!;
    expect(fold).toMatchObject({ kind: 'edge', owner: 'check', port: 'fail', target: 'revise-again', edgeId: 'check-fail-tag-format' });
    const drawn = foldedDefinition(template, folds, new Set());
    expect(drawn.definition.edges.find((item) => item.id === 'check-fail-tag-format')).toMatchObject({ source: 'check', sourceHandle: 'fail', target: 'revise-again' });
    expect(drawn.definition.nodes.some((item) => item.id === 'tag-format' || item.id === 'needs-review')).toBe(false);
    expect(drawn.definition.edges.every((item) => !drawn.hidden.has(item.source) && !drawn.hidden.has(item.target))).toBe(true);
  });
  it('shows everything again when every fold is open', () => {
    expect(foldedDefinition(template, folds, new Set(folds.map((fold) => fold.id))).definition).toBe(template);
  });
});

describe('computeFolds on small definitions', () => {
  it('folds a dead-end chain on an error exit', () => {
    const d = definition([fn('a', 'http'), fn('h', 'http'), fn('m', 'setStatus', { statusId: 'needs-review' }, '검토 필요로'), fn('next', 'script')], [
      edge('a', 'out', 'next'), edge('a', 'error', 'h'), edge('h', 'out', 'm'),
    ]);
    const folds = computeFolds(d);
    expect(folds).toEqual([{ id: 'a:error', kind: 'branch', owner: 'a', port: 'error', nodeIds: ['h', 'm'] }]);
    expect(foldContaining(folds, 'm')?.id).toBe('a:error');
  });
  it('folds a chain ending at the hidden 끝 node and words it by names', () => {
    const d = definition([fn('a', 'http'), fn('h', 'http'), node('done', 'end')], [edge('a', 'error', 'h'), edge('h', 'out', 'done')]);
    const [fold] = computeFolds(d);
    expect(fold?.nodeIds).toEqual(['h', 'done']);
    expect(foldText(d, fold!)).toBe('HTTP 호출 → 끝');
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
  it('folds a tag node that only passes lines on into the line', () => {
    const d = definition([fn('a', 'formatCheck'), tag('t'), fn('b', 'script')], [edge('a', 'pass', 'b'), edge('a', 'fail', 't'), edge('t', 'out', 'b')]);
    expect(computeFolds(d)).toEqual([{ id: 'pass:t', kind: 'edge', owner: 'a', port: 'fail', nodeIds: ['t'], target: 'b', edgeId: 'a-fail-t' }]);
  });
  it('takes the tag node\'s own error branch with it, but not an error exit that goes on to the workflow', () => {
    const own = definition([fn('a', 'formatCheck'), tag('t'), fn('b', 'script'), fn('m', 'setStatus')], [edge('a', 'pass', 'b'), edge('a', 'fail', 't'), edge('t', 'out', 'b'), edge('t', 'error', 'm')]);
    expect(computeFolds(own)).toEqual([expect.objectContaining({ id: 'pass:t', nodeIds: ['t', 'm'] })]);
    const shared = definition([fn('a', 'formatCheck'), tag('t'), fn('b', 'script')], [edge('a', 'pass', 'b'), edge('a', 'fail', 't'), edge('t', 'out', 'b'), edge('t', 'error', 'b')]);
    expect(computeFolds(shared)).toEqual([]);
  });
  it('does not fold a tag node with two outgoing lines or two incoming lines', () => {
    const two = definition([fn('a', 'formatCheck'), tag('t'), fn('b', 'script'), fn('c', 'script')], [edge('a', 'pass', 'b'), edge('a', 'pass', 'c'), edge('a', 'fail', 't'), edge('t', 'out', 'b'), edge('t', 'out', 'c')]);
    expect(computeFolds(two)).toEqual([]);
    const merge = definition([fn('a', 'formatCheck'), tag('t'), fn('b', 'script')], [edge('a', 'pass', 'b'), edge('a', 'fail', 't'), edge('a', 'pass', 't'), edge('t', 'out', 'b')]);
    expect(computeFolds(merge)).toEqual([]);
  });
  it('folds only tag nodes, no other pass-through node', () => {
    const d = definition([fn('a', 'formatCheck'), fn('p', 'script'), fn('b', 'script')], [edge('a', 'pass', 'b'), edge('a', 'fail', 'p'), edge('p', 'keep', 'b')]);
    expect(computeFolds(d)).toEqual([]);
  });
  it('puts several marking nodes in a row on one line', () => {
    const d = definition([fn('a', 'formatCheck'), tag('t1'), fn('s', 'setStatus', { statusId: 'needs-review' }), fn('b', 'script')], [edge('a', 'pass', 'b'), edge('a', 'fail', 't1'), edge('t1', 'out', 's'), edge('s', 'out', 'b')]);
    expect(computeFolds(d)).toEqual([{ id: 'pass:t1', kind: 'edge', owner: 'a', port: 'fail', nodeIds: ['t1', 's'], target: 'b', edgeId: 'a-fail-t1' }]);
  });
});

describe('foldText', () => {
  const folds = computeFolds(template);
  const text = (id: string, names = { status: statusNames }) => foldText(template, find(folds, id)!, names);
  it('words a lone tag marker by what it does and the shared end by its status', () => {
    expect(text('terms:error')).toBe('태그 붙이기 · 고른 태그 1개');
    expect(text('end:needs-review')).toBe('검토 필요');
  });
  it('falls back to the node\'s name without status names', () => {
    expect(text('end:needs-review', { status: new Map() as never })).toBe('검토 필요로');
  });
  it('words tag nodes by what they do', () => {
    expect(text('pass:untag-format')).toBe('태그 떼기 · 고른 태그 1개');
    expect(text('pass:tag-review')).toBe('태그 붙이기 · 검수 지적');
    expect(text('pass:untag-review')).toBe('태그 떼기 · 고른 태그 7개');
  });
  it('words a lone tag node on an exit by what it does, and anything else by names', () => {
    const d = definition([fn('a', 'http'), tag('t', { action: 'remove', map: {}, tagIds: ['format-tag'] }), fn('x', 'script'), fn('y', 'script')], [edge('a', 'error', 't'), edge('a', 'out', 'x'), edge('x', 'error', 'y')]);
    expect(foldText(d, find(computeFolds(d), 'a:error')!)).toBe('태그 떼기 · 고른 태그 1개');
    expect(foldText(d, find(computeFolds(d), 'x:error')!)).toBe('스크립트');
  });
});

describe('what a chip counts', () => {
  const folds = computeFolds(template);
  it('adds up the issues on the folded nodes', () => {
    const issues = [{ level: 'error' as const, nodeId: 'needs-review' }, { level: 'warning' as const, nodeId: 'needs-review' }, { level: 'error' as const, nodeId: 'save' }, { level: 'error' as const }];
    expect(foldIssues(find(folds, 'end:needs-review')!, issues)).toEqual({ errors: 1, warnings: 1 });
  });
  it('adds up a run\'s live counts and leaves zeros out', () => {
    const live = new Map([['needs-review', { queued: 3, running: 0, failed: 3 }], ['review', { queued: 9, running: 9, failed: 9 }]]);
    expect(foldLiveText(find(folds, 'end:needs-review')!, live)).toBe('대기 3 · 실패 3');
    expect(foldLiveText(find(folds, 'terms:error')!, live)).toBe('');
  });
});

describe('which folds are open', () => {
  const folds = computeFolds(template);
  it('toggles a fold and opens or closes all of them', () => {
    const open = toggleFold(NO_OPEN_FOLDS, 'terms:error');
    expect(isFoldOpen(open, 'terms:error')).toBe(true);
    expect(isFoldOpen(toggleFold(open, 'terms:error'), 'terms:error')).toBe(false);
    expect(allFoldsOpen(folds, open)).toBe(false);
    const all = setAllFolds(folds, true);
    expect(allFoldsOpen(folds, all)).toBe(true);
    expect(setAllFolds(folds, false)).toEqual(NO_OPEN_FOLDS);
    expect(allFoldsOpen([], NO_OPEN_FOLDS)).toBe(false);
  });
  it('opens the fold of a selected folded node, and changes nothing otherwise', () => {
    const opened = openFoldContaining(NO_OPEN_FOLDS, folds, 'needs-review');
    expect(opened.open).toEqual(['end:needs-review']);
    expect(openFoldContaining(opened, folds, 'needs-review')).toBe(opened);
    expect(openFoldContaining(NO_OPEN_FOLDS, folds, 'check')).toBe(NO_OPEN_FOLDS);
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
