import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { runCatalogTool, turnPrompt, writeText } from './chat-stream.ts';
import { importProject } from './importer.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'Alice', source: 'Hi' }], characters: [{ name: 'Alice' }] }));
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: 'ask' }).returning().get();
  const tool = (name: string) => agentCatalog(db, projectId, { model: 'm' }).find((entry) => entry.name === name)!;
  return { db, chat, tool };
}

describe('chat stream pieces the chat backends share (#49)', () => {
  it('runs a read at once and fits its result for the agent', async () => {
    const { db, chat, tool } = setup();
    const result = await runCatalogTool(db, chat, 'cli', tool('find_lines'), { speakers: ['Alice'] }, 50);
    expect(result.ok).toBe(true);
    expect(result.ok && result.text.length).toBeLessThanOrEqual(400);
    expect(result.ok && JSON.stringify(result.output)).toContain('Hi');
  });

  it('turns a change into a proposal, and says plainly why one was refused', async () => {
    const { db, chat, tool } = setup();
    const made = await runCatalogTool(db, chat, 'cli', tool('save_character'), { name: 'Bob' });
    expect(made).toMatchObject({ ok: true, output: { applied: false } });
    expect(db.select().from(s.proposals).all()).toHaveLength(1);
    const refused = await runCatalogTool(db, chat, 'cli', tool('save_character'), { id: 'nope', name: 'Bob' });
    expect(refused).toMatchObject({ ok: false, error: '제안하지 못했습니다: 없는 인물입니다.' });
    expect(!refused.ok && refused.reason).toContain('id=nope');
  });

  it('writes one whole text part and builds the turn prompt in order', () => {
    const parts: { type: string; delta?: string }[] = [];
    writeText({ write: (part: { type: string }) => parts.push(part) } as never, '안녕');
    expect(parts.map((part) => part.type)).toEqual(['text-start', 'text-delta', 'text-end']);
    expect(parts[1]!.delta).toBe('안녕');
    expect(turnPrompt({ context: null, view: 'VIEW', text: 'MSG', leftover: [] })).toBe('VIEW\n\nMSG');
  });
});
