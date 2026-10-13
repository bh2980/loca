import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_AI_CONFIRM, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { ModelError } from '@tw/ai';
import { AnalysisService, canonicalNames, mergeAnalysis, saveDrafts, splitPart, type Analysis, type MergedRule } from './analysis.ts';
import { importProject } from './importer.ts';
import { memoryStore } from './secrets.ts';
import { scriptText } from './script-text.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor', section: 'Ch 1' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Sorry, boss.' },
      { key: 'a3', group: 'g1', speaker: 'Alice', source: 'Never again.' },
    ],
    graph: { nodes: [{ key: 'n1', units: ['a1'] }, { key: 'n2', units: ['a2', 'a3'] }], edges: [{ from: 'n1', to: 'n2', label: 'Apologize' }] },
  });
  const { projectId } = importProject(db, file);
  return { db, projectId, choice };
}

const draft = (rule: Analysis['speechRules'][number]['level']): Analysis => ({
  overview: { setting: '항구', mainConflict: '', plot: '앨리스가 늦은 밥을 꾸짖는다.', evidence: ['L1'] },
  characters: [
    { name: 'Alice', aliases: [], profile: '선장', speech: '짧고 단호함', player: false, evidence: ['L1', 'L3'] },
    { name: 'Bob', aliases: [], profile: '선원', speech: '', player: true, evidence: ['L2'] },
  ],
  relationships: [{ from: 'Bob', to: 'Alice', kind: '부하', description: '', changes: [{ at: 'L3', change: '긴장', cause: '지각' }], evidence: ['L2', 'L99'] }],
  events: [{ title: '지각', summary: '', cause: '', outcome: '', participants: ['Bob'], evidence: ['L1'] }],
  speechRules: [
    { from: 'Bob', to: 'Alice', level: rule, address: '선장님', note: '', start: null, evidence: ['L2'] },
    { from: 'Alice', to: 'Bob', level: 'hae', address: '', note: '', start: 'L3', evidence: ['L3'] },
  ],
  terms: [{ source: 'boss', kind: 'title', meaning: '선원들이 선장을 부르는 말', target: '선장님', evidence: ['L2'] }],
  sceneListeners: [],
});

async function settle(service: AnalysisService, projectId: string) {
  for (let i = 0; i < 50 && service.list(projectId)[0]?.status === 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  return service.list(projectId)[0];
}

describe('work analysis', () => {
  it('renders the script with short ids and choice labels', () => {
    const { db, projectId } = setup();
    const { blocks, keyOf } = scriptText(db, projectId);
    expect(blocks[0].text).toBe("## Ch 1 — Harbor [g1]\n  L1 Alice: You're late.\n  ▶ Apologize\n  L2 Bob: Sorry, boss.\n  L3 Alice: Never again.");
    expect(keyOf.get('L3')).toBe('a3');
  });

  it('stores drafts as confirmed AI items with line keys, and a rerun replaces only what nobody touched', async () => {
    const { db, projectId, choice } = setup();
    let level: Analysis['speechRules'][number]['level'] = 'hasipsio';
    const service = new AnalysisService(db, memoryStore(), { generate: async () => ({ object: draft(level), usage: { inputTokens: 10, outputTokens: 5 } }) as never });

    service.start(projectId, choice);
    const job = await settle(service, projectId);
    expect(job.status).toBe('completed');
    expect(job.result).toMatchObject({ characters: 2, speechRules: 2, invalidEvidence: 1 });

    const rules = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).orderBy(s.speechRules.fromName).all();
    expect(rules.map((rule) => [rule.fromName, rule.level, rule.startKey, rule.status, rule.origin, rule.statusBy])).toEqual([
      ['Alice', 'hae', 'a3', 'confirmed', 'ai', 'ai'],
      ['Bob', 'hasipsio', null, 'confirmed', 'ai', 'ai'],
    ]);
    const rel = db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).get()!;
    expect(rel.changes).toEqual([{ at: 'a3', change: '긴장', cause: '지각' }]);
    expect(rel.evidence).toEqual(['a2']);

    // A person reviews one rule; the rerun keeps it, replaces the rest, and does not propose the kept one again.
    db.update(s.speechRules).set({ statusBy: 'human' }).where(eq(s.speechRules.fromName, 'Alice')).run();
    level = 'haeyo';
    // 설정 › AI 확정: speech rules from AI now wait as candidates.
    db.update(s.projects).set({ aiConfirm: { speechRules: 'candidate' } }).where(eq(s.projects.id, projectId)).run();
    service.start(projectId, choice);
    expect((await settle(service, projectId)).status).toBe('completed');
    const after = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).orderBy(s.speechRules.fromName, s.speechRules.status).all();
    expect(after.map((rule) => [rule.fromName, rule.level, rule.status])).toEqual([
      ['Alice', 'hae', 'confirmed'],
      ['Bob', 'haeyo', 'candidate'],
    ]);
    expect(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all()).toHaveLength(2);
  });

  it('records a failure without touching knowledge', async () => {
    const { db, projectId, choice } = setup();
    const service = new AnalysisService(db, memoryStore(), {
      generate: async () => {
        throw new Error('boom');
      },
    });
    service.start(projectId, choice);
    const job = await settle(service, projectId);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('boom');
    expect(db.select().from(s.speechRules).all()).toEqual([]);
  });

  it('maps an analysis\'s fuller names onto stored speakers, and leaves ambiguous ones alone', () => {
    const map = canonicalNames(
      [{ name: 'Mara', aliases: ['CHAR_MARA'] }, { name: 'Iris', aliases: [] }, { name: 'Ivy', aliases: [] }],
      [
        { name: 'Mara Holt', aliases: ['Mari'] },
        { name: 'Iris Vance', aliases: ['Irie'] },
        { name: 'Vance family', aliases: [] },
        { name: 'Michael', aliases: [] },
      ],
    );
    expect(map.get('mara holt')).toBe('Mara');
    expect(map.get('mari')).toBe('Mara');
    expect(map.get('irie')).toBe('Iris');
    expect(map.get('vance family')).toBeUndefined();
    expect(map.get('michael')).toBeUndefined();
  });

  it('leaves a per-line guess to the line and a mixed scene as a hint', () => {
    const { db, projectId } = setup();
    // A guess a listener node made for this very line is more specific than the scene's.
    db.update(s.units).set({ listener: 'Guard', listenerOrigin: 'ai', listenerConfidence: 0.6 }).where(eq(s.units.key, 'a1')).run();
    const { keyOf } = scriptText(db, projectId);
    const idOf = (key: string) => [...keyOf].find(([, value]) => value === key)![0];
    const analysis = { ...draft('hasipsio'), sceneListeners: [{ scene: 'g1', speaker: 'Alice', listener: 'Bob', confidence: 0.8, exceptions: [] }] };
    saveDrafts(db, projectId, 'job', analysis, keyOf);
    const lines = () => new Map(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.key, unit]));
    expect(lines().get('a1')).toMatchObject({ listener: 'Guard', listenerOrigin: 'ai' });
    // Alice mostly addresses Bob here (0.8): kept as a scene hint, which counts as unknown.
    expect(lines().get('a3')).toMatchObject({ listener: 'Bob', listenerOrigin: 'scene', listenerConfidence: 0.8 });
    // With the one line to someone else named as an exception, the rest of the scene is sure.
    const sure = { ...analysis, sceneListeners: [{ scene: 'g1', speaker: 'Alice', listener: 'Bob', confidence: 0.95, exceptions: [{ line: idOf('a3'), listener: 'SWAT 2', confidence: 0.9 }] }] };
    saveDrafts(db, projectId, 'job2', sure, keyOf);
    expect(lines().get('a3')).toMatchObject({ listener: 'SWAT 2', listenerOrigin: 'ai', listenerConfidence: 0.9 });
  });

  it('fills scene listeners as scene guesses without touching imported ones, and holds main-pair rules for a person', () => {
    const { db, projectId } = setup();
    db.update(s.units).set({ listener: 'Captain', listenerOrigin: 'import' }).where(eq(s.units.key, 'a3')).run();
    const { keyOf } = scriptText(db, projectId);
    const analysis = { ...draft('hasipsio'), sceneListeners: [{ scene: 'g1', speaker: 'Alice', listener: 'Bob', confidence: 0.95, exceptions: [] }, { scene: 'g1', speaker: 'Bob', listener: 'Alice', confidence: 0.95, exceptions: [] }] };
    const counts = saveDrafts(db, projectId, 'job', analysis, keyOf);
    const lines = new Map(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.key, unit]));
    expect(lines.get('a1')).toMatchObject({ listener: 'Bob', listenerOrigin: 'scene', listenerConfidence: 0.95 });
    expect(lines.get('a2')).toMatchObject({ listener: 'Alice', listenerOrigin: 'scene' });
    expect(lines.get('a3')).toMatchObject({ listener: 'Captain', listenerOrigin: 'import' });
    expect(counts.listeners).toBe(2);
    // Alice→Bob and Bob→Alice are the only pairs, so both are main pairs: used at once, marked for a look.
    const bob = db.select().from(s.speechRules).where(eq(s.speechRules.fromName, 'Bob')).get()!;
    expect(bob.status).toBe('confirmed');
    expect(bob.review).toContain('주요 쌍');
    expect(counts.rulesForReview).toBeGreaterThan(0);
  });

  it('does not propose a rejected rule again, and doubts a rule whose evidence is someone else talking', () => {
    const { db, projectId } = setup();
    const { keyOf } = scriptText(db, projectId);
    saveDrafts(db, projectId, 'job1', draft('hasipsio'), keyOf);
    db.update(s.speechRules).set({ status: 'rejected', statusBy: 'human' }).where(eq(s.speechRules.fromName, 'Bob')).run();
    db.insert(s.analysisJobs).values({ id: 'job1', projectId, status: 'completed' }).run();
    // Same rule again, plus one citing Alice's lines as Bob's speech.
    const again = { ...draft('hasipsio'), speechRules: [...draft('hasipsio').speechRules, { from: 'Bob', to: 'Alice', level: 'hae' as const, address: '', note: '', start: 'L3', evidence: ['L1', 'L3'] }] };
    saveDrafts(db, projectId, 'job2', again, keyOf);
    const bob = db.select().from(s.speechRules).where(eq(s.speechRules.fromName, 'Bob')).all();
    expect(bob.filter((rule) => rule.level === 'hasipsio').map((rule) => rule.status)).toEqual(['rejected']);
    const doubtful = bob.find((rule) => rule.level === 'hae')!;
    expect(doubtful.status).toBe('confirmed');
    expect(doubtful.review).toContain('근거 대사의 화자가 다름');
  });

  it('fills the empty fields of a person already in the cast and leaves written ones alone', () => {
    const { db, projectId } = setup();
    const { keyOf } = scriptText(db, projectId);
    db.insert(s.characters).values([{ projectId, name: 'Alice', origin: 'import', status: 'confirmed' }, { projectId, name: 'Bob', profile: '사람이 쓴 설명', origin: 'human', status: 'confirmed' }]).run();
    saveDrafts(db, projectId, 'job', draft('haeyo'), keyOf);
    const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((c) => [c.name, c]));
    expect(people.size).toBe(2);
    expect(people.get('Alice')).toMatchObject({ profile: '선장', speech: '짧고 단호함', origin: 'import' });
    expect(people.get('Bob')).toMatchObject({ profile: '사람이 쓴 설명', speech: '' });
  });

  it("keeps an AI rule as a candidate beside a person's rule that says otherwise", () => {
    const { db, projectId } = setup();
    const { keyOf } = scriptText(db, projectId);
    db.insert(s.speechRules).values({ projectId, fromName: 'Bob', toName: 'Alice', level: 'hae', startKey: null, status: 'confirmed', statusBy: 'human' }).run();
    saveDrafts(db, projectId, 'job', draft('hasipsio'), keyOf);
    const ai = db.select().from(s.speechRules).where(eq(s.speechRules.fromName, 'Bob')).all().find((rule) => rule.level === 'hasipsio')!;
    expect(ai.status).toBe('candidate');
    expect(ai.review).toContain('정식 규칙');
  });

  it('adds terms under the auto-confirm switch, fills only empty forms of terms already there, and replaces its own untouched ones on a rerun', () => {
    const { db, projectId } = setup();
    const keyOf = scriptText(db, projectId).keyOf;
    db.insert(s.terms).values({ projectId, source: 'Alice', target: '', note: '', status: 'candidate', origin: 'script' }).run();
    const analysis = { ...draft('haeyo'), terms: [...draft('haeyo').terms, { source: 'alice', kind: 'person' as const, meaning: '선장', target: '앨리스', evidence: ['L1'] }] };
    const counts = saveDrafts(db, projectId, 'job1', analysis, keyOf);
    expect(counts.terms).toBe(1);
    const boss = db.select().from(s.terms).where(eq(s.terms.source, 'boss')).get()!;
    expect(boss).toMatchObject({ target: '선장님', note: '호칭·직함 · 선원들이 선장을 부르는 말', status: 'confirmed', origin: 'ai', jobId: 'job1', examples: ['a2'] });
    // The term found in the script before keeps its own entry and gains the analysis's form.
    expect(db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all().filter((t) => t.source.toLowerCase() === 'alice')).toEqual([expect.objectContaining({ source: 'Alice', target: '앨리스', origin: 'script' })]);
    // A rerun replaces the earlier analysis's untouched term instead of adding a second one.
    db.insert(s.analysisJobs).values([{ id: 'job1', projectId, status: 'completed' }, { id: 'job2', projectId, status: 'completed' }]).run();
    saveDrafts(db, projectId, 'job2', analysis, keyOf);
    expect(db.select().from(s.terms).where(eq(s.terms.source, 'boss')).all().map((t) => t.jobId)).toEqual(['job2']);
    // With the switch off, a rerun replaces it as a candidate.
    saveDrafts(db, projectId, 'job3', analysis, keyOf, { ...DEFAULT_AI_CONFIRM, terms: 'candidate' });
    expect(db.select().from(s.terms).where(eq(s.terms.source, 'boss')).all().map((t) => [t.jobId, t.status])).toEqual([['job3', 'candidate']]);
  });

  it('merges parts: one person across aliases, rules on that person, contradictions kept as conflicts', () => {
    const first: Analysis = { ...draft('hae'), characters: [{ name: 'Mara Holt', aliases: ['Holt'], profile: '', speech: '', player: false, evidence: [] }], speechRules: [{ from: 'Mara Holt', to: 'Bob', level: 'hae', address: '', note: '', start: null, evidence: [] }], relationships: [], events: [{ title: '습격', summary: '', cause: '', outcome: '', participants: [], evidence: ['L1'] }] };
    const second: Analysis = { ...draft('hae'), characters: [{ name: 'Holt', aliases: ['Mara'], profile: '형사', speech: '', player: false, evidence: [] }], speechRules: [{ from: 'Holt', to: 'Bob', level: 'haeyo', address: '', note: '', start: null, evidence: [] }], relationships: [], events: [{ title: '습격', summary: '', cause: '', outcome: '', participants: [], evidence: ['L2'] }] };
    const merged = mergeAnalysis(first, second);
    expect(merged.characters).toHaveLength(1);
    expect(merged.characters[0]).toMatchObject({ name: 'Mara Holt', profile: '형사' });
    expect(merged.characters[0].aliases).toEqual(expect.arrayContaining(['Holt', 'Mara']));
    const rules = merged.speechRules as MergedRule[];
    expect(rules.map((rule) => [rule.from, rule.level, rule.conflict ?? false])).toEqual([
      ['Mara Holt', 'hae', false],
      ['Mara Holt', 'haeyo', true],
    ]);
    expect(merged.events).toHaveLength(1);
    expect(merged.events[0].evidence).toEqual(['L1', 'L2']);
  });

  it('resumes a failed analysis: unchanged parts reuse their answers, only the rest is read again', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    db.update(s.connections).set({ maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'Two parts' },
      groups: [{ key: 'g1', title: 'One' }, { key: 'g2', title: 'Two' }],
      units: [
        { key: 'a1', group: 'g1', speaker: 'Alice', source: 'A line long enough to fill the first part on its own.' },
        { key: 'b1', group: 'g2', speaker: 'Bob', source: 'Another line long enough to need a second part.' },
      ],
    });
    const { projectId } = importProject(db, file);
    let calls = 0;
    let failSecond = true;
    const empty: Analysis = { overview: { setting: '', mainConflict: '', plot: '', evidence: [] }, characters: [], relationships: [], events: [], speechRules: [], terms: [], sceneListeners: [] };
    const service = new AnalysisService(
      db,
      memoryStore(),
      {
        generate: async () => {
          calls += 1;
          if (calls === 2 && failSecond) throw new Error('quota');
          return { object: empty, usage: {} } as never;
        },
      },
      5,
    );
    service.start(projectId, choice);
    expect((await settle(service, projectId)).status).toBe('failed');
    expect(calls).toBe(2);
    failSecond = false;
    service.start(projectId, choice, true);
    const job = await settle(service, projectId);
    expect(job.status).toBe('completed');
    // Part 1 came from the failed job; only part 2 was read again.
    expect(calls).toBe(3);
    expect(job.partsTotal).toBe(2);
  });

  it('splits a part the model refuses as too long at a scene boundary and reads the halves', async () => {
    const { db, choice } = setup();
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'Two scenes' },
      groups: [{ key: 'g1', title: 'Harbor' }, { key: 'g2', title: 'Deck' }],
      units: [
        { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
        { key: 'b1', group: 'g2', speaker: 'Bob', source: 'Aye.' },
      ],
    });
    const { projectId } = importProject(db, file);
    const prompts: string[] = [];
    const service = new AnalysisService(db, memoryStore(), {
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        // Two scenes in one request do not fit.
        if ((request.prompt.match(/^## /gm) ?? []).length > 1) throw new ModelError('too-long', 'prompt is too long', false);
        return { object: draft('hae'), usage: { inputTokens: 1, outputTokens: 1 } } as never;
      },
    });
    service.start(projectId, choice);
    const job = await settle(service, projectId);
    expect(job).toMatchObject({ status: 'completed', partsTotal: 2, partsDone: 2 });
    expect(prompts).toHaveLength(3);
  });

  it('splits a part whose answer was cut off at the output limit, as one that is too long', async () => {
    const { db, choice } = setup();
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'Two scenes' },
      groups: [{ key: 'g1', title: 'Harbor' }, { key: 'g2', title: 'Deck' }],
      units: [
        { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
        { key: 'b1', group: 'g2', speaker: 'Bob', source: 'Aye.' },
      ],
    });
    const { projectId } = importProject(db, file);
    const prompts: string[] = [];
    const service = new AnalysisService(db, memoryStore(), {
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        // What agy says when the whole game's answer does not fit its output limit.
        if ((request.prompt.match(/^## /gm) ?? []).length > 1) throw new ModelError('cli', 'CLI가 실패를 반환했습니다: Your previous response was cut off because it exceeded the output token limit', false);
        return { object: draft('hae'), usage: { inputTokens: 1, outputTokens: 1 } } as never;
      },
    });
    service.start(projectId, choice);
    const job = await settle(service, projectId);
    expect(job).toMatchObject({ status: 'completed', partsTotal: 2, partsDone: 2 });
    expect(prompts).toHaveLength(3);
  });

  it('cuts a part between scenes, near its middle', () => {
    expect(splitPart('## a\n  L1 x\n\n## b\n  L2 y\n\n## c\n  L3 z')).toEqual(['## a\n  L1 x\n\n## b\n  L2 y', '## c\n  L3 z']);
    expect(splitPart('## a\n  L1 x')).toBeNull();
  });
});

