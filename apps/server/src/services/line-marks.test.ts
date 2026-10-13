import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema, isUnknownListener, matchesMarks, type ListenerOrigin } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { markConditions } from './line-marks.ts';

describe('unknown listener', () => {
  it('is decided the same way in SQL and in shared code, nulls included', () => {
    const db = openDatabase(':memory:');
    const cases: { kind: 'dialogue' | 'ui'; listener: string | null; origin: ListenerOrigin | null; confidence: number | null }[] = [];
    for (const kind of ['dialogue', 'ui'] as const)
      for (const listener of [null, 'Hank'])
        for (const origin of [null, 'import', 'scene', 'ai', 'human'] as const)
          for (const confidence of [null, 0.5, 0.95]) cases.push({ kind, listener, origin, confidence });
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: cases.map((_, index) => ({ key: `u${index}`, group: 'g', source: 'Line' })) });
    const { projectId } = importProject(db, file, null as never);
    cases.forEach((item, index) =>
      db.update(s.units).set({ kind: item.kind, listener: item.listener, listenerOrigin: item.origin, listenerConfidence: item.confidence }).where(and(eq(s.units.projectId, projectId), eq(s.units.key, `u${index}`))).run(),
    );
    const bySql = new Set(db.select({ key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, ['unknownListener']))).all().map((row) => row.key));
    const byCode = new Set(cases.flatMap((item, index) => (isUnknownListener({ kind: item.kind, listener: item.listener, listenerOrigin: item.origin, listenerConfidence: item.confidence }) ? [`u${index}`] : [])));
    expect(bySql).toEqual(byCode);
    expect(byCode.size).toBeGreaterThan(0);
  });
});

describe('mark filters', () => {
  it('take marks of one field as either, the rest as all', () => {
    expect(matchesMarks(['candidate'], ['candidate', 'ai'])).toBe(true);
    expect(matchesMarks(['ai', 'emptyTarget'], ['candidate', 'ai', 'emptyTarget'])).toBe(true);
    expect(matchesMarks(['ai'], ['candidate', 'ai', 'emptyTarget'])).toBe(false);
    expect(matchesMarks(['remaining'], ['remaining', 'noted'])).toBe(false);
    expect(matchesMarks([], undefined)).toBe(true);
  });
});
