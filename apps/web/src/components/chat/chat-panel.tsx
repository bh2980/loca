import { Fragment, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { ArrowUp, Check, ChevronRight, History, Plus, Square, Trash2, X } from 'lucide-react';
import { Markdown } from './markdown';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Spinner, Textarea } from '@loca/ui';
import { Elapsed } from '@/components/job-progress';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { agentRequests, usePendingAgentRequest } from '@/lib/agent';
import { chatDock } from '@/lib/chat-dock';
import { chatFor, dropChat } from '@/lib/chat-store';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useViewState, type ViewItem } from '@/lib/view-context';
import { ProposalCard } from './proposal-card';
import { PermissionModePicker } from './permission-mode';
import type { PermissionMode } from '@tw/shared';
import { ToolPart } from './tool-part';

/** A conversation's model use in the session list: 950, 12.3k, 10.3M tokens. */
const compactTokens = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const SESSION_KEY = (projectId: string) => `tw.chat.session.${projectId}`;
const readSession = (projectId: string) => {
  try {
    return localStorage.getItem(SESSION_KEY(projectId));
  } catch {
    return null;
  }
};

/** Global agent panel. Lives beside every page; switching pages or sessions never touches page history. */
export function ChatPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const sessions = useQuery(q.chatSessions(projectId));
  const [sessionId, setSessionId] = useState<string | null>(() => readSession(projectId));

  // Fetch the conversation as soon as its id is known (from localStorage), not only after the
  // sessions list resolves: waiting for the list made the panel flash its spinner on every open.
  useEffect(() => {
    if (sessionId) void queryClient.prefetchQuery(q.chatSession(sessionId));
  }, [queryClient, sessionId]);

  useEffect(() => {
    if (sessions.data && sessionId && !sessions.data.some((session) => session.id === sessionId)) setSessionId(null);
    if (sessions.data && !sessionId && sessions.data[0]) setSessionId(sessions.data[0].id);
  }, [sessions.data, sessionId]);
  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(SESSION_KEY(projectId), sessionId);
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
  const [menuOpen, setMenuOpen] = useState(false);
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
  // One conversation per wait: never a second while the first is being made or was just made.
  const starting = useRef(false);
  useEffect(() => {
    if (!pendingRequest) starting.current = false;
    // With conversations listed but none picked yet (a fresh browser), the effect above picks the
    // latest in this same render: starting another here would leave an empty extra one each time.
    if (!pendingRequest || !sessions.data || sessions.data.length > 0 || sessionId || create.isPending || starting.current) return;
    starting.current = true;
    create.mutate();
  }, [pendingRequest, sessions.data, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="flex h-full flex-col bg-sidebar" aria-label="프로젝트 에이전트">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="min-w-0 flex-1 justify-start">
              <History className="text-muted-foreground" />
              <span className="truncate">{current?.title ?? '대화 없음'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">이 프로젝트의 대화</DropdownMenuLabel>
            {sessions.data?.map((session) => (
              <DropdownMenuItem key={session.id} onSelect={() => setSessionId(session.id)} className={cn('group/session pr-1', session.id === sessionId && 'font-medium')}>
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                {session.calls > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={`모델 요청 ${session.calls}건 · 토큰 ${session.tokens.toLocaleString()}`}>
                    {session.calls}건 · {compactTokens(session.tokens)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground opacity-0 group-hover/session:opacity-100 group-focus/session:opacity-100 hover:text-destructive"
                  aria-label={`${session.title} 삭제`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    setDeleting({ id: session.id, title: session.title });
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Trash2 />
                </Button>
              </DropdownMenuItem>
            ))}
            {!sessions.data?.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">아직 대화가 없습니다.</p>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => create.mutate()}>
              <Plus /> 새 대화
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      {/* A connection picked without a model yet (one with no default) still counts, so the picker asks for the model. */}
      {current ? (
        <Conversation key={current.id} projectId={projectId} sessionId={current.id} mode={current.permissionMode} model={current.connectionId ? { connectionId: current.connectionId, model: current.model ?? '', ...(current.effort && { effort: current.effort }) } : null} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>프로젝트의 원문·자료·워크플로를 읽고 인물 프로필이나 참조 문서, 워크플로를 제안하는 에이전트입니다.</p>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus /> 새 대화 시작
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
      pending={saved.data?.pendingSteers ?? []}
      model={model}
      mode={mode}
      onMode={(next) => {
        queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => list?.map((item) => (item.id === sessionId ? { ...item, permissionMode: next } : item)));
        void unwrap(client.chat[':sessionId'].$patch({ param: { sessionId }, json: { permissionMode: next } }));
      }}
      onModel={async (next) => {
        // Shown at once; a choice without a model yet (a connection with no default) waits for one.
        queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => list?.map((item) => (item.id === sessionId ? { ...item, connectionId: next.connectionId, model: next.model || null, effort: next.effort ?? null } : item)));
        if (!next.model) return;
        await unwrap(client.chat[':sessionId'].$patch({ param: { sessionId }, json: { model: next } }));
      }}
    />
  );
}

function ChatBody({ projectId, sessionId, initial, turn, pending, model, onModel, mode, onMode }: {
  projectId: string;
  sessionId: string;
  initial: UIMessage[];
  turn: Turn | null;
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
  const attached: ViewItem[] = Object.values(view.items).flat().filter((item) => !excluded.has(`${item.kind}:${item.id}`));
  const viewRef = useRef({ page: view.page, path: location.pathname, items: attached });
  viewRef.current = { page: view.page, path: location.pathname, items: attached };

  // The conversation outlives this panel: closing it mid-reply keeps the reply coming in.
  const stored = chatFor(sessionId, initial);
  stored.view.current = viewRef.current;
  const { messages, sendMessage, setMessages, regenerate, status, stop, error, addToolApprovalResponse, addToolOutput } = useChat({ chat: stored.chat });
  // The turn runs on the server, not in this request: stopping ends both.
  const halt = () => {
    void stop();
    // Said at once here; the server saves the same mark on the conversation (chat-turns markStopped).
    setMessages((current) => {
      const last = current.at(-1);
      return last ? [...current.slice(0, -1), { ...last, metadata: { ...((last.metadata as object | undefined) ?? {}), stopped: true } }] : current;
    });
    setLater([]);
    void unwrap(client.chat[':sessionId'].stop.$post({ param: { sessionId } })).then(({ queued: back }) => {
      // Messages the turn had not taken yet go back to the input box.
      const mine = [...later, ...back.filter((text) => !later.includes(text))];
      setQueued([]);
      if (mine.length) setInput((current) => [current.trim(), ...mine].filter(Boolean).join('\n\n'));
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

  const [input, setInput] = useState(() => sessionStorage.getItem(`tw.chat.draft.${sessionId}`) ?? '');
  const [showModelHint, setShowModelHint] = useState(false);
  // Sent while the reply was running (#44): waiting for the turn to take them at its next step.
  // Those still on the server (sent before a reload, or a turn a restart cut off) go with the next one.
  const [queued, setQueued] = useState<string[]>(pending);
  // Sent too late for the running turn to take: they go as the next message once it ends.
  const [later, setLater] = useState<string[]>([]);
  useEffect(() => {
    sessionStorage.setItem(`tw.chat.draft.${sessionId}`, input);
  }, [sessionId, input]);
  const busy = status === 'submitted' || status === 'streaming';
  // A turn this window is not streaming (sent before a reload) that is still going on the server.
  const elsewhere = !busy && Boolean(turn?.startedAt) && messages.at(-1)?.role === 'user';
  // pi chats store change requests as proposals; their cards are decided through the API.
  const proposals = useQuery(q.proposals(projectId, sessionId));
  const proposalById = new Map(proposals.data?.map((proposal) => [proposal.id, proposal]));
  // A finished turn whose last part is a tool call said nothing about the result: say so and offer to continue.
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
    const text = input.trim();
    if (!text || !ready) return;
    setInput('');
    if (!busy && !elsewhere) {
      void sendMessage({ text });
      return;
    }
    pinned.current = true;
    setQueued((list) => [...list, text]);
    void client.chat[':sessionId'].steer.$post({ param: { sessionId }, json: { text } }).then((response) => {
      if (response.ok) return;
      setQueued((list) => list.filter((item) => item !== text));
      setLater((list) => [...list, text]);
    });
  };
  // A queued message shows in the reply once the turn has handed it to the model.
  useEffect(() => {
    if (!queued.length) return;
    const delivered = messages.flatMap((message) => message.parts.flatMap((part) => (part.type === 'data-steer' ? [(part as { data: { text: string } }).data.text] : [])));
    const left = queued.filter((text) => !delivered.includes(text));
    if (left.length !== queued.length) setQueued(left);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  // Too late for the last turn: sent as the next message as soon as it has ended.
  useEffect(() => {
    if (!later.length || busy || elsewhere || !ready) return;
    const text = later.join('\n\n');
    setLater([]);
    void sendMessage({ text });
  }, [later, busy, elsewhere, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {!messages.length && (
          <div className="space-y-2 pt-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">무엇을 도와드릴까요?</p>
            {['대본을 끝까지 읽고 주요 인물 프로필을 만들어줘', '지금 진행 상황을 요약해줘', '검수를 더 엄격하게 하는 워크플로를 제안해줘'].map((example) => (
              <Button key={example} variant="outline" size="row" className="px-3 py-2" onClick={() => setInput(example)}>
                {example}
              </Button>
            ))}
          </div>
        )}
        <div className="space-y-5">
          {messages.map((message) => {
            const { stopped, interrupted } = (message.metadata as { stopped?: boolean; interrupted?: boolean } | undefined) ?? {};
            const view =
            message.role === 'user' && (message.metadata as { kind?: string } | undefined)?.kind === 'decisions' ? (
              <DecisionNotice key={message.id} text={message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')} />
            ) : message.role === 'user' ? (
              <div key={message.id} className="ml-8 rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs ring-1 ring-border">
                {message.parts.map((part, index) => (part.type === 'text' ? <span key={index}>{part.text}</span> : null))}
              </div>
            ) : (
              <div key={message.id} className="space-y-2 text-sm">
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
                  if (part.type.startsWith('tool-')) return <ToolPart key={index} part={part as never} proposal={proposalById.get(((part as { output?: { proposalId?: string } }).output ?? {}).proposalId ?? '') as never} stale={message.id !== messages.at(-1)?.id} onDecide={(id, approved) => addToolApprovalResponse({ id, approved })} onOutput={(toolCallId, output) => void addToolOutput({ tool: part.type.slice(5) as never, toolCallId, output: output as never })} />;
                  return null;
                })}
              </div>
            );
            if (!stopped && !interrupted) return view;
            return (
              <Fragment key={message.id}>
                {view}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                  <Square className="size-3" /> {stopped ? '중지됨' : '끊김 · 다음 메시지가 먼저 시작됐습니다'}
                </p>
              </Fragment>
            );
          })}
          {[...queued, ...later].map((text, index) => (
            <SteerBubble key={`queued-${index}`} text={text} waiting />
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {status === 'submitted' ? '생각하는 중…' : '작업 중… (도구로 자료를 읽거나 답을 쓰고 있습니다)'}
            </p>
          )}
          {!busy && !error && lastMessage?.role === 'user' && <TurnState turn={turn} onStop={halt} onRetry={() => void regenerate()} canRetry={ready} />}
          {stalled && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{finishReason === 'length' ? '출력 한도(AI 연결 설정의 최대 출력 토큰)에 걸려 멈췄습니다.' : '에이전트가 결과를 말하지 않고 멈췄습니다.'}</span>
              <Button variant="outline" className="ml-auto" disabled={!ready} onClick={() => void sendMessage({ text: '계속해줘' })}>
                계속
              </Button>
            </div>
          )}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error.message}</p>}
        </div>
      </div>

      <div className="shrink-0 border-t bg-background p-2">
        {attached.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1" aria-label="첨부된 화면 정보">
            {attached.map((item) => (
              <span key={`${item.kind}:${item.id}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                <span className="text-muted-foreground">{item.kind}</span>
                <span className="truncate">{item.label}</span>
                <Button variant="ghost" size="icon-xs" aria-label={`${item.label} 첨부 빼기`} className="text-muted-foreground" onClick={() => setExcluded((set) => new Set(set).add(`${item.kind}:${item.id}`))}>
                  <X />
                </Button>
              </span>
            ))}
          </div>
        )}
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!ready) {
                setShowModelHint(true);
                return;
              }
              send();
            }
          }}
          placeholder={ready ? (busy || elsewhere ? '답하는 중에도 보낼 수 있습니다 (다음 단계에 전달)' : '메시지 (Enter 전송, Shift+Enter 줄바꿈)') : '먼저 아래에서 채팅할 AI 연결과 모델을 고르세요'}
          className="max-h-48 min-h-16 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        {!ready && (input.trim() || showModelHint) && (
          <p className="px-1 text-xs text-muted-foreground">
            보내려면 아래에서 채팅할 AI 연결과 모델을 고르세요. 연결이 없으면{' '}
            <Link to="/p/$projectId/ai/connections" params={{ projectId }} className="underline">AI 연결 화면</Link>
            에서 추가합니다.
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ModelPicker compact need={['chat']} value={model} onChange={(next) => void onModel(next)} />
          </div>
          <PermissionModePicker compact value={mode} onChange={onMode} />
          <div className="ml-auto flex items-center gap-1">
            {(busy || elsewhere) && (
              <Button size="icon" variant="secondary" aria-label="중지" onClick={halt}>
                <Square className="size-3" />
              </Button>
            )}
            {/* While the reply runs, a message goes in at its next step instead of waiting for it to end. */}
            <Button size="icon" aria-label={busy || elsewhere ? '진행 중인 답에 끼워 보내기' : '보내기'} title={busy || elsewhere ? '지금 답에 끼워 보내기 (다음 단계에 전달)' : undefined} disabled={!input.trim() || !ready} onClick={send}>
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** A message sent while a reply was running: where the reply took it, or still waiting for its next step. */
function SteerBubble({ text, waiting = false }: { text: string; waiting?: boolean }) {
  return (
    <div className={cn('ml-8 rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs ring-1 ring-border', waiting && 'text-muted-foreground')}>
      <span className="mb-0.5 block text-xs text-muted-foreground">{waiting ? '전달 대기 중 · 답의 다음 단계에 들어갑니다' : '진행 중에 보냄'}</span>
      {text}
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
      <Button variant="ghost" size="row" className="rounded-none px-3 py-2 font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
        CLI에서 온 제안 {pending.length}개
      </Button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {pending.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal as never} />
          ))}
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
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        <span className="min-w-0 flex-1">
          {step} · <Elapsed since={new Date(turn.startedAt)} />
          <span className="block text-xs">새로고침 전에 보낸 질문입니다. 답이 끝나면 여기에 나타납니다.</span>
        </span>
        <Button variant="outline" onClick={onStop}>
          중단
        </Button>
      </div>
    );
  }
  const reason = turn?.call?.status === 'failed' ? turn.call.error : null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
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
