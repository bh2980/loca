import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, peopleRelationsTemplate, validateWorkflow, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';

const person = (name: string, extra: Record<string, unknown> = {}) => ({ name, aliases: [], profile: '', speech: '', player: false, gender: 'unknown', ageBand: 'unknown', role: 'unknown', evidence: [], ...extra });

describe('인물·관계 추출 template, end to end', () => {
  it('reads the scenes, saves new people at once, then merges the fragments of each person and proposes what a person owns', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    const choice = { connectionId: connection.id, model: 'm' };
    const groups = [1, 2, 3].map((n) => ({ key: `g${n}`, title: `Scene ${n}` }));
    const units = groups.flatMap((group, scene) => [0, 1].map((n) => ({ key: `${group.key}-${n}`, group: group.key, speaker: scene === 1 ? 'MIRA' : 'KAI', source: `S${scene} L${n}` })));
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'People' }, groups, units }), choice);
    // Stored before the run: one imported with a placeholder profile, one written by an earlier AI run nobody touched.
    db.insert(s.characters).values([
      { projectId, name: 'MIRA', profile: '가져온 자리표시자', origin: 'import', status: 'confirmed' },
      { projectId, name: 'KAI', profile: '옛 AI 프로필', origin: 'ai', statusBy: 'ai' },
    ]).run();
    const aiFailed = db.select().from(s.tags).where(eq(s.tags.role, 'aiFailed')).get()!;
    const template = peopleRelationsTemplate({ model: choice, aiFailedTag: aiFailed.id });
    // One request per scene (two lines each).
    const definition = workflowDefinitionSchema.parse({ ...template, nodes: template.nodes.map((node) => (node.id === 'people' && node.type === 'ai' ? { ...node, config: { ...node.config, batch: { mode: 'count', size: 2 } } } : node)) });
    const refs = { statusIds: new Set<string>(), tagIds: new Set([aiFailed.id]), connections: new Set([choice.connectionId]) } as never;
    expect(validateWorkflow(definition, refs).filter((issue) => issue.level === 'error')).toEqual([]);
    const workflow = db.insert(s.workflows).values({ projectId, name: '인물·관계 추출', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} });

    const merging = (request: { system: string }) => request.system.includes('An earlier node read the script');
    const seen: { system: string; prompt: string }[] = [];
    const port: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        seen.push(request);
        if (merging(request)) return { object: { characters: [person('MIRA', { aliases: ['Captain', 'KAI'], profile: '선장, 부하를 아낀다', role: 'main', gender: 'female' }), person('KAI', { aliases: ['Kay'], profile: '새 AI 프로필', role: 'supporting' }), person('NOVA', { profile: '정비사' })] }, usage: {} } as never;
        const scene = /S(\d)/.exec(request.prompt)![1];
        return { object: { characters: [person('MIRA', { aliases: scene === '0' ? ['Captain'] : [], profile: `장면 ${scene}의 MIRA`, role: 'main' }), ...(scene === '2' ? [person('NOVA', { profile: '정비사' })] : [])], relationships: [], speechRules: [] }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();

    // Three scene requests, then one merge request that gets the fragments (trimmed to the gather's fields) and no lines.
    const combine = seen.filter(merging);
    expect(seen.length - combine.length).toBe(3);
    expect(combine).toHaveLength(1);
    const input = JSON.parse(combine[0]!.prompt) as { scenes?: unknown; previous: { parts: { characters: Record<string, unknown>[] }[]; count: number }[] };
    expect(input.scenes).toBeUndefined();
    expect(input.previous[0]!.count).toBe(3);
    expect(input.previous[0]!.parts.map((part) => part.characters.map((entry) => entry.name))).toEqual([['MIRA'], ['MIRA'], ['MIRA', 'NOVA']]);
    expect(input.previous[0]!.parts.every((part) => part.characters.every((entry) => !('evidence' in entry)))).toBe(true);

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');

    const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((c) => [c.name, c]));
    // The imported profile waits for the person; role, gender and names came in at once.
    expect(people.get('MIRA')).toMatchObject({ profile: '가져온 자리표시자', role: 'main', gender: 'female', origin: 'import' });
    expect(people.get('MIRA')!.aliases).toEqual(['Captain']);
    // KAI is another stored person: not an alias of MIRA, and the untouched AI profile is replaced.
    expect(people.get('KAI')).toMatchObject({ profile: '새 AI 프로필', role: 'supporting', aliases: ['Kay'] });
    expect(people.get('NOVA')).toMatchObject({ profile: '정비사', origin: 'ai' });
    const proposals = db.select().from(s.proposals).all();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ tool: 'save_character', source: 'api', status: 'pending', input: { id: people.get('MIRA')!.id, profile: '선장, 부하를 아낀다' } });
  });
});
