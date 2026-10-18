import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { decideProposal, propose, takeDecisions } from './proposals.ts';
import { undoProposals } from './proposal-undo.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Undo' }, groups: [{ key: 'g', title: 'Scene' }], units: [{ key: 'line', group: 'g', source: 'Hello' }] }));
  const session = db.insert(s.chatSessions).values({ projectId, title: 'Undo' }).returning().get();
  return { db, projectId, session };
}

const add = (db: ReturnType<typeof openDatabase>, projectId: string, sessionId: string, tool: string, input: Record<string, unknown>) => propose(db, { projectId, sessionId, source: 'api', tool, input });

describe('proposal undo', () => {
  it('restores a batch line and skips a line edited after apply', async () => {
    const { db, projectId, session } = setup();
    const status = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all()[1];
    const proposal = add(db, projectId, session.id, 'propose_changes', { origin: 'ai', changes: [{ key: 'line', translation: '안녕', status: status.name, addTags: [], removeTags: [] }] });
    await decideProposal(db, proposal.id, true, 'bypass');
    await undoProposals(db, session.id, [proposal.id]);
    expect(db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()?.translation).toBe('');
  });

  it('deletes a created character and restores only sent update fields', async () => {
    const { db, projectId, session } = setup();
    const created = add(db, projectId, session.id, 'save_character', { name: 'Mira', profile: 'Old' });
    await decideProposal(db, created.id, true, 'bypass');
    await undoProposals(db, session.id, [created.id]);
    expect(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all()).toHaveLength(0);
  });

  it('restores a knowledge update without changing omitted fields', async () => {
    const { db, projectId, session } = setup();
    const created = add(db, projectId, session.id, 'save_character', { name: 'Mira', profile: 'Old' });
    await decideProposal(db, created.id, true, 'bypass');
    const character = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).get()!;
    const update = add(db, projectId, session.id, 'save_character', { id: character.id, profile: 'New' });
    await decideProposal(db, update.id, true, 'bypass');
    await undoProposals(db, session.id, [update.id]);
    const restored = db.select().from(s.characters).where(eq(s.characters.id, character.id)).get()!;
    expect(restored.profile).toBe('Old');
    expect(restored.name).toBe('Mira');
  });

  it('undoes new glossary terms through delete_items', async () => {
    const { db, projectId, session } = setup();
    const proposal = add(db, projectId, session.id, 'save_terms', { terms: [{ source: 'Harbor', target: '항구' }] });
    await decideProposal(db, proposal.id, true, 'bypass');
    expect(db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all()).toHaveLength(1);
    await undoProposals(db, session.id, [proposal.id]);
    expect(db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all()).toHaveLength(0);
  });

  it('records non undoable candidates, rejects a second undo, and reports the undo once', async () => {
    const { db, projectId, session } = setup();
    const candidate = add(db, projectId, session.id, 'propose_translation', { unitId: 'missing', text: '안녕' });
    db.update(s.proposals).set({ status: 'accepted', decidedAt: new Date(), undo: { none: '후보만 추가했고 현재 번역은 그대로입니다' } }).where(eq(s.proposals.id, candidate.id)).run();
    const first = await undoProposals(db, session.id, [candidate.id]);
    expect(first[0]).toMatchObject({ ok: false, error: '후보만 추가했고 현재 번역은 그대로입니다' });
    db.update(s.proposals).set({ undoneAt: new Date(), reportedAt: null }).where(eq(s.proposals.id, candidate.id)).run();
    expect(takeDecisions(db, session.id)).toContain('사용자가 되돌림');
    expect(takeDecisions(db, session.id)).toBeNull();
  });
});
