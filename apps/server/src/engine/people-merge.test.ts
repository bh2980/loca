import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, peopleRelationsTemplate, UNRESOLVED_RELATIONSHIP_KIND, validateWorkflow, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';
import { issueTagIds } from '../services/issue-tags.ts';

const person = (name: string, extra: Record<string, unknown> = {}) => ({ name, aliases: [], newFacts: [], newSpeech: [], player: false, gender: 'unknown', ageBand: 'unknown', role: 'unknown', evidence: [], ...extra });

describe('인물·관계 추출 template, end to end', () => {
  it('reads the scenes and saves nothing, then merges the fragments and saves people, relationships and speech rules once', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    const choice = { connectionId: connection.id, model: 'm' };
    const groups = [1, 2, 3].map((n) => ({ key: `g${n}`, title: `Scene ${n}` }));
    const units = groups.flatMap((group, scene) => [0, 1].map((n) => ({ key: `${group.key}-${n}`, group: group.key, speaker: scene === 1 ? 'MIRA' : 'KAI', source: `S${scene} L${n}` })));
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'People' }, groups, units }), choice);
    // Stored before the run: one imported with a placeholder profile, one written by an earlier AI run nobody touched, and a person's speech rule.
    db.insert(s.characters).values([
      { projectId, name: 'MIRA', profile: '가져온 자리표시자', speech: '가져온 말버릇', role: 'minor', origin: 'import', status: 'confirmed' },
      { projectId, name: 'KAI', profile: '옛 AI 프로필', origin: 'ai', statusBy: 'ai' },
    ]).run();
    db.insert(s.speechRules).values({ projectId, fromName: 'MIRA', toName: 'group', level: 'haeyo', startKey: null, origin: 'human', statusBy: 'human', status: 'confirmed' }).run();
    const template = peopleRelationsTemplate({ model: choice, issueTags: issueTagIds(db, projectId) });
    // One request per scene (two lines each).
    const definition = workflowDefinitionSchema.parse({ ...template, nodes: template.nodes.map((node) => (node.id === 'people' && node.type === 'ai' ? { ...node, config: { ...node.config, batch: { mode: 'count', size: 2 } } } : node)) });
    const refs = { statusIds: new Set<string>(), tagIds: new Set(Object.values(issueTagIds(db, projectId))), connections: new Set([choice.connectionId]) } as never;
    expect(validateWorkflow(definition, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    const workflow = db.insert(s.workflows).values({ projectId, name: '인물·관계 추출', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} });

    const merging = (request: { system: string }) => request.system.includes('An earlier node read the script');
    const seen: { system: string; prompt: string }[] = [];
    // What is stored when each request (the scenes and the merge) is made.
    const stored: { nova: number; relationships: number; speechRules: number }[] = [];
    const port: ModelPort = {
      ask: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        seen.push(request);
        stored.push({ nova: db.select().from(s.characters).where(eq(s.characters.name, 'NOVA')).all().length, relationships: db.select().from(s.relationships).all().length, speechRules: db.select().from(s.speechRules).all().length });
        if (merging(request)) return { object: { notPeople: [], characters: [person('MIRA', { aliases: ['Captain', 'KAI'], newFacts: [{ text: '선장, 부하를 아낀다', evidence: ['g1-0'] }, { text: '가져온 자리표시자', evidence: [] }], newSpeech: [{ text: '짧게 말한다', evidence: ['g3-0'] }], role: 'main', gender: 'female' }), person('KAI', { aliases: ['Kay'], newFacts: [{ text: '새 AI 사실', evidence: [] }], role: 'supporting' }), person('NOVA', { newFacts: [{ text: '정비사', evidence: ['g3-1'] }, { text: '말수가 적다', evidence: [] }] })], unresolvedPairs: [], relationships: [{ between: ['MIRA', 'NOVA'], views: [{ from: 'NOVA', to: 'MIRA', kind: '선장', description: '선장을 따른다', changes: [{ at: ['g1-0'], kind: '은인', cause: '구조' }, { at: ['g3-1'], kind: '믿는 선장', cause: '수리' }], evidence: ['L1', 'g3-0'] }, { from: 'MIRA', to: 'NOVA', kind: '정비사', description: '', changes: [], evidence: [] }, ] }], speechRules: [{ fromName: 'MIRA', toName: 'NOVA', level: 'hae', address: '', note: '상관', startKey: [], evidence: ['g1-0'] }, { fromName: 'MIRA', toName: 'group', level: 'hae', address: '', note: '', startKey: [], evidence: [] }] }, usage: {} } as never;
        const scene = /S(\d)/.exec(request.prompt)![1];
        const rule = { fromName: 'MIRA', toName: 'NOVA', level: scene === '2' ? 'haeyo' : 'hae', address: '', note: '', startKey: [], evidence: ['L1'] };
        return { object: { notPeople: [], characters: [person('MIRA', { aliases: scene === '0' ? ['Captain'] : [], newFacts: [{ text: `장면 ${scene}의 MIRA`, evidence: ['L1'] }], role: 'main' }), ...(scene === '2' ? [person('NOVA', { newFacts: [{ text: '정비사', evidence: ['L2'] }] })] : [])], pairsWithoutRelationship: [], relationships: scene === '2' ? [{ between: ['MIRA', 'NOVA'], views: [{ from: 'MIRA', to: 'NOVA', kind: '정비사', description: '', changes: [{ at: ['L2'], kind: '믿는 정비사', cause: '' }], evidence: ['L2'] }] }] : [], speechRules: [rule] }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();

    // Nothing is saved before the merge request: the people and relationships come after it (the person's rule was stored before the run).
    expect(stored).toHaveLength(4);
    expect(stored.every((entry) => entry.nova === 0 && entry.relationships === 0 && entry.speechRules === 1)).toBe(true);
    // Three scene requests, then one merge request that gets the fragments (trimmed to the gather's fields) and no lines.
    const combine = seen.filter(merging);
    expect(seen.length - combine.length).toBe(3);
    expect(combine).toHaveLength(1);
    const input = JSON.parse(combine[0]!.prompt) as { scenes?: unknown; previous: { parts: { characters: Record<string, unknown>[] }[]; count: number }[] };
    expect(input.scenes).toBeUndefined();
    expect(input.previous[0]!.count).toBe(3);
    expect(input.previous[0]!.parts.map((part) => part.characters.map((entry) => entry.name))).toEqual([['MIRA'], ['MIRA'], ['MIRA', 'NOVA']]);
    expect(input.previous[0]!.parts.every((part) => part.characters.every((entry) => !('evidence' in entry)))).toBe(true);
    // The parts carry relationships (with the line ids of their changes) and speech rules (with start line and evidence).
    const parts = input.previous[0]!.parts as unknown as { relationships: { between: string[]; views: { changes: { at: string[]; kind: string }[]; evidence: string[] }[] }[]; speechRules: { startKey: unknown; evidence: string[] }[] }[];
    expect(parts[2]!.relationships[0]).toMatchObject({ between: ['MIRA', 'NOVA'], views: [{ changes: [{ at: ['g3-1'], kind: '믿는 정비사' }], evidence: ['g3-1'] }] });
    expect(parts.every((part) => part.speechRules.length === 1 && 'startKey' in part.speechRules[0]!)).toBe(true);

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');

    const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((c) => [c.name, c]));
    // The imported profile stays whole and gains the new facts at its end (the one it already says is skipped); gender and names came in at once, the known role stays.
    expect(people.get('MIRA')).toMatchObject({ profile: '가져온 자리표시자\n선장, 부하를 아낀다', speech: '가져온 말버릇\n짧게 말한다', role: 'minor', gender: 'female', origin: 'import', evidence: ['g1-0', 'g3-0'] });
    expect(people.get('MIRA')!.aliases).toEqual(['Captain']);
    // KAI is another stored person: not an alias of MIRA, and the AI profile is kept with the new fact appended.
    expect(people.get('KAI')).toMatchObject({ profile: '옛 AI 프로필\n새 AI 사실', role: 'supporting', aliases: ['Kay'] });
    expect(people.get('NOVA')).toMatchObject({ profile: '정비사\n말수가 적다', origin: 'ai', evidence: ['g3-1'] });
    // Relationships and speech rules were saved once, after the merge; the relationship names NOVA, who is new in this run.
    const rels = db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all();
    // Two views, two rows: how NOVA sees MIRA (with its changes at the lines the parts gave) and how MIRA sees NOVA.
    expect(rels).toHaveLength(2);
    const mira = people.get('MIRA')!.id;
    const nova = people.get('NOVA')!.id;
    const fromNova = rels.find((rel) => rel.fromId === nova)!;
    expect(fromNova).toMatchObject({ toId: mira, kind: '선장', mutual: false, evidence: ['g1-0', 'g3-0'] });
    expect(fromNova.changes).toEqual([{ at: 'g1-0', kind: '은인', cause: '구조' }, { at: 'g3-1', kind: '믿는 선장', cause: '수리' }]);
    expect(rels.find((rel) => rel.fromId === mira)).toMatchObject({ toId: nova, kind: '정비사', changes: [] });
    const rules = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all();
    // The person's rule for MIRA → group stays (the merge's other level for it is not added); the new pair is added.
    expect(rules.map((rule) => `${rule.fromName}|${rule.toName}|${rule.level}`).sort()).toEqual(['MIRA|NOVA|hae', 'MIRA|group|haeyo']);
    expect(db.select().from(s.proposals).all()).toHaveLength(0);
    // The merge was told what is stored about the people its parts name: profile, speech, role and the stored speech rules.
    const known = JSON.parse(combine[0]!.prompt) as { characters?: { name: string; profile: string; speech?: string; role?: string }[]; speechRules?: { from: string; to: string; level: string }[] };
    expect(known.characters).toMatchObject([{ name: 'MIRA', profile: '가져온 자리표시자', speech: '가져온 말버릇', role: 'minor' }]);
    expect(known.speechRules).toEqual([{ from: 'MIRA', to: 'group', level: 'haeyo' }]);
  });
  it('lists the talking pairs (per request and over the whole run) and saves the pairs the merge could not resolve as candidates to look at', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    const choice = { connectionId: connection.id, model: 'm' };
    const groups = [1, 2, 3].map((n) => ({ key: `g${n}`, title: `Scene ${n}` }));
    // Every scene is KAI then MIRA: one turn per scene, three over the run.
    const units = groups.flatMap((group) => ['KAI', 'MIRA'].map((speaker, n) => ({ key: `${group.key}-${n}`, group: group.key, speaker, source: `${speaker} says ${group.key}` })));
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Pairs' }, groups, units }), choice);
    db.insert(s.characters).values([{ projectId, name: 'MIRA', status: 'confirmed' }, { projectId, name: 'KAI', status: 'confirmed' }]).run();
    const template = peopleRelationsTemplate({ model: choice, issueTags: issueTagIds(db, projectId) });
    const definition = workflowDefinitionSchema.parse({
      ...template,
      nodes: template.nodes.map((node) => (node.id === 'people' && node.type === 'ai' ? { ...node, config: { ...node.config, batch: { mode: 'count', size: 2 }, context: { ...node.config.context, pairMinTurns: 1 } } } : node)),
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: '인물·관계 추출', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} });

    const seen: { system: string; prompt: string }[] = [];
    const port: ModelPort = {
      ask: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        seen.push(request);
        if (request.system.includes('An earlier node read the script'))
          return { object: { notPeople: [], characters: [], relationships: [], speechRules: [], unresolvedPairs: [{ between: ['KAI', 'MIRA'], kind: 'noEvidence', reason: '대사에 근거 없음' }, { between: ['MIRA', 'Door'], kind: 'noEvidence', reason: '대사에 근거 없음' }, { between: ['MIRA', 'OBJECTIVE'], kind: 'notPerson', reason: '사람이 아님' }] }, usage: {} } as never;
        return { object: { notPeople: [], characters: [], relationships: [], speechRules: [], pairsWithoutRelationship: [{ between: ['KAI', 'MIRA'], kind: 'noEvidence', reason: '대사에 근거 없음' }] }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();

    const merging = (request: { system: string }) => request.system.includes('An earlier node read the script');
    // Each scene request lists the pair with its one turn (the node's 대화 쌍 setting is 1); the merge lists it over all three scenes (its setting is the default 3).
    const sceneRequests = seen.filter((request) => !merging(request));
    expect(sceneRequests).toHaveLength(3);
    for (const request of sceneRequests) expect(JSON.parse(request.prompt).talkingPairs).toEqual([{ a: 'KAI', b: 'MIRA', turns: 1 }]);
    const merge = seen.find(merging)!;
    expect(JSON.parse(merge.prompt).talkingPairs).toEqual([{ a: 'KAI', b: 'MIRA', turns: 3 }]);
    expect(merge.system).toContain('"talkingPairs" lists pairs of people');
    // The parts handed to the merge carry the pairs without a relationship.
    expect(JSON.parse(merge.prompt).previous[0].parts[0].pairsWithoutRelationship).toEqual([{ between: ['KAI', 'MIRA'], kind: 'noEvidence', reason: '대사에 근거 없음' }]);

    // The unresolved pair is a candidate to look at, never a confirmed relationship; the pair with a non-person is dropped and counted.
    const rows = db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: UNRESOLVED_RELATIONSHIP_KIND, description: '대사에 근거 없음', status: 'candidate', statusBy: 'ai', origin: 'ai' });
    expect(rows[0]!.reviewNote).toContain('대사에 근거 없음');
    const saved = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all().flatMap((item) => (item.data.outputs?.['save-relationships'] ? [item.data.outputs['save-relationships'] as Record<string, unknown>] : []));
    expect(saved[0]).toMatchObject({ applied: true, unresolvedPairs: { added: 1, kept: 0, notPerson: 1, dropped: 1 }, droppedPairs: ['MIRA ↔ Door: 대사에 근거 없음'] });
  });
});
