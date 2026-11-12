import { Fragment, memo, useState, type RefObject } from 'react';
import type { UIMessage } from 'ai';
import { Check, Pencil, Square, X } from 'lucide-react';
import { AssistantMessage, Button, CompactionNotice as CompactionNoticeView, Icon, Inline, Markdown, MessageActionBar, SentImage, Stack, SteerBubble as SteerBubbleView, Tooltip, TooltipContent, TooltipTrigger, UserMessage } from '@loca/ui';
import { messageChips, runCardOf, runEndOf, type ChatChip, type RunCard } from '@tw/shared';
import { CopyButton } from '@/components/copy-button';
import { AttachChip } from './attach-chip';
import { RunCardView, RunEndView, type RunCardControls } from './run-card';
import type { Proposal } from './proposal-card';
import { ToolPart } from './tool-part';

const messageText = (message: UIMessage) => message.parts.map((part) => (part.type === 'text' ? part.text : '')).filter(Boolean).join('\n\n');

export interface ChatMessageProps {
  message: UIMessage;
  projectId: string;
  sessionId: string;
  /** The newest message that is not a run card: only its tools can still be answered. */
  latest: boolean;
  /** The reply is being written into this message: its actions wait until it is done. */
  streaming: boolean;
  /** Set on the newest waiting 실행 확인 card, so the box can answer it by key. */
  waitingCard?: RefObject<RunCardControls | null>;
  proposalById: ReadonlyMap<string, Proposal>;
  /** Where the conversation's start was summarized, when that is just before this message. */
  summary: string | null;
  onToolOutput: (tool: string, toolCallId: string, output: unknown) => void;
  onReuse: (text: string, chips: ChatChip[]) => void;
  onUndo: (proposalIds: string[]) => void;
  onCard: (card: RunCard) => void;
  onCardAnswered: () => void;
}

/**
 * One message of the conversation. Drawn again only when something it shows changed: typing in the box, a run's
 * progress or the reply growing in the newest message leave every other message alone, and a long conversation
 * costs nothing while they happen. Every prop must therefore keep its identity between draws (ChatBody).
 */
export const ChatMessage = memo(function ChatMessage({ message, projectId, sessionId, latest, streaming, waitingCard, proposalById, summary, onToolOutput, onReuse, onUndo, onCard, onCardAnswered }: ChatMessageProps) {
  const card = runCardOf(message);
  if (card) return <RunCardView projectId={projectId} sessionId={sessionId} card={card} controls={waitingCard} onChange={onCard} onAnswered={onCardAnswered} />;
  const ended = runEndOf(message);
  if (ended) return <RunEndView projectId={projectId} end={ended} />;
  const { stopped, interrupted } = (message.metadata as { stopped?: boolean; interrupted?: boolean } | undefined) ?? {};
  const undoable = message.role === 'assistant' ? [...new Set(message.parts.flatMap((part) => {
    const id = ((part as { output?: { proposalId?: string } }).output ?? {}).proposalId;
    const proposal = id ? proposalById.get(id) : undefined;
    return proposal?.status === 'accepted' && proposal.undo && 'calls' in proposal.undo && proposal.undo.calls > 0 && !proposal.undoneAt ? [proposal.id] : [];
  }))] : [];
  const view =
    message.role === 'user' && (message.metadata as { kind?: string } | undefined)?.kind === 'decisions' ? (
      <DecisionNotice text={message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')} />
    ) : message.role === 'user' ? (
      <UserMessage actions={<MessageActions text={messageText(message)} chips={messageChips(message)} onReuse={onReuse} />}>
        {message.parts.map((part, index) => (part.type === 'text' ? <span key={index}>{part.text}</span> : null))}
        <SentImages parts={message.parts} />
        <SentChips projectId={projectId} chips={messageChips(message)} />
      </UserMessage>
    ) : (
      <AssistantMessage>
        {message.parts.map((part, index) => {
          if (part.type === 'text') return <Markdown key={index}>{part.text}</Markdown>;
          if (part.type === 'data-steer') {
            const data = (part as { data: { text: string; kind?: string } }).data;
            return data.kind === 'decisions' ? <DecisionNotice key={index} text={data.text} /> : <SteerBubble key={index} text={data.text} />;
          }
          if (part.type.startsWith('tool-')) return <ToolPart key={index} part={part as never} proposal={proposalById.get(((part as { output?: { proposalId?: string } }).output ?? {}).proposalId ?? '')} stale={!latest} onOutput={(toolCallId, output) => onToolOutput(part.type.slice(5), toolCallId, output)} />;
          return null;
        })}
        {!streaming && <MessageActions text={messageText(message)} />}
        {undoable.length > 0 && <Button variant="outline" onClick={() => onUndo(undoable)}>변경 되돌리기 ({undoable.length})</Button>}
      </AssistantMessage>
    );
  return (
    <Fragment>
      {summary !== null && <CompactionNotice summary={summary} />}
      {view}
      {(stopped || interrupted) && (
        <Inline as="p" gap="tight" variant="caption" tone="muted" role="status">
          <Icon icon={Square} size="xs" /> {stopped ? '중지됨' : '끊김 · 다음 메시지가 먼저 시작됐습니다'}
        </Inline>
      )}
    </Fragment>
  );
});

/** Copy (and, for what the person wrote, reuse as a new draft); shown on hover or keyboard focus. */
function MessageActions({ text, chips = [], onReuse }: { text: string; chips?: ChatChip[]; onReuse?: (text: string, chips: ChatChip[]) => void }) {
  if (!text.trim()) return null;
  return (
    <MessageActionBar side={onReuse ? 'end' : 'start'}>
      <CopyButton value={text} label="메시지 복사" />
      {onReuse && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" tone="muted" aria-label="수정해서 보내기" onClick={() => onReuse(text, chips)}>
              <Pencil />
            </Button>
          </TooltipTrigger>
          <TooltipContent>수정해서 보내기</TooltipContent>
        </Tooltip>
      )}
    </MessageActionBar>
  );
}

/** A message sent while a reply was running: where the reply took it, or still waiting for its next step. */
export function SteerBubble({ text, waiting = false, onEdit, onCancel }: { text: string; waiting?: boolean; onEdit?: () => void; onCancel?: () => void }) {
  return (
    <SteerBubbleView
      label={waiting ? '전달 대기 중' : '진행 중에 보냄'}
      waiting={waiting}
      actions={
        <>
          {waiting && onEdit && (
            <Button variant="ghost" size="icon-xs" aria-label="입력창으로 되돌려 수정" onClick={onEdit}>
              <Pencil />
            </Button>
          )}
          {waiting && onCancel && (
            <Button variant="ghost" size="icon-xs" aria-label="보내기 취소" onClick={onCancel}>
              <X />
            </Button>
          )}
        </>
      }
    >
      {text}
    </SteerBubbleView>
  );
}

/** What a message pointed at with @, kept with it; each opens its page. */
function SentChips({ projectId, chips }: { projectId: string; chips: ChatChip[] }) {
  if (!chips.length) return null;
  return (
    <Stack direction="row" wrap marginTop="condensed" gap="tight" aria-label="첨부한 항목">
      {chips.map((chip) => <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} />)}
    </Stack>
  );
}

/** The pictures a message carried, from the stored record. */
function SentImages({ parts }: { parts: UIMessage['parts'] }) {
  const files = parts.filter((part) => part.type === 'file' && part.mediaType.startsWith('image/')) as { url: string; filename?: string }[];
  if (!files.length) return null;
  return (
    <Stack direction="row" wrap marginTop="condensed" gap="condensed">
      {files.map((file, index) => (
        <SentImage key={index} src={file.url} alt={file.filename ?? '붙인 이미지'} />
      ))}
    </Stack>
  );
}

/** Where the server summarized the conversation's start (chat-compaction.ts); the summary is what the model reads in its place. */
export function CompactionNotice({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <CompactionNoticeView title="앞 대화를 요약했습니다" open={open} onToggle={() => setOpen(!open)}>
      {summary}
    </CompactionNoticeView>
  );
}

/** How proposals were decided, as told to the agent (it carries on from there). */
function DecisionNotice({ text }: { text: string }) {
  const lines = text.split('\n').filter((line) => line.startsWith('- '));
  const count = (word: string) => lines.filter((line) => line.includes(word)).length;
  const summary = [['수락되어 반영됨', '반영'], ['수락되어 후보로 추가됨', '후보 추가'], ['거절함', '거절'], ['실패함', '실패']].flatMap(([word, label]) => (count(word) ? [`${label} ${count(word)}`] : [])).join(' · ');
  return (
    <Inline as="p" gap="tight" variant="caption" tone="muted" title={text}>
      <Icon icon={Check} size="sm" /> 제안 결과를 에이전트에게 알렸습니다{summary && ` (${summary})`}
    </Inline>
  );
}
