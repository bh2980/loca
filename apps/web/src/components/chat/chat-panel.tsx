import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { ArrowUp, ChevronRight, History, Plus, Square, Trash2, X } from 'lucide-react';
import { Markdown } from './markdown';
import { CONNECTION_KIND_INFO } from '@tw/shared';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { agentRequests, usePendingAgentRequest } from '@/lib/agent';
import { chatDock } from '@/lib/chat-dock';
import { chatFor, dropChat } from '@/lib/chat-store';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useViewState, type ViewItem } from '@/lib/view-context';
import { ProposalCard } from './proposal-card';
import { ToolPart } from './tool-part';

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
  const profiles = useQuery(q.profiles());
  const connections = useQuery(q.connections());
  const [sessionId, setSessionId] = useState<string | null>(() => readSession(projectId));

  const chatProfiles = useMemo(() => {
    const kinds = new Map(connections.data?.map((connection) => [connection.id, connection.kind]));
    return (profiles.data ?? []).filter((profile) => CONNECTION_KIND_INFO[kinds.get(profile.connectionId) ?? 'codex']?.capabilities.includes('chat'));
  }, [profiles.data, connections.data]);

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
    mutationFn: () => unwrap(client.projects[':projectId'].chat.$post({ param: { projectId }, json: { profileId: chatProfiles[0]?.id } })),
    onSuccess: (session) => {
      // The new conversation joins the list before it is picked: otherwise the stale list would
      // unpick it, and a waiting AI-button request would start yet another one, again and again.
      queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => (list ? [session as (typeof list)[number], ...list.filter((item) => item.id !== session.id)] : list));
      setSessionId(session.id);
      void queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
    },
  });

  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(client.chat[':sessionId'].$delete({ param: { sessionId: id } })),
    onSuccess: (_data, id) => {
      dropChat(id);
      if (id === sessionId) setSessionId(null);
      void queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
    },
  });

  const current = sessions.data?.find((session) => session.id === sessionId);
  // An AI button was pressed with no conversation yet: start one, the request waits for it.
  const pendingRequest = usePendingAgentRequest();
  // One conversation per wait: never a second while the first is being made or was just made.
  const starting = useRef(false);
  useEffect(() => {
    if (!pendingRequest) starting.current = false;
    if (!pendingRequest || !sessions.data || sessionId || create.isPending || starting.current) return;
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
      {current ? (
        <Conversation key={current.id} projectId={projectId} sessionId={current.id} profileId={current.profileId} profiles={chatProfiles} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>프로젝트의 원문·자료·워크플로를 읽고 인물 프로필이나 참조 문서, 프로필·워크플로를 제안하는 에이전트입니다.</p>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus /> 새 대화 시작
          </Button>
        </div>
      )}
    </aside>
  );
}

function Conversation({ projectId, sessionId, profileId, profiles }: { projectId: string; sessionId: string; profileId: string | null; profiles: { id: string; name: string; model: string }[] }) {
  const queryClient = useQueryClient();
  const saved = useQuery(q.chatSession(sessionId));
  if (saved.isPending) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  return (
    <ChatBody
      projectId={projectId}
      sessionId={sessionId}
      initial={(saved.data?.messages ?? []) as unknown as UIMessage[]}
      profileId={profileId}
      profiles={profiles}
      onProfile={async (next) => {
        await unwrap(client.chat[':sessionId'].$patch({ param: { sessionId }, json: { profileId: next } }));
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
      }}
    />
  );
}

function ChatBody({ projectId, sessionId, initial, profileId, profiles, onProfile }: {
  projectId: string;
  sessionId: string;
  initial: UIMessage[];
  profileId: string | null;
  profiles: { id: string; name: string; model: string }[];
  onProfile: (id: string) => Promise<void>;
}) {
  const view = useViewState();
  const location = useLocation();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const attached: ViewItem[] = Object.values(view.items).flat().filter((item) => !excluded.has(`${item.kind}:${item.id}`));
  const viewRef = useRef({ page: view.page, path: location.pathname, items: attached });
  viewRef.current = { page: view.page, path: location.pathname, items: attached };

  // The conversation outlives this panel: closing it mid-reply keeps the reply coming in.
  const stored = chatFor(sessionId, initial);
  stored.view.current = viewRef.current;
  const { messages, sendMessage, setMessages, status, stop, error, addToolApprovalResponse, addToolOutput } = useChat({ chat: stored.chat });
  // A reply this window is not streaming (sent before a reload, or from another window) is saved
  // by the server when it ends; the saved conversation then catches up here.
  useEffect(() => {
    if (status !== 'ready' || initial.length <= messages.length) return;
    if (messages.every((message, i) => initial[i]?.id === message.id)) setMessages(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const [input, setInput] = useState(() => sessionStorage.getItem(`tw.chat.draft.${sessionId}`) ?? '');
  useEffect(() => {
    sessionStorage.setItem(`tw.chat.draft.${sessionId}`, input);
  }, [sessionId, input]);
  const busy = status === 'submitted' || status === 'streaming';
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
      if (request.send && profileId) {
        pinned.current = true;
        void sendMessage({ text: request.text });
      } else setInput(request.text);
    }, 50);
    return () => clearTimeout(timer);
  }, [pendingRequest, busy, profileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || busy || !profileId) return;
    void sendMessage({ text });
    setInput('');
  };

  return (
    <>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
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
        <div className="space-y-4">
          {messages.map((message) =>
            message.role === 'user' ? (
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
                  if (part.type.startsWith('tool-')) return <ToolPart key={index} part={part as never} proposal={proposalById.get(((part as { output?: { proposalId?: string } }).output ?? {}).proposalId ?? '') as never} stale={message.id !== messages.at(-1)?.id} onDecide={(id, approved) => addToolApprovalResponse({ id, approved })} onOutput={(toolCallId, output) => void addToolOutput({ tool: part.type.slice(5) as never, toolCallId, output: output as never })} />;
                  return null;
                })}
              </div>
            ),
          )}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {status === 'submitted' ? '생각하는 중…' : '작업 중… (도구로 자료를 읽거나 답을 쓰고 있습니다)'}
            </p>
          )}
          {!busy && !error && lastMessage?.role === 'user' && (
            <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <Spinner className="size-3.5" /> 답을 기다리는 중입니다. 새로고침 전에 보낸 질문이면 답이 끝나는 대로 여기에 나타납니다.
            </p>
          )}
          {stalled && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{finishReason === 'length' ? '출력 한도(모델 프로필의 최대 출력)에 걸려 멈췄습니다.' : '에이전트가 결과를 말하지 않고 멈췄습니다.'}</span>
              <Button variant="outline" className="ml-auto" disabled={!profileId} onClick={() => void sendMessage({ text: '계속해줘' })}>
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
              send();
            }
          }}
          placeholder={profileId ? '메시지 (Enter 전송, Shift+Enter 줄바꿈)' : '먼저 아래에서 채팅용 모델 프로필을 고르세요'}
          className="max-h-48 min-h-16 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-2">
          <Select value={profileId ?? undefined} onValueChange={(value) => void onProfile(value)}>
            <SelectTrigger size="sm" className="h-7 max-w-52 border-0 bg-muted text-xs shadow-none">
              <SelectValue placeholder={profiles.length ? '모델 프로필' : '채팅 가능한 프로필 없음'} />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name} <span className="text-muted-foreground">· {profile.model}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            {busy ? (
              <Button size="icon" variant="secondary" aria-label="중지" onClick={() => void stop()}>
                <Square className="size-3" />
              </Button>
            ) : (
              <Button size="icon" aria-label="보내기" disabled={!input.trim() || !profileId} onClick={send}>
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
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
