import { describe, expect, it } from 'vitest';
import { cardText, findNodes, highlighted, nodeCards, type GraphNodeRow } from './node-cards';

const nodes: (GraphNodeRow & { groupId?: string | null })[] = [
  { id: 'a', kind: 'script', key: 'ch1.a', preview: '어디 가?', speaker: '미라', text: '어디 가?', total: 1, groupId: 's1' },
  { id: 'b', kind: 'script', key: 'ch1.b', preview: '등대로.', speaker: null, text: '등대로.', total: 3, groupId: 's1' },
  { id: 'c', kind: 'control', type: 'SetFlag', key: 'ch1.c', preview: null, groupId: 's2' },
  { id: 'd', kind: 'choice', key: 'ch1.d', preview: '따라간다', text: '따라간다', groupId: 's2' },
  { id: 'e', kind: 'control', key: 'ch1.e', preview: null },
];
const colorOf = (speaker: string | null | undefined) => (speaker === '미라' ? 'teal' : undefined);
const cards = (extra: Partial<Parameters<typeof nodeCards>[0]> = {}) => nodeCards({ nodes, show: 'source', colorOf, ...extra });

describe('what the dialogue graph cards say', () => {
  it('a line card leads with who speaks, in their colour, and counts its lines past one', () => {
    expect(cards().get('a')).toMatchObject({ title: '미라', titleColor: 'teal', body: '어디 가?' });
    expect(cards().get('b')).toMatchObject({ title: '지문·화면 문구 · 3줄', body: '등대로.' });
  });

  it('shows the source, the translation or both', () => {
    const translations = { a: '어디 가는 거야?' };
    expect(cards({ show: 'translation', translations }).get('a')).toMatchObject({ body: '어디 가는 거야?', bodyStrong: true });
    expect(cards({ show: 'translation', translations }).get('b')).toMatchObject({ body: '번역 없음', missing: 'body' });
    expect(cards({ show: 'both', translations }).get('a')).toMatchObject({ body: '어디 가?', second: '어디 가는 거야?' });
  });

  it('a control node is labelled by what its class means, a choice by what picking it does', () => {
    expect(cards({ nodeTypes: { SetFlag: { label: '플래그 설정' } } }).get('c')?.label).toBe('플래그 설정');
    expect(cards().get('c')?.label).toBe('SetFlag');
    expect(cards().get('e')?.label).toBeNull();
    expect(cards().get('d')).toMatchObject({ title: '▶ 따라간다 고르면', body: '따라간다' });
  });

  it('a portal names the section it leads to or comes from', () => {
    const map = cards({ portals: [{ id: 'portal:1', direction: 'out', section: '2장' }, { id: 'portal:2', direction: 'in', section: '서장' }] });
    expect(map.get('portal:1')).toMatchObject({ kind: 'portal', label: '→ 2장' });
    expect(map.get('portal:2')?.label).toBe('← 서장');
  });

  it('a folded run reads as its lines and first spoken line, and opens by its card', () => {
    const run = { id: 'chain:c', nodeIds: ['c', 'a', 'b'] };
    const card = cards({ chains: [run], foldable: [run], show: 'both', translations: { a: '어디 가는 거야?' } }).get('chain:c');
    expect(card).toMatchObject({ kind: 'chain', title: '이어진 대사 4줄', body: '미라: 어디 가?', second: '미라: 어디 가는 거야?', key: 'ch1.c 외 2개', fold: 'chain:c' });
  });

  it('a folded run without lines counts its nodes and shows its first node\'s label', () => {
    const run = { id: 'chain:c', nodeIds: ['c', 'e'] };
    expect(cards({ chains: [run] }).get('chain:c')).toMatchObject({ title: '이어진 노드 2개', body: 'SetFlag' });
  });

  it('the first line of an open run folds it again', () => {
    const run = { id: 'chain:a', nodeIds: ['a', 'b'] };
    const map = cards({ foldable: [run], openRuns: new Set(['chain:a']) });
    expect(map.get('a')?.fold).toBe('chain:a');
    expect(map.get('b')?.fold).toBeUndefined();
    expect(cards({ foldable: [run], openRuns: new Set() }).get('a')?.fold).toBeUndefined();
  });

  it('names a drawn thing by its card, else by its id', () => {
    expect(cardText(cards(), 'a')).toBe('미라 · 어디 가?');
    expect(cardText(cards(), 'c')).toBe('SetFlag');
    expect(cardText(cards(), 'gone')).toBe('gone');
  });
});

describe('finding and highlighting nodes', () => {
  it('finds by key, label, first line and translation, without case', () => {
    expect(findNodes(nodes, 'CH1.A', undefined).map((node) => node.id)).toEqual(['a']);
    expect(findNodes(nodes, '등대', undefined).map((node) => node.id)).toEqual(['b']);
    expect(findNodes(nodes, '거야', { a: '어디 가는 거야?' }).map((node) => node.id)).toEqual(['a']);
    expect(findNodes(nodes, '  ', undefined)).toEqual([]);
    expect(findNodes(nodes, 'ch1', undefined, 2)).toHaveLength(2);
  });

  it('highlights a view\'s nodes, one type, or one scene, in that order', () => {
    expect(highlighted(nodes, { mark: ['x', 'y'], type: 'SetFlag' })).toEqual(new Set(['x', 'y']));
    expect(highlighted(nodes, { type: 'SetFlag', scene: 's1' })).toEqual(new Set(['c']));
    expect(highlighted(nodes, { type: 'kind:script' })).toEqual(new Set(['a', 'b']));
    expect(highlighted(nodes, { scene: 's2' })).toEqual(new Set(['c', 'd']));
    expect(highlighted(nodes, {})).toBeUndefined();
  });
});
