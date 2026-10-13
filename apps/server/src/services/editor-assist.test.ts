import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import type * as ai from '@tw/ai';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { CompleteRefused } from './editor-complete.ts';
import { assistLine } from './editor-assist.ts';
import { importProject } from './importer.ts';
import { memoryStore } from './secrets.ts';

function setup(assistModel = true) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor', section: 'Ch 1' }],
    units: [{ key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late.", translation: '늦었네.' }],
  });
  const { projectId } = importProject(db, file);
  if (assistModel) db.update(s.projects).set({ editorAi: { enabled: false, model: null, assistModel: { connectionId: connection.id, model: 'm' }, dailyCap: 200 } }).where(eq(s.projects.id, projectId)).run();
  const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
  return { db, unit };
}

const fake = (text: string, seen: { system?: string; prompt?: string } = {}, changes?: { kind: string; why: string }[]) =>
  (async (_route: unknown, request: { system: string; prompt: string }) => {
    seen.system = request.system;
    seen.prompt = request.prompt;
    return { object: { translations: [{ id: '1', text, ...(changes && { changes }) }] }, usage: { inputTokens: 1, outputTokens: 1 } };
  }) as unknown as typeof ai.generate;

describe('the editor AI assist', () => {
  it('is refused without a model, and refining needs a draft', async () => {
    const none = setup(false);
    await expect(assistLine(none.db, memoryStore(), none.unit.id, { mode: 'translate', draft: '' }, undefined, fake('x'))).rejects.toBeInstanceOf(CompleteRefused);
    const { db, unit } = setup();
    await expect(assistLine(db, memoryStore(), unit.id, { mode: 'refine', draft: '  ' }, undefined, fake('x'))).rejects.toThrow('다듬을 번역이 없습니다');
  });

  it('saves a refined draft as an AI candidate whose note says what changed and why, and leaves the translation', async () => {
    const { db, unit } = setup();
    const seen: { system?: string; prompt?: string } = {};
    const result = await assistLine(db, memoryStore(), unit.id, { mode: 'refine', draft: '늦었네.' }, undefined, fake('늦으셨네요.', seen, [{ kind: 'rule', why: '말투: 상관에게 존댓말' }]));
    if ('unchanged' in result) throw new Error('expected a candidate');
    expect(result).toMatchObject({ text: '늦으셨네요.', reasons: ['규칙 · 말투: 상관에게 존댓말'] });
    const candidate = db.select().from(s.candidates).where(eq(s.candidates.id, result.candidateId)).get();
    expect(candidate).toMatchObject({ unitId: unit.id, text: '늦으셨네요.', origin: 'ai', note: '다듬기 — 규칙 · 말투: 상관에게 존댓말' });
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!.translation).toBe('늦었네.');
    // The draft goes in as the candidate to keep; the prompt asks for minimal, reasoned changes.
    expect(seen.prompt).toContain('늦었네.');
    expect(seen.system).toContain('Do not rephrase what is already correct');
    expect(db.select().from(s.aiCalls).get()!.kind).toBe('editor');
    const translated = await assistLine(db, memoryStore(), unit.id, { mode: 'translate', draft: '' }, undefined, fake('지각이야.'));
    if ('unchanged' in translated) throw new Error('expected a candidate');
    expect(db.select().from(s.candidates).where(eq(s.candidates.id, translated.candidateId)).get()!.note).toBe('AI 번역');
  });

  it('makes no candidate when there is nothing to fix', async () => {
    const { db, unit } = setup();
    const before = db.select().from(s.candidates).all().length;
    const result = await assistLine(db, memoryStore(), unit.id, { mode: 'refine', draft: '늦었네. ' }, undefined, fake('늦었네.'));
    expect(result).toMatchObject({ unchanged: true });
    expect(db.select().from(s.candidates).all()).toHaveLength(before);
  });
});
