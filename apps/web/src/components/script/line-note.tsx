import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Box, Button, Inline, Input, ScriptNoteCard, ScriptNoteMark } from '@loca/ui';
import { client } from '@/lib/api';
import { changeLines, patchedLine } from '@/lib/units';

/** Saves a line's note (empty removes it), shown at once. */
function useSaveNote(projectId: string, unitId: string) {
  return useMutation({
    mutationFn: (note: string) => changeLines(projectId, [unitId], patchedLine({ note }), () => client.units[':unitId'].$patch({ param: { unitId }, json: { note } })),
    onError: (error) => toast.error(error.message),
  });
}

/**
 * A person's note on the picked line: a doubt, or a question for the developer ("who is 'she'
 * here?"). It shows under the editor while there is one; the note button on the speaker line
 * starts one. Enter saves, Esc leaves it as it was, an empty note is removed; the card's corner button and 삭제 while
 * editing remove it too.
 */
export function LineNote({ projectId, unitId, note, editing, onEditing }: { projectId: string; unitId: string; note: string; editing: boolean; onEditing: (editing: boolean) => void }) {
  const [text, setText] = useState(note);
  const save = useSaveNote(projectId, unitId);
  if (!editing && !note) return null;
  if (!editing)
    return (
      <ScriptNoteCard note={note} onClick={() => (setText(note), onEditing(true))} onDelete={() => save.mutate('')} />
    );
  const finish = (value: string | null) => {
    if (value !== null && value.trim() !== note) save.mutate(value);
    onEditing(false);
  };
  return (
    <Inline gap="tight" marginTop="condensed">
      <Input
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
      />
      {/* Pressed without leaving the box first, or the blur would save the text before it is removed. */}
      {note && (
        <Button variant="ghost" tone="danger" shrink={false} onMouseDown={(event) => event.preventDefault()} onClick={() => (save.mutate(''), onEditing(false))}>
          삭제
        </Button>
      )}
    </Inline>
  );
}

/** A line's note as a small mark beside the speaker in the list; the note itself on hover. */
export function NoteMark({ note }: { note: string }) {
  if (!note) return null;
  return <ScriptNoteMark note={note} />;
}
