import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { cn } from '@/lib/utils';

/** Saves a line's note (empty removes it), shown at once. */
function useSaveNote(unitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json: { note } })),
    onMutate: async (note) => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine({ note }))) }),
    onError: (error, _note, context) => {
      context?.undo?.();
      toast.error(error.message);
    },
  });
}

/**
 * A person's note on the picked line: a doubt, or a question for the developer ("who is 'she'
 * here?"). It shows under the editor while there is one; the note button on the speaker line
 * starts one. Enter saves, Esc leaves it as it was, an empty note is removed.
 */
export function LineNote({ unitId, note, editing, onEditing }: { unitId: string; note: string; editing: boolean; onEditing: (editing: boolean) => void }) {
  const [text, setText] = useState(note);
  const save = useSaveNote(unitId);
  if (!editing && !note) return null;
  if (!editing)
    return (
      <Button variant="ghost" size="row" className="mt-2 h-auto items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 py-1.5 text-left text-sm font-normal whitespace-pre-wrap" title="메모 고치기" onClick={() => (setText(note), onEditing(true))}>
        <StickyNote className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 break-words">{note}</span>
      </Button>
    );
  const finish = (value: string | null) => {
    if (value !== null && value.trim() !== note) save.mutate(value);
    onEditing(false);
  };
  return (
    <Input
      autoFocus
      className="mt-2"
      aria-label="메모"
      placeholder="메모 (의문점, 개발사에 물어볼 것) · Enter 저장 · 비우면 지움"
      value={text}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(text);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

/** A line's note as a small mark beside the speaker in the list; the note itself on hover. */
export function NoteMark({ note, className }: { note: string; className?: string }) {
  if (!note) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StickyNote className={cn('size-3.5 shrink-0 text-warning', className)} aria-label="메모 있음" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-sm whitespace-pre-wrap">{note}</TooltipContent>
    </Tooltip>
  );
}
