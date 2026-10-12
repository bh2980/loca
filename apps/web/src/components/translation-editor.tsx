import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { cn } from '@/lib/utils';

interface Status {
  id: string;
  name: string;
  color: string;
  kind: 'initial' | 'normal' | 'final';
}

/** The status ⌘↵ moves a line to: the first final status, unless the line is already final. */
export function nextStatus(statuses: Status[], currentId: string) {
  const current = statuses.find((status) => status.id === currentId);
  if (current?.kind === 'final') return undefined;
  return statuses.find((status) => status.kind === 'final');
}

/**
 * The translation editor of one line. ⌘S saves the text as a person's candidate and makes it the
 * translation; ⌘↵ saves (if changed) and moves the line to the next status, then `onDone` lets
 * the list go to the next line; Esc leaves the editor (the draft stays). The text is a draft in
 * sessionStorage until saved, shared with the line pane's checks.
 */
export function TranslationEditor({
  unit,
  statuses,
  onDone,
  onEscape,
  focusKey,
  className,
}: {
  unit: { id: string; translation: string | null; statusId: string; candidates?: { id: string; text: string }[] };
  statuses: Status[];
  onDone?: (moved: boolean) => void;
  onEscape?: () => void;
  /** Changing this to a non-zero number puts the cursor at the end of the text. */
  focusKey?: number;
  className?: string;
}) {
  const [draft, setDraft, clearDraft] = useDraft(`line:${unit.id}`, unit.translation ?? '');
  const dirty = draft !== (unit.translation ?? '');
  const next = nextStatus(statuses, unit.statusId);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusKey) return;
    const element = area.current;
    element?.focus({ preventScroll: true });
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [focusKey]);

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: ({ advance }: { advance: boolean }) => {
      // Saving the exact text of an existing candidate selects it instead of duplicating it.
      const same = unit.candidates?.find((candidate) => candidate.text === draft);
      const text = dirty ? (same ? { candidateId: same.id } : { translation: draft }) : {};
      const statusId = advance && next ? { statusId: next.id } : {};
      if (!Object.keys(text).length && !Object.keys(statusId).length) return Promise.resolve(null);
      return unwrap(client.units[':unitId'].$patch({ param: { unitId: unit.id }, json: { ...text, ...statusId } }));
    },
    // The saved text and next status show at once, so the old translation never flashes back.
    onMutate: async ({ advance }) => {
      const same = unit.candidates?.find((candidate) => candidate.text === draft);
      const change = { ...(dirty && { translation: same ? same.text : draft }), ...(advance && next && { statusId: next.id }) };
      return { undo: Object.keys(change).length ? await optimistic(queryClient, unitChanges([unit.id], patchedLine(change))) : undefined };
    },
    onSuccess: (_data, { advance }) => {
      clearDraft();
      if (advance && next) toast.success(`${dirty ? '저장하고 ' : ''}‘${next.name}’(으)로 옮겼습니다.`);
      onDone?.(advance);
    },
    onError: (error, _vars, context) => {
      context?.undo?.();
      toast.error(error.message);
    },
  });
  const run = (advance: boolean) => !save.isPending && save.mutate({ advance });

  return (
    <div className={cn('space-y-2', className)} onClick={(event) => event.stopPropagation()}>
      <Textarea
        ref={area}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="번역을 입력하세요. 저장하면 사람 후보가 되고 대표 번역이 됩니다."
        className="field-sizing-content min-h-16 resize-none bg-background"
        onKeyDown={(event) => {
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.key.toLowerCase() === 's') {
            event.preventDefault();
            run(false);
          } else if (mod && event.key === 'Enter') {
            event.preventDefault();
            run(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
            onEscape?.();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {dirty && <span className="text-xs text-warning">저장 안 됨</span>}
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={clearDraft}>
              되돌리기
            </Button>
          )}
          <Button variant={next ? 'outline' : 'default'} disabled={!dirty || save.isPending} onClick={() => run(false)} title="저장 (⌘S)">
            저장
          </Button>
          {next && (
            <Button disabled={save.isPending} onClick={() => run(true)} title={`${dirty ? '저장하고 ' : ''}‘${next.name}’(으)로 옮기고 다음 줄 (⌘↵)`}>
              <StatusDot color={next.color} /> {next.name}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
