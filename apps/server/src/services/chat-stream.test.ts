import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { turnPrompt, writeText } from './chat-stream.ts';
import { agentText, callTool, panelOutput } from './tool-run.ts';
import { importProject } from './importer.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'Alice', source: 'Hi' }], characters: [{ name: 'Alice' }] }));
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: 'ask' }).returning().get();
  const tool = (name: string) => agentCatalog(db, projectId, { model: 'm' }).find((entry) => entry.name === name)!;
  const call = (surface: 'api' | 'acp' | 'terminal', name: string, input: unknown) => callTool(db, { projectId, surface, sessionId: surface === 'terminal' ? null : chat.id, model: 'm' }, tool(name), input);
  return { db, chat, call };
}

describe('chat stream pieces the chat backends share (#49)', () => {
  it('runs a read at once on every surface, with the same result', async () => {
    const { call } = setup();
    for (const surface of ['api', 'acp', 'terminal'] as const) {
      const outcome = await call(surface, 'find_lines', { speakers: ['Alice'] });
      expect(outcome).toMatchObject({ kind: 'result', result: { total: 1 } });
      expect(agentText(outcome)).toMatchObject({ isError: false, text: expect.stringContaining('Hi') });
    }
  });

  it('fits a long result for a model and gives the terminal all of it', async () => {
    const { db, chat, call } = setup();
    // 400 documents of 200 characters: past what either chat surface hands a model.
    db.insert(s.documents).values(Array.from({ length: 400 }, (_, index) => ({ projectId: chat.projectId, kind: 'note' as const, title: `d${index}`, body: 'x'.repeat(200), status: 'confirmed' as const }))).run();
    const size = (outcome: Awaited<ReturnType<typeof call>>) => (outcome.kind === 'result' ? JSON.stringify(outcome.result).length : -1);
    const whole = await call('terminal', 'read_documents', {});
    expect(whole.kind === 'result' && (whole.result as unknown[]).length).toBe(400);
    const api = await call('api', 'read_documents', {});
    const acp = await call('acp', 'read_documents', {});
    expect(size(api)).toBeLessThanOrEqual(30_000);
    expect(size(acp)).toBeLessThanOrEqual(20_000);
    expect(api.kind === 'result' && api.result).toMatchObject({ truncated: { total: 400 } });
    expect(size(whole)).toBeGreaterThan(80_000);
  });

  it('turns a change into a proposal, and says plainly why one was refused', async () => {
    const { db, call } = setup();
    const made = await call('acp', 'save_character', { name: 'Bob' });
    expect(made).toMatchObject({ kind: 'proposal', applied: false, status: 'pending' });
    expect(panelOutput(made)).toMatchObject({ applied: false, status: 'pending' });
    expect(db.select().from(s.proposals).all()).toHaveLength(1);
    const refused = await call('acp', 'save_character', { id: 'nope', name: 'Bob' });
    expect(panelOutput(refused)).toMatchObject({ ok: false, error: '제안하지 못했습니다: 없는 인물입니다.' });
    expect(agentText(refused)).toMatchObject({ isError: true, text: expect.stringContaining('id=nope') });
    // An input that does not fit the schema is refused the same way for a read and for a change.
    expect(await call('acp', 'save_character', { name: 5 })).toMatchObject({ kind: 'invalid' });
    expect(await call('terminal', 'read_scene', {})).toMatchObject({ kind: 'invalid' });
    expect(db.select().from(s.proposals).all()).toHaveLength(1);
  });

  it('writes one whole text part and builds the turn prompt in order', () => {
    const parts: { type: string; delta?: string }[] = [];
    writeText({ write: (part: { type: string }) => parts.push(part) } as never, '안녕');
    expect(parts.map((part) => part.type)).toEqual(['text-start', 'text-delta', 'text-end']);
    expect(parts[1]!.delta).toBe('안녕');
    expect(turnPrompt({ context: null, view: 'VIEW', text: 'MSG', leftover: [] })).toBe('VIEW\n\nMSG');
  });
});
