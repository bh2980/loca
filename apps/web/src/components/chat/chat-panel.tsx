import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { ArrowUp, History, Plus, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { CONNECTION_KIND_INFO } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { chatDock } from '@/lib/chat-dock';
import { q } from '@/lib/queries';
import { useViewState, type ViewItem } from '@/lib/view-context';
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
      void queryClient.invalidateQueries({ queryKey: ['chat', projectId] });
      setSessionId(session.id);
    },
  });

  const current = sessions.data?.find((session) => session.id === sessionId);

  return (
    <aside className="flex h-full flex-col bg-sidebar" aria-label="프로젝트 에이전트">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start">
              <History className="text-muted-foreground" />
              <span className="truncate">{current?.title ?? '대화 없음'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">이 프로젝트의 대화</DropdownMenuLabel>
            {sessions.data?.map((session) => (
              <DropdownMenuItem key={session.id} onSelect={() => setSessionId(session.id)}>
                <span className="truncate">{session.title}</span>
              </DropdownMenuItem>
            ))}
            {!sessions.data?.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">아직 대화가 없습니다.</p>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => create.mutate()}>
              <Plus /> 새 대화
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="size-8" aria-label="새 대화" onClick={() => create.mutate()}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="채팅 닫기" onClick={() => chatDock.set(false)}>
          <X />
        </Button>
      </div>
      {current ? (
        <Conversation key={current.id} sessionId={current.id} profileId={current.profileId} profiles={chatProfiles} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <p>프로젝트의 원문·자료·워크플로를 읽고 인물 프로필이나 참조 문서, 프로필·워크플로를 제안하는 에이전트입니다.</p>
          <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus /> 새 대화 시작
          </Button>
        </div>
      )}
    </aside>
  );
}

function Conversation({ sessionId, profileId, profiles }: { sessionId: string; profileId: string | null; profiles: { id: string; name: string; model: string }[] }) {
  const queryClient = useQueryClient();
  const saved = useQuery(q.chatSession(sessionId));
  if (saved.isPending) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  return (
    <ChatBody
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

function ChatBody({ sessionId, initial, profileId, profiles, onProfile }: {
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

  const { messages, sendMessage, status, stop, error, addToolApprovalResponse } = useChat({
    id: sessionId,
    messages: initial,
    transport: new DefaultChatTransport({
      api: `/api/chat/${sessionId}/stream`,
      // The view is read at send time, so it always describes what is on screen right now.
      prepareSendMessagesRequest: ({ messages: all }) => ({ body: { messages: all, view: viewRef.current } }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const [input, setInput] = useState(() => sessionStorage.getItem(`tw.chat.draft.${sessionId}`) ?? '');
  useEffect(() => {
    sessionStorage.setItem(`tw.chat.draft.${sessionId}`, input);
  }, [sessionId, input]);
  const busy = status === 'submitted' || status === 'streaming';
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
              <button key={example} className="block w-full rounded-md border bg-background px-3 py-2 text-left text-foreground hover:bg-muted" onClick={() => setInput(example)}>
                {example}
              </button>
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
                        <ReactMarkdown>{part.text}</ReactMarkdown>
                      </div>
                    );
                  if (part.type.startsWith('tool-')) return <ToolPart key={index} part={part as never} onDecide={(id, approved) => addToolApprovalResponse({ id, approved })} />;
                  return null;
                })}
              </div>
            ),
          )}
          {status === 'submitted' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> 생각하는 중…
            </p>
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
                <button aria-label={`${item.label} 첨부 빼기`} className="text-muted-foreground hover:text-foreground" onClick={() => setExcluded((set) => new Set(set).add(`${item.kind}:${item.id}`))}>
                  <X className="size-3" />
                </button>
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
          placeholder={profileId ? '메시지 (Enter 전송, Shift+Enter 줄바꿈)' : '먼저 아래에서 채팅용 AI 프로필을 고르세요'}
          className="max-h-48 min-h-16 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-2">
          <Select value={profileId ?? undefined} onValueChange={(value) => void onProfile(value)}>
            <SelectTrigger size="sm" className="h-7 max-w-52 border-0 bg-muted text-xs shadow-none">
              <SelectValue placeholder={profiles.length ? 'AI 프로필' : '채팅 가능한 프로필 없음'} />
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
              <Button size="icon" variant="secondary" className="size-7" aria-label="중지" onClick={() => void stop()}>
                <Square className="size-3" />
              </Button>
            ) : (
              <Button size="icon" className="size-7" aria-label="보내기" disabled={!input.trim() || !profileId} onClick={send}>
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
