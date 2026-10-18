import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import { importProject } from './importer.ts';
import * as s from '../db/schema.ts';
import { agentTools } from './agent-tools.ts';
import { autoReview, itemCount } from './change-gate.ts';
import { prepareProposal } from './proposal-check.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Hi.' }] }));
  const run = async (name: string, input: object) => (await (agentTools(db, projectId) as Record<string, { execute?: (i: never, o: never) => unknown }>)[name]!.execute!(input as never, { toolCallId: 't', messages: [] } as never)) as Record<string, unknown>;
  return { db, projectId, run };
}

describe('bulk and project tools (#45)', () => {
  it('save_knowledge rolls back every item when one relationship fails', async () => {
    const { db, run } = setup();
    const result = await run('save_knowledge', { characters: [{ name: 'Alice' }, { name: 'Bob' }], relationships: [{ from: 'Alice', to: 'Bob', kind: '친구' }, { from: 'Alice', to: 'Nobody', kind: '적' }] });
    expect(result).toMatchObject({ ok: false, saved: 0, failed: 1, error: '4개 중 1개를 저장하지 못해 아무것도 저장하지 않았습니다. 실패한 항목을 고쳐 전체를 다시 보내세요.', results: [
      { kind: 'characters', index: 0, ok: true },
      { kind: 'characters', index: 1, ok: true },
      { kind: 'relationships', index: 0, ok: true },
      { kind: 'relationships', index: 1, ok: false, error: '인물을 먼저 만들어야 합니다: Nobody' },
    ] });
    expect(db.select().from(s.characters).all()).toHaveLength(0);
    expect(db.select().from(s.relationships).all()).toHaveLength(0);
  });

  it('save_knowledge saves all items and relationships can name newly created characters', async () => {
    const { db, run } = setup();
    const result = await run('save_knowledge', { characters: [{ name: 'Alice' }, { name: 'Bob' }], relationships: [{ from: 'Alice', to: 'Bob', kind: '친구' }] });
    expect(result).toMatchObject({ ok: true, saved: 3, failed: 0, results: [
      { kind: 'characters', index: 0, ok: true },
      { kind: 'characters', index: 1, ok: true },
      { kind: 'relationships', index: 0, ok: true },
    ] });
    expect(db.select().from(s.characters).all().map((c) => c.name).sort()).toEqual(['Alice', 'Bob']);
    expect(db.select().from(s.relationships).all()).toHaveLength(1);
  });

  it('save_knowledge counts all its items for auto review', () => {
    const many = { characters: Array.from({ length: 15 }, (_, i) => ({ name: `c${i}` })), documents: Array.from({ length: 10 }, (_, i) => ({ title: `d${i}` })) };
    expect(itemCount(many)).toBe(25);
    expect(autoReview('save_knowledge', many, null).pass).toBe(false);
    expect(autoReview('delete_items', { kind: 'terms', ids: ['x'] }, null).pass).toBe(false);
  });

  it('delete_items drops missing ids and refuses app tags', async () => {
    const { db, projectId, run } = setup();
    const a = db.insert(s.characters).values({ projectId, name: 'A' }).returning().get();
    const prepared = await prepareProposal(db, projectId, 'delete_items', { kind: 'characters', ids: [a.id, 'gone'] });
    expect(prepared).toMatchObject({ ok: true, input: { ids: [a.id] }, report: { dropped: [{ key: 'gone' }] } });
    expect(await prepareProposal(db, projectId, 'delete_items', { kind: 'characters', ids: ['gone'] })).toMatchObject({ ok: false });
    expect(await run('delete_items', { kind: 'characters', ids: [a.id] })).toMatchObject({ ok: true, deleted: 1 });
    expect(db.select().from(s.characters).where(eq(s.characters.id, a.id)).get()).toBeUndefined();
    const roleTag = db.select().from(s.tags).all().find((tag) => tag.role);
    if (roleTag) expect(await prepareProposal(db, projectId, 'delete_items', { kind: 'tags', ids: [roleTag.id] })).toMatchObject({ ok: false });
  });

  it('save_knowledge refuses an item whose id does not exist', async () => {
    const { db, projectId } = setup();
    expect(await prepareProposal(db, projectId, 'save_knowledge', { characters: [{ id: 'nope', name: 'X' }] })).toMatchObject({ ok: false, error: '없는 인물입니다.' });
  });

  it('update_project_settings changes settings but has no agentSettings field', async () => {
    const { db, projectId, run } = setup();
    const tools = agentTools(db, projectId);
    expect(Object.keys((tools.update_project_settings.inputSchema as unknown as { shape: object }).shape)).not.toContain('agentSettings');
    expect(await run('update_project_settings', { description: '새 설명' })).toEqual({ ok: true });
    expect(await run('read_project_settings', {})).toMatchObject({ description: '새 설명' });
  });
});
