import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, Spinner } from '@loca/ui';
import { acceptedLabel } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { ChangePreview, LABEL } from './change-preview';

export interface Proposal {
  id: string;
  sessionId?: string | null;
  tool: string;
  input: Record<string, unknown>;
  /** running: accepted, the change still being applied (another window or a resent click may have started it). */
  status: 'pending' | 'running' | 'accepted' | 'rejected' | 'failed';
  result: unknown;
  undo?: { calls: number } | { none: string } | null;
  undoneAt?: Date | string | null;
  /** Why the person rejected it, if they said; the agent hears it with the decision. */
  reason?: string | null;
  source: 'pi' | 'cli' | 'api';
  /** Who decided: the person, or the conversation's permission mode (#45). */
  decidedBy?: 'person' | 'auto' | 'bypass' | null;
  /** Auto review's reason: why it asked, or that it passed. */
  review?: string | null;
  /** What the check left out when the proposal was made, and warnings about what it kept (first entries; counts when trimmed). */
  report?: { dropped: { key: string; reason: string }[]; warnings: { key: string; issues: string[] }[]; counts?: { dropped: number; warnings: number } } | null;
}

const STATUS = { running: '적용 중', rejected: '거절함', failed: '실패' } as const;
const DECIDED_BY = { auto: '자동 검토로', bypass: '우회 모드로' } as const;

/** A change an agent proposed (pi chat or the CLI). Accepting runs it now; nothing changes before that. */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const queryClient = useQueryClient();
  const undo = useMutation({
    mutationFn: () => unwrap(client.chat[':sessionId'].undo.$post({ param: { sessionId: proposal.sessionId! }, json: { ids: [proposal.id] } })),
    onSuccess: (rows) => {
      void queryClient.invalidateQueries({ queryKey: ['proposals'] });
      const row = rows[0];
      if (row?.ok) toast.success('되돌렸습니다'); else toast.error(row?.error ?? '되돌리지 못했습니다');
    },
    onError: (error) => toast.error(error.message),
  });
  // Shown decided at once: the card turns 적용됨/거절함 before the server answers (back to pending on
  // failure), and takes the server's row (failed, skipped) as soon as it comes instead of waiting for the refetch.
  const patch = (update: (row: Proposal) => Proposal) => queryClient.setQueriesData<Proposal[]>({ queryKey: ['proposals'] }, (list) => list?.map((row) => (row.id === proposal.id ? update(row) : row)));
  // Rejecting asks (optionally) why, so the agent can try differently instead of guessing.
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') => unwrap(client.proposals[':id'][':action{accept|reject}'].$post({ param: { id: proposal.id, action }, json: action === 'reject' && reason.trim() ? { reason: reason.trim() } : {} })),
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: ['proposals'] });
      patch((row) => ({ ...row, status: action === 'accept' ? 'accepted' : 'rejected', reason: action === 'reject' ? reason.trim() || null : row.reason }));
    },
    onSuccess: (row) => patch((old) => ({ ...old, ...(row as Partial<Proposal>) })),
    onError: (error) => {
      patch((row) => ({ ...row, status: 'pending' }));
      toast.error(error.message);
    },
  });
  const failure = proposal.status === 'failed' ? String((proposal.result as { error?: string } | null)?.error ?? '') : '';
  const skipped = proposal.status === 'accepted' ? ((proposal.result as { skipped?: unknown[] } | null)?.skipped?.length ?? 0) : 0;
  return (
    <div className="overflow-hidden rounded-lg border bg-background text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
        <CardTitle>{LABEL[proposal.tool] ?? proposal.tool}</CardTitle>
        {proposal.source === 'cli' && <span className="font-normal text-muted-foreground">· CLI</span>}
        <span className="ml-auto text-right">
          {proposal.undoneAt ? <span className="ml-auto text-muted-foreground">되돌림</span> : proposal.status !== 'pending' && (
            <span className={proposal.status === 'accepted' ? 'text-success' : proposal.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
              {proposal.decidedBy && proposal.decidedBy !== 'person' && `${DECIDED_BY[proposal.decidedBy]} `}
              {proposal.status === 'accepted' ? acceptedLabel(proposal.tool).short : proposal.status === 'failed' && proposal.decidedBy && proposal.decidedBy !== 'person' ? '적용하려 했지만 실패' : STATUS[proposal.status]}
              {failure && ` · ${failure}`}
              {proposal.status === 'rejected' && proposal.reason && ` · ${proposal.reason}`}
              {skipped > 0 && ` · ${skipped.toLocaleString()}개는 건너뜀(그사이 바뀌었거나 바꿀 수 없음)`}
            </span>
          )}
          {decide.isPending && <Spinner className="size-3" />}
        </span>
      </div>
      <div className="px-3 py-2 text-xs">
        <ChangePreview name={proposal.tool} input={proposal.input} pending={proposal.status === 'pending'} />
        {proposal.report && <ProposalReport report={proposal.report} />}
        {proposal.status === 'pending' && proposal.review && <p className="mt-2 border-t pt-2 text-muted-foreground">자동 검토가 넘김: {proposal.review}</p>}
      </div>
      {proposal.status === 'pending' && rejecting && (
        <form
          className="flex items-center gap-2 border-t px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            decide.mutate('reject');
          }}
        >
          <Input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="거절 이유(선택) — 에이전트에게 전달됩니다" aria-label="거절 이유" />
          <Button type="button" variant="ghost" disabled={decide.isPending} onClick={() => setRejecting(false)}>
            취소
          </Button>
          <Button type="submit" variant="outline" disabled={decide.isPending}>
            <X /> 거절
          </Button>
        </form>
      )}
      {proposal.status === 'pending' && !rejecting && (
        <div className="flex justify-end gap-2 border-t px-3 py-2">
          <Button variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>
            <X /> 거절
          </Button>
          <Button disabled={decide.isPending} onClick={() => decide.mutate('accept')}>
            <Check /> 수락
          </Button>
        </div>
      )}
      {proposal.sessionId && proposal.status === 'accepted' && proposal.undo && 'calls' in proposal.undo && proposal.undo.calls > 0 && !proposal.undoneAt && (
        <div className="flex justify-end border-t px-3 py-2"><Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => undo.mutate()}>{undo.isPending ? <Spinner /> : null} 되돌리기</Button></div>
      )}
    </div>
  );
}

/** The check made when the proposal was created: lines it left out and warnings about the rest. */
function ProposalReport({ report }: { report: NonNullable<Proposal['report']> }) {
  const dropped = report.counts?.dropped ?? report.dropped.length;
  const warnings = report.counts?.warnings ?? report.warnings.length;
  return (
    <div className="mt-2 space-y-1 border-t pt-2 text-muted-foreground">
      {dropped > 0 && (
        <p>
          제안할 때 뺀 줄 {dropped.toLocaleString()}개: {report.dropped.slice(0, 3).map((entry) => `${entry.key} ${entry.reason}`).join(' · ')}
          {dropped > 3 && ' …'}
        </p>
      )}
      {warnings > 0 && (
        <p className="text-warning">
          경고 {warnings.toLocaleString()}개: {report.warnings.slice(0, 3).map((entry) => `${entry.key} ${entry.issues[0]}`).join(' · ')}
          {warnings > 3 && ' …'}
        </p>
      )}
    </div>
  );
}

/** A card's title on one line (narrow panel: the status wraps below instead of breaking the title). */
function CardTitle({ children }: { children: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap" title={children}>
      <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </span>
  );
}
