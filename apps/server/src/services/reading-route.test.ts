import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { readingRoute, type ReadingEdge, type ReadingNode, type ReadingUnit } from './reading-route.ts';

const node = (id: string, unitIds: string[] = [], kind = 'script'): ReadingNode => ({ id, key: id, unitIds, kind });
const edge = (from: string, to: string): ReadingEdge => ({ from, to, label: null });
const unit = (id: string, seq: number, translation?: string | null): ReadingUnit => ({ id, seq, source: id, translation });

describe('reading route', () => {
  it.each([
    [{}, null, null],
    [{ start: 'a' }, 'a', null],
    [{ end: 'b' }, null, 'b'],
  ])('does not invent endpoints when input is incomplete: %j', (input, start, end) => {
    const result = readingRoute([node('a', ['ua']), node('b', ['ub'])], [edge('a', 'b')], [unit('ua', 1), unit('ub', 2)], input);

    expect(result).toMatchObject({ status: 'needs-endpoints', start, end, nodeIds: [], sequence: [], stages: [] });
  });

  it('returns only the directed interval, traversing controls and stopping at the selected end', () => {
    const nodes = [node('before', ['u0']), node('start', ['u1']), node('control', [], 'condition'), node('middle', ['u2']), node('end', ['u3']), node('after', ['u4'])];
    const edges = [edge('before', 'start'), edge('start', 'control'), edge('control', 'middle'), edge('middle', 'end'), edge('end', 'after')];
    const result = readingRoute(nodes, edges, [unit('u0', 0), unit('u1', 1), unit('u2', 2), unit('u3', 3), unit('u4', 4)], { start: 'start', end: 'end' });

    expect(result.status).toBe('found');
    expect(result.nodeIds).toEqual(['start', 'control', 'middle', 'end']);
    expect(result.sequence.map(({ unitId }) => unitId)).toEqual(['u1', 'u2', 'u3']);
    expect(result.untranslatedIds).toEqual(['u1', 'u2', 'u3']);
  });

  it('chooses the shortest valid exclusive branch rather than the first outgoing edge', () => {
    const nodes = [node('start', ['u0'], 'condition'), node('long', ['u1']), node('longer', ['u2']), node('short', ['u3']), node('end', ['u4'])];
    const edges = [edge('start', 'long'), edge('long', 'longer'), edge('longer', 'end'), edge('start', 'short'), edge('short', 'end')];
    const result = readingRoute(nodes, edges, nodes.flatMap((n, i) => n.unitIds.map((id) => unit(id, i))), { start: 'start', end: 'end' });

    expect(result.status).toBe('found');
    expect(result.nodeIds).toEqual(['start', 'short', 'end']);
  });

  it('returns unreachable when there is only a reverse directed connection', () => {
    const result = readingRoute([node('start', ['ua']), node('end', ['ub'])], [edge('end', 'start')], [unit('ua', 1), unit('ub', 2)], { start: 'start', end: 'end' });

    expect(result).toMatchObject({ status: 'unreachable', start: 'start', end: 'end', nodeIds: [], sequence: [], stages: [] });
  });

  it('accepts the same content node as both endpoints and includes it once', () => {
    const result = readingRoute([node('only', ['u'])], [], [unit('u', 1)], { start: 'only', end: 'only' });

    expect(result.status).toBe('found');
    expect(result.nodeIds).toEqual(['only']);
    expect(result.sequence).toEqual([{ unitId: 'u', nodeId: 'only' }]);
  });

  it('rejects foreign or contentless endpoints', () => {
    const nodes = [node('start', ['u1']), node('control', [], 'state'), node('end', ['u2'])];
    const units = [unit('u1', 1), unit('u2', 2)];

    expect(() => readingRoute(nodes, [edge('start', 'control'), edge('control', 'end')], units, { start: 'foreign', end: 'end' })).toThrow(HTTPException);
    expect(() => readingRoute(nodes, [edge('start', 'control'), edge('control', 'end')], units, { start: 'start', end: 'foreign' })).toThrow(HTTPException);
    expect(() => readingRoute(nodes, [edge('start', 'control'), edge('control', 'end')], units, { start: 'control', end: 'end' })).toThrow(HTTPException);
  });

  it('includes one reachable branch in linear story with branch forks', () => {
    const nodes = [
      node('A', ['uA']), node('fan', [], 'state'), node('B', ['uB']), node('condition', [], 'condition'),
      node('C1', ['uC1']), node('C2', ['uC2']), node('D', ['uD']), node('join', [], 'state'), node('E', ['uE']),
    ];
    const edges = [
      edge('A', 'fan'), edge('fan', 'B'), edge('fan', 'D'), edge('B', 'condition'),
      edge('condition', 'C1'), edge('condition', 'C2'), edge('C1', 'join'), edge('C2', 'join'),
      edge('D', 'join'), edge('join', 'E'),
    ];
    const units = ['uA', 'uB', 'uC1', 'uC2', 'uD', 'uE'].map((id, i) => unit(id, i + 1));
    const result = readingRoute(nodes, edges, units, { start: 'A', end: 'E' });

    expect(result.status).toBe('found');
    expect(result.nodeIds).toContain('fan');
    expect(result.nodeIds).toContain('join');
    expect(result.sequence.map(({ unitId }) => unitId)).toContain('uA');
    expect(result.sequence.map(({ unitId }) => unitId)).toContain('uE');
    expect(result.forks.length).toBeGreaterThanOrEqual(1);
  });

  it('finds linear path through branch alternatives', () => {
    const nodes = [
      node('start', ['u0']), node('outer', [], 'state'), node('nested', [], 'event'),
      node('a', ['ua']), node('b', ['ub']), node('c', ['uc']), node('join-inner', [], 'state'), node('join-outer', [], 'state'), node('end', ['ue']),
    ];
    const edges = [
      edge('start', 'outer'), edge('outer', 'nested'), edge('outer', 'c'), edge('nested', 'a'), edge('nested', 'b'),
      edge('a', 'join-inner'), edge('b', 'join-inner'), edge('join-inner', 'join-outer'), edge('c', 'join-outer'), edge('join-outer', 'end'),
    ];
    const units = ['u0', 'ua', 'ub', 'uc', 'ue'].map((id, i) => unit(id, i + 1));
    const result = readingRoute(nodes, edges, units, { start: 'start', end: 'end' });

    expect(result.status).toBe('found');
    expect(result.sequence.map(({ unitId }) => unitId)).toContain('u0');
    expect(result.sequence.map(({ unitId }) => unitId)).toContain('ue');
  });

  it('finds a finite route through an exclusive cycle when an exit reaches the end', () => {
    const nodes = [node('start', ['u1']), node('condition', [], 'condition'), node('exit', ['u2']), node('end', ['u3'])];
    const edges = [edge('start', 'condition'), edge('condition', 'condition'), edge('condition', 'exit'), edge('exit', 'end')];
    const result = readingRoute(nodes, edges, ['u1', 'u2', 'u3'].map((id, i) => unit(id, i)), { start: 'start', end: 'end' });

    expect(result.status).toBe('found');
    expect(result.nodeIds).toEqual(['start', 'condition', 'exit', 'end']);
  });

  it('returns unreachable when disconnected from the selected end', () => {
    const nodes = [node('start', ['u1']), node('fan', [], 'state'), node('loop-a', ['u2']), node('loop-b', ['u3']), node('isolated', ['u4']), node('end', ['u5'])];
    const edges = [edge('start', 'fan'), edge('fan', 'loop-a'), edge('loop-a', 'loop-b'), edge('loop-b', 'loop-a'), edge('isolated', 'end')];
    const result = readingRoute(nodes, edges, ['u1', 'u2', 'u3', 'u4', 'u5'].map((id, i) => unit(id, i)), { start: 'start', end: 'end' });

    expect(result.status).toBe('unreachable');
    expect(result.sequence).toEqual([]);
  });

  it('walks a 9,000-node linear interval without recursive stack growth', () => {
    const size = 9_000;
    const nodes = Array.from({ length: size }, (_, i) => node(`n${i}`, [`u${i}`]));
    const edges = Array.from({ length: size - 1 }, (_, i) => edge(`n${i}`, `n${i + 1}`));
    const units = Array.from({ length: size }, (_, i) => unit(`u${i}`, i));
    const result = readingRoute(nodes, edges, units, { start: 'n0', end: `n${size - 1}` });

    expect(result.status).toBe('found');
    expect(result.nodeIds).toHaveLength(size);
    expect(result.sequence).toHaveLength(size);
  });
});
