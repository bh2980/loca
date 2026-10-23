import { Fragment, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { ArrowUp, Check, ChevronRight, ImageOff, Paperclip, Pencil, Plus, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from './markdown';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, SectionHeading, Spinner, Textarea, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { CopyButton } from '@/components/copy-button';
import { Elapsed } from '@/components/job-progress';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { agentRequests, usePendingAgentRequest } from '@/lib/agent';
import { chatDock } from '@/lib/chat-dock';
import { NO_HISTORY, sentTexts, stepHistory, type HistoryState } from '@/lib/chat-input-history';
import { mergeIntoDraft, removeOnce } from '@/lib/chat-queue';
import { insertAt } from '@/lib/chat-triggers';
import { loadCards, saveCards, type RunCard } from '@/lib/chat-run';
import { chatFor, dropChat } from '@/lib/chat-store';
import { keyLabel } from '@/lib/keys';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useViewState, type ViewItem } from '@/lib/view-context';
import { AttachChip } from './attach-chip';
import { ComposerMenu } from './composer-menu';
import { ConversationMenu } from './conversation-menu';
import { RunCardView, type RunCardControls } from './run-card';
import { useComposerMenu, type RunMode } from './use-composer-menu';
import { useUndo } from './proposal-card';
import { ProposalList } from './proposal-list';
import { PermissionModePicker } from './permission-mode';
import { CHAT_IMAGES_MAX, compactionMarker, imageDecision, IMAGE_UNSUPPORTED_NOTE, messageChips, type ChatChip, type PermissionMode } from '@tw/shared';
import { imageFilesOf, prepareImage, type PendingImage } from '@/lib/chat-image-file';
import { ContextMeter, type ChatUsage } from './context-meter';
import { ToolPart } from './tool-part';

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
    <aside className="flex h-full flex-col bg-sidebar" aria-label="프로젝트 에이전트" data-own-keys>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <ConversationMenu projectId={projectId} sessions={sessions.data} sessionId={sessionId} currentTitle={current?.title} onPick={setSessionId} onDelete={setDeleting} onCreate={() => create.mutate()} />
        <Button variant="ghost" size="icon" aria-label="새 대화" onClick={() => create.mutate()}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" aria-label="채팅 닫기" onClick={() => chatDock.set(false)}>
          <X />
        </Button>
      </div>
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus /> 새 대화
          </Button>
        </div>
      )}
    </aside>
  );
}

function Conversation({ projectId, sessionId, model, mode }: { projectId: string; sessionId: string; model: ModelValue | null; mode: PermissionMode }) {
  const queryClient = useQueryClient();
  const saved = useQuery(q.chatSession(sessionId));
  if (saved.isPending) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
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
  const ready = Boolean(model?.connectionId && model.model);
  const view = useViewState();
  const location = useLocation();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Chips from the page (reported by useReportView) and ones the person picked with @ for the next message
  // (these stay on the message they were sent with).
  const [picked, setPicked] = useState<ChatChip[]>([]);
  const reported: ViewItem[] = Object.values(view.items).flat();
  const onPage: ViewItem[] = reported.filter((item) => !excluded.has(`${item.kind}:${item.id}`) && !picked.some((other) => other.kind === item.kind && other.id === item.id));
  const attached: ViewItem[] = [...onPage, ...picked.map((chip): ViewItem => ({ kind: chip.kind, id: chip.id, label: chip.label, ...(chip.detail && { detail: chip.detail }), attached: true }))];
  const viewRef = useRef({ page: view.page, path: location.pathname, items: attached });
  viewRef.current = { page: view.page, path: location.pathname, items: attached };
  // What the message being sent carries: held for a moment after sending so the chips cleared by it still reach the request.
  const frozenView = useRef<typeof viewRef.current | null>(null);

  // The conversation outlives this panel: closing it mid-reply keeps the reply coming in.
  const stored = chatFor(sessionId, initial);
  stored.view.current = frozenView.current ?? viewRef.current;
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
  // A /workflow waiting for its target, the `{대상}` slot of a saved prompt, and the 실행 확인 cards of this conversation.
  const [run, setRun] = useState<RunMode | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [cards, setCards] = useState<RunCard[]>(() => loadCards(sessionId));
  useEffect(() => saveCards(sessionId, cards), [sessionId, cards]);
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
    if (!run) return;
    if (!run.chips.length) return putInput('@', 1);
    setCards((list) => [...list, { id: crypto.randomUUID(), workflowId: run.command.id, workflowName: run.command.name, input: run.command.input, chips: run.chips, after: messages.length }]);
    setRun(null);
    putInput('', 0);
  };
  // ↑/↓ in the box walks what was sent in this conversation; any edit leaves the walk.
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);
  const sent = sentTexts(messages);
  useEffect(() => {
    sessionStorage.setItem(`tw.chat.draft.${sessionId}`, input);
  }, [sessionId, input]);
  const busy = status === 'submitted' || status === 'streaming';
  // A turn this window is not streaming (sent before a reload) that is still going on the server.
  const elsewhere = !busy && Boolean(turn?.startedAt) && messages.at(-1)?.role === 'user';
  // CLI chats store change requests as proposals; their cards are decided through the API.
  const proposals = useQuery(q.proposals(projectId, sessionId));
  const proposalById = new Map(proposals.data?.map((proposal) => [proposal.id, proposal]));
  const [undoingReply, setUndoingReply] = useState(false);
  const [replyUndoIds, setReplyUndoIds] = useState<string[]>([]);
  const undoReply = useUndo(projectId, sessionId);
  // A finished turn whose last part is a tool call said nothing about the result: say so and offer to continue.
  const marker = compactionMarker(compaction, messages.length);
  const lastMessage = messages.at(-1);
  const lastPart = lastMessage?.parts.filter((part) => part.type !== 'step-start').at(-1);
  const finishReason = (lastMessage?.metadata as { finishReason?: string } | undefined)?.finishReason;
  const stalled = !busy && !error && lastMessage?.role === 'assistant' && (finishReason === 'length' || Boolean(lastPart?.type.startsWith('tool-') && (lastPart as { state?: string }).state === 'output-available'));

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
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
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
      stored.view.current = viewRef.current;
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

  // 실행 확인 cards sit where they were made (after that many messages); the newest waiting one answers the keyboard.
  const lastWaiting = [...cards].reverse().find((card) => !card.runId && !card.cancelled)?.id;
  const cardsAt = (n: number) =>
    cards
      .filter((card) => Math.min(card.after, messages.length) === n)
      .map((card) => (
        <RunCardView
          key={card.id}
          projectId={projectId}
          card={card}
          controls={card.id === lastWaiting ? waitingCard : undefined}
          onChange={(patch) => setCards((list) => list.map((item) => (item.id === card.id ? { ...item, ...patch } : item)))}
          onAnswered={() => box.current?.focus()}
        />
      ));

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        // Esc stops the running reply from anywhere in the panel body (not from a popup opened inside it).
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || !(busy || elsewhere)) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        halt();
      }}
    >
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {!messages.length && !cards.length && (
          <div className="space-y-2 pt-6 text-sm text-muted-foreground">
            <SectionHeading>무엇을 도와드릴까요?</SectionHeading>
          </div>
        )}
        <div className="space-y-5">
          {cardsAt(0)}
          {messages.map((message, messageIndex) => {
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
              <div key={message.id} className="group/message ml-8">
                <div className="rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs ring-1 ring-border">
                  {message.parts.map((part, index) => (part.type === 'text' ? <span key={index}>{part.text}</span> : null))}
                  <SentImages parts={message.parts} />
                  <SentChips projectId={projectId} chips={messageChips(message)} />
                </div>
                <MessageActions text={messageText(message)} chips={messageChips(message)} onReuse={reuse} />
              </div>
            ) : (
              <div key={message.id} className="group/message space-y-2 text-sm">
                {message.parts.map((part, index) => {
                  if (part.type === 'text')
                    return (
                      <div key={index} className="prose-chat">
                        <Markdown>{part.text}</Markdown>
                      </div>
                    );
                  if (part.type === 'data-steer') {
                    const data = (part as { data: { text: string; kind?: string } }).data;
                    return data.kind === 'decisions' ? <DecisionNotice key={index} text={data.text} /> : <SteerBubble key={index} text={data.text} />;
                  }
                  if (part.type.startsWith('tool-')) return <ToolPart key={index} part={part as never} proposal={proposalById.get(((part as { output?: { proposalId?: string } }).output ?? {}).proposalId ?? '')} stale={message.id !== messages.at(-1)?.id} onDecide={(id, approved) => addToolApprovalResponse({ id, approved })} onOutput={(toolCallId, output) => void addToolOutput({ tool: part.type.slice(5) as never, toolCallId, output: output as never })} />;
                  return null;
                })}
                {!(busy && message.id === lastMessage?.id) && <MessageActions text={messageText(message)} />}
                {undoable.length > 0 && <Button variant="outline" onClick={() => { setReplyUndoIds(undoable); setUndoingReply(true); }}>변경 되돌리기 ({undoable.length})</Button>}
              </div>
            );
            const summarized = marker?.index === messageIndex ? <CompactionNotice summary={marker.summary} /> : null;
            if (!stopped && !interrupted) return <Fragment key={message.id}>{summarized}{view}{cardsAt(messageIndex + 1)}</Fragment>;
            return (
              <Fragment key={message.id}>
                {summarized}
                {view}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                  <Square className="size-3" /> {stopped ? '중지됨' : '끊김 · 다음 메시지가 먼저 시작됐습니다'}
                </p>
                {cardsAt(messageIndex + 1)}
              </Fragment>
            );
          })}
          {queued.map((text, index) => (
            <SteerBubble key={`queued-${index}`} text={text} waiting onEdit={() => void takeBack(text, true)} onCancel={() => void takeBack(text, false)} />
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {status === 'submitted' ? '생각하는 중…' : '작업 중…'}
            </p>
          )}
          {!busy && !error && lastMessage?.role === 'user' && <TurnState turn={turn} onStop={halt} onRetry={() => void regenerate()} canRetry={ready} />}
          {stalled && (
            <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">{finishReason === 'length' ? '모델의 출력 한도에 걸려 멈췄습니다.' : '에이전트가 결과를 말하지 않고 멈췄습니다.'}</span>
            </div>
          )}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error.message}</p>}
        </div>
      </div>

      <AlertDialog open={undoingReply} onOpenChange={setUndoingReply}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>변경을 되돌릴까요?</AlertDialogTitle><AlertDialogDescription>이 답에서 반영된 변경 {replyUndoIds.length}개를 되돌리는 제안을 적용합니다. 그사이 바뀐 대사는 건너뜁니다.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={undoReply.isPending} onClick={() => { undoReply.mutate(replyUndoIds); setUndoingReply(false); }}>되돌리기</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="shrink-0 border-t bg-background p-2">
        {run && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1" aria-label="실행 대상">
            <span className="text-xs font-medium">/{run.command.name}</span>
            {run.chips.map((chip) => (
              <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} onRemove={() => { setRun({ ...run, chips: run.chips.filter((other) => !(other.kind === chip.kind && other.id === chip.id)) }); box.current?.focus(); }} />
            ))}
            <span className="text-xs text-muted-foreground">{run.chips.length ? `${keyLabel('Enter')} 실행 확인 · @ 더 고르기 · ${keyLabel('Esc')} 취소` : '@로 실행할 대상을 고르세요'}</span>
            <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label="실행 그만두기" onClick={() => { setRun(null); putInput('', 0); }}>
              <X />
            </Button>
          </div>
        )}
        {attached.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1" aria-label="첨부된 화면 정보">
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
          </div>
        )}
        {images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5" aria-label="붙인 이미지">
            {images.map((image) => (
              <span key={image.id} className={cn('relative inline-block rounded-md ring-1 ring-border', imageSupport.support === 'no' && 'opacity-50')}>
                <img src={image.url} alt={image.name} className="size-12 rounded-md object-cover" />
                <Button variant="secondary" size="inline" aria-label={`${image.name} 빼기`} className="absolute -top-1.5 -right-1.5 rounded-full p-0.5" onClick={() => setImages((list) => list.filter((other) => other.id !== image.id))}>
                  <X />
                </Button>
              </span>
            ))}
            {imageSupport.support === 'no' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
                <ImageOff className="size-3.5" /> {IMAGE_UNSUPPORTED_NOTE}
              </span>
            )}
          </div>
        )}
        <div
          className={cn('relative', dragging && 'rounded-md ring-2 ring-ring')}
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
        <Textarea
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
          className="max-h-48 min-h-16 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        </div>
        {!ready && (input.trim() || showModelHint) && (
          <p className="px-1 text-xs text-muted-foreground">
            아래에서 AI 연결과 모델을 고르세요.{' '}
            <Link to="/p/$projectId/settings/connections" params={{ projectId }} className="underline">AI 연결 추가</Link>
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ModelPicker compact need={['chat']} value={model} onChange={(next) => void onModel(next)} />
          </div>
          <PermissionModePicker compact value={mode} onChange={onMode} />
          <div className="ml-auto flex items-center gap-1">
            <ContextMeter usage={usage} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="첨부 (@)"
                  onClick={() => {
                    const target = box.current;
                    const next = insertAt(input, target?.selectionStart ?? input.length);
                    menu.reopen();
                    putInput(next.value, next.caret);
                  }}
                >
                  <Paperclip />
                </Button>
              </TooltipTrigger>
              <TooltipContent>첨부 (@)</TooltipContent>
            </Tooltip>
            {(busy || elsewhere) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="secondary" aria-label="중지" aria-keyshortcuts="Escape" onClick={halt}>
                    <Square className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>중지 ({keyLabel('Esc')})</TooltipContent>
              </Tooltip>
            )}
            {/* While the reply runs, a message goes in at its next step instead of waiting for it to end. */}
            <Button size="icon" aria-label={run ? '실행 확인' : busy || elsewhere ? '진행 중인 답에 끼워 보내기' : '보내기'} disabled={run ? false : (!input.trim() && !imageSupport.send) || !ready} onClick={send}>
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const messageText = (message: UIMessage) => message.parts.map((part) => (part.type === 'text' ? part.text : '')).filter(Boolean).join('\n\n');

/** Copy (and, for what the person wrote, reuse as a new draft); shown on hover or keyboard focus. */
function MessageActions({ text, chips = [], onReuse }: { text: string; chips?: ChatChip[]; onReuse?: (text: string, chips: ChatChip[]) => void }) {
  if (!text.trim()) return null;
  return (
    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
      <CopyButton value={text} label="메시지 복사" />
      {onReuse && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="수정해서 보내기" onClick={() => onReuse(text, chips)}>
              <Pencil />
            </Button>
          </TooltipTrigger>
          <TooltipContent>수정해서 보내기</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** A message sent while a reply was running: where the reply took it, or still waiting for its next step. */
function SteerBubble({ text, waiting = false, onEdit, onCancel }: { text: string; waiting?: boolean; onEdit?: () => void; onCancel?: () => void }) {
  return (
    <div className={cn('ml-8 rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs ring-1 ring-border', waiting && 'text-muted-foreground')}>
      <span className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="flex-1">{waiting ? '전달 대기 중' : '진행 중에 보냄'}</span>
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
      </span>
      {text}
    </div>
  );
}

/** What a message pointed at with @, kept with it; each opens its page. */
function SentChips({ projectId, chips }: { projectId: string; chips: ChatChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" aria-label="첨부한 항목">
      {chips.map((chip) => <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} />)}
    </div>
  );
}

/** The pictures a message carried, from the stored record. */
function SentImages({ parts }: { parts: UIMessage['parts'] }) {
  const files = parts.filter((part) => part.type === 'file' && part.mediaType.startsWith('image/')) as { url: string; filename?: string }[];
  if (!files.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {files.map((file, index) => (
        <img key={index} src={file.url} alt={file.filename ?? '붙인 이미지'} className="max-h-40 max-w-full rounded-md ring-1 ring-border" />
      ))}
    </div>
  );
}

/** Where the server summarized the conversation's start (chat-compaction.ts); the summary is what the model reads in its place. */
function CompactionNotice({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs text-muted-foreground" role="status">
      <Button variant="ghost" size="row" className="gap-1.5 px-0 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        앞 대화를 요약했습니다
      </Button>
      {open && <p className="mt-1 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">{summary}</p>}
    </div>
  );
}

/** How proposals were decided, as told to the agent (it carries on from there). */
function DecisionNotice({ text }: { text: string }) {
  const lines = text.split('\n').filter((line) => line.startsWith('- '));
  const count = (word: string) => lines.filter((line) => line.includes(word)).length;
  const summary = [['수락되어 반영됨', '반영'], ['수락되어 후보로 추가됨', '후보 추가'], ['거절함', '거절'], ['실패함', '실패']].flatMap(([word, label]) => (count(word) ? [`${label} ${count(word)}`] : [])).join(' · ');
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" title={text}>
      <Check className="size-3.5" /> 제안 결과를 에이전트에게 알렸습니다{summary && ` (${summary})`}
    </p>
  );
}

/** Changes sent from the CLI (by a person or an agent using it), waiting for a decision. */
function ExternalProposals({ projectId }: { projectId: string }) {
  const proposals = useQuery(q.proposals(projectId));
  const pending = (proposals.data ?? []).filter((proposal) => proposal.status === 'pending');
  const [open, setOpen] = useState(true);
  if (!pending.length) return null;
  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-b bg-background">
      <Button variant="ghost" size="row" className="rounded-none px-3 py-2 font-semibold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
        제안 {pending.length.toLocaleString()}개 대기 중
      </Button>
      {open && (
        <div className="px-3 pb-3">
          <ProposalList projectId={projectId} proposals={pending} title="제안" />
        </div>
      )}
    </div>
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
      <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        <span className="min-w-0 flex-1">
          {step} · <Elapsed since={new Date(turn.startedAt)} />
        </span>
        <Button variant="outline" onClick={onStop}>
          중단
        </Button>
      </div>
    );
  }
  const reason = turn?.call?.status === 'failed' ? turn.call.error : null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-muted-foreground">
        답을 받지 못했습니다.
        <span className="block text-xs">{reason ?? '답이 끝나기 전에 끊겼습니다.'}</span>
      </span>
      <Button variant="outline" disabled={!canRetry} onClick={onRetry}>
        다시 보내기
      </Button>
    </div>
  );
}
