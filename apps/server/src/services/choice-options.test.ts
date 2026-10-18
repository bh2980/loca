import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { resolveChoiceOptions } from './choice-options.ts';

describe('choice options', () => {
  const db = openDatabase(':memory:');
  const project = db.insert(s.projects).values({ name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
  db.insert(s.characters).values([
    { projectId: project.id, name: 'Mira' },
    { projectId: project.id, name: 'Draft', status: 'candidate' },
  ]).run();
  db.insert(s.tags).values([
    { projectId: project.id, name: 'Casual', color: 'slate', scope: ['lines'] },
    { projectId: project.id, name: 'Scene only', color: 'slate', scope: ['terms'] },
  ]).run();
  const statuses = db.insert(s.statuses).values([
    { projectId: project.id, name: '번역 전', color: 'slate', kind: 'initial', sort: 0 },
    { projectId: project.id, name: '확정', color: 'slate', kind: 'final', sort: 1 },
  ]).returning().all();

  it('custom: the typed values, trimmed and deduplicated', () => {
    expect(resolveChoiceOptions(db, project.id, { source: 'custom', values: [' a ', 'a', 'b'] })).toEqual(['a', 'b']);
  });

  it('characters: confirmed cast names plus group, public, self', () => {
    expect(resolveChoiceOptions(db, project.id, { source: 'characters', values: ['ignored'] })).toEqual(['Mira', 'group', 'public', 'self']);
  });

  it('lineTags: tags that can go on lines', () => {
    expect(resolveChoiceOptions(db, project.id, { source: 'lineTags', values: [] })).toEqual(['Casual']);
  });

  it('statuses: status names in order', () => {
    expect(resolveChoiceOptions(db, project.id, { source: 'statuses', values: [] })).toEqual(statuses.map((status) => status.name));
  });
});
