import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Box, Input, ScriptNoteCard, ScriptNoteMark } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';

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
      <ScriptNoteCard note={note} onClick={() => (setText(note), onEditing(true))} />
    );
  const finish = (value: string | null) => {
    if (value !== null && value.trim() !== note) save.mutate(value);
    onEditing(false);
  };
  return (
    <Box asChild marginTop="condensed"><Input
      autoFocus
      aria-label="메모"
      placeholder="메모 · Enter 저장"
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
    /></Box>
  );
}

/** A line's note as a small mark beside the speaker in the list; the note itself on hover. */
export function NoteMark({ note }: { note: string }) {
  if (!note) return null;
  return <ScriptNoteMark note={note} />;
}
