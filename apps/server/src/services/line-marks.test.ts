import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_FORMAT_RULES, importFileSchema, isUnknownListener, matchesMarks, type FormatRules, type ListenerOrigin } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { markConditions, unknownListenerSql } from './line-marks.ts';
import { addCandidate, declineSuggestion } from './candidates.ts';

describe('unknown listener', () => {
  it('is decided the same way in SQL and in shared code, nulls included', () => {
    const db = openDatabase(':memory:');
    const cases: { kind: 'dialogue' | 'ui'; speaker: string | null; source: string; listener: string | null; origin: ListenerOrigin | null; confidence: number | null }[] = [];
    for (const kind of ['dialogue', 'ui'] as const)
      for (const speaker of ['Ann', null, ' ', '\t', '\u00a0', ''])
        for (const source of ['Line', '<b></b>', '{0} %s', '<b>{name}</b>!'])
          for (const listener of [null, 'Hank'])
            for (const origin of [null, 'import', 'ai', 'human'] as const)
              for (const confidence of [null, 0.5, 0.95]) cases.push({ kind, speaker, source, listener, origin, confidence });
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: cases.map((item, index) => ({ key: `u${index}`, group: 'g', source: item.source })) });
    const { projectId } = importProject(db, file, null as never);
    cases.forEach((item, index) =>
      db.update(s.units).set({ kind: item.kind, speaker: item.speaker, listener: item.listener, listenerOrigin: item.origin, listenerConfidence: item.confidence }).where(and(eq(s.units.projectId, projectId), eq(s.units.key, `u${index}`))).run(),
    );
    // The project's format rules (설정 › 서식) decide what is only tokens: with no presets, '<b></b>' is text.
    for (const rules of [DEFAULT_FORMAT_RULES, { presets: [], custom: [] }] satisfies FormatRules[]) {
      db.update(s.projects).set({ formatRules: rules }).where(eq(s.projects.id, projectId)).run();
      const bySql = new Set(db.select({ key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), unknownListenerSql(projectId))).all().map((row) => row.key));
      const byCode = new Set(cases.flatMap((item, index) => (isUnknownListener({ ...item, listenerOrigin: item.origin, listenerConfidence: item.confidence }, rules) ? [`u${index}`] : [])));
      expect(bySql).toEqual(byCode);
      expect(byCode.size).toBeGreaterThan(0);
    }
  });

  it('is never narration or a line of format tokens only', () => {
    const line = { kind: 'dialogue', speaker: 'Ann', source: 'Hi', listener: null, listenerOrigin: null, listenerConfidence: null };
    expect(isUnknownListener(line, undefined)).toBe(true);
    expect(isUnknownListener({ ...line, speaker: null }, undefined)).toBe(false);
    expect(isUnknownListener({ ...line, source: '<color=#fff></color>' }, undefined)).toBe(false);
    expect(isUnknownListener({ ...line, source: '{0}' }, undefined)).toBe(false);
    expect(isUnknownListener({ ...line, source: '[b][/b]' }, undefined)).toBe(true);
    expect(isUnknownListener({ ...line, source: '[b][/b]' }, { presets: ['bbcode'], custom: [] })).toBe(false);
    expect(isUnknownListener({ ...line, source: '@@ICON@@' }, { presets: [], custom: [{ label: '', kind: 'tag', pattern: '@@\\w+@@' }] })).toBe(false);
    expect(isUnknownListener({ ...line, source: '<b>42</b>' }, undefined)).toBe(true);
  });
});

describe('mark filters', () => {
  it('need every picked mark', () => {
    expect(matchesMarks(['unused', 'duplicateTarget'], ['unused', 'duplicateTarget'])).toBe(true);
    expect(matchesMarks(['unused'], ['unused', 'duplicateTarget'])).toBe(false);
    expect(matchesMarks(['review'], ['review', 'noEvidence'])).toBe(false);
    expect(matchesMarks([], undefined)).toBe(true);
  });
});

describe('AI 제안 대기', () => {
  it('marks the lines with a waiting suggestion, and only while it waits', () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'A' }, { key: 'b', group: 'g', source: 'B' }] });
    const { projectId } = importProject(db, file, null as never);
    const unit = (key: string) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get()!;
    const marked = () => db.select({ key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), ...markConditions(projectId, ['aiSuggestion']))).all().map((row) => row.key);
    const suggestion = addCandidate(db, { unitId: unit('a').id, text: '제안', origin: 'ai', state: 'pending' });
    addCandidate(db, { unitId: unit('b').id, text: '지난 번역', origin: 'ai' });
    expect(marked()).toEqual(['a']);
    declineSuggestion(db, unit('a').id, suggestion);
    expect(marked()).toEqual([]);
  });
});
