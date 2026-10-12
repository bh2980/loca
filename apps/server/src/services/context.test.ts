import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { contextConfigSchema, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildContext } from './context.ts';
import { importProject } from './importer.ts';

// The sample has a choice (panel / logbook) that joins before the tower, and a loop back into it.
function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  const rows = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.sort)).all();
  const unit = (key: string) => rows.find((row) => row.key === key)!;
  return { db, projectId, unit, rows };
}

const config = (patch: Partial<ReturnType<typeof contextConfigSchema.parse>> = {}) => ({ ...contextConfigSchema.parse({}), ...patch });
const keys = (lines: { key: string }[]) => lines.map((line) => line.key);

describe('context builder', () => {
  it('follows one path back while there is one', () => {
    const { db, projectId, unit } = setup();
    const context = buildContext(db, projectId, [unit('panel.2')], config({ precedingLines: 3 }));
    expect(keys(context.preceding[unit('panel.2').id].lines)).toEqual(['arrival.2', 'arrival.3', 'panel.1']);
    expect(context.preceding[unit('panel.2').id].branches).toEqual([]);
  });

  it('keeps joining paths apart instead of mixing them into one conversation', () => {
    const { db, projectId, unit } = setup();
    const context = buildContext(db, projectId, [unit('tower.1')], config({ precedingLines: 4 }));
    const preceding = context.preceding[unit('tower.1').id];
    expect(preceding.lines).toEqual([]);
    const byPath = Object.fromEntries(preceding.branches.map((branch) => [branch.label, keys(branch.lines)]));
    expect(byPath).toEqual({
      repeat: ['tower.2', 'tower.3'],
      panel: ['arrival.2', 'arrival.3', 'panel.1', 'panel.2'],
      logbook: ['arrival.3', 'logbook.1', 'logbook.2', 'logbook.3'],
    });
    expect(context.items.find((item) => item.kind === 'preceding')?.reason).toContain('갈래별로 나눔');
  });

  it('shows outside lines once per batch and never lines that are in the batch', () => {
    const { db, projectId, unit } = setup();
    const batch = ['panel.1', 'panel.2'].map(unit);
    const context = buildContext(db, projectId, batch, config({ precedingLines: 3 }));
    expect(keys(context.preceding[unit('panel.1').id].lines)).toEqual(['arrival.1', 'arrival.2', 'arrival.3']);
    expect(context.preceding[unit('panel.2').id]).toBeUndefined();
  });

  it('shows existing translations of preceding lines only when asked', () => {
    const { db, projectId, unit } = setup();
    db.update(s.units).set({ translation: '정답' }).where(eq(s.units.id, unit('panel.1').id)).run();
    const shown = buildContext(db, projectId, [unit('panel.2')], config({ precedingTranslations: true })).preceding[unit('panel.2').id].lines;
    const hidden = buildContext(db, projectId, [unit('panel.2')], config()).preceding[unit('panel.2').id].lines;
    expect(shown.find((line) => line.key === 'panel.1')?.translation).toBe('정답');
    expect(hidden.every((line) => !('translation' in line))).toBe(true);
  });

  it('fills in priority order and records what the cap dropped', () => {
    const { db, projectId, unit } = setup();
    db.insert(s.documents).values({ projectId, kind: 'world', title: '긴 설정집', body: '설정 '.repeat(3000), alwaysInclude: true }).run();
    const full = buildContext(db, projectId, [unit('ending.2')], config({ documents: true, characters: true, maxTokens: 200_000 }));
    expect(full.documents.map((doc) => doc.title)).toContain('긴 설정집');
    const big = full.items.find((item) => item.label === '긴 설정집')!;
    const rest = full.items.filter((item) => item !== big).reduce((sum, item) => sum + item.tokens, 0);
    const tight = buildContext(db, projectId, [unit('ending.2')], config({ documents: true, characters: true, maxTokens: Math.max(500, rest) }));
    expect(tight.terms.map((term) => term.source)).toEqual(['Directorate']);
    expect(full.characters.length).toBeGreaterThan(0);
    expect(tight.characters.length).toBe(full.characters.length);
    expect(tight.documents.map((doc) => doc.title)).not.toContain('긴 설정집');
    expect(tight.items.find((item) => item.label === '긴 설정집')?.included).toBe(false);
    expect(tight.budget.used).toBeLessThanOrEqual(tight.budget.limit);
    expect(tight.items.map((item) => item.kind)).toEqual(full.items.map((item) => item.kind));
  });

  it('gives each line its known listener and the confirmed rule of its stretch', () => {
    const { db, projectId, unit } = setup();
    const set = (key: string, listener: string, listenerOrigin: 'ai' | 'human', listenerConfidence: number | null = null) =>
      db.update(s.units).set({ listener, listenerOrigin, listenerConfidence }).where(eq(s.units.id, unit(key).id)).run();
    set('arrival.1', 'Jonas', 'human');
    set('arrival.3', 'JONAS', 'ai', 0.95);
    set('tower.1', 'JONAS', 'ai', 0.95);
    set('panel.2', 'JONAS', 'ai', 0.5);
    db.insert(s.speechRules)
      .values([
        { projectId, fromName: 'Mira', toName: 'Jonas', level: 'haeyo', address: '조나스 씨' },
        { projectId, fromName: 'MIRA', toName: 'JONAS', level: 'hae', startKey: 'tower.1', note: '화해 후' },
        { projectId, fromName: 'MIRA', toName: 'JONAS', level: 'hasipsio', status: 'candidate' },
      ])
      .run();
    const lines = ['arrival.1', 'arrival.3', 'panel.2', 'tower.1'].map(unit);
    const context = buildContext(db, projectId, lines, config());
    // Aliases resolve to the same pair; the later stretch starts at tower.1; candidates and unsure AI listeners are ignored.
    expect(context.speech[unit('arrival.1').id]).toEqual({ listener: 'Jonas', rule: '해요체, 호칭 "조나스 씨"', byOrder: true });
    expect(context.speech[unit('arrival.3').id]?.rule).toBe('해요체, 호칭 "조나스 씨"');
    expect(context.speech[unit('panel.2').id]).toBeUndefined();
    expect(context.speech[unit('tower.1').id]).toEqual({ listener: 'JONAS', rule: '해체(반말)', note: '화해 후', byOrder: true });
  });

  it('defaults the translation context to listener/speech, glossary, preceding lines and scene text only', () => {
    const defaults = contextConfigSchema.parse({});
    expect(defaults).toMatchObject({ speech: true, glossary: true, precedingLines: 8, cast: false, characters: false, relationships: false, documents: false });
    const { db, projectId, unit } = setup();
    db.insert(s.documents).values({ projectId, kind: 'world', title: '설정집', body: '설정', alwaysInclude: true }).run();
    const context = buildContext(db, projectId, ['arrival.1', 'panel.1', 'tower.1'].map(unit), defaults);
    expect(context.characters).toEqual([]);
    expect(context.relationships).toEqual([]);
    expect(context.documents).toEqual([]);
    expect(context.aiNotes).toEqual({ characters: [], relationships: [], documents: [] });
    expect(context.items.some((item) => ['character', 'relationship', 'document'].includes(item.kind))).toBe(false);
  });

  it('sends unreviewed AI characters, relationships and documents apart from the facts', () => {
    const { db, projectId, unit } = setup();
    const ai = db.insert(s.characters).values({ projectId, name: 'Ghost Rider', origin: 'ai', reviewed: false, profile: '추측' }).returning().get();
    const checked = db.insert(s.characters).values({ projectId, name: 'Vera', origin: 'ai', reviewed: true, profile: '확인함' }).returning().get();
    db.insert(s.relationships).values([
      { projectId, fromId: ai.id, toId: checked.id, kind: 'guess', origin: 'ai', reviewed: false },
      { projectId, fromId: ai.id, toId: checked.id, kind: 'fact', origin: 'human' },
    ]).run();
    db.insert(s.documents).values([
      { projectId, kind: 'world', title: 'AI 설정', body: 'x', alwaysInclude: true, origin: 'ai', reviewed: false },
      { projectId, kind: 'world', title: '사람 설정', body: 'y', alwaysInclude: true },
    ]).run();
    const batch = [{ ...unit('arrival.1'), source: `${unit('arrival.1').source} Ghost Rider meets Vera.` }];
    const context = buildContext(db, projectId, batch, config({ characters: true, relationships: true, documents: true }));
    expect(context.characters.map((c) => c.name)).toContain('Vera');
    expect(context.characters.map((c) => c.name)).not.toContain('Ghost Rider');
    expect(context.aiNotes.characters.map((c) => c.name)).toEqual(['Ghost Rider']);
    expect(context.relationships.map((r) => r.kind)).toEqual(['fact']);
    expect(context.aiNotes.relationships.map((r) => r.kind)).toEqual(['guess']);
    expect(context.documents.map((d) => d.title)).toContain('사람 설정');
    expect(context.documents.map((d) => d.title)).not.toContain('AI 설정');
    expect(context.aiNotes.documents.map((d) => d.title)).toEqual(['AI 설정']);
  });

  it('does not match a character through a generic alias, only through its name or a real alias', () => {
    const { db, projectId, unit } = setup();
    db.insert(s.characters).values({ projectId, name: 'Pat', aliases: ['you', 'Sir', 'me', 'Pj', 'Patty'], player: true }).run();
    const run = (source: string) => buildContext(db, projectId, [{ ...unit('arrival.1'), speaker: null, source }], config({ characters: true })).characters.map((c) => c.name);
    expect(run('Thank you, sir. Give me a hand.')).not.toContain('Pat');
    expect(run('Pj is here')).not.toContain('Pat');
    expect(run('Pat is here')).toContain('Pat');
    expect(run('Patty is here')).toContain('Pat');
  });
});
