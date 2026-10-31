import { describe, expect, it } from 'vitest';
import { createLiveQueryCollection } from '@tanstack/react-db';
import type { FeedSnapshot } from '@tw/shared';
import { feedCollection } from './collections';
import { feed } from './feed';

type Term = { id: string; source: string; target: string };

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(projectId: string, snapshot: FeedSnapshot, gate?: Promise<void>) {
  return feedCollection<Term>({ projectId, name: 'terms', load: async () => (await gate, snapshot) });
}

describe('a feed collection', () => {
  it('loads the snapshot, then applies the events that came while it loaded, dropping older ones', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const terms = setup('p1', { seq: 5, rows: [{ id: 'a', source: 'Gate', target: '' }] }, gate);
    terms.startSyncImmediate();
    // Older than the snapshot (already in it) and newer, both before it arrives.
    feed.push('p1', { terms: { upsert: [{ id: 'a', source: 'Gate', target: 'OLD' }], delete: [] } }, 4);
    feed.push('p1', { terms: { upsert: [{ id: 'b', source: 'Hesk', target: '헤스크' }], delete: [] } }, 6);
    release();
    await terms.toArrayWhenReady();
    expect(terms.get('a')?.target).toBe('');
    expect(terms.get('b')?.target).toBe('헤스크');
    feed.push('p1', { terms: { upsert: [], delete: ['b'] } }, 7);
    expect(terms.has('b')).toBe(false);
    // Another project's events leave it alone.
    feed.push('p2', { terms: { upsert: [{ id: 'c', source: 'X', target: '' }], delete: [] } }, 8);
    expect(terms.has('c')).toBe(false);
  });

  it('keeps every other row the same object when one row changes, in the collection and in a live query', async () => {
    const terms = setup('p3', { seq: 1, rows: ['a', 'b', 'c'].map((id) => ({ id, source: id.toUpperCase(), target: '' })) });
    await terms.toArrayWhenReady();
    const sorted = createLiveQueryCollection((q) => q.from({ term: terms }).orderBy(({ term }) => term.source));
    await sorted.toArrayWhenReady();
    const before = sorted.toArray;
    const [a, b, c] = ['a', 'b', 'c'].map((id) => terms.get(id));
    feed.push('p3', { terms: { upsert: [{ id: 'b', source: 'B', target: '비' }], delete: [] } }, 2);
    await later();
    expect(terms.get('a')).toBe(a);
    expect(terms.get('c')).toBe(c);
    expect(terms.get('b')).not.toBe(b);
    const after = sorted.toArray;
    expect(after.map((row) => row.target)).toEqual(['', '비', '']);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it('a write can wait for the feed to bring its change back', async () => {
    let done = false;
    const waited = feed.wait('p4', 3).then(() => (done = true));
    feed.push('p4', {}, 2);
    await later();
    expect(done).toBe(false);
    feed.push('p4', {}, 3);
    await waited;
    expect(done).toBe(true);
    // Already seen, or nothing to wait for: at once.
    await feed.wait('p4', 1);
    await feed.wait('p4', undefined);
  });
});
