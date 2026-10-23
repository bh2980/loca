import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ATTACH_KINDS, ATTACH_PAGE, ATTACH_PER_KIND, importFileSchema, type AttachSearchResult } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { chatRoutes } from '../routes/chat.ts';
import { importProject } from './importer.ts';
import { runStamp, searchAttach } from './attach-search.ts';

const setup = (extraLines = 0) => {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'P' },
    groups: [{ key: 'ch1.ferry', title: 'Greywater Ferry' }, { key: 'ch1.dock', title: 'Dock' }],
    units: [
      { key: 'c1.ferry.001', group: 'ch1.ferry', source: 'Excuse me. I have a ticket for the lighthouse.', speaker: 'Reeve' },
      { key: 'c1.ferry.002', group: 'ch1.ferry', source: 'Hello there', speaker: 'Lookout' },
      { key: 'c1.dock.001', group: 'ch1.dock', source: 'The Rat is loose.', speaker: 'Gentleman' },
      ...Array.from({ length: extraLines }, (_, index) => ({ key: `bulk.${String(index).padStart(5, '0')}`, group: 'ch1.dock', source: `Crate number ${index} is heavy`, speaker: 'Mole' })),
    ],
    characters: [
      { name: 'Lookout', aliases: ['The Lookout'], role: 'main' },
      { name: 'Gentleman', role: 'supporting' },
      { name: 'Mole' },
      ...Array.from({ length: 24 }, (_, index) => ({ name: `Lord ${String(index).padStart(2, '0')}` })),
    ],
    relationships: [{ from: 'Lookout', to: 'Gentleman', kind: '협력자', changes: [{ at: 'c1.dock.001', kind: '배신자' }] }],
    speechRules: [{ from: 'Mole', to: 'Gentleman', level: 'haeyo' }],
    events: [{ title: '요트 탈환', participants: ['Lookout', 'Gentleman'] }],
    documents: [{ title: '작품 개요', kind: 'note', body: 'x' }],
    terms: [{ source: 'The Rat', target: '쥐새끼' }, { source: 'Lighthouse', target: '등대' }],
  });
  const { projectId } = importProject(db, file, null as never);
  const status = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!;
  db.insert(s.tags).values({ projectId, name: '청자 미상', color: '#888888' }).run();
  const run = db.insert(s.runs).values({ projectId, workflowName: '번역', workflowVersion: 1, definition: { nodes: [], edges: [], settings: {} } as never, scope: {}, status: 'completed', total: 3 }).returning().get();
  return { db, projectId, status, run };
};

const flat = (result: AttachSearchResult) => result.groups.flatMap((group) => group.items);

describe('@ search: every kind', () => {
  it('finds each kind with its page address', () => {
    const { db, projectId, status, run } = setup();
    const hit = (kind: string, q: string) => flat(searchAttach(db, projectId, { q, kind: kind as never })).find((item) => item.kind === kind);
    expect(hit('대사', 'ticket')).toMatchObject({ label: 'Reeve: Excuse me. I have a ticket for the light…', detail: 'c1.ferry.001' });
    expect(hit('대사', 'ticket')!.href).toMatch(new RegExp(`^/p/${projectId}/script\\?group=[^&]+&line=[^&]+&detail=true$`));
    expect(hit('장면', 'Greywater')).toMatchObject({ label: 'Greywater Ferry', detail: '2줄' });
    expect(hit('장면', 'Greywater')!.href).toMatch(/\/script\?group=/);
    expect(hit('인물', 'The Lookout')).toMatchObject({ label: 'Lookout', detail: '주연 · 별칭 The Lookout' });
    expect(hit('관계', 'Gentleman')).toMatchObject({ label: 'Lookout → Gentleman', detail: '협력자 ▸ 배신자' });
    expect(hit('관계', 'Gentleman')!.href).toMatch(/\/knowledge\?tab=people&item=/);
    expect(hit('말투 규칙', 'Mole')).toMatchObject({ label: 'Mole → Gentleman', detail: '해요체' });
    expect(hit('사건', '요트')).toMatchObject({ label: '요트 탈환', detail: 'Lookout, Gentleman' });
    expect(hit('사건', '요트')!.href).toMatch(/tab=events/);
    expect(hit('노트', '개요')).toMatchObject({ label: '작품 개요', detail: '메모' });
    expect(hit('용어', 'rat')).toMatchObject({ label: 'The Rat → 쥐새끼' });
    expect(hit('용어', 'rat')!.href).toMatch(/\/glossary\?term=/);
    const tag = hit('태그', '청자')!;
    expect(tag).toMatchObject({ label: '#청자 미상', detail: '0줄' });
    db.insert(s.unitTags).values({ unitId: db.select().from(s.units).get()!.id, tagId: tag.id }).run();
    expect(hit('태그', '청자')!.detail).toBe('1줄');
    expect(decodeURIComponent(tag.href)).toContain('tags=["');
    const found = hit('상태', status.name)!;
    expect(found).toMatchObject({ label: status.name, detail: '3줄' });
    expect(found.href).toContain(`/p/${projectId}/script?statuses=`);
    expect(hit('실행 기록', '번역')).toMatchObject({ id: run.id, detail: '완료' });
    expect(hit('실행 기록', '번역')!.label).toBe(`${runStamp(run.createdAt)} · 번역`);
    expect(hit('실행 기록', '번역')!.href).toBe(`/p/${projectId}/runs/${run.id}`);
  });

  it('finds a workflow by name', () => {
    const { db, projectId } = setup();
    const workflow = db.insert(s.workflows).values({ projectId, name: '시험 흐름', description: '시험으로 만든 워크플로', definition: { nodes: [], edges: [], settings: {} } as never }).returning().get();
    expect(flat(searchAttach(db, projectId, { q: '시험', kind: '워크플로' }))).toEqual([{ kind: '워크플로', id: workflow.id, label: '시험 흐름', detail: '시험으로 만든 워크플로', href: `/p/${projectId}/workflows/${workflow.id}` }]);
    // the project's own default workflows are found the same way
    expect(flat(searchAttach(db, projectId, { q: '번역', kind: '워크플로' })).length).toBeGreaterThan(0);
  });

  it('never offers rejected knowledge, other projects, or what does not match', () => {
    const { db, projectId } = setup();
    db.update(s.terms).set({ status: 'rejected' }).where(eq(s.terms.source, 'The Rat')).run();
    expect(flat(searchAttach(db, projectId, { q: 'rat', kind: '용어' }))).toEqual([]);
    expect(flat(searchAttach(db, 'other-project', { q: '', kind: '인물' }))).toEqual([]);
    expect(searchAttach(db, projectId, { q: 'zzzzzz' }).groups).toEqual([]);
  });
});

describe('@ search: grouping, paging, ranking', () => {
  it('without a kind: the top few of every kind that has a match, in the order of the kinds', () => {
    const { db, projectId } = setup();
    // The same rank (a name starting with "lo") is ordered by what changed last.
    db.update(s.characters).set({ updatedAt: new Date('2020-01-01') }).where(eq(s.characters.projectId, projectId)).run();
    db.update(s.characters).set({ updatedAt: new Date('2026-01-01') }).where(eq(s.characters.name, 'Lookout')).run();
    db.update(s.characters).set({ updatedAt: new Date('2025-01-01') }).where(eq(s.characters.name, 'Lord 05')).run();
    const result = searchAttach(db, projectId, { q: 'lo' });
    const kinds = result.groups.map((group) => group.kind);
    expect(kinds).toEqual(ATTACH_KINDS.filter((kind) => kinds.includes(kind)));
    expect(kinds).toEqual(expect.arrayContaining(['대사', '인물', '관계', '사건']));
    for (const group of result.groups) expect(group.items.length).toBeLessThanOrEqual(ATTACH_PER_KIND);
    expect(result.groups.find((group) => group.kind === '인물')!.items.map((item) => item.label)).toEqual(['Lookout', 'Lord 05', expect.stringMatching(/^Lord /)]);
    expect(result.groups.find((group) => group.kind === '인물')!.more).toBe(true);
  });

  it('with a kind: pages of up to 20, then 더 보기 until the end', () => {
    const { db, projectId } = setup();
    const first = searchAttach(db, projectId, { q: 'lo', kind: '인물' }).groups[0];
    expect(first.items).toHaveLength(ATTACH_PAGE);
    expect(first.more).toBe(true);
    const second = searchAttach(db, projectId, { q: 'lo', kind: '인물', offset: ATTACH_PAGE }).groups[0];
    expect(second.items.length).toBe(5);
    expect(second.more).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);
    expect(searchAttach(db, projectId, { q: 'lo', kind: '인물', limit: 5 }).groups[0].items).toHaveLength(5);
    expect(searchAttach(db, projectId, { q: 'lo', kind: '인물', limit: 500 }).groups[0].items).toHaveLength(ATTACH_PAGE);
  });

  it('ranks exact, then prefix, then contains, then matches elsewhere', () => {
    const { db, projectId } = setup();
    for (const name of ['Old Mole', 'Molecule', 'mole']) db.insert(s.characters).values({ projectId, name }).run();
    db.insert(s.characters).values({ projectId, name: 'Zed', aliases: ['the mole king'] }).run();
    const names = flat(searchAttach(db, projectId, { q: 'mole', kind: '인물' })).map((item) => item.label);
    // exact (Mole, mole), prefix (Molecule), contains (Old Mole), then only an alias matched (Zed)
    expect(names.slice(0, 2).sort()).toEqual(['Mole', 'mole']);
    expect(names.slice(2)).toEqual(['Molecule', 'Old Mole', 'Zed']);
  });

  it('among equal ranks the recently changed comes first', () => {
    const { db, projectId } = setup();
    const old = db.insert(s.characters).values({ projectId, name: 'Pilot A', updatedAt: new Date('2020-01-01') }).returning().get();
    const fresh = db.insert(s.characters).values({ projectId, name: 'Pilot B', updatedAt: new Date('2026-01-01') }).returning().get();
    expect(flat(searchAttach(db, projectId, { q: 'pilot', kind: '인물' })).map((item) => item.id)).toEqual([fresh.id, old.id]);
  });

  it('a line whose key is what was typed comes before lines that only mention it', () => {
    const { db, projectId } = setup();
    db.insert(s.units).values({ projectId, groupId: db.select().from(s.groups).get()!.id, key: 'mention', sort: 99, seq: 0, kind: 'dialogue', source: 'see c1.dock.001 for details', statusId: db.select().from(s.statuses).get()!.id }).run();
    const labels = flat(searchAttach(db, projectId, { q: 'c1.dock.001', kind: '대사' })).map((item) => item.detail);
    expect(labels[0]).toBe('c1.dock.001');
  });
});

describe('@ search: lines use the full-text index and are never all loaded', () => {
  it('finds lines by text (3+ characters through units_fts, shorter by LIKE) and pages them', () => {
    const { db, projectId } = setup(300);
    const fts = db.all<{ name: string }>(`select name from sqlite_master where name = 'units_fts'` as never);
    expect(fts.length).toBeGreaterThan(0);
    const page = searchAttach(db, projectId, { q: 'Crate number', kind: '대사' }).groups[0];
    expect(page.items).toHaveLength(ATTACH_PAGE);
    expect(page.more).toBe(true);
    const deep = searchAttach(db, projectId, { q: 'Crate number', kind: '대사', offset: 280 }).groups[0];
    expect(deep.items).toHaveLength(20);
    expect(deep.more).toBe(false);
    expect(flat(searchAttach(db, projectId, { q: 'number 299', kind: '대사' }))[0].detail).toBe('bulk.00299');
    // two characters: LIKE fallback still limited
    expect(searchAttach(db, projectId, { q: 'Cr', kind: '대사' }).groups[0].items).toHaveLength(ATTACH_PAGE);
    // a typed key
    expect(flat(searchAttach(db, projectId, { q: 'bulk.00007', kind: '대사' }))[0].detail).toBe('bulk.00007');
  });

  it('an empty search lists the most recently edited lines', () => {
    const { db, projectId } = setup(30);
    const result = searchAttach(db, projectId, { q: '', kind: '대사' }).groups[0];
    expect(result.items).toHaveLength(ATTACH_PAGE);
    expect(result.more).toBe(true);
  });
});

describe('GET /projects/:id/chat/attach', () => {
  const app = (db: ReturnType<typeof setup>['db']) => new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', chatRoutes);
  it('answers with groups, paged by kind/offset/limit, and refuses an unknown kind', async () => {
    const { db, projectId } = setup();
    const server = app(db);
    const all = (await (await server.request(`/projects/${projectId}/chat/attach?q=lo`)).json()) as AttachSearchResult;
    expect(all.groups.length).toBeGreaterThan(1);
    const page = (await (await server.request(`/projects/${projectId}/chat/attach?q=lo&kind=${encodeURIComponent('인물')}&offset=20&limit=20`)).json()) as AttachSearchResult;
    expect(page.groups).toHaveLength(1);
    expect(page.groups[0].items).toHaveLength(5);
    expect((await server.request(`/projects/${projectId}/chat/attach?kind=nope`)).status).toBe(400);
    expect((await server.request(`/projects/${projectId}/chat/attach?kind=${encodeURIComponent('인물')}&limit=21`)).status).toBe(400);
  });
});
