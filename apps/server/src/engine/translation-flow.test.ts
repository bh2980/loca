import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';

type Entry = { id: string; source: string; candidate?: string; previous?: { issues?: string[]; categories?: string[]; kind?: string } };

/** The default 번역 workflow over two lines with a fake model: `review` and `translate` decide what it answers. */
async function run({ source = 'Hello', translate = (line: Entry) => `번역 ${line.source}`, revise = (line: Entry, n: number) => `수정${n} ${line.source}`, passes = (_line: Entry, _review: number) => true }: { source?: string; translate?: (line: Entry) => string; revise?: (line: Entry, n: number) => string; passes?: (line: Entry, review: number) => boolean } = {}) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const { projectId } = importProject(
    db,
    importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Scene' }], units: [{ key: 'u0', group: 'g1', source }] }),
    { connectionId: connection.id, model: 'm' },
  );
  const calls = { translate: 0, review: 0, revise: 0, terms: 0 };
  const revisePrompts: Entry[] = [];
  const port: ModelPort = {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      if (request.system.includes('Find proper nouns')) {
        calls.terms++;
        return { object: { terms: [{ source: 'Hello', target: '안녕', kind: 'other', meaning: '인사', evidence: [] }] }, usage: {} } as never;
      }
      const lines = promptEntries<Entry>(request.prompt);
      // 말투 판정: not sure, so the line goes on to AI 검수 (the speech-match branch is tested in judgment flows).
      if (request.system.includes('Which Korean speech level')) return { object: { results: lines.map((line) => ({ id: line.id, value: '', confidence: 0 })) }, usage: {} } as never;
      if (request.system.includes('Review each')) {
        const review = ++calls.review;
        return { object: { results: lines.map((line) => { const passed = passes(line, review); return { id: line.id, passed, issues: passed ? [] : ['말투가 어색합니다'], categories: passed ? [] : ['speech'] }; }) }, usage: {} } as never;
      }
      if (request.system.includes('Fix only what')) {
        calls.revise++;
        revisePrompts.push(...lines);
        return { object: { results: lines.map((line) => ({ id: line.id, text: revise(line, calls.revise) })) }, usage: {} } as never;
      }
      calls.translate++;
      return { object: { results: lines.map((line) => ({ id: line.id, text: translate(line) })) }, usage: {} } as never;
    },
  };
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.name === '번역')!;
  const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
  await new Runner(db, memoryStore(), port).drain();
  const unit = db.select().from(s.units).where(eq(s.units.key, 'u0')).get()!;
  const status = db.select().from(s.statuses).where(eq(s.statuses.id, unit.statusId)).get()!.name;
  const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
  return { db, projectId, unit, status, items, calls, revisePrompts };
}

describe('the default 번역 workflow, end to end with a fake model', () => {
  it('a line that passes becomes 완료, and the closing 용어 추출 saves its terms', async () => {
    const result = await run();
    expect(result.status).toBe('완료');
    expect(result.unit.translation).toBe('번역 Hello');
    expect(result.calls).toEqual({ translate: 1, review: 1, revise: 0, terms: 1 });
    expect(result.items.map((item) => item.state)).toEqual(['done']);
    expect(result.db.select().from(s.terms).where(eq(s.terms.projectId, result.projectId)).all().map((term) => [term.source, term.target])).toEqual([['Hello', '안녕']]);
  });

  it('a review that keeps failing sends the line to 검토 필요 after 3 revisions, and AI 수정 saw the translation and the findings', async () => {
    const result = await run({ passes: () => false });
    expect(result.status).toBe('검토 필요');
    expect(result.calls).toMatchObject({ translate: 1, review: 4, revise: 3, terms: 0 });
    expect(result.items.map((item) => item.state)).toEqual(['done']);
    // The first revision reads the first translation and the review's findings; the next one reads the previous revision.
    expect(result.revisePrompts).toHaveLength(3);
    expect(result.revisePrompts[0]).toMatchObject({ source: 'Hello', candidate: '번역 Hello', previous: { issues: ['말투가 어색합니다'], categories: ['speech'] } });
    expect(result.revisePrompts[1]).toMatchObject({ candidate: '수정1 Hello', previous: { issues: ['말투가 어색합니다'], categories: ['speech'] } });
    expect(result.unit.translation).toBe('수정3 Hello');
  });

  it('a line that fails once is revised, passes the second review and becomes 완료', async () => {
    const result = await run({ passes: (_line, review) => review > 1 });
    expect(result.status).toBe('완료');
    expect(result.calls).toMatchObject({ review: 2, revise: 1, terms: 1 });
  });

  it('a 형식 검사 that keeps failing also ends in 검토 필요 after 3 revisions, not as a failed line', async () => {
    const result = await run({ source: 'Hi\nthere', translate: () => '안녕', revise: (_line, n) => `안녕하세요${n}` });
    expect(result.status).toBe('검토 필요');
    expect(result.calls).toMatchObject({ translate: 1, review: 0, revise: 3, terms: 0 });
    expect(result.items.map((item) => item.state)).toEqual(['done']);
    expect(result.revisePrompts[0]).toMatchObject({ candidate: '안녕', previous: { kind: 'format' } });
    expect(result.revisePrompts[2]).toMatchObject({ candidate: '안녕하세요2' });
    expect(result.revisePrompts[0]!.previous!.issues!.length).toBeGreaterThan(0);
  });

  it('a revision that leaves the translation as it was (line breaks aside) ends in 검토 필요 at once', async () => {
    const result = await run({ source: 'Hi\r\nthere', translate: () => '안녕\r\n여러분', passes: () => false, revise: () => '안녕\n여러분' });
    expect(result.status).toBe('검토 필요');
    expect(result.calls).toMatchObject({ translate: 1, review: 1, revise: 1, terms: 0 });
    expect(result.items[0]!.data.path.map((step) => step.nodeId).slice(-2)).toEqual(['revised', 'unrevised']);
    // The model's \n is stored as the source's \r\n.
    expect(result.unit.translation).toBe('안녕\r\n여러분');
  });
});

describe('the default 검수 workflow, end to end with a fake model', () => {
  it('judges the speech level only of lines with a speaker → listener rule', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    const { projectId } = importProject(
      db,
      importFileSchema.parse({
        format: 'loca/v1',
        project: { name: 'Test' },
        groups: [{ key: 'g1', title: 'Scene' }],
        units: [
          { key: 'ruled', group: 'g1', speaker: 'Ann', listener: 'Bob', source: 'Hi, Bob.' },
          { key: 'menu', group: 'g1', kind: 'ui', source: 'Start' },
        ],
      }),
      { connectionId: connection.id, model: 'm' },
    );
    db.update(s.units).set({ translation: '안녕, 밥.' }).where(eq(s.units.key, 'ruled')).run();
    db.update(s.units).set({ translation: '시작' }).where(eq(s.units.key, 'menu')).run();
    db.insert(s.speechRules).values({ projectId, fromName: 'Ann', toName: 'Bob', level: 'hae', status: 'confirmed' }).run();
    const judged: string[] = [];
    const port: ModelPort = {
      ask: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        const lines = promptEntries<Entry>(request.prompt);
        if (request.system.includes('Which Korean speech level')) {
          judged.push(...lines.map((line) => line.source));
          return { object: { results: lines.map((line) => ({ id: line.id, value: '해체(반말)', confidence: 0.9 })) }, usage: {} } as never;
        }
        if (request.system.includes('Review each')) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [], categories: [] })) }, usage: {} } as never;
        return { object: { terms: [] }, usage: {} } as never;
      },
    };
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.name === '검수')!;
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await new Runner(db, memoryStore(), port).drain();
    expect(judged).toEqual(['Hi, Bob.']);
    const paths = new Map(db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all().map((item) => [db.select().from(s.units).where(eq(s.units.id, item.subjectId)).get()!.key, item.data.path.map((step) => `${step.nodeId}:${step.port}`)]));
    expect(paths.get('ruled')).toEqual(expect.arrayContaining(['has-rule:true', 'speech-sure:true', 'speech-ok:true', 'review:pass']));
    expect(paths.get('menu')).toEqual(expect.arrayContaining(['has-rule:false', 'review:pass']));
    expect(paths.get('menu')!.some((step) => step.startsWith('speech'))).toBe(false);
  });
});
