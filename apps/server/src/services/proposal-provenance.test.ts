import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { decideProposal, propose } from './proposals.ts';

// An agent's change is written by AI; who decided it is the person who accepted it, or AI when the
// terminal's permission mode applied it (과제 9 A).
function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1', project: { name: 'Provenance' }, groups: [{ key: 'g', title: 'Scene' }],
    units: [{ key: 'line', group: 'g', source: 'Yes!\n', speaker: 'Alice' }],
  }));
  const apply = async (tool: string, input: Record<string, unknown>, by: 'person' | 'bypass') => {
    const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool, input });
    const row = await decideProposal(db, proposal.id, true, by);
    expect(row.status).toBe('accepted');
  };
  return { db, projectId, apply };
}

describe('who an applied proposal is recorded as', () => {
  it('a mode-applied change is AI-written and AI-decided; an accepted one is decided by the person', async () => {
    const { db, apply } = setup();
    await apply('save_character', { name: 'Bob', profile: 'x' }, 'bypass');
    await apply('save_character', { name: 'Carol', profile: 'y' }, 'person');
    const bob = db.select().from(s.characters).where(eq(s.characters.name, 'Bob')).get()!;
    const carol = db.select().from(s.characters).where(eq(s.characters.name, 'Carol')).get()!;
    expect([bob.origin, bob.statusBy]).toEqual(['ai', 'ai']);
    expect([carol.origin, carol.statusBy]).toEqual(['ai', 'human']);
  });

  it("a line imported by the terminal's mode keeps the source's edges and says AI decided it", async () => {
    const { db, apply } = setup();
    await apply('propose_changes', { changes: [{ key: 'line', translation: '네!' }] }, 'bypass');
    const line = db.select().from(s.units).get()!;
    expect(line.translation).toBe('네!\n');
    expect(line.statusBy).toBe('ai');
  });
});
