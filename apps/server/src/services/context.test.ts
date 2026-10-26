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
  it('gives the gender and age band of the batch\'s speakers and named listeners, leaving out what is unknown', () => {
    const { db, projectId, unit } = setup();
    db.update(s.characters).set({ gender: 'female', ageBand: 'young' }).where(eq(s.characters.name, 'MIRA')).run();
    db.update(s.characters).set({ ageBand: 'old' }).where(eq(s.characters.name, 'JONAS')).run();
    // MIRA speaks to JONAS: both are named; a batch of JONAS's line alone names only him.
    db.update(s.units).set({ listener: 'JONAS', listenerOrigin: 'human' }).where(eq(s.units.id, unit('arrival.1').id)).run();
    const context = buildContext(db, projectId, [unit('arrival.1')], config());
    expect(context.people).toEqual({ MIRA: 'female, young adult', JONAS: 'elderly' });
    expect(buildContext(db, projectId, [unit('arrival.2')], config()).people).toEqual({ JONAS: 'elderly' });
    expect(buildContext(db, projectId, [unit('arrival.1')], config({ speech: false })).people).toEqual({});
    const cast = buildContext(db, projectId, [unit('arrival.1')], config({ cast: true })).cast;
    expect(cast.find((person) => person.name === 'MIRA')).toMatchObject({ gender: 'female', age: 'young adult' });
    expect(cast.find((person) => person.name === 'JONAS')).not.toHaveProperty('gender');
  });

  it('sends a previous scene only when it has a description (a title alone says nothing)', () => {
    const { db, projectId, rows } = setup();
    db.update(s.groups).set({ description: '앞 장면 요약' }).where(eq(s.groups.projectId, projectId)).run();
    // A line whose scene has a scene before it in the graph.
    const late = rows.find((row) => buildContext(db, projectId, [row], config({ previousScenes: 1 })).previousScenes.length > 0)!;
    expect(late).toBeDefined();
    db.update(s.groups).set({ description: '' }).where(eq(s.groups.projectId, projectId)).run();
    expect(buildContext(db, projectId, [late], config({ previousScenes: 3 })).previousScenes).toEqual([]);
  });

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
    // Aliases resolve to the same pair; the later stretch starts at tower.1 (every route passes it); candidates and unsure AI listeners are ignored.
    expect(context.speech[unit('arrival.1').id]).toEqual({ listener: 'Jonas', rule: '해요체, 호칭 "조나스 씨"' });
    expect(context.speech[unit('arrival.3').id]?.rule).toBe('해요체, 호칭 "조나스 씨"');
    expect(context.speech[unit('panel.2').id]).toBeUndefined();
    expect(context.speech[unit('tower.1').id]).toEqual({ listener: 'JONAS', rule: '해체(반말)', note: '화해 후' });
  });

  it('applies a rule toward several people, the public or oneself, and says who is present', () => {
    const { db, projectId, unit } = setup();
    db.update(s.units).set({ listener: 'group', listenerOrigin: 'human' }).where(eq(s.units.id, unit('arrival.1').id)).run();
    db.update(s.units).set({ listener: 'self', listenerOrigin: 'ai', listenerConfidence: 0.95 }).where(eq(s.units.id, unit('arrival.3').id)).run();
    db.insert(s.speechRules).values([{ projectId, fromName: 'Mira', toName: 'group', level: 'haeyo' }, { projectId, fromName: 'Mira', toName: 'self', level: 'hae' }]).run();
    const context = buildContext(db, projectId, [unit('arrival.1'), unit('arrival.3')], config());
    // The others who speak in the scene (MIRA herself left out).
    expect(context.speech[unit('arrival.1').id]).toEqual({ listener: 'everyone present (JONAS)', rule: '해요체' });
    expect(context.speech[unit('arrival.3').id]).toEqual({ listener: 'self (thinking aloud)', rule: '해체(반말)' });
  });

  it('does not carry a stretch over to a branch its start never leads to, even when that branch comes later in the script', () => {
    const { db, projectId, unit } = setup();
    db.update(s.units).set({ listener: 'Jonas', listenerOrigin: 'human' }).where(eq(s.units.id, unit('logbook.2').id)).run();
    // The panel and the logbook are two branches from the arrival; script order puts the panel first.
    db.insert(s.speechRules)
      .values([
        { projectId, fromName: 'Mira', toName: 'Jonas', level: 'haeyo' },
        { projectId, fromName: 'Mira', toName: 'Jonas', level: 'hae', startKey: 'panel.1' },
      ])
      .run();
    const context = buildContext(db, projectId, [unit('logbook.2')], config());
    expect(context.speech[unit('logbook.2').id]).toEqual({ listener: 'Jonas', rule: '해요체' });
  });

  it('picks by script order, and says so, where a stretch starts on only one of the routes into a line', () => {
    const { db, projectId, unit } = setup();
    for (const key of ['arrival.1', 'tower.1']) db.update(s.units).set({ listener: 'Jonas', listenerOrigin: 'human' }).where(eq(s.units.id, unit(key).id)).run();
    // panel.1 is on one of the routes into the tower (the other goes through the logbook).
    db.insert(s.speechRules)
      .values([
        { projectId, fromName: 'Mira', toName: 'Jonas', level: 'haeyo' },
        { projectId, fromName: 'Mira', toName: 'Jonas', level: 'hae', startKey: 'panel.1' },
      ])
      .run();
    const context = buildContext(db, projectId, ['arrival.1', 'tower.1'].map(unit), config());
    expect(context.speech[unit('arrival.1').id]?.rule).toBe('해요체');
    expect(context.speech[unit('tower.1').id]).toEqual({ listener: 'Jonas', rule: '해체(반말)', byOrder: true });
    expect(context.items.find((item) => item.kind === 'speech' && item.label.startsWith('tower.1'))?.reason).toContain('루트에 따라 달라 대본 순서 기준');
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
    const ai = db.insert(s.characters).values({ projectId, name: 'Ghost Rider', origin: 'ai', statusBy: 'ai', profile: '추측' }).returning().get();
    const checked = db.insert(s.characters).values({ projectId, name: 'Vera', origin: 'ai', statusBy: 'human', profile: '확인함' }).returning().get();
    db.insert(s.relationships).values([
      { projectId, fromId: ai.id, toId: checked.id, kind: 'guess', origin: 'ai', statusBy: 'ai' },
      { projectId, fromId: ai.id, toId: checked.id, kind: 'fact', origin: 'human' },
    ]).run();
    db.insert(s.documents).values([
      { projectId, kind: 'world', title: 'AI 설정', body: 'x', alwaysInclude: true, origin: 'ai', statusBy: 'ai' },
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

  it('filters relationship changes and future relationships to prevent spoilers based on graph passage', () => {
    const { db, projectId, unit } = setup();
    const mira = db.select().from(s.characters).where(eq(s.characters.name, 'MIRA')).get()!;
    const jonas = db.select().from(s.characters).where(eq(s.characters.name, 'JONAS')).get()!;

    // 1. Relationship with time-based changes
    db.insert(s.relationships).values({
      projectId,
      fromId: mira.id,
      toId: jonas.id,
      kind: 'colleagues',
      description: '동료 수사관',
      changes: [
        { at: 'panel.1', kind: '경쟁자', cause: '조사 방식' },
        { at: 'tower.1', kind: '신뢰하는 동료', cause: '탑 수리 협력' },
      ],
    }).run();

    // 2. Secret relationship whose evidence only appears later in tower.2
    db.insert(s.relationships).values({
      projectId,
      fromId: jonas.id,
      toId: mira.id,
      kind: 'secret_alliance',
      description: '비밀 결사 공모',
      evidence: ['tower.2'],
    }).run();

    const batchArrival = [{ ...unit('arrival.1'), source: 'MIRA meets JONAS at arrival.' }];
    const ctxArrival = buildContext(db, projectId, batchArrival, config({ characters: true, relationships: true }));
    const relArrival = ctxArrival.relationships.find((r) => r.kind === 'colleagues')!;
    expect(relArrival).toBeDefined();
    // In arrival, panel.1 and tower.1 have not been reached yet -> the start kind, no changes (spoiler prevention)
    expect(relArrival.kind).toBe('colleagues');
    expect(relArrival.changes).toBeUndefined();
    // Secret alliance whose evidence is in tower.2 is suppressed completely
    expect(ctxArrival.relationships.find((r) => r.kind === 'secret_alliance')).toBeUndefined();
    expect(ctxArrival.items.find((item) => item.label.includes('colleagues'))?.reason).toContain('미래 변화 2건 차단');

    // In panel.2, panel.1 has been passed (its kind holds now), but tower.1 has not
    const batchPanel = [{ ...unit('panel.2'), source: 'MIRA speaks to JONAS.' }];
    const ctxPanel = buildContext(db, projectId, batchPanel, config({ characters: true, relationships: true }));
    expect(ctxPanel.relationships.find((r) => r.kind === 'colleagues')).toBeUndefined();
    const relPanel = ctxPanel.relationships.find((r) => r.kind === '경쟁자')!;
    expect(relPanel.changes).toBeUndefined();
    expect(ctxPanel.relationships.find((r) => r.kind === 'secret_alliance')).toBeUndefined();

    // A batch from panel.2 to tower.1 starts as of its first line (panel.1's change has been passed)
    // and tells the change that comes inside it with its line.
    const batchSpan = [{ ...unit('panel.2'), source: 'MIRA and JONAS.' }, { ...unit('tower.1'), source: 'MIRA and JONAS at tower.' }];
    const relSpan = buildContext(db, projectId, batchSpan, config({ characters: true, relationships: true })).relationships.find((r) => r.description === '동료 수사관')!;
    expect(relSpan).toMatchObject({ kind: '경쟁자', changes: [{ at: 'tower.1', kind: '신뢰하는 동료', cause: '탑 수리 협력' }] });
    // A batch that starts at the change applies it to its own first line.
    const batchAt = [{ ...unit('panel.1'), source: 'MIRA and JONAS.' }];
    expect(buildContext(db, projectId, batchAt, config({ characters: true, relationships: true })).relationships.find((r) => r.description === '동료 수사관')).toMatchObject({ kind: '경쟁자' });

    // In tower.2, both panel.1 and tower.1 have been passed (the latest kind holds), and evidence for secret_alliance is met
    const batchTower = [{ ...unit('tower.2'), source: 'MIRA and JONAS at tower.' }];
    const ctxTower = buildContext(db, projectId, batchTower, config({ characters: true, relationships: true }));
    const relTower = ctxTower.relationships.find((r) => r.description === '동료 수사관')!;
    expect(relTower).toMatchObject({ kind: '신뢰하는 동료' });
    expect(relTower.changes).toBeUndefined();
    expect(ctxTower.relationships.find((r) => r.kind === 'secret_alliance')).toBeDefined();
  });
  it('lists the pairs that talk in the batch (listener, else the line right before), only from minTurns on', () => {
    const { db, projectId, rows } = setup();
    const batch = rows.filter((row) => row.key.startsWith('arrival.'));
    // Without listeners the sample's arrival scene is MIRA/JONAS lines in turn.
    const adjacent = buildContext(db, projectId, batch, config({ pairs: true, pairMinTurns: 1 })).pairs;
    expect(adjacent.length).toBeGreaterThan(0);
    expect(adjacent.every((pair) => pair.a.toLowerCase() < pair.b.toLowerCase())).toBe(true);
    // A listener on every line counts speaker → listener instead.
    for (const row of batch) if (row.speaker) db.update(s.units).set({ listener: row.speaker === 'MIRA' ? 'JONAS' : 'MIRA', listenerOrigin: 'human' }).where(eq(s.units.id, row.id)).run();
    const spoken = batch.filter((row) => row.speaker === 'MIRA' || row.speaker === 'JONAS').length;
    const withListeners = buildContext(db, projectId, batch, config({ pairs: true, pairMinTurns: 1 }));
    expect(withListeners.pairs).toEqual([{ a: 'JONAS', b: 'MIRA', turns: spoken }]);
    const item = withListeners.items.find((entry) => entry.kind === 'pair');
    expect(item).toMatchObject({ label: '1쌍', included: true });
    expect(item?.reason).toContain('1번 이상');
    // minTurns above the count leaves the pair (and the item) out; switched off sends nothing.
    expect(buildContext(db, projectId, batch, config({ pairs: true, pairMinTurns: spoken + 1 })).pairs).toEqual([]);
    expect(buildContext(db, projectId, batch, config({ pairs: true, pairMinTurns: spoken + 1 })).items.some((entry) => entry.kind === 'pair')).toBe(false);
    expect(buildContext(db, projectId, batch, config({ pairs: false })).pairs).toEqual([]);
  });

  it('counts the pairs of a request that reads earlier results over the run\'s lines, not over the batch', () => {
    const { db, projectId, rows } = setup();
    const carrier = rows.slice(0, 1);
    const runLines = rows.map((row) => ({ groupId: row.groupId, speaker: row.speaker, listener: null }));
    const merged = buildContext(db, projectId, carrier, config({ pairs: true, pairMinTurns: 1 }), '[]', runLines);
    expect(merged.pairs.length).toBeGreaterThan(0);
    expect(merged.items.find((entry) => entry.kind === 'pair')?.reason).toContain(`이번 실행이 읽은 대사 ${rows.length}줄`);
    // No lines given: nothing to count.
    expect(buildContext(db, projectId, carrier, config({ pairs: true, pairMinTurns: 1 }), '[]').pairs).toEqual([]);
  });
});
