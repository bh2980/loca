import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Box, Button, Inline, Input, Spinner, Stack, Text, ToolCard, ToolCardHeader } from '@loca/ui';
import { acceptedLabel } from '@tw/shared';
import { client } from '@/lib/api';
import { changeProposals, decideProposal, type Proposal } from '@/lib/proposals';
import { ChangePreview, LABEL } from './change-preview';

export type { Proposal };

const STATUS = { running: '적용 중', rejected: '거절함', failed: '실패' } as const;
const DECIDED_BY = { auto: '자동 검토로', bypass: '바로 반영 모드로' } as const;

/** One undo request and its shared outcome message for cards and whole replies. */
export function useUndo(projectId: string, sessionId: string) {
  return useMutation({
    mutationFn: (ids: string[]) => changeProposals(projectId, client.chat[':sessionId'].undo.$post({
      param: { sessionId }, json: { ids },
    })),
    onSuccess: (rows, ids) => {
      const done = rows.filter((row) => row.ok).length;
      const failures = rows.filter((row) => !row.ok);
      const skipped = rows.reduce((sum, row) => sum + (row.skipped?.length ?? 0), 0);
      if (ids.length === 1 && failures[0]) {
        toast.error(failures[0].error ?? '되돌리지 못했습니다');
        return;
      }
      toast.success(`${done}개 되돌림${skipped ? ` · ${skipped}개는 그사이 바뀌어 건너뜀` : ''}${failures.length ? ` · 실패 ${failures.length}개` : ''}`);
    },
    onError: (error) => toast.error(error.message),
  });
}

/** A change an agent proposed (a CLI chat or the loca CLI). Accepting runs it now; nothing changes before that. */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const undo = useUndo(proposal.projectId, proposal.sessionId ?? '');
  // Rejecting asks (optionally) why, so the agent can try differently instead of guessing.
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  // Shown decided at once (적용됨/거절함), back to pending on failure; the server's row (failed, skipped) comes with the feed.
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') => decideProposal(proposal.projectId, proposal.id, action, action === 'reject' ? reason.trim() || undefined : undefined),
    onError: (error) => toast.error(error.message),
  });
  const failure = proposal.status === 'failed' ? String((proposal.result as { error?: string } | null)?.error ?? '') : '';
  const skipped = proposal.status === 'accepted' ? ((proposal.result as { skipped?: unknown[] } | null)?.skipped?.length ?? 0) : 0;
  return (
    <ToolCard>
      <ToolCardHeader title={LABEL[proposal.tool] ?? proposal.tool} suffix={proposal.source === 'cli' && <Text weight="normal" tone="muted">· CLI</Text>}>
        {proposal.undoneAt ? <Text marginLeft="auto" tone="muted">되돌림</Text> : proposal.status !== 'pending' && (
          <Text tone={proposal.status === 'accepted' ? 'success' : proposal.status === 'failed' ? 'danger' : 'muted'}>
            {proposal.decidedBy && proposal.decidedBy !== 'person' && `${DECIDED_BY[proposal.decidedBy]} `}
            {proposal.status === 'accepted' ? acceptedLabel(proposal.tool).short : proposal.status === 'failed' && proposal.decidedBy && proposal.decidedBy !== 'person' ? '적용하려 했지만 실패' : STATUS[proposal.status]}
            {failure && ` · ${failure}`}
            {proposal.status === 'rejected' && proposal.reason && ` · ${proposal.reason}`}
            {skipped > 0 && ` · ${skipped.toLocaleString()}개는 건너뜀`}
          </Text>
        )}
        {decide.isPending && <Spinner size="xs" />}
      </ToolCardHeader>
      <Box paddingX="normal" paddingY="condensed" variant="body">
        <ChangePreview name={proposal.tool} input={proposal.input} pending={proposal.status === 'pending'} details={proposal.details} />
        {proposal.report && <ProposalReport report={proposal.report} />}
        {proposal.status === 'pending' && proposal.review && <Text as="p" marginTop="condensed" border="top" paddingTop="condensed" tone="muted">자동 검토가 넘김: {proposal.review}</Text>}
      </Box>
      {proposal.status === 'pending' && rejecting && (
        <Inline
          as="form"
          gap="condensed"
          border="top"
          paddingX="normal"
          paddingY="condensed"
          onSubmit={(event) => {
            event.preventDefault();
            decide.mutate('reject');
          }}
        >
          <Input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="거절 이유(선택)" aria-label="거절 이유" />
          <Button type="button" variant="ghost" disabled={decide.isPending} onClick={() => setRejecting(false)}>
            취소
          </Button>
          <Button type="submit" variant="outline" disabled={decide.isPending}>
            <X /> 거절
          </Button>
        </Inline>
      )}
      {proposal.status === 'pending' && !rejecting && (
        <Stack direction="row" justify="end" gap="condensed" border="top" paddingX="normal" paddingY="condensed">
          <Button variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>
            <X /> 거절
          </Button>
          <Button disabled={decide.isPending} onClick={() => decide.mutate('accept')}>
            <Check /> 수락
          </Button>
        </Stack>
      )}
      {proposal.sessionId && proposal.status === 'accepted' && proposal.undo && 'calls' in proposal.undo && proposal.undo.calls > 0 && !proposal.undoneAt && (
        <Stack direction="row" justify="end" border="top" paddingX="normal" paddingY="condensed"><Button variant="outline" disabled={undo.isPending} onClick={() => undo.mutate([proposal.id])}>{undo.isPending ? <Spinner /> : null} 되돌리기</Button></Stack>
      )}
    </ToolCard>
  );
}

/** The check made when the proposal was created: lines it left out and warnings about the rest. */
function ProposalReport({ report }: { report: NonNullable<Proposal['report']> & { counts?: { dropped: number; warnings: number } } }) {
  const dropped = report.counts?.dropped ?? report.dropped.length;
  const warnings = report.counts?.warnings ?? report.warnings.length;
  return (
    <Box marginTop="condensed" spaceY="tight" border="top" paddingTop="condensed" tone="muted">
      {dropped > 0 && (
        <p>
          제안할 때 뺀 줄 {dropped.toLocaleString()}개: {report.dropped.slice(0, 3).map((entry) => `${entry.key} ${entry.reason}`).join(' · ')}
          {dropped > 3 && ' …'}
        </p>
      )}
      {warnings > 0 && (
        <Text as="p" tone="warning">
          경고 {warnings.toLocaleString()}개: {report.warnings.slice(0, 3).map((entry) => `${entry.key} ${entry.issues[0]}`).join(' · ')}
          {warnings > 3 && ' …'}
        </Text>
      )}
    </Box>
  );
}
