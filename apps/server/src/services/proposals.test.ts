import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { closeInterruptedProposals, decideProposal, INTERRUPTED_PROPOSAL, listedProposal, propose, takeDecisions } from './proposals.ts';

const proposal = (changes: unknown[]) => ({ id: 'p', projectId: 'x', sessionId: null, source: 'cli' as const, tool: 'propose_changes', input: { origin: 'ai', changes }, status: 'pending' as const, result: null, createdAt: new Date(), decidedAt: null });

describe('proposal list', () => {
  it('sends a large batch as its first lines plus counts, and a small one as it is', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ key: `k${index}`, translation: 't', ...(index % 2 ? { status: '확정' } : {}), addTags: [], removeTags: [] }));
    const listed = listedProposal(proposal(many) as never) as unknown as { input: { changes: unknown[]; counts: unknown } };
    expect(listed.input.changes).toHaveLength(50);
    expect(listed.input.counts).toEqual({ lines: 60, translations: 60, statuses: 30, tagged: 0 });
    const small = proposal(many.slice(0, 3));
    expect(listedProposal(small as never)).toEqual({ ...small, undo: null });
  });
});

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Harbor' }], units: [{ key: 'a1', group: 'g1', source: 'Hi.' }] }));
  const proposal = propose(db, { projectId, sessionId: null, source: 'cli', tool: 'save_document', input: { title: '세계관', body: '항구 도시' } });
  const documents = () => db.select().from(s.documents).where(eq(s.documents.projectId, projectId)).all();
  return { db, proposal, documents };
}

describe('deciding a proposal', () => {
  it('runs the tool once when the same proposal is accepted twice at the same time', async () => {
    const { db, proposal, documents } = setup();
    const results = await Promise.allSettled([decideProposal(db, proposal.id, true), decideProposal(db, proposal.id, true)]);
    expect(documents()).toHaveLength(1);
    const rows = results.map((result) => (result.status === 'fulfilled' ? result.value : null));
    // The winner answers with its result; the other gets the row as it stood (still applying) instead of an error.
    expect(rows.map((row) => row?.status).sort()).toEqual(['accepted', 'running']);
    expect(db.select().from(s.proposals).where(eq(s.proposals.id, proposal.id)).get()?.status).toBe('accepted');
    // Asking again later returns the recorded decision, and runs nothing.
    expect((await decideProposal(db, proposal.id, true)).status).toBe('accepted');
    expect(documents()).toHaveLength(1);
  });

  it('lets only one of an accept and a reject through', async () => {
    const accepted = setup();
    const first = await Promise.all([decideProposal(accepted.db, accepted.proposal.id, true), decideProposal(accepted.db, accepted.proposal.id, false)]);
    expect(first.map((row) => row.status)).toEqual(['accepted', 'running']);
    expect(accepted.documents()).toHaveLength(1);

    const rejected = setup();
    const second = await Promise.all([decideProposal(rejected.db, rejected.proposal.id, false), decideProposal(rejected.db, rejected.proposal.id, true)]);
    expect(second.map((row) => row.status)).toEqual(['rejected', 'rejected']);
    expect(rejected.documents()).toHaveLength(0);
  });

  it('closes proposals a stopped server was applying as failed, without running them again', () => {
    const { db, proposal, documents } = setup();
    db.update(s.proposals).set({ status: 'running' }).where(eq(s.proposals.id, proposal.id)).run();
    expect(closeInterruptedProposals(db)).toBe(1);
    const row = db.select().from(s.proposals).where(eq(s.proposals.id, proposal.id)).get();
    expect(row?.status).toBe('failed');
    expect(row?.result).toEqual({ ok: false, error: INTERRUPTED_PROPOSAL });
    expect(row?.decidedAt).toBeInstanceOf(Date);
    expect(documents()).toHaveLength(0);
  });

  it('tells the agent why the person rejected a change', async () => {
    const { db, proposal } = setup();
    const session = db.insert(s.chatSessions).values({ projectId: proposal.projectId, title: '대화' }).returning().get();
    const asked = propose(db, { projectId: proposal.projectId, sessionId: session.id, source: 'cli', tool: 'save_document', input: { title: '메모', body: '…' } });
    const row = await decideProposal(db, asked.id, false, 'person', '제목을 더 구체적으로');
    expect(row.reason).toBe('제목을 더 구체적으로');
    expect(takeDecisions(db, session.id)).toContain('사용자가 거절함 — 이유: 제목을 더 구체적으로');
    expect(takeDecisions(db, session.id)).toBeNull();
  });

  it('reports accepted translations as AI 제안 and other tools as applied', () => {
    const { db, proposal } = setup();
    const session = db.insert(s.chatSessions).values({ projectId: proposal.projectId, title: '대화' }).returning().get();
    const translation = propose(db, { projectId: proposal.projectId, sessionId: session.id, source: 'api', tool: 'propose_translation', input: { unitId: 'u', text: '안녕' } });
    const other = propose(db, { projectId: proposal.projectId, sessionId: session.id, source: 'api', tool: 'save_document', input: { title: '메모', body: '내용' } });
    for (const row of [translation, other]) db.update(s.proposals).set({ status: 'accepted', decidedAt: new Date() }).where(eq(s.proposals.id, row.id)).run();

    const decisions = takeDecisions(db, session.id);
    expect(decisions).toContain('수락되어 AI 제안으로 추가됨 (사람이 적용·거절)');
    expect(decisions).toContain('수락되어 반영됨');
  });
});
