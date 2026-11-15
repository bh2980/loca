import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addSourceSchema, importFileSchema, sourceFileSchema, type ImportFileInput } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { addSource, sourceRefusal } from './source-add.ts';
import { undoRecorded } from './undo-records.ts';

vi.mock('./layout.ts', () => ({ computeLayouts: vi.fn(async () => {}), cancelViewLayouts: vi.fn() }));
let db: ReturnType<typeof openDatabase>;
beforeEach(() => void (db = openDatabase(':memory:')));
afterEach(() => db.$client.close());

const dialogue: ImportFileInput = {
  format: 'loca/v1',
  project: { name: 'Monaco', sourceLanguage: 'en' },
  groups: [{ key: 'intro', title: 'Intro' }],
  units: [
    { key: 'intro.1', group: 'intro', speaker: 'Ana', source: 'Hello.' },
    { key: 'intro.2', group: 'intro', speaker: 'Ben', source: 'Hi.' },
  ],
  graph: { nodes: [{ key: 'n1', units: ['intro.1'] }, { key: 'n2', units: ['intro.2'] }], edges: [{ from: 'n1', to: 'n2' }] },
  characters: [{ name: 'Ana' }, { name: 'Ben' }],
};
const made = () => importProject(db, importFileSchema.parse(dialogue)).projectId;
const made2 = () => importProject(db, importFileSchema.parse({ ...dialogue, project: { name: 'B', sourceLanguage: 'en' } })).projectId;
const lines = (projectId: string) => db.select({ key: s.units.key, source: s.units.source, kind: s.units.kind, seq: s.units.seq, translation: s.units.translation }).from(s.units).where(eq(s.units.projectId, projectId)).all().sort((a, b) => a.seq - b.seq);
const nodes = (projectId: string) => db.select({ key: s.graphNodes.key }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().map((row) => row.key).sort();

it('adds the UI strings after the dialogue, and one undo takes them all back', () => {
  const projectId = made();
  const ui = sourceFileSchema.parse({ format: 'loca/v1', groups: [{ key: 'menu', kind: 'ui', title: 'Menu' }], units: [{ key: 'menu.start', group: 'menu', source: 'Start', translation: '시작', tags: ['button'] }, { key: 'menu.quit', group: 'menu', source: 'Quit' }] });
  const added = addSource(db, projectId, ui);
  expect(added).toMatchObject({ added: { groups: 1, units: 2, graphNodes: 0, graphEdges: 0 }, missing: 0, knowledge: { kept: 0 } });
  // The group's kind decides the line's (the file left kind out); after the dialogue in script order.
  expect(lines(projectId).map((line) => [line.key, line.kind])).toEqual([['intro.1', 'dialogue'], ['intro.2', 'dialogue'], ['menu.start', 'ui'], ['menu.quit', 'ui']]);
  expect(lines(projectId).find((line) => line.key === 'menu.start')!.translation).toBe('시작');
  expect(db.select().from(s.tags).where(eq(s.tags.name, 'button')).all()).toHaveLength(1);

  undoRecorded(db, projectId, added.undoId!, 'script');
  expect(lines(projectId).map((line) => line.key)).toEqual(['intro.1', 'intro.2']);
  expect(db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).all().map((group) => group.key)).toEqual(['intro']);
  expect(db.select().from(s.tags).where(eq(s.tags.name, 'button')).all()).toHaveLength(0);
});

it('leaves what the project has as it is: a changed line, a missing line, its knowledge', () => {
  const projectId = made();
  const next = sourceFileSchema.parse({
    format: 'loca/v1',
    groups: [{ key: 'intro', title: 'Intro' }],
    units: [{ key: 'intro.1', group: 'intro', speaker: 'Ana', source: 'Hello there.' }, { key: 'intro.3', group: 'intro', speaker: 'Ana', source: 'Bye.' }],
    characters: [{ name: 'Ana' }, { name: 'Cleo' }],
  });
  const added = addSource(db, projectId, next);
  expect(added).toMatchObject({ added: { groups: 0, units: 1, graphNodes: 1 }, kept: { units: 1 }, missing: 1, knowledge: { added: { characters: 1 }, kept: 1 } });
  // intro.3 goes after the group's lines, with a node of its own; intro.1 keeps its source, intro.2 stays.
  expect(lines(projectId).map((line) => [line.key, line.source])).toEqual([['intro.1', 'Hello.'], ['intro.2', 'Hi.'], ['intro.3', 'Bye.']]);
  expect(nodes(projectId)).toEqual(['intro.3', 'n1', 'n2']);
  // Ana is there already; Cleo is new.
  expect(db.select({ name: s.characters.name }).from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((row) => row.name).sort()).toEqual(['Ana', 'Ben', 'Cleo']);
});

it('adds the knowledge the project lacks, joined to its people by any name, and keeps what it has; one undo takes it back', () => {
  const projectId = made();
  // A person edited in the app since: the file's older profile must not come back.
  db.update(s.characters).set({ profile: '앱에서 고친 프로필', aliases: ['Anna'] }).where(eq(s.characters.name, 'Ana')).run();
  db.insert(s.terms).values({ projectId, source: 'Monaco', target: '모나코' }).run();
  const more = sourceFileSchema.parse({
    format: 'loca/v1',
    units: [{ key: 'intro.3', group: 'intro', speaker: 'Cleo', source: 'Hey.' }],
    characters: [{ name: 'Ana', profile: '파일의 옛 프로필' }, { name: 'Cleo', aliases: ['C'] }],
    relationships: [{ from: 'C', to: 'Anna', kind: 'rival' }, { from: 'Ana', to: 'Ben', kind: 'friend' }],
    speechRules: [{ from: 'Cleo', to: 'Ana', level: 'hae' }],
    terms: [{ source: 'monaco', target: '모나코!' }, { source: 'Relay', target: '중계소' }],
    documents: [{ title: 'World', body: '…' }],
  });
  const added = addSource(db, projectId, more);
  // Kept: Ana (by name) and monaco (Monaco, whatever the case).
  expect(added.knowledge).toEqual({ added: { characters: 1, relationships: 2, documents: 1, terms: 1, events: 0, speechRules: 1 }, kept: 2 });
  const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((row) => [row.id, row]));
  expect([...people.values()].find((row) => row.name === 'Ana')!.profile).toBe('앱에서 고친 프로필');
  // C is Cleo (the file's alias), Anna is Ana (the project's): the rivalry joins them.
  const rivalry = db.select().from(s.relationships).where(eq(s.relationships.kind, 'rival')).get()!;
  expect([people.get(rivalry.fromId)!.name, people.get(rivalry.toId)!.name]).toEqual(['Cleo', 'Ana']);
  expect(db.select({ source: s.terms.source }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((row) => row.source).sort()).toEqual(['Monaco', 'Relay']);

  undoRecorded(db, projectId, added.undoId!, 'script');
  expect([...db.select({ name: s.characters.name }).from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((row) => row.name)].sort()).toEqual(['Ana', 'Ben']);
  expect(db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all()).toHaveLength(0);
  expect(db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all()).toHaveLength(1);
  expect(db.select().from(s.documents).where(eq(s.documents.projectId, projectId)).all()).toHaveLength(0);
  expect(db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all()).toHaveLength(0);
});

it('a file of knowledge only is something to add', () => {
  const projectId = made();
  const added = addSource(db, projectId, sourceFileSchema.parse({ format: 'loca/v1', units: [{ key: 'intro.1', group: 'intro', speaker: 'Ana', source: 'Hello.' }], terms: [{ source: 'Relay', target: '중계소' }] }));
  expect(added).toMatchObject({ added: { units: 0 }, knowledge: { added: { terms: 1 } } });
  expect(added.undoId).not.toBeNull();
});

it('joins new nodes to the project\'s graph by key, and draws no connection twice', () => {
  const projectId = made();
  const more = sourceFileSchema.parse({
    format: 'loca/v1',
    units: [{ key: 'intro.3', group: 'intro', speaker: 'Ana', source: 'And you?' }],
    graph: { nodes: [{ key: 'n3', units: ['intro.3'] }], edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n2', to: 'n3', kind: 'choice' }] },
  });
  const added = addSource(db, projectId, more);
  expect(added.added).toEqual({ groups: 0, units: 1, graphNodes: 1, graphEdges: 1 });
  const keyOf = new Map(db.select().from(s.graphNodes).all().map((node) => [node.id, node.key]));
  expect(db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().map((edge) => `${keyOf.get(edge.fromId)}→${keyOf.get(edge.toId)}`).sort()).toEqual(['n1→n2', 'n2→n3']);
});

it('refuses a file pointing at what neither has, or a new node holding a line the project has; nothing is written', () => {
  const projectId = made();
  const before = lines(projectId).length;
  expect(() => addSource(db, projectId, sourceFileSchema.parse({ format: 'loca/v1', units: [{ key: 'x.1', group: 'nowhere', source: 'X' }] }))).toThrow(/없는 참조가 1개.*nowhere/);
  expect(() => addSource(db, projectId, sourceFileSchema.parse({ format: 'loca/v1', units: [{ key: 'intro.9', group: 'intro', source: 'X' }], graph: { nodes: [{ key: 'n9', units: ['intro.9', 'intro.1'] }], edges: [] } }))).toThrow(/n9 → intro\.1/);
  expect(lines(projectId)).toHaveLength(before);
});

it('the same file again adds nothing and keeps no undo record', () => {
  const projectId = made();
  expect(addSource(db, projectId, sourceFileSchema.parse(dialogue))).toMatchObject({ added: { groups: 0, units: 0, graphNodes: 0, graphEdges: 0 }, undoId: null });
});

it('asks before turning on a format the new lines use, and turns on what it is told with the lines', () => {
  const projectId = made();
  db.update(s.projects).set({ formatRules: { presets: ['brace'], custom: [] } }).where(eq(s.projects.id, projectId)).run();
  const file = { format: 'loca/v1', groups: [{ key: 'hud', kind: 'ui', title: 'HUD' }], units: [{ key: 'hud.coins', group: 'hud', source: '%d coins' }, { key: 'hud.hp', group: 'hud', source: '@hp@ HP' }] };
  const { diff, refusal } = sourceRefusal(db, projectId, addSourceSchema.parse(file));
  expect(diff.formats.map((format) => format.id).sort()).toEqual(['@변수@', 'printf']);
  expect(refusal).toMatch(/서식 규칙에 없는 서식.*printf/);
  expect(() => addSource(db, projectId, addSourceSchema.parse({ ...file, formats: ['doubleBrace'] }))).toThrow(/doubleBrace/);
  const added = addSource(db, projectId, addSourceSchema.parse({ ...file, formats: ['printf', '@변수@'] }));
  expect(added.formats).toEqual(['printf', '@변수@']);
  expect(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!.formatRules).toEqual({ presets: ['brace', 'printf'], custom: [{ label: '@변수@', kind: 'placeholder', pattern: '@[A-Za-z_][\\w.]*@' }] });
  // The undo record holds the rules as they were.
  undoRecorded(db, projectId, added.undoId!, 'script');
  expect(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!.formatRules).toEqual({ presets: ['brace'], custom: [] });
  // [] adds without turning anything on.
  const projectB = made2();
  db.update(s.projects).set({ formatRules: { presets: ['brace'], custom: [] } }).where(eq(s.projects.id, projectB)).run();
  expect(addSource(db, projectB, addSourceSchema.parse({ ...file, formats: [] })).added.units).toBe(2);
  expect(db.select().from(s.projects).where(eq(s.projects.id, projectB)).get()!.formatRules.presets).toEqual(['brace']);
});

it('a line without a kind takes its group\'s, as in a new project', () => {
  const ui = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'UI', sourceLanguage: 'en' }, groups: [{ key: 'm', kind: 'ui', title: 'M' }], units: [{ key: 'm.1', group: 'm', source: 'Start' }] })).projectId;
  expect(lines(ui).map((line) => line.kind)).toEqual(['ui']);
});
