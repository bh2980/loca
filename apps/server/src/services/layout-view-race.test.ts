import { beforeEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { deleteView, saveView, updateView, viewSection } from './graph-views.ts';
import { invalidate } from './source-mutations.ts';
const fixture = vi.hoisted(() => ({ workers: [] as { emit: (name: string, data: unknown) => boolean; terminate: ReturnType<typeof vi.fn> }[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    terminate = vi.fn(async () => 0);
    constructor() { super(); fixture.workers.push(this); }
  } };
});
beforeEach(() => { fixture.workers = []; });
function setup() {
  const db = openDatabase(':memory:');
  const { id: projectId } = db.insert(s.projects).values({ name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
  const nodes = db.insert(s.graphNodes).values(['a', 'b'].map((key) => ({ projectId, key, kind: 'state' as const, unitIds: [] }))).returning().all();
  const id = saveView(db, projectId, [nodes[0].id], 'Old');
  return { db, projectId, nodes, id };
}
const result = (width: number) => ({ ok: true, data: { width, height: 50, nodes: [], edges: [] } });
it('ignores an old completion after a view changes and preserves the new job', async () => {
  const { db, projectId, nodes, id } = setup();
  try {
    const old = viewSection(db, projectId, id);
    updateView(db, projectId, id, { add: [nodes[1].id], label: 'New' });
    expect(fixture.workers[0].terminate).toHaveBeenCalled();
    const fresh = viewSection(db, projectId, id);
    fixture.workers[0].emit('message', result(100)); await old;
    expect(db.select().from(s.graphLayouts).get()?.status).toBe('pending');
    // The old job's finally must not remove the current one, creating a duplicate worker.
    const same = viewSection(db, projectId, id);
    expect(fixture.workers).toHaveLength(2);
    fixture.workers[1].emit('message', result(200)); await Promise.all([fresh, same]);
    expect(db.select().from(s.graphLayouts).get()?.data).toMatchObject({ width: 200 });
  } finally { db.$client.close(); }
});
it.each(['view', 'source'] as const)('does not recreate a layout invalidated by deleting the %s', async (kind) => {
  const { db, projectId, id } = setup();
  try {
    const old = viewSection(db, projectId, id);
    if (kind === 'view') deleteView(db, projectId, id);
    else db.transaction((tx) => invalidate(tx, projectId));
    fixture.workers[0].emit('message', result(100)); await old;
    expect(db.select().from(s.graphLayouts).all()).toEqual([]);
  } finally { db.$client.close(); }
});
