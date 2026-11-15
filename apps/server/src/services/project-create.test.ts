import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importFileSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createProject } from './project-create.ts';
import { importProject } from './importer.ts';
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
  const file = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'File', sourceLanguage: 'ja' }, groups: [{ key: 'a', title: 'A' }], units: [{ key: 'a.1', group: 'a', source: 'こんにちは {name}' }] }));
  const names = (projectId: string) => db.select({ name: s.statuses.name }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((row) => row.name).sort();
  expect(names(file.projectId)).toEqual(names(empty.projectId));
  expect(db.select().from(s.projects).where(eq(s.projects.id, file.projectId)).get()).toMatchObject({ name: 'File', sourceLanguage: 'ja', targetLanguage: 'ko' });
});
