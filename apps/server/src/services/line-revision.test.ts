import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { saveLine } from './line-save.ts';
import { decideProposal, propose, undoProposals } from './proposals.ts';

const FIXED_TIME = new Date('2026-10-18T10:00:00.000Z');

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1', project: { name: 'Line revision' }, groups: [{ key: 'g', title: 'Scene' }],
    units: [{ key: 'line', group: 'g', source: 'Hello' }],
  }));
  const session = db.insert(s.chatSessions).values({ projectId, title: 'Revision' }).returning().get();
  const unit = db.select().from(s.units).where(eq(s.units.key, 'line')).get()!;
  return { db, projectId, session, unit };
}

afterEach(() => vi.useRealTimers());

describe('line revision timestamps', () => {
  it('preserves a same-clock human edit when undoing an accepted proposal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_TIME);
    const { db, projectId, session, unit } = setup();
    const proposal = propose(db, {
      projectId,
      sessionId: session.id,
      source: 'api',
      tool: 'propose_changes',
      input: { origin: 'ai', changes: [{ key: unit.key, translation: 'AI 초안' }] },
    });

    await decideProposal(db, proposal.id, true, 'bypass');
    const afterProposal = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    db.transaction((tx) => { saveLine(tx, afterProposal, { text: '사람이 고친 번역' }); });

    const afterHumanEdit = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    expect(afterHumanEdit.updatedAt.getTime()).toBeGreaterThan(afterProposal.updatedAt.getTime());

    const [result] = await undoProposals(db, session.id, [proposal.id]);
    expect(result).toMatchObject({ ok: true, skipped: [unit.key] });
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()?.translation).toBe('사람이 고친 번역');
  });

  it('advances on same-clock updates and continues advancing after the clock rolls back', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_TIME);
    const { db, unit } = setup();

    db.update(s.units).set({ note: '첫 수정' }).where(eq(s.units.id, unit.id)).run();
    const first = db.select({ updatedAt: s.units.updatedAt }).from(s.units).where(eq(s.units.id, unit.id)).get()!.updatedAt.getTime();
    db.update(s.units).set({ note: '둘째 수정' }).where(eq(s.units.id, unit.id)).run();
    const second = db.select({ updatedAt: s.units.updatedAt }).from(s.units).where(eq(s.units.id, unit.id)).get()!.updatedAt.getTime();
    expect(second).toBeGreaterThan(first);

    vi.setSystemTime(new Date(FIXED_TIME.getTime() - 60_000));
    db.update(s.units).set({ note: '시계가 돌아간 뒤 수정' }).where(eq(s.units.id, unit.id)).run();
    const afterRollback = db.select({ updatedAt: s.units.updatedAt }).from(s.units).where(eq(s.units.id, unit.id)).get()!.updatedAt.getTime();
    expect(afterRollback).toBeGreaterThan(second);
  });
});
