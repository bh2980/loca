import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importFileSchema, sourceFileSchema, type ImportFileInput } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import { createProjectFromFile } from './project-create.ts';
import { diffSource } from './source-diff.ts';

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
  characters: [{ name: 'Ana', aliases: ['Anna'] }, { name: 'Ben' }],
  relationships: [{ from: 'Ana', to: 'Ben', kind: 'friend' }],
  terms: [{ source: 'Monaco', target: '모나코' }],
};
const made = () => createProjectFromFile(db, importFileSchema.parse(dialogue)).projectId;

it('a file of UI strings after the dialogue is all new, and leaves the dialogue alone', () => {
  const projectId = made();
  const ui = sourceFileSchema.parse({ format: 'loca/v1', groups: [{ key: 'menu', kind: 'ui', title: 'Menu' }], units: [{ key: 'menu.start', group: 'menu', kind: 'ui', source: 'Start' }] });
  const diff = diffSource(db, projectId, ui);
  expect(diff.groups).toEqual({ added: ['menu'], changed: [], same: 0 });
  expect(diff.units).toEqual({ added: ['menu.start'], changed: [], same: 0, missing: [] });
  expect(diff.unresolved).toEqual([]);
});

it('the same file again is the same, and its knowledge is already there', () => {
  const projectId = made();
  const diff = diffSource(db, projectId, sourceFileSchema.parse(dialogue));
  expect(diff.groups.same).toBe(1);
  expect(diff.units).toMatchObject({ added: [], changed: [], same: 2, missing: [] });
  expect(diff.graph).toEqual({ nodes: { added: [], changed: [], same: 2, own: 0 }, edges: { added: 0, same: 1 } });
  expect(diff.knowledge).toMatchObject({ characters: { added: 0, existing: 2 }, relationships: { added: 0, existing: 1 }, terms: { added: 0, existing: 1 } });
  expect(diff.warnings).toEqual([]);
});

it('says which lines changed and how, and the lines a group brought again no longer has', () => {
  const projectId = made();
  const next = sourceFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Monaco', sourceLanguage: 'ja' },
    groups: [{ key: 'intro', title: 'Intro' }],
    units: [{ key: 'intro.1', group: 'intro', speaker: 'Ana', source: 'Hello there.' }, { key: 'intro.3', group: 'intro', source: 'Bye.' }],
  });
  const diff = diffSource(db, projectId, next);
  expect(diff.units).toEqual({ added: ['intro.3'], changed: [{ key: 'intro.1', fields: ['source'] }], same: 0, missing: ['intro.2'] });
  expect(diff.warnings).toEqual(['파일의 원문 언어(ja)가 프로젝트(en)와 다릅니다.']);
});

it('a file may point at the project\'s own groups, nodes and people; what nothing has is unresolved', () => {
  const projectId = made();
  const more = {
    format: 'loca/v1',
    units: [{ key: 'intro.3', group: 'intro', speaker: 'Ana', source: 'And you?' }],
    graph: { nodes: [{ key: 'n3', units: ['intro.3'] }], edges: [{ from: 'n2', to: 'n3' }, { from: 'n3', to: 'nowhere' }] },
    relationships: [{ from: 'Anna', to: 'Ben', kind: 'friend' }, { from: 'Ana', to: 'Cleo', kind: 'rival' }],
  };
  // As a new project this file is not whole: its group and the other ends are not in it.
  expect(importFileSchema.safeParse(more).success).toBe(false);
  const diff = diffSource(db, projectId, sourceFileSchema.parse(more));
  expect(diff.units.added).toEqual(['intro.3']);
  expect(diff.graph).toEqual({ nodes: { added: ['n3'], changed: [], same: 0, own: 0 }, edges: { added: 2, same: 0 } });
  // Anna is Ana: the friendship is there already.
  expect(diff.knowledge.relationships).toEqual({ added: 1, existing: 1 });
  expect(diff.unresolved).toEqual([
    { path: 'graph.edges.1.to', message: '프로젝트에도 파일에도 없는 노드: nowhere' },
    { path: 'relationships.1.to', message: '프로젝트에도 파일에도 없는 인물: Cleo' },
  ]);
});

it('a line moved to another group and a node given other lines are changes', () => {
  const projectId = made();
  const moved = sourceFileSchema.parse({
    format: 'loca/v1',
    groups: [{ key: 'outro', title: 'Outro' }],
    units: [{ key: 'intro.2', group: 'outro', speaker: 'Ben', source: 'Hi.' }],
    graph: { nodes: [{ key: 'n1', units: ['intro.1', 'intro.2'] }], edges: [] },
  });
  const diff = diffSource(db, projectId, moved);
  expect(diff.units.changed).toEqual([{ key: 'intro.2', fields: ['group'] }]);
  expect(diff.graph.nodes.changed).toEqual([{ key: 'n1', fields: ['units'] }]);
});
