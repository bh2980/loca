import { useMutation } from '@tanstack/react-query';
import { Check, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { ChangePreview, LABEL } from './tool-part';

export interface Proposal {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected' | 'failed';
  result: unknown;
  source: 'pi' | 'cli';
  /** What the check left out when the proposal was made, and warnings about what it kept (first entries; counts when trimmed). */
  report?: { dropped: { key: string; reason: string }[]; warnings: { key: string; issues: string[] }[]; counts?: { dropped: number; warnings: number } } | null;
}

const STATUS = { accepted: '적용됨', rejected: '거절함', failed: '실패' } as const;

/** A change an agent proposed (pi chat or the CLI). Accepting runs it now; nothing changes before that. */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') => unwrap(client.proposals[':id'][':action{accept|reject}'].$post({ param: { id: proposal.id, action } })),
    onError: (error) => toast.error(error.message),
  });
  const failure = proposal.status === 'failed' ? String((proposal.result as { error?: string } | null)?.error ?? '') : '';
  const skipped = proposal.status === 'accepted' ? ((proposal.result as { skipped?: unknown[] } | null)?.skipped?.length ?? 0) : 0;
  return (
    <div className="overflow-hidden rounded-lg border bg-background text-sm">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
        <Wrench className="size-3.5 text-muted-foreground" /> {LABEL[proposal.tool] ?? proposal.tool}
        {proposal.source === 'cli' && <span className="font-normal text-muted-foreground">· CLI</span>}
        <span className="ml-auto">
          {proposal.status !== 'pending' && (
            <span className={proposal.status === 'accepted' ? 'text-success' : proposal.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
              {STATUS[proposal.status]}
              {failure && ` · ${failure}`}
              {skipped > 0 && ` · ${skipped.toLocaleString()}개는 건너뜀(그사이 바뀌었거나 바꿀 수 없음)`}
            </span>
          )}
          {decide.isPending && <Spinner className="size-3" />}
        </span>
      </div>
      <div className="px-3 py-2 text-xs">
        <ChangePreview name={proposal.tool} input={proposal.input} />
        {proposal.report && <ProposalReport report={proposal.report} />}
      </div>
      {proposal.status === 'pending' && (
        <div className="flex justify-end gap-2 border-t px-3 py-2">
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate('reject')}>
            <X /> 거절
          </Button>
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate('accept')}>
            <Check /> 수락
          </Button>
        </div>
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
