import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { AnalysisService, type Analysis } from './analysis.ts';
import { importProject } from './importer.ts';
import { memoryStore } from './secrets.ts';
import { scriptText } from './script-text.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const profile = db.insert(s.profiles).values({ name: 'fake', connectionId: connection.id, model: 'm', maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 }).returning().get();
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
  return { db, projectId, profileId: profile.id };
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

  it('stores drafts as AI candidates with line keys, and a rerun replaces only unconfirmed drafts', async () => {
    const { db, projectId, profileId } = setup();
    let level: Analysis['speechRules'][number]['level'] = 'hasipsio';
    const service = new AnalysisService(db, memoryStore(), { generate: async () => ({ object: draft(level), usage: { inputTokens: 10, outputTokens: 5 } }) as never });

    service.start(projectId, profileId);
    const job = await settle(service, projectId);
    expect(job.status).toBe('completed');
    expect(job.result).toMatchObject({ characters: 2, speechRules: 2, invalidEvidence: 1 });

    const rules = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).orderBy(s.speechRules.fromName).all();
    expect(rules.map((rule) => [rule.fromName, rule.level, rule.startKey, rule.status, rule.origin])).toEqual([
      ['Alice', 'hae', 'a3', 'candidate', 'ai'],
      ['Bob', 'hasipsio', null, 'candidate', 'ai'],
    ]);
    const rel = db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).get()!;
    expect(rel.changes).toEqual([{ at: 'a3', change: '긴장', cause: '지각' }]);
    expect(rel.evidence).toEqual(['a2']);

    // A person confirms one rule; the rerun keeps it and replaces the rest.
    db.update(s.speechRules).set({ status: 'confirmed' }).where(eq(s.speechRules.fromName, 'Alice')).run();
    level = 'haeyo';
    service.start(projectId, profileId);
    expect((await settle(service, projectId)).status).toBe('completed');
    const after = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).orderBy(s.speechRules.fromName, s.speechRules.status).all();
    expect(after.map((rule) => [rule.fromName, rule.level, rule.status])).toEqual([
      ['Alice', 'hae', 'confirmed'],
      ['Bob', 'haeyo', 'candidate'],
    ]);
    expect(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all()).toHaveLength(2);
  });

  it('records a failure without touching knowledge', async () => {
    const { db, projectId, profileId } = setup();
    const service = new AnalysisService(db, memoryStore(), {
      generate: async () => {
        throw new Error('boom');
      },
    });
    service.start(projectId, profileId);
    const job = await settle(service, projectId);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('boom');
    expect(db.select().from(s.speechRules).all()).toEqual([]);
  });
});
