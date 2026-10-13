import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, PanelRightOpen, X } from 'lucide-react';
import { LineHints } from '@/components/script/line-list';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText } from '@/components/editor/source-text';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { q } from '@/lib/queries';
import { keyLabel } from '@/lib/keys';

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
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{choice ? '선택지' : line ? (line.speaker ?? '지문·문구') : ''}</span>
        {position && <span className="text-xs text-muted-foreground tabular-nums">{position}</span>}
        <Button variant="ghost" size="icon-xs" aria-label={`이전 줄 (${keyLabel('Alt+Up')})`} title={`이전 줄 (${keyLabel('Alt+Up')})`} onClick={() => onStep(-1)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={`다음 줄 (${keyLabel('Alt+Down')})`} title={`다음 줄 (${keyLabel('Alt+Down')})`} onClick={() => onStep(1)}>
          <ChevronDown />
        </Button>
        {line && (
          <Button variant="ghost" size="icon-xs" aria-label="번역 화면에서 자세히" title="번역 화면에서 자세히 (검사·후보·이력)" onClick={() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { group: line.groupId, line: line.id, detail: true } })}>
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
            key={line.id}
            unit={line}
            statuses={statuses.data?.statuses ?? []}
            focusKey={1}
            onEscape={onClose}
            onDone={(moved) => moved && onStep(1)}
          />
          <LineHints projectId={projectId} line={{ ...line, lastRun: null }} />
        </>
      )}
    </div>
  );
}
