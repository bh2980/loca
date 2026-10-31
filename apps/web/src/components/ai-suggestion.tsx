import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, EditorAiSuggestion, EditorDiffWord, Section } from '@loca/ui';
import { sameTranslation } from '@tw/shared';
import { TokenText } from '@/components/editor/source-text';
import { replaceLineText } from '@/components/editor/translation-input';
import { client, unwrap } from '@/lib/api';
import { wordDiff } from '@/lib/diff';
import { useSaveLine } from '@/lib/line-save';

interface Candidate {
  id: string;
  text: string;
  origin: 'ai' | 'human' | 'import' | 'tool';
  model: string | null;
  runId: string | null;
  note: string;
  state: 'pending' | 'history' | 'declined';
}

/** Where a waiting suggestion came from: a workflow run on a line a person translated, or the chat / terminal. */
export const suggestionFrom = (candidate: Pick<Candidate, 'runId' | 'model' | 'note'>) =>
  [candidate.runId ? '워크플로 실행' : '채팅 제안', candidate.model, candidate.note].filter(Boolean).join(' · ');

/**
 * The newest AI 제안 waiting on the line, with the words that differ from its translation marked: 적용 makes it the line's
 * text (the old one stays in 이력), 거절 keeps it only in 이력. While the box holds typing that is not saved, 적용 puts the
 * text into the box instead (saving it then settles the suggestion). Nothing shows, its frame included, when no suggestion
 * waits or the box already holds its text (line breaks of another kind are the same text).
 */
export function AiSuggestion({ unit, draft, dirty, base, onDraft, framed }: {
  unit: { id: string; source: string; translation: string | null; candidates: Candidate[] };
  draft: string;
  dirty: boolean;
  base?: string | null;
  /** Puts text into the line's box (or its draft, when no editor is open). */
  onDraft: (text: string) => void;
  /** In a pane of sections: it is a section of its own. */
  framed?: boolean;
}) {
  const save = useSaveLine();
  const decline = useMutation({
    mutationFn: (candidateId: string) => unwrap(client.units[':unitId'].candidates[':candidateId'].decline.$post({ param: { unitId: unit.id, candidateId } })),
    onError: (error) => toast.error(error.message),
  });
  const waiting = unit.candidates.filter((candidate) => candidate.state === 'pending' && !sameTranslation(candidate.text, draft) && !sameTranslation(candidate.text, unit.translation));
  const suggestion = waiting[0];
  if (!suggestion) return null;
  const current = (unit.translation ?? '').trim();
  const apply = () => {
    if (dirty) {
      if (!replaceLineText(unit.id, suggestion.text)) onDraft(suggestion.text);
      toast.info('편집 중인 글이 있어 입력란에 넣었습니다. 저장하면 적용됩니다.');
      return;
    }
    save.mutate({ unitId: unit.id, candidateId: suggestion.id, candidateText: suggestion.text, base }, { onError: (error) => toast.error(error.message) });
  };
  const busy = save.isPending || decline.isPending;
  const notice = (
    <EditorAiSuggestion
      meta={[suggestionFrom(suggestion), waiting.length > 1 && `외 ${waiting.length - 1}개 대기`].filter(Boolean).join(' · ')}
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={apply}>적용</Button>
          <Button variant="ghost" disabled={busy} onClick={() => decline.mutate(suggestion.id)}>거절</Button>
        </>
      }
    >
      {current ? (
        wordDiff(current, suggestion.text.trim()).map((part, index) => (
          <EditorDiffWord key={index} change={part.change === 'removed' || part.change === 'added' ? part.change : undefined}>
            {part.text}
          </EditorDiffWord>
        ))
      ) : (
        <TokenText text={suggestion.text} source={unit.source} pattern={null} />
      )}
    </EditorAiSuggestion>
  );
  return framed ? <Section>{notice}</Section> : notice;
}
