import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Box, Button, DockHeaderSlot, Inline, Notice, SectionHeading, Spinner, Stack, Text } from '@loca/ui';
import { Elapsed } from '@/components/job-progress';
import type { ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { usePendingAgentRequest } from '@/lib/agent';
import { chatDock } from '@/lib/chat-dock';
import { sentTexts } from '@/lib/chat-input-history';
import { removeOnce } from '@/lib/chat-queue';
import { syncCards, withCard } from '@/lib/chat-run';
import { chatFor, dropChat } from '@/lib/chat-store';
import { q } from '@/lib/queries';
import { ChatComposer, type ComposerHandle, type OutgoingMessage } from './chat-composer';
import { ChatMessage, SteerBubble } from './chat-message';
import { ConversationMenu } from './conversation-menu';
import type { RunCardControls } from './run-card';
import { useUndo } from './proposal-card';
import { compactionMarker, isRunRecord, runCardOf, type ChatChip, type PermissionMode, type RunCard } from '@tw/shared';
import type { ChatUsage } from './context-meter';
import { useProposals } from '@/lib/proposals';
import { changeChatSession, useChatSessions } from '@/lib/logs';
import { sent } from '@/lib/collections';

const SESSION_KEY = (projectId: string) => `tw.chat.session.${projectId}`;
const readSession = (projectId: string) => {
  try {
    return sessionStorage.getItem(SESSION_KEY(projectId)) ?? localStorage.getItem(SESSION_KEY(projectId));
  } catch {
    return null;
  }
};

/** How many of a conversation's newest messages are drawn at first; 이전 메시지 더 보기 draws as many again. */
const MESSAGES_SHOWN = 100;

/**
 * Global agent panel. Lives beside every page; switching pages or sessions never touches page history. It stays mounted
 * while another tab of the dock is open (a reply keeps coming in, an AI button's request is taken) but `active` says
 * whether its messages are drawn; and memo keeps the shell's own updates (a run's progress, every second) out of it.
 */
export const ChatPanel = memo(function ChatPanel({ projectId, active }: { projectId: string; active: boolean }) {
  const queryClient = useQueryClient();
  const sessions = useChatSessions(projectId);
  const [sessionId, setSessionId] = useState<string | null>(() => readSession(projectId));

  // Fetch the conversation as soon as its id is known (from storage), not only after the
  // sessions list resolves: waiting for the list made the panel flash its spinner on every open.
  useEffect(() => {
    if (sessionId) void queryClient.prefetchQuery(q.chatSession(sessionId));
  }, [queryClient, sessionId]);

  useEffect(() => {
    return chatDock.onOpenSession((targetProjectId, targetSessionId) => {
      if (targetProjectId === projectId) {
        setSessionId(targetSessionId);
        void queryClient.prefetchQuery(q.chatSession(targetSessionId));
      }
    });
  }, [projectId, queryClient]);

  useEffect(() => {
    if (sessions.data && sessionId && !sessions.data.some((session) => session.id === sessionId)) {
      // Deleted (here or elsewhere): forget it too, or every load asks for it again.
      try {
        sessionStorage.removeItem(SESSION_KEY(projectId));
        localStorage.removeItem(SESSION_KEY(projectId));
      } catch {
        /* ignore */
      }
      setSessionId(null);
    }
    if (sessions.data && !sessionId && sessions.data[0]) setSessionId(sessions.data[0].id);
  }, [sessions.data, sessionId, projectId]);
  useEffect(() => {
    try {
      if (sessionId) {
        sessionStorage.setItem(SESSION_KEY(projectId), sessionId);
        localStorage.setItem(SESSION_KEY(projectId), sessionId);
      }
    } catch {
      /* ignore */
    }
  }, [projectId, sessionId]);

  const create = useMutation({
    // The server starts it with the AI the latest conversation picked.
    // Done once the feed has brought the new conversation: picked before it is listed, the list would
    // unpick it, and a waiting AI-button request would start yet another one, again and again.
    mutationFn: () => sent(projectId, client.projects[':projectId'].chat.$post({ param: { projectId }, json: {} })),
    onSuccess: (session) => setSessionId(session.id),
  });

  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => sent(projectId, client.chat[':sessionId'].$delete({ param: { sessionId: id } })),
    onSuccess: (_data, id) => {
      dropChat(id);
      if (id === sessionId) setSessionId(null);
    },
  });

  const current = sessions.data?.find((session) => session.id === sessionId);
  // An AI button was pressed with no conversation yet: start one, the request waits for it.
  const pendingRequest = usePendingAgentRequest();
  // A page prefilled a request (chatDock.prefill) with no conversation open: start one too; its box takes the text.
  const [prefillWaiting, setPrefillWaiting] = useState(false);
  useEffect(() => chatDock.onPrefill((target) => target === projectId && setPrefillWaiting(true)), [projectId]);
  useEffect(() => {
    if (sessionId) setPrefillWaiting(false);
  }, [sessionId]);
  const waiting = Boolean(pendingRequest) || prefillWaiting;
  // One conversation per wait: never a second while the first is being made or was just made.
  const starting = useRef(false);
  useEffect(() => {
    if (!waiting) starting.current = false;
    // With conversations listed but none picked yet (a fresh browser), the effect above picks the
    // latest in this same render: starting another here would leave an empty extra one each time.
    if (!waiting || !sessions.data || sessions.data.length > 0 || sessionId || create.isPending || starting.current) return;
    starting.current = true;
    create.mutate();
  }, [waiting, sessions.data, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack as="aside" height="full" background="sidebar" aria-label="프로젝트 에이전트" data-own-keys>
      {/* In the dock's top row beside the tabs: the panel closes with the dock's own button. */}
      <DockHeaderSlot>
        <ConversationMenu projectId={projectId} sessions={sessions.data} sessionId={sessionId} currentTitle={current?.title} onPick={setSessionId} onDelete={setDeleting} onCreate={() => create.mutate()} />
        <Button variant="ghost" size="icon-sm" aria-label="새 대화" onClick={() => create.mutate()}>
          <Plus />
        </Button>
      </DockHeaderSlot>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>대화를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>‘{deleting?.title}’의 메시지가 모두 지워집니다. 이 대화에서 이미 수락한 변경은 그대로 남습니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* A connection picked without a model yet still counts, so the picker asks for the model. */}
      {current ? (
        <Conversation key={current.id} active={active} projectId={projectId} sessionId={current.id} mode={current.permissionMode} model={current.connectionId ? { connectionId: current.connectionId, model: current.model ?? '', ...(current.effort && { effort: current.effort }) } : null} />
      ) : (
        <Stack grow align="center" justify="center" gap="normal" padding="spacious" textAlign="center" variant="body" tone="muted">
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus /> 새 대화
          </Button>
        </Stack>
      )}
    </Stack>
  );
});

function Conversation({ active, projectId, sessionId, model, mode }: { active: boolean; projectId: string; sessionId: string; model: ModelValue | null; mode: PermissionMode }) {
  const saved = useQuery(q.chatSession(sessionId));
  // A connection picked without a model yet: the picker shows it and asks for the model.
  const [picked, setPicked] = useState<ModelValue | null>(null);
  if (saved.isPending) return <Inline grow justify="center"><Spinner /></Inline>;
  return (
    <ChatBody
      active={active}
      projectId={projectId}
      sessionId={sessionId}
      initial={(saved.data?.messages ?? []) as unknown as UIMessage[]}
      turn={saved.data?.turn ?? null}
      usage={saved.data?.usage ?? null}
      compaction={saved.data?.compaction ?? null}
      pending={saved.data?.pendingSteers ?? []}
      model={picked ?? model}
      mode={mode}
      onMode={(next) => void changeChatSession(projectId, sessionId, { permissionMode: next }, () => client.chat[':sessionId'].$patch({ param: { sessionId }, json: { permissionMode: next } })).catch(() => undefined)}
      onModel={async (next) => {
        // A connection chosen without a model yet waits here for one; a whole choice is saved (shown at once).
        if (!next.model) return setPicked(next);
        setPicked(null);
        await changeChatSession(projectId, sessionId, { connectionId: next.connectionId, model: next.model, effort: next.effort ?? null }, () => client.chat[':sessionId'].$patch({ param: { sessionId }, json: { model: next } }));
      }}
    />
  );
}

function ChatBody({ active, projectId, sessionId, initial, turn, usage, compaction, pending, model, onModel, mode, onMode }: {
  /** The panel is the dock's open tab: only then are the messages drawn. */
  active: boolean;
  projectId: string;
  sessionId: string;
  initial: UIMessage[];
  turn: Turn | null;
  /** The meter's numbers and whether the model takes images (server: chat-usage.ts). */
  usage: (ChatUsage & { images: 'yes' | 'no' | 'unknown' }) | null;
  /** Where the conversation's start was summarized, if it was. */
  compaction: { upTo: number; summary: string; at: number } | null;
  /** Messages the server still holds for the conversation's agent (sent before a reload or a restart). */
  pending: string[];
  model: ModelValue | null;
  mode: PermissionMode;
  onMode: (mode: PermissionMode) => void;
  onModel: (next: ModelValue) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const ready = Boolean(model?.connectionId && model.model);
  const composer = useRef<ComposerHandle>(null);

  // The conversation outlives this panel: closing it mid-reply keeps the reply coming in.
  const stored = chatFor(sessionId, initial);
  // A reply's chunks arrive far faster than anyone reads: the conversation is drawn at most this often.
  const { messages, sendMessage, setMessages, regenerate, status, stop, error, addToolOutput } = useChat({ chat: stored.chat, throttle: 50 });
  // The turn runs on the server, not in this request: stopping ends both.
  const halt = () => {
    void stop();
    // Said at once here; the server saves the same mark on the conversation (chat-turns markStopped).
    setMessages((current) => {
      const last = current.at(-1);
      return last ? [...current.slice(0, -1), { ...last, metadata: { ...((last.metadata as object | undefined) ?? {}), stopped: true } }] : current;
    });
    void unwrap(client.chat[':sessionId'].stop.$post({ param: { sessionId } })).then(({ queued: back }) => {
      // Messages the turn had not taken yet go back to the input box.
      setQueued([]);
      if (back.length) composer.current?.mergeDraft(back);
    });
  };
  // A reply this window is not streaming (sent before a reload, or from another window) is saved
  // by the server when it ends; the saved conversation then catches up here.
  useEffect(() => {
    if (status !== 'ready' || initial.length <= messages.length) return;
    if (messages.every((message, i) => initial[i]?.id === message.id)) setMessages(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  // Run cards are messages of the stored conversation (made or answered here or in another window): they join this one once no reply is streaming into it.
  useEffect(() => {
    if (status !== 'ready') return;
    const next = syncCards(messages, initial);
    if (next) setMessages(next);
  }, [initial, status, messages]); // eslint-disable-line react-hooks/exhaustive-deps
  // A turn running on the server that this window is not streaming (sent before a reload, from
  // another window, or started by the server once proposals were decided): attach to it, once per turn.
  const attachedTo = useRef<number | null>(null);
  // When this window last finished streaming a reply: a turn that started before then was its own.
  const streamedUntil = useRef(0);
  const streaming = useRef(false);
  useEffect(() => {
    const now = status === 'submitted' || status === 'streaming';
    if (streaming.current && !now) streamedUntil.current = Date.now();
    streaming.current = now;
  }, [status]);
  useEffect(() => {
    const startedAt = turn?.startedAt ?? null;
    if (!startedAt || status !== 'ready' || attachedTo.current === startedAt) return;
    attachedTo.current = startedAt;
    if (startedAt <= streamedUntil.current) return;
    // The question it answers comes first (the server saved it before the turn began).
    if (initial.length > messages.length && messages.every((message, i) => initial[i]?.id === message.id)) setMessages(initial);
    void stored.chat.resumeStream();
  }, [turn?.startedAt, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sent while the reply was running (#44): waiting for the turn to take them at its next step.
  // Those still on the server (sent before a reload, or a turn a restart cut off) go with the next one.
  const [queued, setQueued] = useState<string[]>(pending);
  // A card the server made or answered joins the stored conversation at once; the sync above puts it on screen.
  const putCard = useCallback((card: RunCard) => queryClient.setQueryData(q.chatSession(sessionId).queryKey, (session) => (session ? withCard(session, card) : session)), [queryClient, sessionId]);
  const waitingCard = useRef<RunCardControls | null>(null);
  const sentHere = useMemo(() => sentTexts(messages), [messages]);
  const busy = status === 'submitted' || status === 'streaming';
  // A turn this window is not streaming (sent before a reload) that is still going on the server.
  // Run cards are in the conversation but are not the exchange: the newest message that is not one is what the reply state is about.
  const lastMessage = useMemo(() => messages.findLast((message) => !isRunRecord(message)), [messages]);
  const elsewhere = !busy && Boolean(turn?.startedAt) && lastMessage?.role === 'user';
  // CLI chats store change requests as proposals; their cards are decided through the API.
  const proposals = useProposals(projectId, { session: sessionId });
  const proposalById = useMemo(() => new Map(proposals.data?.map((proposal) => [proposal.id, proposal])), [proposals.data]);
  const [undoingReply, setUndoingReply] = useState(false);
  const [replyUndoIds, setReplyUndoIds] = useState<string[]>([]);
  const undoReply = useUndo(projectId, sessionId);
  // A finished turn whose last part is a tool call said nothing about the result: say so and offer to continue.
  const marker = compactionMarker(compaction, messages.length);
  const lastPart = lastMessage?.parts.filter((part) => part.type !== 'step-start').at(-1);
  const finishReason = (lastMessage?.metadata as { finishReason?: string } | undefined)?.finishReason;
  const stalled = !busy && !error && lastMessage?.role === 'assistant' && (finishReason === 'length' || Boolean(lastPart?.type.startsWith('tool-') && (lastPart as { state?: string }).state === 'output-available'));

  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // The panel may have been hidden while they came: opening it shows the newest too.
  useEffect(() => {
    const element = scroller.current;
    if (active && element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages, active]);
  // Only the newest messages are drawn at first; drawing older ones above keeps what is on screen where it is.
  const [extra, setExtra] = useState(0);
  const firstShown = Math.max(0, messages.length - MESSAGES_SHOWN - extra);
  const scrolledFrom = useRef<number | null>(null);
  const showOlder = () => {
    scrolledFrom.current = scroller.current?.scrollHeight ?? null;
    setExtra((count) => count + MESSAGES_SHOWN);
  };
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || scrolledFrom.current === null) return;
    element.scrollTop += element.scrollHeight - scrolledFrom.current;
    scrolledFrom.current = null;
  }, [extra]);

  const pin = useCallback(() => void (pinned.current = true), []);
  const send = (message: OutgoingMessage) => void sendMessage(message);
  const queue = (text: string) => {
    setQueued((list) => [...list, text]);
    const giveBack = () => {
      setQueued((list) => removeOnce(list, text));
      composer.current?.mergeDraft([text]);
      toast.info('답이 막 끝나 전달하지 못했습니다. 입력창에 되돌려 두었습니다.');
    };
    // The turn may be ending: it refuses (409) and the text goes back to the box instead of being sent on its own.
    client.chat[':sessionId'].steer.$post({ param: { sessionId }, json: { text } }).then((response) => response.ok || giveBack(), giveBack);
  };
  // A queued message the turn has not taken yet: cancel it, or take it back into the box to edit.
  const takeBack = async (text: string, edit: boolean) => {
    const { removed } = await unwrap(client.chat[':sessionId'].unsteer.$post({ param: { sessionId }, json: { text } })).catch(() => ({ removed: false }));
    if (!removed) return void toast.info('이미 에이전트에게 전달됐습니다.');
    setQueued((list) => removeOnce(list, text));
    if (edit) {
      composer.current?.mergeDraft([text]);
      composer.current?.focus();
    }
  };
  // 수정해서 보내기: the old message stays; its text becomes a new draft.
  const reuse = useCallback((text: string, chips: ChatChip[]) => composer.current?.reuse(text, chips), []);
  const focusBox = useCallback(() => composer.current?.focus(), []);
  const undo = useCallback((ids: string[]) => {
    setReplyUndoIds(ids);
    setUndoingReply(true);
  }, []);
  const toolOutput = useCallback((tool: string, toolCallId: string, output: unknown) => void addToolOutput({ tool: tool as never, toolCallId, output: output as never }), [addToolOutput]);
  // A queued message shows in the reply once the turn has handed it to the model.
  useEffect(() => {
    if (!queued.length) return;
    const delivered = messages.flatMap((message) => message.parts.flatMap((part) => (part.type === 'data-steer' ? [(part as { data: { text: string } }).data.text] : [])));
    const left = queued.filter((text) => !delivered.includes(text));
    if (left.length !== queued.length) setQueued(left);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // 실행 확인 cards are in the conversation where they were made; the newest waiting one answers the keyboard.
  const lastWaiting = useMemo(() => messages.findLast((message) => runCardOf(message)?.state === 'pending')?.id, [messages]);

  return (
    <Stack
      minHeight={0}
      grow
      onKeyDown={(event) => {
        // Esc stops the running reply from anywhere in the panel body (not from a popup opened inside it).
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || !(busy || elsewhere)) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        halt();
      }}
    >
      <Box
        ref={scroller}
        minHeight={0}
        grow
        overflow="y"
        paddingX="comfortable"
        paddingY="comfortable"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {!messages.length && (
          <Box spaceY="condensed" paddingTop="spacious" variant="body" tone="muted">
            <SectionHeading>무엇을 도와드릴까요?</SectionHeading>
          </Box>
        )}
        {active && (
          <Box spaceY="comfortable">
            {firstShown > 0 && (
              <Inline justify="center">
                <Button variant="ghost" onClick={showOlder}>이전 메시지 더 보기 ({firstShown.toLocaleString()})</Button>
              </Inline>
            )}
            {messages.slice(firstShown).map((message, offset) => (
              <ChatMessage
                key={message.id}
                message={message}
                projectId={projectId}
                sessionId={sessionId}
                latest={message.id === lastMessage?.id}
                streaming={busy && message.id === lastMessage?.id}
                waitingCard={message.id === lastWaiting ? waitingCard : undefined}
                proposalById={proposalById}
                summary={marker?.index === firstShown + offset ? marker.summary : null}
                onToolOutput={toolOutput}
                onReuse={reuse}
                onUndo={undo}
                onCard={putCard}
                onCardAnswered={focusBox}
              />
            ))}
            {queued.map((text, index) => (
              <SteerBubble key={`queued-${index}`} text={text} waiting onEdit={() => void takeBack(text, true)} onCancel={() => void takeBack(text, false)} />
            ))}
            {busy && (
              <Inline as="p" gap="condensed" variant="body" tone="muted">
                <Spinner /> {status === 'submitted' ? '생각하는 중…' : '작업 중…'}
              </Inline>
            )}
            {!busy && !error && lastMessage?.role === 'user' && <TurnState turn={turn} onStop={halt} onRetry={() => void regenerate()} canRetry={ready} />}
            {stalled && (
              <Inline gap="condensed" radius="md" border="all" background="sunken" paddingX="normal" paddingY="condensed" variant="body">
                <Text tone="muted">{finishReason === 'length' ? '모델의 출력 한도에 걸려 멈췄습니다.' : '에이전트가 결과를 말하지 않고 멈췄습니다.'}</Text>
              </Inline>
            )}
            {error && <Notice tone="danger" as="p">{error.message}</Notice>}
          </Box>
        )}
      </Box>

      <AlertDialog open={undoingReply} onOpenChange={setUndoingReply}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>변경을 되돌릴까요?</AlertDialogTitle><AlertDialogDescription>이 답에서 반영된 변경 {replyUndoIds.length}개를 되돌리는 제안을 적용합니다. 그사이 바뀐 대사는 건너뜁니다.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={undoReply.isPending} onClick={() => { undoReply.mutate(replyUndoIds); setUndoingReply(false); }}>되돌리기</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChatComposer
        handle={composer}
        projectId={projectId}
        sessionId={sessionId}
        stored={stored}
        onSend={send}
        onQueue={queue}
        onPin={pin}
        onStop={halt}
        onCard={putCard}
        ready={ready}
        busy={busy}
        elsewhere={elsewhere}
        sent={sentHere}
        waitingCard={waitingCard}
        cardWaiting={Boolean(lastWaiting)}
        usage={usage}
        model={model}
        onModel={onModel}
        mode={mode}
        onMode={onMode}
      />
    </Stack>
  );
}

type Turn = { startedAt: number | null; call: { label: string | null; status: string; error: string | null; startedAt: string } | null };

/**
 * A question whose answer this window is not streaming (it was sent before a reload): while the
 * server is still on it, what step it is at and for how long, with a way to stop; once it is
 * over without an answer, why, with a way to ask again.
 */
function TurnState({ turn, onStop, onRetry, canRetry }: { turn: Turn | null; onStop: () => void; onRetry: () => void; canRetry: boolean }) {
  if (turn?.startedAt) {
    const rounds = Number(/도구 결과 후 (\d+)/.exec(turn.call?.label ?? '')?.[1] ?? 0);
    const step = turn.call?.status === 'running' ? (rounds ? `도구 결과를 받고 이어서 쓰는 중 (${rounds + 1}번째 요청)` : '답을 쓰는 중') : '도구를 쓰는 중';
    return (
      <Inline gap="condensed" radius="md" border="all" background="sunken" paddingX="normal" paddingY="condensed" variant="body" tone="muted">
        <Spinner />
        <Text minWidth={0} grow>
          {step} · <Elapsed since={new Date(turn.startedAt)} />
        </Text>
        <Button variant="outline" onClick={onStop}>
          중단
        </Button>
      </Inline>
    );
  }
  const reason = turn?.call?.status === 'failed' ? turn.call.error : null;
  return (
    <Inline gap="condensed" radius="md" border="all" background="sunken" paddingX="normal" paddingY="condensed" variant="body">
      <Text minWidth={0} grow tone="muted">
        답을 받지 못했습니다.
        <Text display="block" variant="caption">{reason ?? '답이 끝나기 전에 끊겼습니다.'}</Text>
      </Text>
      <Button variant="outline" disabled={!canRetry} onClick={onRetry}>
        다시 보내기
      </Button>
    </Inline>
  );
}
