import { Fragment, useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowUp, Check, ChevronRight, ImageOff, Pencil, Plus, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AssistantMessage, Box, Button, FilePickButton, DockHeaderSlot, Markdown, CompactionNotice as CompactionNoticeView, ComposerInput, ComposerMenu, Icon, Notice, ImageChip, Inline, MessageActionBar, SectionHeading, SentImage, Spinner, Stack, SteerBubble as SteerBubbleView, Text, Tooltip, TooltipContent, TooltipTrigger, UserMessage } from '@loca/ui';
import { CopyButton } from '@/components/copy-button';
import { Elapsed } from '@/components/job-progress';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { agentRequests, usePendingAgentRequest } from '@/lib/agent';
import { chatDock } from '@/lib/chat-dock';
import { NO_HISTORY, sentTexts, stepHistory, type HistoryState } from '@/lib/chat-input-history';
import { mergeIntoDraft, removeOnce } from '@/lib/chat-queue';
import { syncCards, withCard } from '@/lib/chat-run';
import { makeRunCard } from '@/lib/chat-run-api';
import { chatFor, dropChat } from '@/lib/chat-store';
import { keyLabel } from '@/lib/keys';
import { q } from '@/lib/queries';
import { useViewState, type ViewItem } from '@/lib/view-context';
import { AttachChip } from './attach-chip';
import { ConversationMenu } from './conversation-menu';
import { RunCardView, type RunCardControls } from './run-card';
import { useComposerMenu, type RunMode } from './use-composer-menu';
import { useUndo } from './proposal-card';
import { ProposalList } from './proposal-list';
import { PermissionModePicker } from './permission-mode';
import { CHAT_IMAGES_MAX, compactionMarker, imageDecision, IMAGE_UNSUPPORTED_NOTE, messageChips, runCardOf, type ChatChip, type PermissionMode, type RunCard } from '@tw/shared';
import { imageFilesOf, prepareImage, type PendingImage } from '@/lib/chat-image-file';
import { ContextMeter, type ChatUsage } from './context-meter';
import { ToolPart } from './tool-part';
import { useProposals } from '@/lib/proposals';

const SESSION_KEY = (projectId: string) => `tw.chat.session.${projectId}`;
const readSession = (projectId: string) => {
  try {
    return sessionStorage.getItem(SESSION_KEY(projectId)) ?? localStorage.getItem(SESSION_KEY(projectId));
  } catch {
    return null;
  }
};

/** Global agent panel. Lives beside every page; switching pages or sessions never touches page history. */
export function ChatPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const sessions = useQuery(q.chatSessions(projectId));
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
        void queryClient.invalidateQueries({ queryKey: q.chatSessions(projectId).queryKey });
      }
    });
  }, [projectId, queryClient]);

  useEffect(() => {
    if (sessions.data && sessionId && !sessions.data.some((session) => session.id === sessionId)) setSessionId(null);
    if (sessions.data && !sessionId && sessions.data[0]) setSessionId(sessions.data[0].id);
  }, [sessions.data, sessionId]);
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
    mutationFn: () => unwrap(client.projects[':projectId'].chat.$post({ param: { projectId }, json: {} })),
    onSuccess: (session) => {
      // The new conversation joins the list before it is picked: otherwise the stale list would
      // unpick it, and a waiting AI-button request would start yet another one, again and again.
      queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => (list ? [{ id: session.id, title: session.title, connectionId: session.connectionId, model: session.model, effort: session.effort, permissionMode: session.permissionMode, updatedAt: session.updatedAt, calls: 0, tokens: 0 }, ...list.filter((item) => item.id !== session.id)] : list));
      setSessionId(session.id);
    },
  });

  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(client.chat[':sessionId'].$delete({ param: { sessionId: id } })),
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
      <ExternalProposals projectId={projectId} />
      {/* A connection picked without a model yet still counts, so the picker asks for the model. */}
      {current ? (
        <Conversation key={current.id} projectId={projectId} sessionId={current.id} mode={current.permissionMode} model={current.connectionId ? { connectionId: current.connectionId, model: current.model ?? '', ...(current.effort && { effort: current.effort }) } : null} />
      ) : (
        <Stack grow align="center" justify="center" gap="normal" padding="spacious" textAlign="center" variant="body" tone="muted">
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus /> 새 대화
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function Conversation({ projectId, sessionId, model, mode }: { projectId: string; sessionId: string; model: ModelValue | null; mode: PermissionMode }) {
  const queryClient = useQueryClient();
  const saved = useQuery(q.chatSession(sessionId));
  if (saved.isPending) return <Inline grow justify="center"><Spinner /></Inline>;
  return (
    <ChatBody
      projectId={projectId}
      sessionId={sessionId}
      initial={(saved.data?.messages ?? []) as unknown as UIMessage[]}
      turn={saved.data?.turn ?? null}
      usage={saved.data?.usage ?? null}
      compaction={saved.data?.compaction ?? null}
      pending={saved.data?.pendingSteers ?? []}
      model={model}
      mode={mode}
      onMode={(next) => {
        queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => list?.map((item) => (item.id === sessionId ? { ...item, permissionMode: next } : item)));
        void unwrap(client.chat[':sessionId'].$patch({ param: { sessionId }, json: { permissionMode: next } }));
      }}
      onModel={async (next) => {
        // Shown at once; a connection chosen without a model yet waits for one.
        queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => list?.map((item) => (item.id === sessionId ? { ...item, connectionId: next.connectionId, model: next.model || null, effort: next.effort ?? null } : item)));
        if (!next.model) return;
        await unwrap(client.chat[':sessionId'].$patch({ param: { sessionId }, json: { model: next } }));
      }}
    />
  );
}

function ChatBody({ projectId, sessionId, initial, turn, usage, compaction, pending, model, onModel, mode, onMode }: {
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
  const view = useViewState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Chips from the page (reported by useReportView) and ones the person picked with @ for the next message
  // (these stay on the message they were sent with).
  const [picked, setPicked] = useState<ChatChip[]>([]);
  const reported: ViewItem[] = Object.values(view.items).flat();
  const onPage: ViewItem[] = reported.filter((item) => !excluded.has(`${item.kind}:${item.id}`) && !picked.some((other) => other.kind === item.kind && other.id === item.id));
  const attached: ViewItem[] = [...onPage, ...picked.map((chip): ViewItem => ({ kind: chip.kind, id: chip.id, label: chip.label, ...(chip.detail && { detail: chip.detail }), attached: true }))];
  const viewRef = useRef({ page: view.page, path: pathname, items: attached });
  // What the message being sent carries: held for a moment after sending so the chips cleared by it still reach the request.
  const frozenView = useRef<typeof viewRef.current | null>(null);

  // The conversation outlives this panel: closing it mid-reply keeps the reply coming in.
  const stored = chatFor(sessionId, initial);
  // What is on screen now, for the next message (kept after render: rendering itself changes nothing).
  useLayoutEffect(() => {
    viewRef.current = { page: view.page, path: pathname, items: attached };
    stored.setView(frozenView.current ?? viewRef.current);
  });
  const { messages, sendMessage, setMessages, regenerate, status, stop, error, addToolApprovalResponse, addToolOutput } = useChat({ chat: stored.chat });
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
      if (back.length) setInput((current) => mergeIntoDraft(current, back));
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

  const [input, setInput] = useState(() => chatDock.takePrefill(projectId) ?? sessionStorage.getItem(`tw.chat.draft.${sessionId}`) ?? '');
  // A page asked to start a request here (e.g. the graph's AI 간략 보기): it fills the box, the person finishes and sends it.
  useEffect(
    () =>
      chatDock.onPrefill((target, text) => {
        if (target !== projectId) return;
        chatDock.takePrefill(projectId);
        setInput(text);
      }),
    [projectId],
  );
  const [showModelHint, setShowModelHint] = useState(false);
  // Images pasted or dropped for the next message; a model that takes none keeps the chip but they are not sent.
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const imageSupport = imageDecision(usage?.images === 'yes' ? true : usage?.images === 'no' ? false : undefined, images.length);
  const addImages = async (files: File[]) => {
    for (const file of files) {
      if (images.length >= CHAT_IMAGES_MAX) return void toast.error(`이미지는 한 메시지에 ${CHAT_IMAGES_MAX}장까지 붙일 수 있습니다.`);
      try {
        const image = await prepareImage(file);
        setImages((list) => (list.length >= CHAT_IMAGES_MAX ? list : [...list, image]));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : '이미지를 붙이지 못했습니다.');
      }
    }
  };
  // Sent while the reply was running (#44): waiting for the turn to take them at its next step.
  // Those still on the server (sent before a reload, or a turn a restart cut off) go with the next one.
  const [queued, setQueued] = useState<string[]>(pending);
  const box = useRef<HTMLTextAreaElement>(null);
  // @ (attach) and / (commands) pickers over the box (use-composer-menu.ts): what they show follows the text and the caret.
  const [caret, setCaret] = useState(0);
  // A /workflow waiting for its target and the `{대상}` slot of a saved prompt. The 실행 확인 cards are messages of the conversation (server).
  const [run, setRun] = useState<RunMode | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  // A card the server made or answered joins the stored conversation at once; the sync above puts it on screen.
  const putCard = (card: RunCard) => queryClient.setQueryData(q.chatSession(sessionId).queryKey, (session) => (session ? withCard(session, card) : session));
  const makeCard = useMutation({
    mutationFn: ({ workflowId, chips }: { workflowId: string; chips: ChatChip[] }) => makeRunCard(sessionId, workflowId, chips),
    onSuccess: (card) => {
      putCard(card);
      setRun(null);
      putInput('', 0);
    },
    onError: (cause) => toast.error(cause instanceof Error ? cause.message : '실행 확인을 만들지 못했습니다.'),
  });
  const waitingCard = useRef<RunCardControls | null>(null);
  const putInput = (value: string, at: number) => {
    setInput(value);
    setHistory(NO_HISTORY);
    setCaret(at);
    const target = box.current;
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(at, at);
      // The browser moves the caret to the end when the text is replaced (a select event may report that); the caret we set is the one that counts.
      setCaret(at);
    });
  };
  const menu = useComposerMenu({ projectId, input, caret, put: putInput, box, onPage: reported, picked, setPicked, run, setRun, slot, setSlot });
  // The slot is the @ a prompt's {대상} was opened as: it ends when that @ is no longer there (the caret may jump while the text is replaced, so it is not tied to the list being open).
  useEffect(() => {
    if (slot !== null && input[slot] !== '@') setSlot(null);
  }, [input, slot]);
  // The target is picked: the card asks before anything runs (AI work costs money).
  const confirmRun = () => {
    if (!run || makeCard.isPending) return;
    if (!run.chips.length) return putInput('@', 1);
    makeCard.mutate({ workflowId: run.command.id, chips: run.chips });
  };
  // ↑/↓ in the box walks what was sent in this conversation; any edit leaves the walk.
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);
  const sent = sentTexts(messages);
  useEffect(() => {
    sessionStorage.setItem(`tw.chat.draft.${sessionId}`, input);
  }, [sessionId, input]);
  const busy = status === 'submitted' || status === 'streaming';
  // A turn this window is not streaming (sent before a reload) that is still going on the server.
  // Run cards are in the conversation but are not the exchange: the newest message that is not one is what the reply state is about.
  const lastMessage = messages.findLast((message) => !runCardOf(message));
  const elsewhere = !busy && Boolean(turn?.startedAt) && lastMessage?.role === 'user';
  // CLI chats store change requests as proposals; their cards are decided through the API.
  const proposals = useProposals(projectId, { session: sessionId });
  const proposalById = new Map(proposals.data?.map((proposal) => [proposal.id, proposal]));
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
  // Requests from AI buttons elsewhere in the app.
  const pendingRequest = usePendingAgentRequest();
  // Taken on the next tick, after the freshly mounted chat has settled (a send during its
  // own setup is dropped); the cleanup keeps the request queued if this body unmounts first.
  useEffect(() => {
    if (!pendingRequest || busy) return;
    const timer = setTimeout(() => {
      const request = agentRequests.take();
      if (!request) return;
      if (request.send && ready) {
        pinned.current = true;
        void sendMessage({ text: request.text });
      } else setInput(request.text);
    }, 50);
    return () => clearTimeout(timer);
  }, [pendingRequest, busy, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const send = () => {
    // A /workflow waiting for its target: Enter makes the confirm card instead of sending a message.
    if (run) return confirmRun();
    const text = input.trim();
    const files = imageSupport.send ? images.map((image) => ({ type: 'file' as const, mediaType: image.mediaType, url: image.url, filename: image.name })) : [];
    if (!text && !files.length) return;
    if (!ready) return;
    // A message that joins a running reply is text: the images wait for the next message.
    if ((busy || elsewhere) && files.length) return void toast.info('이미지는 답이 끝난 뒤에 보낼 수 있습니다.');
    setInput('');
    if (!busy && !elsewhere) {
      frozenView.current = viewRef.current;
      setTimeout(() => (frozenView.current = null), 2000);
      stored.setView(viewRef.current);
      // What the person pointed at with @ is kept on the message, to read (and open) later.
      void sendMessage({ text, ...(files.length && { files }), ...(picked.length && { metadata: { chips: picked } }) });
      setPicked([]);
      setImages([]);
      return;
    }
    pinned.current = true;
    setQueued((list) => [...list, text]);
    const giveBack = () => {
      setQueued((list) => removeOnce(list, text));
      setInput((current) => mergeIntoDraft(current, [text]));
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
      setInput((current) => mergeIntoDraft(current, [text]));
      box.current?.focus();
    }
  };
  // 수정해서 보내기: the old message stays; its text becomes a new draft.
  const reuse = (text: string, chips: ChatChip[]) => {
    setInput(text);
    setPicked(chips);
    setHistory(NO_HISTORY);
    box.current?.focus();
  };
  // A queued message shows in the reply once the turn has handed it to the model.
  useEffect(() => {
    if (!queued.length) return;
    const delivered = messages.flatMap((message) => message.parts.flatMap((part) => (part.type === 'data-steer' ? [(part as { data: { text: string } }).data.text] : [])));
    const left = queued.filter((text) => !delivered.includes(text));
    if (left.length !== queued.length) setQueued(left);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // 실행 확인 cards are in the conversation where they were made; the newest waiting one answers the keyboard.
  const lastWaiting = messages.findLast((message) => runCardOf(message)?.state === 'pending')?.id;
  const cardView = (message: UIMessage, card: RunCard) => (
    <RunCardView
      key={message.id}
      projectId={projectId}
      sessionId={sessionId}
      card={card}
      controls={message.id === lastWaiting ? waitingCard : undefined}
      onChange={putCard}
      onAnswered={() => box.current?.focus()}
    />
  );

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
        <Box spaceY="comfortable">
          {messages.map((message, messageIndex) => {
            const card = runCardOf(message);
            if (card) return cardView(message, card);
            const { stopped, interrupted } = (message.metadata as { stopped?: boolean; interrupted?: boolean } | undefined) ?? {};
            const undoable = message.role === 'assistant' ? [...new Set(message.parts.flatMap((part) => {
              const id = ((part as { output?: { proposalId?: string } }).output ?? {}).proposalId;
              const proposal = id ? proposalById.get(id) : undefined;
              return proposal?.status === 'accepted' && proposal.undo && 'calls' in proposal.undo && proposal.undo.calls > 0 && !proposal.undoneAt ? [proposal.id] : [];
            }))] : [];
            const view =
            message.role === 'user' && (message.metadata as { kind?: string } | undefined)?.kind === 'decisions' ? (
              <DecisionNotice key={message.id} text={message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')} />
            ) : message.role === 'user' ? (
              <UserMessage key={message.id} actions={<MessageActions text={messageText(message)} chips={messageChips(message)} onReuse={reuse} />}>
                {message.parts.map((part, index) => (part.type === 'text' ? <span key={index}>{part.text}</span> : null))}
                <SentImages parts={message.parts} />
                <SentChips projectId={projectId} chips={messageChips(message)} />
              </UserMessage>
            ) : (
              <AssistantMessage key={message.id}>
                {message.parts.map((part, index) => {
                  if (part.type === 'text')
                    return <Markdown key={index}>{part.text}</Markdown>;
                  if (part.type === 'data-steer') {
                    const data = (part as { data: { text: string; kind?: string } }).data;
                    return data.kind === 'decisions' ? <DecisionNotice key={index} text={data.text} /> : <SteerBubble key={index} text={data.text} />;
                  }
                  if (part.type.startsWith('tool-')) return <ToolPart key={index} part={part as never} proposal={proposalById.get(((part as { output?: { proposalId?: string } }).output ?? {}).proposalId ?? '')} stale={message.id !== lastMessage?.id} onDecide={(id, approved) => addToolApprovalResponse({ id, approved })} onOutput={(toolCallId, output) => void addToolOutput({ tool: part.type.slice(5) as never, toolCallId, output: output as never })} />;
                  return null;
                })}
                {!(busy && message.id === lastMessage?.id) && <MessageActions text={messageText(message)} />}
                {undoable.length > 0 && <Button variant="outline" onClick={() => { setReplyUndoIds(undoable); setUndoingReply(true); }}>변경 되돌리기 ({undoable.length})</Button>}
              </AssistantMessage>
            );
            const summarized = marker?.index === messageIndex ? <CompactionNotice summary={marker.summary} /> : null;
            if (!stopped && !interrupted) return <Fragment key={message.id}>{summarized}{view}</Fragment>;
            return (
              <Fragment key={message.id}>
                {summarized}
                {view}
                <Inline as="p" gap="tight" variant="caption" tone="muted" role="status">
                  <Icon icon={Square} size="xs" /> {stopped ? '중지됨' : '끊김 · 다음 메시지가 먼저 시작됐습니다'}
                </Inline>
              </Fragment>
            );
          })}
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
      </Box>

      <AlertDialog open={undoingReply} onOpenChange={setUndoingReply}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>변경을 되돌릴까요?</AlertDialogTitle><AlertDialogDescription>이 답에서 반영된 변경 {replyUndoIds.length}개를 되돌리는 제안을 적용합니다. 그사이 바뀐 대사는 건너뜁니다.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={undoReply.isPending} onClick={() => { undoReply.mutate(replyUndoIds); setUndoingReply(false); }}>되돌리기</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Box shrink={false} border="top" background="page" padding="condensed">
        {run && (
          <Inline wrap marginBottom="condensed" gap="tight" aria-label="실행 대상">
            <Text variant="caption" weight="medium">/{run.command.name}</Text>
            {run.chips.map((chip) => (
              <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} onRemove={() => { setRun({ ...run, chips: run.chips.filter((other) => !(other.kind === chip.kind && other.id === chip.id)) }); box.current?.focus(); }} />
            ))}
            <Text variant="caption" tone="muted">{run.chips.length ? `${keyLabel('Enter')} 실행 확인 · @ 더 고르기 · ${keyLabel('Esc')} 취소` : '@로 실행할 대상을 고르세요'}</Text>
            <Button type="button" variant="ghost" size="icon-xs" marginLeft="auto" aria-label="실행 그만두기" onClick={() => { setRun(null); putInput('', 0); }}>
              <X />
            </Button>
          </Inline>
        )}
        {/* What goes with the message, led by +: a picture from a file (as pasting or dropping one); lines and screens are @ in the box. */}
        <Stack direction="row" wrap align="center" marginBottom="condensed" gap="tight" aria-label="첨부된 화면 정보">
          <FilePickButton size="icon-xs" variant="outline" accept="image/*" multiple aria-label="이미지 첨부" title="이미지 첨부 (붙여넣기·끌어 놓기도 됩니다)" onFiles={(files) => void addImages(files)}>
            <Plus />
          </FilePickButton>
            {attached.map((item) => (
              <AttachChip
                key={`${item.kind}:${item.id}`}
                projectId={projectId}
                chip={{ kind: item.kind, id: item.id, label: item.label, ...(item.detail && { detail: item.detail }), href: picked.find((chip) => chip.kind === item.kind && chip.id === item.id)?.href }}
                link={Boolean(item.attached)}
                onRemove={() => {
                  if (item.attached) setPicked((list) => list.filter((other) => !(other.kind === item.kind && other.id === item.id)));
                  else setExcluded((set) => new Set(set).add(`${item.kind}:${item.id}`));
                  box.current?.focus();
                }}
              />
            ))}
        </Stack>
        {images.length > 0 && (
          <Inline wrap marginBottom="condensed" gap="condensed" aria-label="붙인 이미지">
            {images.map((image) => (
              <ImageChip key={image.id} src={image.url} alt={image.name} dimmed={imageSupport.support === 'no'} removeLabel={`${image.name} 빼기`} onRemove={() => setImages((list) => list.filter((other) => other.id !== image.id))} />
            ))}
            {imageSupport.support === 'no' && (
              <Inline gap="tight" variant="caption" tone="muted" role="status">
                <Icon icon={ImageOff} size="sm" /> {IMAGE_UNSUPPORTED_NOTE}
              </Inline>
            )}
          </Inline>
        )}
        <Box
          position="relative"
          radius={dragging ? 'md' : undefined}
          ring={dragging ? 'focus' : undefined}
          onDragOver={(event) => {
            if (![...event.dataTransfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            setDragging(false);
            const files = imageFilesOf(event.dataTransfer);
            if (!files.length) return;
            event.preventDefault();
            void addImages(files);
          }}
        >
        {menu.menuShown && (
          <ComposerMenu
            id="chat-composer-menu"
            title={menu.title}
            groups={menu.groups}
            activeId={menu.activeId}
            onActive={menu.setActiveId}
            onPick={menu.pickRow}
            loading={menu.loading}
            empty={menu.empty}
            hint={menu.hint}
          />
        )}
        <ComposerInput
          ref={box}
          value={input}
          aria-haspopup="listbox"
          aria-expanded={menu.menuShown}
          aria-controls={menu.menuShown ? 'chat-composer-menu' : undefined}
          onChange={(event) => {
            setInput(event.target.value);
            setCaret(event.target.selectionStart);
            setHistory(NO_HISTORY);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onPaste={(event) => {
            // A pasted picture (a screenshot) becomes a chip; text pastes as usual.
            const files = imageFilesOf(event.clipboardData);
            if (!files.length || event.clipboardData.getData('text/plain')) return;
            event.preventDefault();
            void addImages(files);
          }}
          onKeyDown={(event) => {
            const composing = event.nativeEvent.isComposing || event.keyCode === 229;
            // The @ and / lists take their keys first (arrows, Enter, Tab, Esc, Backspace on an empty search).
            if (menu.onKeyDown(event)) return;
            if (event.key === 'Escape' && !composing && !event.shiftKey) {
              // No list open: Esc backs out of a /workflow's target, then cancels a card that waits, then (in the panel) stops a reply.
              if (run) {
                event.preventDefault();
                setRun(null);
                putInput('', 0);
                return;
              }
              if (!input.trim() && !busy && !elsewhere && waitingCard.current) {
                event.preventDefault();
                waitingCard.current.cancel();
                return;
              }
            }
            if (!composing && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
              const step = stepHistory(sent, history, event.key === 'ArrowUp' ? 'up' : 'down', input, event.currentTarget.selectionStart);
              if (step) {
                event.preventDefault();
                setInput(step.value);
                setHistory(step.state);
                // The caret goes to the end after React has put the text in.
                const target = event.currentTarget;
                requestAnimationFrame(() => target.setSelectionRange(step.value.length, step.value.length));
              }
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              // Nothing typed and a 실행 확인 card waiting: Enter answers it (실행).
              if (!run && !input.trim() && !images.length && waitingCard.current) return waitingCard.current.start();
              if (!ready && !run) {
                setShowModelHint(true);
                return;
              }
              send();
            }
          }}
          placeholder={run ? '@로 실행할 대상을 고르세요' : lastWaiting ? `${keyLabel('Enter')}로 실행 · ${keyLabel('Esc')}로 취소 (또는 메시지)` : ready ? '메시지' : '모델을 먼저 고르세요'}
        />
        </Box>
        {!ready && (input.trim() || showModelHint) && (
          <Text as="p" paddingX="tight" variant="caption" tone="muted">
            아래에서 AI 연결과 모델을 고르세요.{' '}
            <Text asChild underline><Link to="/p/$projectId/settings/connections" params={{ projectId }}>AI 연결 추가</Link></Text>
          </Text>
        )}
        <Inline gap="condensed">
          <Box minWidth={0} grow>
            <ModelPicker compact need={['chat']} value={model} onChange={(next) => void onModel(next)} />
          </Box>
          <PermissionModePicker compact value={mode} onChange={onMode} />
          <Inline marginLeft="auto" gap="tight">
            <ContextMeter usage={usage} />
            {(busy || elsewhere) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="secondary" aria-label="중지" aria-keyshortcuts="Escape" onClick={halt}>
                    <Icon icon={Square} size="xs" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>중지 ({keyLabel('Esc')})</TooltipContent>
              </Tooltip>
            )}
            {/* While the reply runs, a message goes in at its next step instead of waiting for it to end. */}
            <Button size="icon" aria-label={run ? '실행 확인' : busy || elsewhere ? '진행 중인 답에 끼워 보내기' : '보내기'} disabled={run ? false : (!input.trim() && !imageSupport.send) || !ready} onClick={send}>
              <ArrowUp />
            </Button>
          </Inline>
        </Inline>
      </Box>
    </Stack>
  );
}

const messageText = (message: UIMessage) => message.parts.map((part) => (part.type === 'text' ? part.text : '')).filter(Boolean).join('\n\n');

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
function SteerBubble({ text, waiting = false, onEdit, onCancel }: { text: string; waiting?: boolean; onEdit?: () => void; onCancel?: () => void }) {
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
function CompactionNotice({ summary }: { summary: string }) {
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

/** Changes sent from the CLI (by a person or an agent using it), waiting for a decision. */
function ExternalProposals({ projectId }: { projectId: string }) {
  const pending = useProposals(projectId, { status: 'pending' }).data ?? [];
  const [open, setOpen] = useState(true);
  if (!pending.length) return null;
  return (
    <Box maxHeight="pane" shrink={false} overflow="y" border="bottom" background="page">
      <Button variant="ghost" size="row" radius="none" paddingX="normal" paddingY="condensed" weight="semibold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon icon={ChevronRight} tone="muted" turn={open} />
        제안 {pending.length.toLocaleString()}개 대기 중
      </Button>
      {open && (
        <Box paddingX="normal" paddingBottom="normal">
          <ProposalList projectId={projectId} proposals={pending} title="제안" />
        </Box>
      )}
    </Box>
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
