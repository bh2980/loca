import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { AUTO_MAX_ITEMS, autoReview, gatedTools, proposeChange } from './change-gate.ts';
import { importProject } from './importer.ts';
import { decideProposal, hasUnreportedDecisions } from './proposals.ts';

function setup(mode: 'ask' | 'auto' | 'bypass') {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'Alice', source: 'Hi' }], characters: [{ name: 'Alice' }] }));
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: mode }).returning().get();
  return { db, projectId, chat };
}
const characterNamed = (db: ReturnType<typeof setup>['db'], name: string) => db.select().from(s.characters).where(eq(s.characters.name, name)).get();

describe('change gate (#45)', () => {
  it('ask: stores a pending proposal and changes nothing', async () => {
    const { db, projectId, chat } = setup('ask');
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } });
    expect(gate).toMatchObject({ ok: true, applied: false, status: 'pending' });
    expect(characterNamed(db, 'Bob')).toBeUndefined();
  });

  it('accepted translation proposals retain their proposing model', async () => {
    const { db, projectId, chat } = setup('ask');
    const unit = db.select().from(s.units).get()!;
    const proposed = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', model: 'gpt-test', tool: 'propose_translation', input: { unitId: unit.id, text: 'Hello', note: '' } });
    expect(proposed).toMatchObject({ ok: true, status: 'pending' });
    if (!proposed.ok) throw new Error(proposed.error);

    await decideProposal(db, proposed.proposalId, true);
    expect(db.select().from(s.candidates).where(eq(s.candidates.unitId, unit.id)).get()?.model).toBe('gpt-test');

    const noModel = await proposeChange(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'propose_translation', input: { unitId: unit.id, text: 'Hi there', note: '' } });
    expect(noModel).toMatchObject({ ok: true, status: 'pending' });
    if (!noModel.ok) throw new Error(noModel.error);
    await decideProposal(db, noModel.proposalId, true);
    expect(db.select().from(s.candidates).where(eq(s.candidates.text, 'Hi there')).get()?.model).toBeNull();
  });

  it('bypass: applies at once, records who decided, and does not tell the agent twice', async () => {
    const { db, projectId, chat } = setup('bypass');
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'pi', tool: 'save_character', input: { name: 'Bob' } });
    expect(gate).toMatchObject({ ok: true, applied: true, status: 'accepted' });
    expect(gate.ok && gate.text).toContain('바로 반영했습니다');
    expect(characterNamed(db, 'Bob')).toBeDefined();
    const row = db.select().from(s.proposals).get()!;
    expect(row).toMatchObject({ decidedBy: 'bypass', status: 'accepted' });
    expect(row.reportedAt).not.toBeNull();
    expect(hasUnreportedDecisions(db, chat.id)).toBe(false);
  });

  it('auto: a small checked change applies; a run, a large batch or a warning asks', async () => {
    const { db, projectId, chat } = setup('auto');
    const small = await proposeChange(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'save_character', input: { name: 'Bob' } });
    expect(small).toMatchObject({ ok: true, applied: true });
    expect(db.select().from(s.proposals).get()).toMatchObject({ decidedBy: 'auto', review: '검사 통과' });
    expect(autoReview('start_run', {}, null).pass).toBe(false);
    expect(autoReview('propose_changes', { changes: Array.from({ length: AUTO_MAX_ITEMS + 1 }, () => ({})) }, null)).toMatchObject({ pass: false, reason: expect.stringContaining('21개') });
    expect(autoReview('propose_changes', { changes: [{}] }, { dropped: [], warnings: [{ key: 'a', issues: ['x'] }] }).pass).toBe(false);
  });

  it('a refusal stays a refusal in every mode, with the fix for the agent apart', async () => {
    const { db, projectId, chat } = setup('bypass');
    expect(await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { id: 'gone', name: 'X' } })).toEqual({ ok: false, error: '없는 인물입니다.', hint: expect.stringContaining('gone') });
  });

  it('the API chat gets change tools without the SDK approval step, through the gate', async () => {
    const { db, projectId, chat } = setup('bypass');
    const tools = gatedTools(db, projectId, chat.id, { model: null }) as Record<string, { needsApproval?: unknown; execute?: (input: unknown, options: unknown) => Promise<unknown> }>;
    expect(tools.save_character.needsApproval).toBeUndefined();
    expect(tools.edit_workflow_node.execute).toBeUndefined();
    expect(await tools.save_character.execute!({ name: 'Cara' }, { toolCallId: 't', messages: [] })).toMatchObject({ applied: true, status: 'accepted' });
    expect(characterNamed(db, 'Cara')).toBeDefined();
  });
});
