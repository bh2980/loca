import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { defaultModelChoice, fillDefaultModels, liveChoice, snapshotChoice, withDefaultModels } from './routes.ts';
import { eq } from 'drizzle-orm';
import { memoryStore } from './secrets.ts';

describe('model choices', () => {
  it('uses the requested capability when choosing a connection default, with generate as the default', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values([
      { id: 'judge', kind: 'systemone', name: 'A Judge', defaultModel: 'judge-model' },
      { id: 'chat', kind: 'openai', name: 'B Chat', defaultModel: 'chat-model', defaultEffort: 'low' },
    ]).run();
    expect(defaultModelChoice(db)).toEqual({ connectionId: 'chat', model: 'chat-model', effort: 'low' });
    expect(defaultModelChoice(db, 'chat')).toEqual({ connectionId: 'chat', model: 'chat-model', effort: 'low' });
    expect(defaultModelChoice(db, 'judge')).toEqual({ connectionId: 'judge', model: 'judge-model' });
    db.delete(s.connections).where(eq(s.connections.id, 'chat')).run();
    expect(defaultModelChoice(db, 'chat')).toEqual({ connectionId: '', model: '' });
  });

  it('follow each connection\'s fallback in turn, stopping at a loop, with the picked connection\'s call settings', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values([
      { id: 'a', kind: 'openai', name: 'A', timeoutSeconds: 60, maxAttempts: 3, outputTokens: 4000, fallback: { connectionId: 'b', model: 'mb', effort: 'high' } },
      { id: 'b', kind: 'codex', name: 'B', timeoutSeconds: 900, fallback: { connectionId: 'a', model: 'ma' } },
    ]).run();
    const snapshot = snapshotChoice(db, { connectionId: 'a', model: 'ma' })!;
    expect(snapshot).toMatchObject({ label: 'A · ma', timeoutSeconds: 60, maxAttempts: 3, maxOutputTokens: 4000 });
    expect(snapshot.routes.map((route) => [route.name, route.model, route.effort])).toEqual([['A', 'ma', null], ['B', 'mb', 'high']]);
    expect(snapshotChoice(db, { connectionId: 'gone', model: 'x' })).toBeUndefined();
  });

  it('falls back to another model of the same connection once, without looping', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'or', kind: 'openai', name: 'OpenRouter', fallback: { connectionId: 'or', model: 'cheap' } }).run();
    expect(snapshotChoice(db, { connectionId: 'or', model: 'big' })!.routes.map((route) => route.model)).toEqual(['big', 'cheap']);
    expect(snapshotChoice(db, { connectionId: 'or', model: 'cheap' })!.routes.map((route) => route.model)).toEqual(['cheap']);
  });

  it('refuse a connection that cannot do what the place needs', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'j', kind: 'systemone', name: 'Judge' }).run();
    expect(() => liveChoice(db, { connectionId: 'j', model: 'm' }, memoryStore(), 'chat')).toThrow('채팅에 쓸 수 없습니다');
    expect(() => liveChoice(db, { connectionId: 'x', model: 'm' }, memoryStore(), 'generate')).toThrow('AI 연결이 없습니다');
  });
});

describe('default models for unpicked AI nodes', () => {
  const aiNode = (id: string, model: { connectionId: string; model: string; effort?: string }) =>
    ({ id, type: 'ai', name: id, position: { x: 0, y: 0 }, config: { model, extraModels: [] } }) as never;

  it('fill empty nodes and connection-only nodes, leave picked ones, and bump the version', () => {
    const db = openDatabase(':memory:');
    const project = db.insert(s.projects).values({ name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' } as never).returning().get();
    db.insert(s.connections).values([
      { id: 'a', kind: 'openai', name: 'A', defaultModel: 'ma', defaultEffort: 'low' },
      { id: 'b', kind: 'opencode', name: 'B', defaultModel: 'mb' },
    ]).run();
    const definition = { nodes: [aiNode('empty', { connectionId: '', model: '' }), aiNode('conn', { connectionId: 'b', model: '' }), aiNode('picked', { connectionId: 'b', model: 'other' })], edges: [] } as never;
    const workflow = db.insert(s.workflows).values({ projectId: project.id, name: 'W', definition }).returning().get();
    expect(fillDefaultModels(db)).toEqual([project.id]);
    const after = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!;
    expect(after.version).toBe(workflow.version + 1);
    expect(after.definition.nodes.map((node) => (node.type === 'ai' ? node.config.model : null))).toEqual([
      { connectionId: 'a', model: 'ma', effort: 'low' },
      { connectionId: 'b', model: 'mb' },
      { connectionId: 'b', model: 'other' },
    ]);
    // Nothing left to fill: no new version.
    expect(fillDefaultModels(db)).toEqual([]);
    expect(withDefaultModels(db, after.definition)).toBeNull();
  });
});
