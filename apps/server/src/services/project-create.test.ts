import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importFileSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createProject, fileFormatOffers, startingFormatRules } from './project-create.ts';
import { createProjectFromFile } from './project-create.ts';
import { createGroup } from './source-mutations.ts';
import { createLine } from './graph-edit.ts';

vi.mock('./layout.ts', () => ({ computeLayouts: vi.fn(async () => {}), cancelViewLayouts: vi.fn() }));
let db: ReturnType<typeof openDatabase>;
beforeEach(() => void (db = openDatabase(':memory:')));
afterEach(() => db.$client.close());

it('makes an empty project from the home defaults, and its lines are written in it', () => {
  const { projectId } = createProject(db, { name: 'Monaco', description: '', sourceLanguage: 'en', targetLanguage: 'ko' });
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  expect(project).toMatchObject({ name: 'Monaco', sourceLanguage: 'en', targetLanguage: 'ko', nodeTypes: {} });
  // The same start as a project made from a file: statuses, tags and workflows of the 홈 설정, and nothing of a script.
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  expect(statuses.some((status) => status.kind === 'initial') && statuses.some((status) => status.kind === 'final')).toBe(true);
  expect(db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().length).toBeGreaterThan(0);
  expect(db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).all()).toEqual([]);

  const group = createGroup(db, projectId, { kind: 'ui', title: 'Menu' });
  const { unit } = createLine(db, projectId, { groupId: group.id }, { key: 'menu.start', source: 'Start' });
  const initial = statuses.find((status) => status.kind === 'initial')!;
  expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()).toMatchObject({ key: 'menu.start', statusId: initial.id, seq: 0 });
});

it('starts a project made from a file the same way, with what the file brings', () => {
  const empty = createProject(db, { name: 'Empty', description: '', sourceLanguage: 'en', targetLanguage: 'ko' });
  const file = createProjectFromFile(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'File', sourceLanguage: 'ja' }, groups: [{ key: 'a', title: 'A' }], units: [{ key: 'a.1', group: 'a', source: 'こんにちは {name}' }] }));
  const names = (projectId: string) => db.select({ name: s.statuses.name }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((row) => row.name).sort();
  expect(names(file.projectId)).toEqual(names(empty.projectId));
  expect(db.select().from(s.projects).where(eq(s.projects.id, file.projectId)).get()).toMatchObject({ name: 'File', sourceLanguage: 'ja', targetLanguage: 'ko' });
});

it('a project made from a file is an empty one with the file put in: the log keeps it, and the formats to ask about are offered', () => {
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'HUD', sourceLanguage: 'en' }, groups: [{ key: 'hud', kind: 'ui', title: 'HUD' }], units: [{ key: 'hud.hp', group: 'hud', source: '@hp@ HP {0}' }] });
  // The presets its lines use come with the project; a custom pattern is asked about.
  expect(startingFormatRules(file).presets).toEqual(['brace']);
  expect(fileFormatOffers(file).map((format) => format.id)).toEqual(['@변수@']);
  const { projectId, units } = createProjectFromFile(db, file, undefined, undefined, { name: 'hud.json', formats: ['@변수@'] });
  expect(units).toBe(1);
  expect(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!.formatRules.custom.map((rule) => rule.label)).toEqual(['@변수@']);
  expect(db.select().from(s.sourceImports).where(eq(s.sourceImports.projectId, projectId)).all()).toMatchObject([{ via: 'new', name: 'hud.json', summary: { formats: ['@변수@'] } }]);
});

it('a file that cannot go in leaves no half-made project behind', () => {
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'Bad' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'g.1', group: 'g', source: 'Hi' }] });
  const before = db.select().from(s.projects).all().length;
  expect(() => createProjectFromFile(db, file, undefined, undefined, { formats: ['nope'] })).toThrow(/nope/);
  expect(db.select().from(s.projects).all()).toHaveLength(before);
});
