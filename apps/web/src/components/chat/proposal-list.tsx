/** Proposals waiting for a decision: each readable with its own buttons, bulk accept/reject when there are several. */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Box, Button, Checkbox, Inline, Spinner, Text, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { client } from '@/lib/api';
import type { Proposal } from './proposal-card';
import { ChangePreview, LABEL } from './change-preview';
import { changeProposals } from '@/lib/proposals';

/**
 * Each waiting proposal readable as it is (what it changes, ChangePreview), with its own 거절 · 수락; picking several and
 * deciding them at once only when there are several. The pane around it carries the title and the count.
 */
export function ProposalList({ projectId, proposals }: { projectId: string; proposals: Proposal[] }) {
  const [kind, setKind] = useState('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const kinds = [...new Set(proposals.map((proposal) => proposal.tool))];
  const shown = proposals.filter((proposal) => kind === 'all' || proposal.tool === kind);
  const shownIds = shown.map((proposal) => proposal.id);
  const pickedShown = shownIds.filter((id) => picked.has(id));
  const targets = pickedShown.length ? pickedShown : shownIds;
  const countLabel = pickedShown.length ? `${pickedShown.length.toLocaleString()}개 ` : '모두 ';
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;
  const several = proposals.length > 1;
  const toggle = (ids: string[], on: boolean) => setPicked((old) => { const next = new Set(old); for (const id of ids) on ? next.add(id) : next.delete(id); return next; });

  // One request for the lot: the server decides them oldest first (characters before the relationships that name them).
  const decide = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: 'accept' | 'reject' }) =>
      changeProposals(projectId, client.projects[':projectId'].proposals.decide.$post({ param: { projectId }, json: { ids, action } })).then(({ results }) => ({
        ok: results.filter((result) => result.status === (action === 'accept' ? 'accepted' : 'rejected')).length,
        total: ids.length,
        action,
      })),
    onSuccess: ({ ok, total, action }) => {
      setPicked(new Set());
      if (ok < total || total > 1) toast[ok === total ? 'success' : 'error'](`${total.toLocaleString()}개 중 ${ok.toLocaleString()}개를 ${action === 'accept' ? '수락' : '거절'}했습니다${ok < total ? ` · 실패 ${(total - ok).toLocaleString()}개` : ''}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const run = (action: 'accept' | 'reject', ids: string[]) => decide.mutate({ ids, action });

  return (
    <Box variant="body">
      {several && (
        <Inline wrap gap="condensed" paddingX="normal" paddingY="condensed" border="bottom">
          <Inline as="label" gap="condensed" variant="caption">
            <Checkbox checked={allPicked ? true : pickedShown.length ? 'indeterminate' : false} onCheckedChange={(on) => toggle(shownIds, Boolean(on))} aria-label="모두 선택" />
            모두 선택
          </Inline>
          {kinds.length > 1 && (
            <Select value={kind} onValueChange={(value) => { setKind(value); setPicked(new Set()); }}>
              <SelectTrigger width="field" aria-label="종류 필터">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[{ value: 'all', label: '모든 종류' }, ...kinds.map((tool) => ({ value: tool, label: LABEL[tool] ?? tool }))].map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Inline marginLeft="auto" gap="condensed">
            <Button variant="ghost" disabled={decide.isPending || !targets.length} onClick={() => run('reject', targets)}>{countLabel}거절</Button>
            <Button variant="outline" disabled={decide.isPending || !targets.length} onClick={() => run('accept', targets)}>
              {decide.isPending ? <Spinner /> : <Check />} {countLabel}수락
            </Button>
          </Inline>
        </Inline>
      )}
      <Box as="ul" divide="y">
        {shown.map((proposal) => (
          <Box as="li" key={proposal.id} paddingX="normal" paddingY="condensed" spaceY="tight">
            <Inline gap="condensed">
              {several && <Checkbox checked={picked.has(proposal.id)} onCheckedChange={(on) => toggle([proposal.id], Boolean(on))} aria-label="선택" />}
              <Text minWidth={0} grow truncate variant="caption" weight="medium" tone="muted">{LABEL[proposal.tool] ?? proposal.tool}{proposal.source === 'cli' ? ' · CLI' : ''}</Text>
              <Button variant="ghost" disabled={decide.isPending} onClick={() => run('reject', [proposal.id])}>거절</Button>
              <Button variant="outline" disabled={decide.isPending} onClick={() => run('accept', [proposal.id])}><Check /> 수락</Button>
            </Inline>
            <ChangePreview name={proposal.tool} input={proposal.input} details={proposal.details} run={proposal.report?.run} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
