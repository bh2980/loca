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

const fake = (text: string, seen: { system?: string; prompt?: string } = {}) =>
  (async (_route: unknown, request: { system: string; prompt: string }) => {
    seen.system = request.system;
    seen.prompt = request.prompt;
    return { object: { translations: [{ id: '1', text }] }, usage: { inputTokens: 1, outputTokens: 1 } };
  }) as unknown as typeof ai.generate;

describe('the editor AI assist', () => {
  it('is refused without a model, and refining needs a draft', async () => {
    const none = setup(false);
    await expect(assistLine(none.db, memoryStore(), none.unit.id, { mode: 'translate', draft: '', instruction: '' }, undefined, fake('x'))).rejects.toBeInstanceOf(CompleteRefused);
    const { db, unit } = setup();
    await expect(assistLine(db, memoryStore(), unit.id, { mode: 'refine', draft: '  ', instruction: '' }, undefined, fake('x'))).rejects.toThrow('다듬을 번역이 없습니다');
  });

  it('saves the answer as an AI candidate with a note, leaves the translation, and sends the instruction', async () => {
    const { db, unit } = setup();
    const seen: { system?: string; prompt?: string } = {};
    const result = await assistLine(db, memoryStore(), unit.id, { mode: 'refine', draft: '늦었네.', instruction: '더 짧게' }, undefined, fake('늦었어.', seen));
    expect(result.text).toBe('늦었어.');
    const candidate = db.select().from(s.candidates).where(eq(s.candidates.id, result.candidateId)).get();
    expect(candidate).toMatchObject({ unitId: unit.id, text: '늦었어.', origin: 'ai', note: '다듬기: 더 짧게' });
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!.translation).toBe('늦었네.');
    expect(seen.system).toContain('더 짧게');
    const call = db.select().from(s.aiCalls).get()!;
    expect(call.kind).toBe('editor');
    expect(call.request).toContain('더 짧게');
    const translated = await assistLine(db, memoryStore(), unit.id, { mode: 'translate', draft: '', instruction: '' }, undefined, fake('지각이야.'));
    expect(db.select().from(s.candidates).where(eq(s.candidates.id, translated.candidateId)).get()!.note).toBe('AI 번역');
  });
});
