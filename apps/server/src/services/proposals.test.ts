import { describe, expect, it } from 'vitest';
import { listedProposal } from './proposals.ts';

const proposal = (changes: unknown[]) => ({ id: 'p', projectId: 'x', sessionId: null, source: 'cli' as const, tool: 'propose_changes', input: { origin: 'ai', changes }, status: 'pending' as const, result: null, createdAt: new Date(), decidedAt: null });

describe('proposal list', () => {
  it('sends a large batch as its first lines plus counts, and a small one as it is', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ key: `k${index}`, translation: 't', ...(index % 2 ? { status: '확정' } : {}), addTags: [], removeTags: [] }));
    const listed = listedProposal(proposal(many) as never) as unknown as { input: { changes: unknown[]; counts: unknown } };
    expect(listed.input.changes).toHaveLength(50);
    expect(listed.input.counts).toEqual({ lines: 60, translations: 60, statuses: 30, tagged: 0 });
    const small = proposal(many.slice(0, 3));
    expect(listedProposal(small as never)).toBe(small);
  });
});
