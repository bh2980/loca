import { readFileSync } from 'node:fs';
import { and, asc, eq, ne } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { exclusionRulesSchema, importFileSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createProjectFromFile } from './project-create.ts';
import { exportProject } from './project-export.ts';

vi.mock('./layout.ts', () => ({ computeLayouts: vi.fn(async () => {}), cancelViewLayouts: vi.fn() }));
let db: ReturnType<typeof openDatabase>;
beforeEach(() => void (db = openDatabase(':memory:')));
afterEach(() => db.$client.close());

const sample = () => importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));

/** What a project is, as one comparable value: set-up, script, graph and knowledge, by names and keys (ids differ between projects). */
function shape(projectId: string) {
  const statusName = new Map(db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((status) => [status.id, status.name]));
  const tagName = new Map(db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.id, tag.name]));
  const workflows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all();
  const ids = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(ids) : value && typeof value === 'object' ? Object.values(value).flatMap(ids) : []);
  return {
    project: ((row) => ({ ...row, exclusionRules: exclusionRulesSchema.parse(row.exclusionRules) }))(db.select({ name: s.projects.name, sourceLanguage: s.projects.sourceLanguage, formatRules: s.projects.formatRules, exclusionRules: s.projects.exclusionRules, nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, projectId)).get()!),
    statuses: db.select({ name: s.statuses.name, kind: s.statuses.kind, color: s.statuses.color, inReview: s.statuses.inReview }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all(),
    tags: [...tagName.values()].sort(),
    // A workflow's status and tag ids, as the names they stand for in its own project.
    workflows: workflows.map((workflow) => ({ name: workflow.name, refs: ids(workflow.definition).filter((id) => statusName.has(id) || tagName.has(id)).map((id) => statusName.get(id) ?? `#${tagName.get(id)}`).sort() })),
    units: db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.seq)).all().map((unit) => ({ key: unit.key, kind: unit.kind, source: unit.source, translation: unit.translation, status: statusName.get(unit.statusId), note: unit.note, translate: unit.translate, speaker: unit.speaker })),
    groups: db.select({ key: s.groups.key, title: s.groups.title, kind: s.groups.kind }).from(s.groups).where(eq(s.groups.projectId, projectId)).orderBy(asc(s.groups.sort)).all(),
    nodes: db.select({ key: s.graphNodes.key }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().map((row) => row.key).sort(),
    edges: db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().length,
    characters: db.select({ name: s.characters.name, status: s.characters.status }).from(s.characters).where(eq(s.characters.projectId, projectId)).orderBy(asc(s.characters.name)).all(),
    relationships: db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all().length,
    terms: db.select({ source: s.terms.source, target: s.terms.target, status: s.terms.status }).from(s.terms).where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'))).orderBy(asc(s.terms.source)).all(),
    documents: db.select({ title: s.documents.title }).from(s.documents).where(eq(s.documents.projectId, projectId)).all().map((row) => row.title).sort(),
  };
}

it('a project exported to its file and made again from it is the same project: set-up, script with statuses and memos, graph, knowledge', () => {
  const { projectId } = createProjectFromFile(db, sample());
  // A project that has been worked on: its own status and tag, a workflow that names them, lines in other statuses with memos.
  const review = db.insert(s.statuses).values({ projectId, name: '감수 대기', color: '#aa3355', kind: 'normal', inReview: true, sort: 99 }).returning().get();
  const tag = db.insert(s.tags).values({ projectId, name: '음성', color: '#112233', scope: ['lines'] }).returning().get();
  // A workflow that names them: one of its status ids made the new status (its exits move lines there).
  const statusIds = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((status) => status.id);
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => statusIds.some((id) => JSON.stringify(row.definition).includes(id)))!;
  const named = statusIds.find((id) => JSON.stringify(workflow.definition).includes(id))!;
  db.update(s.workflows).set({ name: 'ZZ 감수로', definition: JSON.parse(JSON.stringify(workflow.definition).replaceAll(named, review.id)) }).where(eq(s.workflows.id, workflow.id)).run();
  const [first, second] = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.seq)).all();
  db.update(s.units).set({ translation: '도착했다.', statusId: review.id, note: '말끝 확인', translate: 'include' }).where(eq(s.units.id, first!.id)).run();
  db.insert(s.unitTags).values({ unitId: second!.id, tagId: tag.id }).run();
  // Knowledge still to be confirmed stays so, and what was thrown out stays out.
  db.insert(s.terms).values({ projectId, source: 'Beacon', target: '신호기', status: 'candidate' }).run();
  db.insert(s.terms).values({ projectId, source: 'Junk', target: '', status: 'rejected' }).run();
  db.insert(s.characters).values({ projectId, name: 'Stranger', status: 'candidate' }).run();
  db.update(s.projects).set({ exclusionRules: { ...db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!.exclusionRules, empty: false } }).where(eq(s.projects.id, projectId)).run();

  const file = exportProject(db, projectId);
  // It is a file a new project is made from: everything it points at is in it.
  const parsed = importFileSchema.parse(JSON.parse(JSON.stringify(file)));
  expect(parsed.terms.map((term) => term.source)).not.toContain('Junk');
  const again = createProjectFromFile(db, parsed).projectId;

  expect({ ...shape(again), project: { ...shape(again).project, name: undefined } }).toEqual({ ...shape(projectId), project: { ...shape(projectId).project, name: undefined } });
  expect(shape(again).terms.find((term) => term.source === 'Beacon')!.status).toBe('candidate');
  expect(shape(again).characters.find((row) => row.name === 'Stranger')!.status).toBe('candidate');
  expect(shape(again).workflows.find((row) => row.name === 'ZZ 감수로')!.refs).toEqual(expect.arrayContaining(['감수 대기']));
  expect(db.select().from(s.unitTags).innerJoin(s.units, eq(s.units.id, s.unitTags.unitId)).where(eq(s.units.key, second!.key)).all().filter((row) => row.units.projectId === again)).toHaveLength(1);
});

it('a line status the file does not bring is refused when the project is made', () => {
  const file = { ...sample(), statuses: [{ id: 'a', name: '시작', kind: 'initial' as const, color: '#888888', inReview: false }, { id: 'b', name: '끝', kind: 'final' as const, color: '#888888', inReview: false }] };
  file.units = file.units.map((unit, index) => (index === 0 ? { ...unit, status: '없는 상태' } : unit));
  const result = importFileSchema.safeParse(file);
  expect(result.success).toBe(false);
  expect(result.error!.issues[0]).toMatchObject({ path: ['units', 0, 'status'], message: '없는 상태: 없는 상태' });
});

it('the file keeps what a person set on knowledge and the project: styles, term scopes, tags, 사건 흐름 corrections, listeners, settings', () => {
  // The home has the connection the editor's AI uses, so a project made again finds it by name.
  db.insert(s.connections).values({ kind: 'openai', name: '내 API' }).run();
  const { projectId } = createProjectFromFile(db, sample());
  const connection = db.select().from(s.connections).where(eq(s.connections.projectId, projectId)).get()!;
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  db.update(s.projects).set({
    aiAutoConfirm: false,
    markStyles: { review: { name: '봐 주세요', color: '#123456' } },
    editorAi: { ...project.editorAi, model: { connectionId: connection.id, model: 'gpt-x' } },
    agentSettings: { ...project.agentSettings, terminalPermissionMode: 'bypass', prompts: [{ name: '말투', text: '반말로' }] },
  }).where(eq(s.projects.id, projectId)).run();

  const people = db.insert(s.tags).values({ projectId, name: '주요', color: '#112233', scope: ['people', 'terms'] }).returning().get();
  const hero = db.insert(s.characters).values({ projectId, name: 'Hero', style: { length: 'concise', force: 'strong' }, origin: 'ai', statusBy: 'ai', reviewNote: '근거 부족' }).returning().get();
  db.insert(s.knowledgeTags).values({ kind: 'characters', itemId: hero.id, tagId: people.id }).run();
  const term = db.insert(s.terms).values({ projectId, source: 'Help', target: '도움말', scope: ['ui'], matchCase: true, targetCandidates: ['도움'] }).returning().get();
  db.insert(s.knowledgeTags).values({ kind: 'terms', itemId: term.id, tagId: people.id }).run();
  const [cause, effect] = ['정전', '대피'].map((title) => db.insert(s.storyEvents).values({ projectId, title }).returning().get());
  db.insert(s.eventLinks).values({ projectId, fromId: cause!.id, toId: effect!.id, kind: 'added' }).run();
  const line = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.seq)).get()!;
  db.update(s.units).set({ listener: 'Hero', listenerOrigin: 'human', listenerConfidence: null }).where(eq(s.units.id, line.id)).run();

  const again = createProjectFromFile(db, importFileSchema.parse(JSON.parse(JSON.stringify(exportProject(db, projectId))))).projectId;

  const made = db.select().from(s.projects).where(eq(s.projects.id, again)).get()!;
  expect(made.aiAutoConfirm).toBe(false);
  expect(made.markStyles).toEqual({ review: { name: '봐 주세요', color: '#123456' } });
  const madeConnection = db.select().from(s.connections).where(eq(s.connections.projectId, again)).get()!;
  expect(made.editorAi.model).toEqual({ connectionId: madeConnection.id, model: 'gpt-x' });
  expect(made.agentSettings.prompts).toEqual([{ name: '말투', text: '반말로' }]);
  // The chat's permissions are not in the file: the new project asks as the home says.
  expect(made.agentSettings.terminalPermissionMode).toBe('ask');

  const madeHero = db.select().from(s.characters).where(and(eq(s.characters.projectId, again), eq(s.characters.name, 'Hero'))).get()!;
  expect(madeHero).toMatchObject({ style: { length: 'concise', force: 'strong' }, origin: 'ai', statusBy: 'ai', reviewNote: '근거 부족' });
  const madeTerm = db.select().from(s.terms).where(and(eq(s.terms.projectId, again), eq(s.terms.source, 'Help'))).get()!;
  expect(madeTerm).toMatchObject({ scope: ['ui'], matchCase: true, targetCandidates: ['도움'] });
  const madeTag = db.select().from(s.tags).where(and(eq(s.tags.projectId, again), eq(s.tags.name, '주요'))).get()!;
  expect(madeTag.scope).toEqual(['terms', 'people']);
  const tagged = db.select().from(s.knowledgeTags).where(eq(s.knowledgeTags.tagId, madeTag.id)).all();
  expect(tagged.map((row) => [row.kind, row.itemId]).sort()).toEqual([['characters', madeHero.id], ['terms', madeTerm.id]].sort());
  const madeEvents = new Map(db.select().from(s.storyEvents).where(eq(s.storyEvents.projectId, again)).all().map((event) => [event.id, event.title]));
  expect(db.select().from(s.eventLinks).where(eq(s.eventLinks.projectId, again)).all().map((link) => [madeEvents.get(link.fromId), madeEvents.get(link.toId), link.kind])).toEqual([['정전', '대피', 'added']]);
  const madeLine = db.select().from(s.units).where(and(eq(s.units.projectId, again), eq(s.units.key, line.key))).get()!;
  expect(madeLine).toMatchObject({ listener: 'Hero', listenerOrigin: 'human' });
});
