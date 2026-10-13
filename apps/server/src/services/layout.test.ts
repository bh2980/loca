import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { computeLayouts } from './layout.ts';

const fixture = vi.hoisted(() => ({ result: {} as unknown, terminated: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      terminate = vi.fn(async () => 0);
      constructor() {
        super();
        fixture.terminated.push(this.terminate);
        queueMicrotask(() => {
          this.emit('message', { 'watch:import': ['file:///layout-worker.ts'] });
          this.emit('message', { 'watch:require': [null, 'elk.bundled.js'] });
          if (!this.terminate.mock.calls.length) this.emit('message', fixture.result);
        });
      }
    },
  };
});

function setup() {
  const db = openDatabase(':memory:');
  const project = db.insert(s.projects).values({ name: 'Layout test', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
  const group = db.insert(s.groups).values({ projectId: project.id, key: 'scene', kind: 'scene', title: 'Scene', sort: 0 }).returning().get();
  db.insert(s.graphNodes).values({ projectId: project.id, key: 'node', kind: 'state', groupId: group.id, unitIds: [] }).run();
  return { db, projectId: project.id };
}

describe('layout worker results under Node watch', () => {
  beforeEach(() => { fixture.terminated = []; });

  it('waits past dependency notifications and saves the actual scene and dialogue layouts', async () => {
    const data = { width: 130, height: 80, nodes: [], edges: [] };
    fixture.result = { ok: true, data };
    const { db, projectId } = setup();
    try {
      await computeLayouts(db, projectId);
      const rows = db.select().from(s.graphLayouts).all();
      expect(rows.map((row) => row.scope).sort()).toEqual(['dialogue', 'scene']);
      expect(rows.every((row) => row.status === 'ready' && row.error === null)).toBe(true);
      for (const row of rows) expect(row.data).toMatchObject(data);
      for (const terminate of fixture.terminated) expect(terminate).toHaveBeenCalledTimes(1);
    } finally { db.$client.close(); }
  });

  it('preserves a real layout failure received after dependency notifications', async () => {
    fixture.result = { ok: false, error: 'ELK calculation failed' };
    const { db, projectId } = setup();
    try {
      await computeLayouts(db, projectId);
      expect(db.select().from(s.graphLayouts).all().map((row) => ({ status: row.status, error: row.error }))).toEqual([
        { status: 'failed', error: 'ELK calculation failed' },
        { status: 'failed', error: 'ELK calculation failed' },
      ]);
    } finally { db.$client.close(); }
  });
});
