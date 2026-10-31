/** Proposals waiting for a decision, with bulk accept/reject. */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { Box, Button, Checkbox, Icon, Inline, Spinner, Text, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@loca/ui';
import { client } from '@/lib/api';
import { ProposalCard, type Proposal } from './proposal-card';
import { LABEL } from './change-preview';
import { useCharacters } from '@/lib/knowledge';
import { changeProposals } from '@/lib/proposals';

/** The proposal's review text names the person when the input itself carries only an id. */
function reviewName(proposal: Proposal) {
  const review = (proposal as { review?: unknown }).review;
  return typeof review === 'string' ? review.split('\n')[0].slice(0, 80) : '';
}

function summary(proposal: Proposal, names: ReadonlyMap<string, string>) {
  const input = proposal.input as Record<string, unknown>;
  if (typeof input.id === 'string' && names.has(input.id)) return names.get(input.id)!;
  const first = ['name', 'title', 'source', 'key', 'text'].map((key) => input[key]).find((value) => typeof value === 'string' && value) as string | undefined;
  return first ?? reviewName(proposal);
}

export function ProposalList({ projectId, title, proposals }: { projectId: string; title: string; proposals: Proposal[] }) {
  const characters = useCharacters(projectId);
  const names = new Map((characters.data ?? []).map((person) => [person.id, person.name] as const));
  const [open, setOpen] = useState(proposals.length <= 5);
  const [kind, setKind] = useState('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const kinds = [...new Set(proposals.map((proposal) => proposal.tool))];
  const shown = proposals.filter((proposal) => kind === 'all' || proposal.tool === kind);
  const shownIds = shown.map((proposal) => proposal.id);
  const pickedShown = shownIds.filter((id) => picked.has(id));
  const targets = pickedShown.length ? pickedShown : shownIds;
  const countLabel = pickedShown.length ? `${pickedShown.length.toLocaleString()}개 ` : '모두 ';
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;
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
      toast[ok === total ? 'success' : 'error'](`${total.toLocaleString()}개 중 ${ok.toLocaleString()}개를 ${action === 'accept' ? '수락' : '거절'}했습니다${ok < total ? ` · 실패 ${(total - ok).toLocaleString()}개` : ''}`);
    },
  });
  const run = (action: 'accept' | 'reject', ids: string[]) => decide.mutate({ ids, action });

  return (
    <Box radius="lg" border="all" background="page" variant="body">
      <Inline gap="condensed" paddingX="condensed" paddingY="tight">
        <Button variant="ghost" size="row" minWidth={0} grow weight="medium" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon icon={ChevronRight} tone="muted" turn={open} />
          <Text truncate>{title}</Text>
          <Text shrink={false} weight="normal" tone="muted" tabular>{proposals.length.toLocaleString()}개</Text>
        </Button>
      </Inline>
      {open && (
        <Box spaceY="condensed" border="top" paddingX="normal" paddingY="condensed">
          <Inline wrap gap="condensed">
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
              <Button variant="outline" disabled={decide.isPending || !targets.length} onClick={() => run('reject', targets)}>
                <X /> {countLabel}거절
              </Button>
              <Button disabled={decide.isPending || !targets.length} onClick={() => run('accept', targets)}>
                {decide.isPending ? <Spinner /> : <Check />} {countLabel}수락
              </Button>
            </Inline>
          </Inline>
          <Box as="ul" maxHeight="scroll-lg" divide="y" overflow="y" radius="md" border="all">
            {shown.map((proposal) => (
              <Box as="li" key={proposal.id} paddingX="condensed" paddingY="condensed">
                <Inline gap="condensed" variant="caption">
                  <Checkbox checked={picked.has(proposal.id)} onCheckedChange={(on) => toggle([proposal.id], Boolean(on))} aria-label="선택" />
                  <Button variant="ghost" size="row" minWidth={0} grow aria-expanded={expanded === proposal.id} onClick={() => setExpanded(expanded === proposal.id ? null : proposal.id)}>
                    <Text shrink={false} tone="muted">{LABEL[proposal.tool] ?? proposal.tool}</Text>
                    <Text truncate>{summary(proposal, names)}</Text>
                  </Button>
                </Inline>
                {expanded === proposal.id && <Box marginTop="condensed"><ProposalCard proposal={proposal} /></Box>}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
