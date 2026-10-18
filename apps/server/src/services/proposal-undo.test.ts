import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { decideProposal, propose, takeDecisions } from './proposals.ts';
import { undoProposals } from './proposals.ts';
import { saveLine } from './line-save.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1', project: { name: 'Undo' }, groups: [{ key: 'g', title: 'Scene' }],
    units: [{ key: 'line', group: 'g', source: 'Hello' }, { key: 'other', group: 'g', source: 'Bye' }],
  }));
  const session = db.insert(s.chatSessions).values({ projectId, title: 'Undo' }).returning().get();
  return { db, projectId, session };
}

function add(db: ReturnType<typeof openDatabase>, projectId: string, sessionId: string,
  tool: string, input: Record<string, unknown>) {
  return propose(db, { projectId, sessionId, source: 'api', tool, input });
}

describe('proposal undo', () => {
  it('restores line text, status and tags; skips a line edited after apply', async () => {
    const { db, projectId, session } = setup();
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const existingTag = db.insert(s.tags).values({ projectId, name: '기존', color: '#123456', scope: ['lines'] }).returning().get();
    const addedTag = db.insert(s.tags).values({ projectId, name: '검토', color: '#654321', scope: ['lines'] }).returning().get();
    const original = db.select().from(s.units).where(eq(s.units.key, 'line')).get()!;
    db.insert(s.unitTags).values({ unitId: original.id, tagId: existingTag.id }).run();

    const proposal = add(db, projectId, session.id, 'propose_changes', {
      origin: 'ai', changes: [{ key: 'line', translation: '안녕', status: statuses[1].name,
        addTags: ['검토'], removeTags: [] }],
    });
    await decideProposal(db, proposal.id, true, 'bypass');
    const after = db.select().from(s.units).where(eq(s.units.id, original.id)).get()!;
    expect(after.translation).toBe('안녕');
    expect(after.statusId).toBe(statuses[1].id);
    expect(db.select().from(s.unitTags).where(eq(s.unitTags.unitId, original.id)).all()).toHaveLength(2);

    const undone = await undoProposals(db, session.id, [proposal.id]);
    const restored = db.select().from(s.units).where(eq(s.units.id, original.id)).get()!;
    expect(undone[0]).toMatchObject({ ok: true });
    expect(restored.translation).toBe('');
    expect(restored.statusId).toBe(statuses[0].id);
    const restoredTags = db.select().from(s.unitTags).where(eq(s.unitTags.unitId, original.id)).all();
    expect(restoredTags.map((link) => link.tagId)).toEqual([existingTag.id]);
    expect(restoredTags.map((link) => link.tagId)).not.toContain(addedTag.id);

    const second = add(db, projectId, session.id, 'propose_changes', {
      origin: 'ai', changes: [{ key: 'other', translation: '안녕', addTags: [], removeTags: [] }],
    });
    await decideProposal(db, second.id, true, 'bypass');
    const changed = db.select().from(s.units).where(eq(s.units.key, 'other')).get()!;
    db.transaction((tx) => { saveLine(tx, changed, { text: '사람이 고친 번역' }); });
    const skippedUndo = await undoProposals(db, session.id, [second.id]);
    expect(skippedUndo[0]).toMatchObject({ ok: true, skipped: ['other'] });
    expect(db.select().from(s.units).where(eq(s.units.key, 'other')).get()?.translation).toBe('사람이 고친 번역');
  });

  it('restores the updated item and deletes the created item in a mixed knowledge batch', async () => {
    const { db, projectId, session } = setup();
    const original = db.insert(s.characters).values({ projectId, name: 'Mira', profile: 'Old' }).returning().get();
    const proposal = add(db, projectId, session.id, 'save_knowledge', {
      characters: [{ id: original.id, profile: 'New' }, { name: 'Jon', profile: 'Created' }],
    });
    await decideProposal(db, proposal.id, true, 'bypass');
    expect(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all()).toHaveLength(2);
    await undoProposals(db, session.id, [proposal.id]);
    const remaining = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: original.id, name: 'Mira', profile: 'Old' });
  });

  it('reverts only item ids whose tag membership changed', async () => {
    const { db, projectId, session } = setup();
    const first = db.insert(s.terms).values({ projectId, source: 'one', status: 'candidate' }).returning().get();
    const second = db.insert(s.terms).values({ projectId, source: 'two', status: 'candidate' }).returning().get();
    const tag = db.insert(s.tags).values({ projectId, name: '표시', color: '#123456', scope: ['terms'] }).returning().get();
    db.insert(s.knowledgeTags).values({ kind: 'terms', itemId: first.id, tagId: tag.id }).run();
    const proposal = add(db, projectId, session.id, 'tag_items', {
      kind: 'terms', ids: [first.id, second.id], add: ['표시'], remove: [],
    });
    await decideProposal(db, proposal.id, true, 'bypass');
    await undoProposals(db, session.id, [proposal.id]);
    const links = db.select().from(s.knowledgeTags).where(eq(s.knowledgeTags.tagId, tag.id)).all();
    expect(links.map((link) => link.itemId)).toEqual([first.id]);
  });

  it('restores a patched project setting and leaves other settings alone', async () => {
    const { db, projectId, session } = setup();
    const before = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    const proposal = add(db, projectId, session.id, 'update_project_settings', { name: 'Renamed' });
    await decideProposal(db, proposal.id, true, 'bypass');
    await undoProposals(db, session.id, [proposal.id]);
    const after = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    expect(after.name).toBe(before.name);
    expect(after.description).toBe(before.description);
  });

  it('stores no undo after a failed tool and hides proposals from other sessions', async () => {
    const { db, projectId, session } = setup();
    const failed = add(db, projectId, session.id, 'save_document', { body: 'missing required title' });
    const row = await decideProposal(db, failed.id, true, 'bypass');
    expect(row.status).toBe('failed');
    expect(row.undo).toBeNull();

    const otherSession = db.insert(s.chatSessions).values({ projectId, title: 'Other' }).returning().get();
    const other = add(db, projectId, otherSession.id, 'save_document', { title: 'Doc', body: 'Text' });
    await decideProposal(db, other.id, true, 'bypass');
    expect(await undoProposals(db, session.id, [other.id])).toEqual([
      { id: other.id, ok: false, error: '제안을 찾을 수 없습니다' },
    ]);
  });

  it('keeps candidate-only changes non-undoable, prevents repeat undo and reports an undo once', async () => {
    const { db, projectId, session } = setup();
    const candidate = add(db, projectId, session.id, 'propose_translation', {
      unitId: 'missing', text: '안녕',
    });
    db.update(s.proposals).set({ status: 'accepted', decidedAt: new Date(),
      undo: { none: '후보만 추가했고 현재 번역은 그대로입니다' } }).where(eq(s.proposals.id, candidate.id)).run();
    const first = await undoProposals(db, session.id, [candidate.id]);
    expect(first[0]).toMatchObject({ ok: false, error: '후보만 추가했고 현재 번역은 그대로입니다' });
    db.update(s.proposals).set({ undo: { calls: [] }, undoneAt: new Date(), reportedAt: null })
      .where(eq(s.proposals.id, candidate.id)).run();
    expect((await undoProposals(db, session.id, [candidate.id]))[0]).toMatchObject({ ok: false, error: '이미 되돌렸습니다' });
    expect(takeDecisions(db, session.id)).toContain('사용자가 되돌림');
    expect(takeDecisions(db, session.id)).toBeNull();
  });
});
