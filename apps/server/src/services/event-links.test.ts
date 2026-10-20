import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { deleteItemsKept, restoreItems } from './item-delete.ts';
import { linkEvents, projectEventFlow, withLinks } from './event-routes.ts';

describe('사건 흐름 corrections', () => {
  it('drops hidden derived lines and adds drawn ones once, beside the derived', () => {
    const flow = [
      { id: 'a', next: [{ id: 'b', label: null }, { id: 'c', label: '도망' }] },
      { id: 'b', next: [] },
      { id: 'c', next: [] },
    ];
    const next = withLinks(flow, [
      { fromId: 'a', toId: 'b', kind: 'hidden', origin: 'human' },
      { fromId: 'a', toId: 'c', kind: 'added', origin: 'human' },
      { fromId: 'b', toId: 'c', kind: 'added', origin: 'ai' },
      { fromId: 'b', toId: 'gone', kind: 'added', origin: 'human' },
    ]);
    expect(next[0]!.next).toEqual([{ id: 'c', label: '도망', source: 'graph' }]);
    expect(next[1]!.next).toEqual([{ id: 'c', label: null, source: 'added', origin: 'ai' }]);
  });

  it('links and unlinks events, and a deleted event takes its lines with it until ⌘Z', () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Hi' }] }));
    const [first, second] = db.insert(s.storyEvents).values([{ projectId, title: '하나' }, { projectId, title: '둘' }]).returning().all();
    const nextOf = (id: string) => projectEventFlow(db, projectId).find((event) => event.id === id)!.next;

    linkEvents(db, projectId, { fromId: first!.id, toId: second!.id, action: 'link', origin: 'ai' });
    expect(nextOf(first!.id)).toEqual([{ id: second!.id, label: null, source: 'added', origin: 'ai' }]);
    expect(linkEvents(db, projectId, { fromId: first!.id, toId: second!.id, action: 'link', origin: 'ai' }).result).toBe('이미 이어져 있습니다.');

    const { token } = deleteItemsKept(db, projectId, [{ kind: 'events', ids: [second!.id] }]);
    expect(db.select().from(s.eventLinks).all()).toEqual([]);
    expect(restoreItems(db, projectId, token)).toBe(true);
    expect(nextOf(first!.id)).toHaveLength(1);

    linkEvents(db, projectId, { fromId: first!.id, toId: second!.id, action: 'unlink', origin: 'ai' });
    expect(nextOf(first!.id)).toEqual([]);
    expect(() => linkEvents(db, projectId, { fromId: first!.id, toId: first!.id, action: 'link', origin: 'ai' })).toThrow();
  });
});
