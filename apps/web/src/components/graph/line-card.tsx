import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, PanelRightOpen, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import { PALETTE, TAG_SCOPES } from '@tw/shared';
import { LineHints } from '@/components/script/line-row';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText } from '@/components/editor/source-text';
import { Button, Skeleton, TagListEditor } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { lineTags, q } from '@/lib/queries';
import { keyLabel } from '@/lib/keys';
import { SpeakerCard } from '@/components/script/speaker-card';
import { LineNote } from '@/components/script/line-note';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { PersonName } from '@/lib/person-colors';

/** The card's width; the graph keeps this much room beside the node when it opens. */
export const LINE_CARD_WIDTH = 384;

/**
 * Translating one line in the dialogue graph: a card beside its node (not a modal: the graph stays
 * usable around it). It holds only that line — who says it, the source, the translation editor and
 * the same hints as the script screen; the pane next to the graph keeps the lines around it.
 * ⌥↓/⌥↑ go to the next/previous line along the flow, ⌘↵ confirms and goes on, Esc closes.
 */
export function LineCard({ projectId, unitId, choice, position, onStep, onClose }: {
  projectId: string;
  unitId: string;
  /** The line is a player's choice (shown as such instead of a speaker). */
  choice?: boolean;
  /** Where the line sits in the selection ("3 / 12"). */
  position?: string;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const navigate = useNavigate();
  const line = unit.data;
  const tags = lineTags(statuses.data?.tags);
  const attachedTags = line ? tags.filter((tag) => line.tagIds.includes(tag.id)) : [];
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];

  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[] }) => unwrap(client.units[':unitId'].$patch({ param: { unitId }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([unitId], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      queryClient.invalidateQueries({ queryKey: ['unit', unitId] });
    },
  });

  const handleToggleTag = (tagId: string, add: boolean) => {
    if (!line) return;
    const nextTagIds = add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId);
    patch.mutate({ tagIds: nextTagIds });
  };

  const handleCreateTag = async (name: string) => {
    if (!line) return;
    try {
      const color = (PALETTE[tags.length % PALETTE.length] as any).light ?? PALETTE[tags.length % PALETTE.length].hex;
      const res = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [...TAG_SCOPES] },
      }));
      await patch.mutateAsync({ tagIds: [...line.tagIds, res.id] });
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const marks = line && (
    <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="이 줄의 태그" onClick={(event) => event.stopPropagation()}>
      <TagListEditor
        tags={orderedTags}
        allTags={tags}
        onToggle={handleToggleTag}
        onCreate={handleCreateTag}
        heading="대사 태그"
      />
    </div>
  );

  const [noting, setNoting] = useState(false);
  useEffect(() => setNoting(false), [unitId]);
  // While the next line loads its editor is gone; the card holds the focus so ⌥↓ and Esc keep working.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!card.current?.contains(document.activeElement)) card.current?.focus({ preventScroll: true });
  }, [unitId, line]);

  return (
    <div
      ref={card}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-lg border bg-popover outline-none p-3 text-popover-foreground shadow-lg"
      style={{ width: LINE_CARD_WIDTH }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          onStep(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {choice ? '선택지' : line && (
            <SpeakerCard projectId={projectId} name={line.speaker}>
              {line.speaker ? <PersonName projectId={projectId} name={line.speaker} /> : <span>지문·문구</span>}
            </SpeakerCard>
          )}
        </span>
        {position && <span className="text-xs text-muted-foreground tabular-nums">{position}</span>}
        <Button variant="ghost" size="icon-xs" aria-label={`이전 줄 (${keyLabel('Alt+Up')})`} title={`이전 줄 (${keyLabel('Alt+Up')})`} onClick={() => onStep(-1)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={`다음 줄 (${keyLabel('Alt+Down')})`} title={`다음 줄 (${keyLabel('Alt+Down')})`} onClick={() => onStep(1)}>
          <ChevronDown />
        </Button>
        {line && !line.note && (
          <Button variant="ghost" size="icon-xs" aria-label="메모 남기기" title="메모 남기기" onClick={() => setNoting(true)}>
            <StickyNote />
          </Button>
        )}
        {line && (
          <Button variant="ghost" size="icon-xs" aria-label="번역 화면에서 열기" title="번역 화면에서 열기" onClick={() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { group: line.groupId, line: line.id, detail: true } })}>
            <PanelRightOpen />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="닫기 (Esc)" title="닫기 (Esc)" onClick={onClose}>
          <X />
        </Button>
      </div>
      {!line ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          <LineSourceText projectId={projectId} unitId={line.id} source={line.source} className="max-h-40 overflow-auto text-sm" />
          <TranslationEditor
            projectId={projectId}
            key={`editor-${line.id}`}
            unit={line}
            statuses={statuses.data?.statuses ?? []}
            focusKey={1}
            marks={marks}
            onEscape={onClose}
            onDone={(moved) => moved && onStep(1)}
          />
          <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={setNoting} />
          <LineHints projectId={projectId} line={{ ...line, lastRun: null }} />
        </>
      )}
    </div>
  );
}
