import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Box, Button, EditorTermPopover, GroupHeading, Input, Popover, PopoverAnchor, Stack, Text } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { selectionInLine } from './translation-input';

/**
 * Selecting words in a line's source offers to add them to the glossary on the spot: the source
 * is the selection, the translation is what is selected in the line's editor (or typed here).
 * The term is confirmed, as one a person adds on the glossary page.
 */
export function TermPick({ projectId, unitId, children }: { projectId: string; unitId: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ rect: DOMRect; source: string; target: string }>();
  const terms = useQuery(q.terms(projectId));
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
    mutationFn: (term: { source: string; target: string }) => unwrap(client.projects[':projectId'].terms.$post({ param: { projectId }, json: { source: term.source.trim(), target: term.target.trim() } })),
    onSuccess: (term) => {
      toast.success(`용어집에 추가했습니다: ${term.source}${term.target ? ` → ${term.target}` : ''}`);
      setPick(undefined);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div ref={box}>
      {children}
      <Popover open={!!pick} onOpenChange={(open) => !open && setPick(undefined)}>
        {pick && <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => pick.rect } }} />}
        <EditorTermPopover side="bottom" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
          {pick && (
            <Box
              as="form"
              spaceY="condensed"
              onSubmit={(event) => {
                event.preventDefault();
                if (pick.source.trim()) add.mutate(pick);
              }}
            >
              <GroupHeading>용어로 추가</GroupHeading>
              <Input aria-label="원문" value={pick.source} onChange={(event) => setPick({ ...pick, source: event.target.value })} />
              <Input aria-label="번역어" placeholder="번역어" value={pick.target} autoFocus onChange={(event) => setPick({ ...pick, target: event.target.value })} />
              {existing && (
                <Text as="p" variant="caption" tone="warning">
                  이미 있습니다: {existing.source} → {existing.target || '(번역 없음)'}
                </Text>
              )}
              <Stack direction="row" justify="end" gap="condensed">
                <Button type="button" variant="ghost" onClick={() => setPick(undefined)}>
                  취소
                </Button>
                <Button type="submit" disabled={add.isPending || !pick.source.trim()}>
                  추가
                </Button>
              </Stack>
            </Box>
          )}
        </EditorTermPopover>
      </Popover>
    </div>
  );
}
