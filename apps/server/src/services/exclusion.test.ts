import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_FORMAT_RULES, exclusionReason, importFileSchema, lineExclusion, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { excludedInScope, selectRunUnits } from '../engine/run-create.ts';
import { importProject } from './importer.ts';
import { excludedSql, lineFactConditions } from './line-marks.ts';
import { findLines } from './script-query.ts';

describe('번역 제외 rules', () => {
  const reason = (source: string, rules = {}, language = 'en') => exclusionReason(source, DEFAULT_FORMAT_RULES, { empty: true, formatOnly: true, noLetters: true, noSourceScript: false, patterns: [], ...rules }, language);

  it('leaves out blank, format-only and letterless sources, and keeps text', () => {
    expect(reason('   \n')).toBe('empty');
    expect(reason('{0}')).toBe('formatOnly');
    expect(reason('<br/>')).toBe('formatOnly');
    expect(reason('...')).toBe('noLetters');
    expect(reason('100%')).toBe('noLetters');
    expect(reason('{0} 1')).toBe('noLetters');
    expect(reason('Hello {0}')).toBeNull();
    expect(reason('OK')).toBeNull();
  });

  it('applies the source-script rule and patterns only when asked', () => {
    expect(reason('東京')).toBeNull();
    expect(reason('東京', { noSourceScript: true })).toBe('noSourceScript');
    expect(reason('東京', { noSourceScript: true }, 'xx')).toBeNull();
    expect(reason('BTN_OK')).toBeNull();
    expect(reason('BTN_OK', { patterns: [{ label: '키', pattern: '^[A-Z0-9_]+$' }] })).toBe('pattern');
    expect(reason('{0}', { formatOnly: false, noLetters: false })).toBeNull();
  });

  it('lets a person decide one line either way', () => {
    expect(lineExclusion({ source: '...', translate: 'include' }, DEFAULT_FORMAT_RULES, undefined)).toBeNull();
    expect(lineExclusion({ source: 'Hello', translate: 'exclude' }, DEFAULT_FORMAT_RULES, undefined)).toBe('manual');
  });
});

describe('번역 제외 in the project', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({
      format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }],
      units: [{ key: 'a', group: 'g', speaker: 'A', source: 'Hello' }, { key: 'b', group: 'g', source: '{0}' }, { key: 'c', group: 'g', source: '...' }, { key: 'd', group: 'g', source: 'BTN_OK' }],
    }));
    const keyOf = new Map(db.select({ id: s.units.id, key: s.units.key }).from(s.units).all().map((row) => [row.id, row.key]));
    const excluded = () => db.select({ key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), excludedSql(projectId))).all().map((row) => row.key).sort();
    return { db, projectId, keyOf, excluded };
  };

  it('agrees with the shared rules in SQL, follows rule changes and a person\'s call', () => {
    const { db, projectId, excluded } = setup();
    expect(excluded()).toEqual(['b', 'c']);
    db.update(s.projects).set({ exclusionRules: { patterns: [{ label: '', pattern: '^[A-Z_]+$' }] } }).where(eq(s.projects.id, projectId)).run();
    expect(excluded()).toEqual(['b', 'c', 'd']);
    db.update(s.units).set({ translate: 'include' }).where(eq(s.units.key, 'c')).run();
    db.update(s.units).set({ translate: 'exclude' }).where(eq(s.units.key, 'a')).run();
    expect(excluded()).toEqual(['a', 'b', 'd']);
  });

  it('keeps excluded lines out of 최종 아님, runs and exports, and says so on the row', () => {
    const { db, projectId, keyOf } = setup();
    const remaining = db.select({ key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), ...lineFactConditions(projectId, { unfinished: true }))).all().map((row) => row.key).sort();
    expect(remaining).toEqual(['a', 'd']);
    const definition = workflowDefinitionSchema.parse({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} }, { id: 'end', type: 'end', position: { x: 0, y: 0 } }], edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'end' }] });
    expect(selectRunUnits(db, projectId, {}).map((id) => keyOf.get(id)).sort()).toEqual(['a', 'd']);
    expect(excludedInScope(db, projectId, {})).toBe(2);
    expect(findLines(db, projectId, { translated: false, offset: 0, limit: 50 }).rows.map((row) => row.key)).toEqual(['a', 'd']);
    const all = findLines(db, projectId, { offset: 0, limit: 50 }).rows;
    expect(all.find((row) => row.key === 'b')?.excluded).toBe(true);
    expect(all.find((row) => row.key === 'a')?.excluded).toBe(false);
    expect(findLines(db, projectId, { unfinished: true, offset: 0, limit: 50 }).rows.map((row) => row.key)).toEqual(['a', 'd']);
    expect(findLines(db, projectId, { excluded: 'only', offset: 0, limit: 50 }).rows.map((row) => row.key).sort()).toEqual(['b', 'c']);
  });
});

describe('숨기기 filters', () => {
  it('leave out lines by 번역 제외, memo, tag, status or speaker, any one of each', () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({
      format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }],
      units: [{ key: 'a', group: 'g', speaker: 'A', source: 'Hello' }, { key: 'b', group: 'g', speaker: 'B', source: 'Bye' }, { key: 'c', group: 'g', source: '{0}' }],
    }));
    const keys = (filter: Record<string, unknown>) => findLines(db, projectId, { offset: 0, limit: 50, ...filter }).rows.map((row) => row.key);
    expect(keys({ excluded: 'hide' })).toEqual(['a', 'b']);
    expect(keys({ hideSpeakers: ['A'] })).toEqual(['b', 'c']);
    db.update(s.units).set({ note: 'x' }).where(eq(s.units.key, 'b')).run();
    expect(keys({ excluded: 'hide', noted: false })).toEqual(['a']);
    const final = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, 'final'))).get()!;
    db.update(s.units).set({ statusId: final.id, translation: '안녕' }).where(eq(s.units.key, 'a')).run();
    expect(keys({ hideStatuses: [final.name] })).toEqual(['b', 'c']);
  });
});
