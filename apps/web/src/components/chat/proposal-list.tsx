/** Proposals waiting for a decision, with bulk accept/reject. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectionBar, Spinner } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ProposalCard, type Proposal } from './proposal-card';
import { LABEL } from './change-preview';

function summary(proposal: Proposal) {
  const input = proposal.input as Record<string, unknown>;
  const first = ['name', 'title', 'source', 'key', 'text'].map((key) => input[key]).find((value) => typeof value === 'string' && value) as string | undefined;
  return first ?? '';
}

export function ProposalList({ projectId, title, proposals }: { projectId: string; title: string; proposals: Proposal[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(proposals.length <= 5);
  const [kind, setKind] = useState('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const kinds = [...new Set(proposals.map((proposal) => proposal.tool))];
  const shown = proposals.filter((proposal) => kind === 'all' || proposal.tool === kind);
  const shownIds = shown.map((proposal) => proposal.id);
  const pickedShown = shownIds.filter((id) => picked.has(id));
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;
  const toggle = (ids: string[], on: boolean) => setPicked((old) => { const next = new Set(old); for (const id of ids) on ? next.add(id) : next.delete(id); return next; });

  // One request for the lot: the server decides them oldest first (characters before the relationships that name them).
  const decide = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: 'accept' | 'reject' }) =>
      unwrap(client.projects[':projectId'].proposals.decide.$post({ param: { projectId }, json: { ids, action } })).then(({ results }) => ({
        ok: results.filter((result) => result.status === (action === 'accept' ? 'accepted' : 'rejected')).length,
        total: ids.length,
        action,
      })),
    onSuccess: ({ ok, total, action }) => {
      setPicked(new Set());
      toast[ok === total ? 'success' : 'error'](`${total.toLocaleString()}개 중 ${ok.toLocaleString()}개를 ${action === 'accept' ? '수락' : '거절'}했습니다${ok < total ? ` · 실패 ${(total - ok).toLocaleString()}개` : ''}`);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['proposals', projectId] }),
  });
  const run = (action: 'accept' | 'reject', ids: string[]) => decide.mutate({ ids, action });

  return (
    <div className="rounded-lg border bg-background text-sm">
      <div className="flex items-center gap-2 px-2 py-1">
        <Button variant="ghost" size="row" className="min-w-0 flex-1 font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronRight className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="truncate">{title}</span>
          <span className="shrink-0 font-normal text-muted-foreground tabular-nums">{proposals.length.toLocaleString()}개</span>
        </Button>
      </div>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={allPicked ? true : pickedShown.length ? 'indeterminate' : false} onCheckedChange={(on) => toggle(shownIds, Boolean(on))} aria-label="모두 선택" />
              모두 선택
            </label>
            {kinds.length > 1 && (
              <Select value={kind} onValueChange={(value) => { setKind(value); setPicked(new Set()); }}>
                <SelectTrigger size="sm" className="ml-auto w-36 text-xs" aria-label="종류 필터">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 종류</SelectItem>
                  {kinds.map((tool) => (
                    <SelectItem key={tool} value={tool}>
                      {LABEL[tool] ?? tool}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {pickedShown.length > 0 ? (
            <SelectionBar count={pickedShown.length} onClear={() => setPicked(new Set())}>
              <Button variant="outline" disabled={decide.isPending} onClick={() => run('reject', pickedShown)}>
                <X /> 거절
              </Button>
              <Button disabled={decide.isPending} onClick={() => run('accept', pickedShown)}>
                {decide.isPending ? <Spinner /> : <Check />} 수락
              </Button>
            </SelectionBar>
          ) : (
            <p className="text-xs text-muted-foreground">
              {shown.length.toLocaleString()}개 표시 중 — 고르거나{' '}
              <Button variant="link" className="h-auto p-0 text-xs" disabled={decide.isPending} onClick={() => run('accept', shownIds)}>
                표시된 {shown.length.toLocaleString()}개 모두 수락
              </Button>{' '}
              ·{' '}
              <Button variant="link" className="h-auto p-0 text-xs" disabled={decide.isPending} onClick={() => run('reject', shownIds)}>
                모두 거절
              </Button>
            </p>
          )}
          <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
            {shown.map((proposal) => (
              <li key={proposal.id} className="px-2 py-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <Checkbox checked={picked.has(proposal.id)} onCheckedChange={(on) => toggle([proposal.id], Boolean(on))} aria-label="선택" />
                  <Button variant="ghost" size="row" className="min-w-0 flex-1" aria-expanded={expanded === proposal.id} onClick={() => setExpanded(expanded === proposal.id ? null : proposal.id)}>
                    <span className="shrink-0 text-muted-foreground">{LABEL[proposal.tool] ?? proposal.tool}</span>
                    <span className="truncate">{summary(proposal)}</span>
                  </Button>
                </div>
                {expanded === proposal.id && <div className="mt-2"><ProposalCard proposal={proposal} /></div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
