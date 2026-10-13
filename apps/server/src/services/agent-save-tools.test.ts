import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { importProject } from './importer.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  const run = (name: string, input: unknown) => agentCatalog(db, projectId).find((tool) => tool.name === name)!.run(input) as Promise<{ ok: boolean; error?: string; id?: string }>;
  const term = db.insert(s.terms).values({ projectId, source: 'Varn Tower', target: '노코코', note: '탑 이름', status: 'candidate', statusBy: 'ai', origin: 'ai' }).returning().get();
  const tag = (name: string, scope: ('lines' | 'knowledge' | 'terms')[]) => db.insert(s.tags).values({ projectId, name, color: '#8b5cf6', scope }).returning().get();
  const tagsOn = (itemId: string) => db.select({ tagId: s.knowledgeTags.tagId }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, 'terms'), eq(s.knowledgeTags.itemId, itemId))).all().map((row) => row.tagId);
  return { db, projectId, run, term, tag, tagsOn };
}

describe('chat save tools', () => {
  it('change only the fields sent when updating: a term keeps its status, note and tags', async () => {
    const { db, run, term, tag, tagsOn } = setup();
    const place = tag('지명', ['terms']);
    db.insert(s.knowledgeTags).values({ kind: 'terms', itemId: term.id, tagId: place.id }).run();
    expect(await run('save_terms', { terms: [{ id: term.id, target: '노코코 탑' }] })).toMatchObject({ ok: true });
    const after = db.select().from(s.terms).where(eq(s.terms.id, term.id)).get()!;
    expect(after).toMatchObject({ source: 'Varn Tower', target: '노코코 탑', note: '탑 이름', status: 'candidate' });
    expect(tagsOn(term.id)).toEqual([place.id]);
  });

  it('still create with defaults, and refuse a new item missing what it needs', async () => {
    const { db, projectId, run } = setup();
    expect(await run('save_terms', { terms: [{ source: 'Relay' }] })).toMatchObject({ ok: true });
    expect(db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), eq(s.terms.source, 'Relay'))).get()).toMatchObject({ target: '', status: 'confirmed' });
    expect(await run('save_terms', { terms: [{ target: '없는 원문' }] })).toMatchObject({ ok: true, count: 0, skipped: [expect.objectContaining({ reason: expect.stringContaining('source') })] });
    const doc = await run('save_document', { title: '세계관', body: '긴 본문' });
    expect(await run('save_document', { id: doc.id, title: '세계관 (고침)' })).toMatchObject({ ok: true });
    expect(db.select().from(s.documents).where(eq(s.documents.id, doc.id!)).get()).toMatchObject({ title: '세계관 (고침)', body: '긴 본문' });
  });

  it('puts tags on terms and takes them off, refusing a tag whose scope leaves terms out', async () => {
    const { run, term, tag, tagsOn } = setup();
    const place = tag('지명', ['terms']);
    const lineOnly = tag('대사 전용', ['lines']);
    expect(await run('tag_items', { kind: 'terms', ids: [term.id], add: ['지명'] })).toMatchObject({ ok: true });
    expect(tagsOn(term.id)).toEqual([place.id]);
    // All or nothing: the refused tag keeps the allowed one from going on as well.
    expect(await run('tag_items', { kind: 'terms', ids: [term.id], add: ['#대사 전용'], remove: ['지명'] })).toMatchObject({ ok: false, error: expect.stringContaining('대사 전용') });
    expect(tagsOn(term.id)).toEqual([place.id]);
    expect(await run('tag_items', { kind: 'terms', ids: [term.id], remove: [place.id] })).toMatchObject({ ok: true });
    expect(tagsOn(term.id)).toEqual([]);
    expect(await run('tag_items', { kind: 'terms', ids: [term.id], add: ['없는 태그'] })).toMatchObject({ ok: false, error: expect.stringContaining('없는 태그') });
    void lineOnly;
  });

  it('create a tag for the places asked', async () => {
    const { db, projectId, run } = setup();
    const made = await run('save_status', { type: 'tag', name: '고유명사', scope: ['terms'] });
    expect(db.select().from(s.tags).where(and(eq(s.tags.projectId, projectId), eq(s.tags.id, made.id!))).get()).toMatchObject({ name: '고유명사', scope: ['terms'] });
  });
});
