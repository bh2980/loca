import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentSettingsSchema, importFileSchema } from '@tw/shared';
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
function setBypassLimits(db: ReturnType<typeof setup>['db'], projectId: string, bypassLimits: { changes: number; costUsd: number | null }) {
  db.update(s.projects).set({ agentSettings: agentSettingsSchema.parse({ bypassLimits }) }).where(eq(s.projects.id, projectId)).run();
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

  it('a batch takes the proposal\'s model over one named in its payload (#93 review)', async () => {
    const { db, projectId, chat } = setup('ask');
    const changes = [{ key: 'a', translation: '안녕' }];
    const proposed = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', model: 'gpt-test', tool: 'propose_changes', input: { model: 'forged', changes } });
    if (!proposed.ok) throw new Error(proposed.error);
    await decideProposal(db, proposed.proposalId, true);
    expect(db.select().from(s.candidates).where(eq(s.candidates.text, '안녕')).get()?.model).toBe('gpt-test');
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

  it('bypass: adds a translation candidate and says the current translation is unchanged', async () => {
    const { db, projectId, chat } = setup('bypass');
    const unit = db.select().from(s.units).get()!;
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'propose_translation', input: { unitId: unit.id, text: '안녕', note: '' } });
    expect(gate.ok && gate.text).toContain('후보');
    expect(gate.ok && gate.text).toContain('현재 번역은 그대로');
    expect(db.select().from(s.candidates).where(eq(s.candidates.unitId, unit.id)).get()).toBeDefined();
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()?.translation).toBeNull();
  });

  it('bypass: applies under the change cap and holds the next change with its reason', async () => {
    const { db, projectId, chat } = setup('bypass');
    setBypassLimits(db, projectId, { changes: 1, costUsd: null });
    const first = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } });
    expect(first).toMatchObject({ ok: true, applied: true });
    const next = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Cara' } });
    expect(next).toMatchObject({ ok: true, applied: false, status: 'pending', review: expect.stringContaining('변경 1개 (한도 1개)') });
    expect(next.ok && next.text).toContain('우회 한도로 사용자에게 넘겼습니다');
    expect(characterNamed(db, 'Cara')).toBeUndefined();
  });

  it('bypass: a batch counts its items, a batch past the cap asks, and running changes count (#99 review)', async () => {
    const { db, projectId, chat } = setup('bypass');
    setBypassLimits(db, projectId, { changes: 3, costUsd: null });
    const two = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_knowledge', input: { characters: [{ name: 'A1' }, { name: 'A2' }] } });
    expect(two).toMatchObject({ ok: true, applied: true });
    const big = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_knowledge', input: { characters: [{ name: 'B1' }, { name: 'B2' }] } });
    expect(big).toMatchObject({ ok: true, applied: false, review: expect.stringContaining('변경 2개 + 이번 2개 (한도 3개)') });
    // Two calls of one step in flight: the first claims its row (running) before the second checks.
    const [x, y] = await Promise.all(['C1', 'C2'].map((name) => proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name } })));
    expect([x, y].filter((gate) => gate.ok && gate.applied)).toHaveLength(1);
  });

  it('bypass: counts reported chat-call costs by session refId', async () => {
    const { db, projectId, chat } = setup('bypass');
    setBypassLimits(db, projectId, { changes: 10, costUsd: 0.5 });
    db.insert(s.aiCalls).values({ projectId, kind: 'chat', refId: chat.id, label: 'chat', costUsd: 0.6, startedAt: new Date() }).run();
    const next = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } });
    expect(next).toMatchObject({ ok: true, applied: false, status: 'pending', review: expect.stringContaining('측정된 비용 $0.60') });
    expect(characterNamed(db, 'Bob')).toBeUndefined();
  });

  it('bypass: a null cost cap leaves only the change cap; ask and auto stay unchanged', async () => {
    const bypass = setup('bypass');
    setBypassLimits(bypass.db, bypass.projectId, { changes: 10, costUsd: null });
    bypass.db.insert(s.aiCalls).values({ projectId: bypass.projectId, kind: 'chat', refId: bypass.chat.id, label: 'chat', costUsd: 500, startedAt: new Date() }).run();
    expect(await proposeChange(bypass.db, { projectId: bypass.projectId, sessionId: bypass.chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } })).toMatchObject({ ok: true, applied: true });
    const ask = setup('ask');
    const auto = setup('auto');
    expect(await proposeChange(ask.db, { projectId: ask.projectId, sessionId: ask.chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } })).toMatchObject({ ok: true, applied: false, status: 'pending' });
    expect(await proposeChange(auto.db, { projectId: auto.projectId, sessionId: auto.chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } })).toMatchObject({ ok: true, applied: true });
    expect(agentSettingsSchema.parse({ disabledTools: [] }).bypassLimits).toEqual({ changes: 100, costUsd: 1 });
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
