import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { decideProposal, propose, undoProposals } from './proposals.ts';

// Undo must never lose data: not through a cascade, and not over a person's later edit (#102 review).
function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1', project: { name: 'Undo safety' }, groups: [{ key: 'g', title: 'Scene' }],
    units: [{ key: 'line', group: 'g', source: 'Hello' }],
  }));
  const session = db.insert(s.chatSessions).values({ projectId, title: 'Undo' }).returning().get();
  const person = (name: string) => db.insert(s.characters).values({ projectId, name, origin: 'human' }).returning().get();
  const a = person('Alice'), b = person('Bob');
  const rel = db.insert(s.relationships).values({ projectId, fromId: a.id, toId: b.id, kind: '동료' }).returning().get();
  const apply = async (tool: string, input: Record<string, unknown>) => {
    const proposal = propose(db, { projectId, sessionId: session.id, source: 'api', tool, input });
    const row = await decideProposal(db, proposal.id, true, 'bypass');
    expect(row.status).toBe('accepted');
    return proposal.id;
  };
  const undo = (...ids: string[]) => undoProposals(db, session.id, ids);
  const character = (name: string) => db.select().from(s.characters).where(and(eq(s.characters.projectId, projectId), eq(s.characters.name, name))).get();
  const relationship = () => db.select().from(s.relationships).where(eq(s.relationships.id, rel.id)).get();
  return { db, projectId, a, b, rel, apply, undo, character, relationship };
}

describe('undo safety', () => {
  it('restores a relationship endpoint changed in a save_knowledge batch and does not cascade-delete it', async () => {
    const { apply, undo, character, relationship, b } = setup();
    const id = await apply('save_knowledge', { characters: [{ name: 'Carol' }], relationships: [{ id: relationship()!.id, to: 'Carol' }] });
    expect(relationship()!.toId).toBe(character('Carol')!.id);
    const [result] = await undo(id);
    expect(result.ok).toBe(true);
    expect(relationship()).toBeDefined();
    expect(relationship()!.toId).toBe(b.id);
    expect(character('Carol')).toBeUndefined();
  });

  it('restores a single save_relationship endpoint', async () => {
    const { db, projectId, apply, undo, relationship, a } = setup();
    db.insert(s.characters).values({ projectId, name: 'Dan', origin: 'human' }).run();
    const id = await apply('save_relationship', { id: relationship()!.id, from: 'Dan' });
    await undo(id);
    expect(relationship()!.fromId).toBe(a.id);
  });

  it('keeps a character field a person edited after the change, and reports it skipped', async () => {
    const { db, apply, undo, a } = setup();
    const id = await apply('save_character', { id: a.id, profile: 'AI' });
    db.update(s.characters).set({ profile: '사람이 고침' }).where(eq(s.characters.id, a.id)).run();
    const [result] = await undo(id);
    expect(db.select().from(s.characters).where(eq(s.characters.id, a.id)).get()!.profile).toBe('사람이 고침');
    expect(result.skipped).toContain(a.id);
  });

  it('keeps a term a person edited after the change', async () => {
    const { db, projectId, apply, undo } = setup();
    const term = db.insert(s.terms).values({ projectId, source: 'Harbor', target: '항구' }).returning().get();
    const id = await apply('save_terms', { terms: [{ id: term.id, target: '부두' }] });
    db.update(s.terms).set({ target: '선착장' }).where(eq(s.terms.id, term.id)).run();
    const [result] = await undo(id);
    expect(db.select().from(s.terms).where(eq(s.terms.id, term.id)).get()!.target).toBe('선착장');
    expect(result.skipped).toContain(term.id);
  });

  it('keeps a document a person edited after a save_knowledge change', async () => {
    const { db, projectId, apply, undo } = setup();
    const doc = db.insert(s.documents).values({ projectId, kind: 'note', title: '설정', body: '원래' }).returning().get();
    const id = await apply('save_knowledge', { documents: [{ id: doc.id, body: 'AI가 씀' }] });
    db.update(s.documents).set({ body: '사람이 씀' }).where(eq(s.documents.id, doc.id)).run();
    const [result] = await undo(id);
    expect(db.select().from(s.documents).where(eq(s.documents.id, doc.id)).get()!.body).toBe('사람이 씀');
    expect(result.skipped).toContain(doc.id);
  });

  it('does not delete a created character that a person has since edited or linked', async () => {
    const { db, projectId, apply, undo, character, a } = setup();
    const edited = await apply('save_character', { name: 'Eve' });
    db.update(s.characters).set({ profile: '사람이 씀' }).where(eq(s.characters.id, character('Eve')!.id)).run();
    expect((await undo(edited))[0].skipped).toContain(character('Eve')!.id);
    expect(character('Eve')).toBeDefined();

    const linked = await apply('save_character', { name: 'Finn' });
    const human = db.insert(s.relationships).values({ projectId, fromId: a.id, toId: character('Finn')!.id, kind: '친구' }).returning().get();
    await undo(linked);
    expect(character('Finn')).toBeDefined();
    expect(db.select().from(s.relationships).where(eq(s.relationships.id, human.id)).get()).toBeDefined();
  });

  it('undoes two changes of the same line in one reply back to the value before both', async () => {
    const { db, apply, undo } = setup();
    const first = await apply('propose_changes', { origin: 'ai', changes: [{ key: 'line', translation: '하나' }] });
    const second = await apply('propose_changes', { origin: 'ai', changes: [{ key: 'line', translation: '둘' }] });
    await undo(first, second);
    expect(db.select().from(s.units).where(eq(s.units.key, 'line')).get()!.translation ?? '').toBe('');
  });
});
