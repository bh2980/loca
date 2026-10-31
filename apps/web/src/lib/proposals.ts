import { createOptimisticAction } from '@tanstack/react-db';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { FeedRows } from '@tw/shared';
import { client, unwrap } from './api';
import { sent } from './collections';
import { heldCollection, useHeld, type Held } from './units';

/**
 * Proposals as their cards show them: which ones a panel lists is a question (GET proposals/ids, one
 * chat's or those sent from the CLI), the proposals themselves come from a collection that holds the
 * ones shown and reads one again when the feed names it (0117). A card not yet accepted says what each
 * field has now, so it is read again too when an item, status, tag, workflow or scene it names changes.
 */
export type Proposal = InferResponseType<(typeof client.projects)[':projectId']['proposals']['by-ids']['$post']>['rows'][number];

const held = new Map<string, Held<Proposal>>();

/** The ids an event changed among what proposal cards name. */
function namedIds(rows: FeedRows) {
  const ids = new Set<string>();
  for (const name of ['characters', 'relationships', 'speechRules', 'events', 'documents', 'statuses', 'tags', 'workflows', 'groups'] as const) {
    const part = rows[name];
    if (!part) continue;
    for (const row of part.upsert as { id: string }[]) ids.add(row.id);
    for (const id of part.delete) ids.add(id);
  }
  for (const id of rows.units?.changed ?? []) ids.add(id);
  return ids;
}

function proposalsOf(projectId: string) {
  let rows = held.get(projectId);
  if (!rows) {
    rows = heldCollection<Proposal>({
      id: `proposals:${projectId}`,
      projectId,
      read: (ids) => unwrap(client.projects[':projectId'].proposals['by-ids'].$post({ param: { projectId }, json: { ids } })),
      signal: (rows) => rows.proposals,
      staleBy: (rows) => {
        const ids = namedIds(rows);
        if (!ids.size) return undefined;
        return (proposal) => proposal.status !== 'accepted' && proposal.details !== null && [...Object.keys(proposal.details.refs), JSON.stringify(proposal.input)].some((text) => [...ids].some((id) => text.includes(id)));
      },
    });
    held.set(projectId, rows);
  }
  return rows;
}

export type ProposalQuery = { session?: string; status?: 'pending' };

/** Which proposals a panel lists (proposals topic: one is filed or decided). */
const proposalIds = (projectId: string, query: ProposalQuery) =>
  queryOptions({
    queryKey: ['proposals', 'ids', projectId, query.session ?? 'external', query.status ?? ''],
    queryFn: () => unwrap(client.projects[':projectId'].proposals.ids.$get({ param: { projectId }, query })),
    placeholderData: keepPreviousData,
  });

/** One chat's proposals or (no session) those sent from the CLI, newest first; `total` counts them all. */
export function useProposals(projectId: string, query: ProposalQuery = {}) {
  const page = useQuery(proposalIds(projectId, query));
  const rows = useHeld(proposalsOf(projectId), page.data?.ids).rows;
  return { data: rows, total: page.data?.total };
}

/** Shown at once (accepted or rejected), put back on failure; done once the feed has brought the server's row. */
export function decideProposal(projectId: string, id: string, action: 'accept' | 'reject', reason?: string) {
  const { collection, idle } = proposalsOf(projectId);
  const run = createOptimisticAction<void>({
    onMutate: () => {
      if (collection.has(id)) collection.update(id, (draft) => void Object.assign(draft, { status: action === 'accept' ? 'accepted' : 'rejected', reason: action === 'reject' ? reason ?? null : draft.reason }));
    },
    mutationFn: async () => {
      await sent(projectId, client.proposals[':id'][':action{accept|reject}'].$post({ param: { id, action }, json: action === 'reject' && reason ? { reason } : {} }));
      await idle();
    },
  });
  return run().when('settled');
}

/** A request that decides or undoes proposals: done once the feed has brought their rows. */
export async function changeProposals<T extends Response & { json(): Promise<unknown> }>(projectId: string, request: Promise<T>): Promise<Awaited<ReturnType<T['json']>>> {
  const body = await sent(projectId, request);
  await proposalsOf(projectId).idle();
  return body;
}
