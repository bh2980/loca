import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, PanelRightOpen, StickyNote, X } from 'lucide-react';
import { LineHints } from '@/components/script/line-row';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText } from '@/components/editor/source-text';
import { Box, Button, FloatingCard, Inline, Skeleton, Text } from '@loca/ui';
import { q } from '@/lib/queries';
import { keyLabel } from '@/lib/keys';
import { SpeakerCard } from '@/components/script/speaker-card';
import { LineNote } from '@/components/script/line-note';
import { PersonName } from '@/lib/person-colors';

/** The card's width; the graph keeps this much room beside the node when it opens. */
export const LINE_CARD_WIDTH = 384;

/**
 * Translating one line in the dialogue graph: a card beside its node (not a modal: the graph stays
 * usable around it). It holds only that line — who says it, the source, the translation editor and
 * the same hints as the script screen; the pane next to the graph keeps the lines around it. A small
 * editor: no tags, no record of what changed, one line per suggestion (the line's detail has them),
 * and never taller than the canvas: the header stays, the rest scrolls.
 * ⌥↓/⌥↑ go to the next/previous line along the flow, ⌘↵ confirms and goes on, Esc closes.
 */
export function LineCard({ projectId, unitId, choice, position, maxHeight, onStep, onShowNode, onClose }: {
  projectId: string;
  unitId: string;
  /** The line is a player's choice (shown as such instead of a speaker). */
  choice?: boolean;
  /** Where the line sits in the selection ("3 / 12"). */
  position?: string;
  /** The most the card may take, in pixels (the canvas's height less its margins). */
  maxHeight: number;
  onStep: (direction: 1 | -1) => void;
  /** Opens this line's node in the side pane (its kind, lines and details, and what it joins). */
  onShowNode: () => void;
  onClose: () => void;
}) {
  const unit = useQuery(q.unit(unitId));
  const statuses = useQuery(q.statuses(projectId));
  const line = unit.data;
  const [noting, setNoting] = useState(false);
  useEffect(() => setNoting(false), [unitId]);
  // While the next line loads its editor is gone; the card holds the focus so ⌥↓ and Esc keep working.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!card.current?.contains(document.activeElement)) card.current?.focus({ preventScroll: true });
  }, [unitId, line]);

  return (
    <FloatingCard
      ref={card}
      tabIndex={-1}
      style={{ width: LINE_CARD_WIDTH, maxHeight }}
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
      <Inline gap="tight">
        <Text variant="label" truncate minWidth={0} grow>
          {choice ? '선택지' : line && (
            <SpeakerCard projectId={projectId} name={line.speaker}>
              {line.speaker ? <PersonName projectId={projectId} name={line.speaker} /> : <span>지문·문구</span>}
            </SpeakerCard>
          )}
        </Text>
        {position && <Text variant="caption" tone="muted" tabular>{position}</Text>}
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
          <Button variant="ghost" size="icon-xs" aria-label="노드 정보 (오른쪽 패널)" title="노드 정보 (오른쪽 패널)" onClick={onShowNode}>
            <PanelRightOpen />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="닫기 (Esc)" title="닫기 (Esc)" onClick={onClose}>
          <X />
        </Button>
      </Inline>
      {!line ? (
        <Skeleton height="placeholder-sm" />
      ) : (
        <Box spaceY="condensed" minHeight={0} grow overflow="auto">
          <Box asChild maxHeight="scroll-sm" overflow="auto" variant="body"><LineSourceText projectId={projectId} unitId={line.id} source={line.source} /></Box>
          <TranslationEditor
            projectId={projectId}
            key={`editor-${line.id}`}
            unit={line}
            statuses={statuses.data?.statuses ?? []}
            focusKey={1}
            compact
            onEscape={onClose}
            onDone={(moved) => moved && onStep(1)}
          />
          <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={setNoting} />
          <LineHints projectId={projectId} line={{ ...line, lastRun: null }} />
        </Box>
      )}
    </FloatingCard>
  );
}
