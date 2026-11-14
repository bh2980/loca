import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Box, Button, Input, Popover, PopoverAnchor, PopoverContent, Stack, Text, SectionHeading } from '@loca/ui';
import { selectionInLine } from './translation-input';
import { useTerms, createTerm, saveTerm } from '@/lib/terms';

/**
 * Selecting words in a line's source offers to add them to the glossary on the spot: the source
 * is the selection, the translation is what is selected in the line's editor (or typed here).
 * The term is confirmed, as one a person adds on the glossary page. A source the glossary has already
 * (one term per source) is changed instead: its Korean form becomes the new one, the former kept among
 * its candidates (the glossary pane can put it back); lines already translated stay as they are.
 */
export function TermPick({ projectId, unitId, children }: { projectId: string; unitId: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ rect: DOMRect; source: string; target: string }>();
  const terms = useTerms(projectId);
  const existing = pick && terms.data?.find((term) => term.source.toLowerCase() === pick.source.trim().toLowerCase());

  // A selection that ends inside the source (a word or a few, not a whole paragraph).
  useEffect(() => {
    const onUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
      if (!selection?.rangeCount || !text || text.length > 60 || !box.current?.contains(selection.anchorNode)) return;
      setPick({ rect: selection.getRangeAt(0).getBoundingClientRect(), source: text, target: selectionInLine(unitId) });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [unitId]);

  const add = useMutation({
    mutationFn: async (term: { source: string; target: string }) => {
      // A person picking the form confirms a candidate the AI found.
      if (existing) await saveTerm(projectId, existing.id, { target: term.target.trim(), ...(existing.status === 'candidate' && { status: 'confirmed' as const }) });
      else await createTerm(projectId, { source: term.source.trim(), target: term.target.trim() });
      return { source: existing?.source ?? term.source.trim(), target: term.target.trim(), before: existing?.target };
    },
    onSuccess: ({ source, target, before }) => {
      toast.success(before !== undefined ? `번역어를 바꿨습니다: ${source} → ${target}${before ? ` (이전: ${before})` : ''}` : `용어집에 추가했습니다: ${source}${target ? ` → ${target}` : ''}`);
      setPick(undefined);
    },
    onError: (error) => toast.error(error.message),
  });
  const same = Boolean(existing && pick && pick.target.trim() === existing.target.trim());
  const blocked = add.isPending || !pick?.source.trim() || (existing ? !pick?.target.trim() || same : false);

  return (
    <div ref={box}>
      {children}
      <Popover open={!!pick} onOpenChange={(open) => !open && setPick(undefined)}>
        {pick && <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => pick.rect } }} />}
        <PopoverContent side="bottom" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
          {pick && (
            <Box
              as="form"
              spaceY="condensed"
              onSubmit={(event) => {
                event.preventDefault();
                if (!blocked) add.mutate(pick);
              }}
            >
              <SectionHeading level="group">{existing ? '용어 고치기' : '용어로 추가'}</SectionHeading>
              <Input aria-label="원문" value={pick.source} onChange={(event) => setPick({ ...pick, source: event.target.value })} />
              <Input aria-label="번역어" placeholder={existing?.target ? `지금: ${existing.target}` : '번역어'} value={pick.target} autoFocus onChange={(event) => setPick({ ...pick, target: event.target.value })} />
              {existing && (
                <Text as="p" variant="caption" tone="muted">
                  용어집에 있습니다: {existing.source} → {existing.target || '(번역 없음)'}
                  {existing.status === 'candidate' && ' · 후보 (바꾸면 확정)'}
                  {same ? ' · 같은 번역어입니다' : existing.lines ? ` · 이미 번역한 대사 ${existing.lines.toLocaleString()}줄은 그대로입니다` : ''}
                </Text>
              )}
              <Stack direction="row" justify="end" gap="condensed">
                <Button type="button" variant="ghost" onClick={() => setPick(undefined)}>
                  취소
                </Button>
                <Button type="submit" disabled={blocked}>
                  {existing ? '번역어 바꾸기' : '추가'}
                </Button>
              </Stack>
            </Box>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
