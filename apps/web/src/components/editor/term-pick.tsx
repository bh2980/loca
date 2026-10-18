import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, GroupHeading, Input, Popover, PopoverAnchor, PopoverContent } from '@loca/ui';
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
        <PopoverContent side="bottom" align="start" className="w-72 space-y-2 p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
          {pick && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (pick.source.trim()) add.mutate(pick);
              }}
            >
              <GroupHeading>용어로 추가</GroupHeading>
              <Input aria-label="원문" value={pick.source} onChange={(event) => setPick({ ...pick, source: event.target.value })} />
              <Input aria-label="번역어" placeholder="번역어" value={pick.target} autoFocus onChange={(event) => setPick({ ...pick, target: event.target.value })} />
              {existing && (
                <p className="text-xs text-warning">
                  이미 있습니다: {existing.source} → {existing.target || '(번역 없음)'}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPick(undefined)}>
                  취소
                </Button>
                <Button type="submit" disabled={add.isPending || !pick.source.trim()}>
                  추가
                </Button>
              </div>
            </form>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
