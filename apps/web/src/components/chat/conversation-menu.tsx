import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, History, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Input } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export type SessionRow = { id: string; title: string; calls: number; tokens: number };

/** A conversation's model use in the session list: 950, 12.3k, 10.3M tokens. */
const compactTokens = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Waits for typing to pause before the value is used (the search runs on the server). */
export function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The conversation list: pick, search by title and message text, rename in place, delete, start a new one. */
export function ConversationMenu({ projectId, sessions, sessionId, currentTitle, onPick, onDelete, onCreate }: {
  projectId: string;
  sessions: SessionRow[] | undefined;
  sessionId: string | null;
  currentTitle: string | undefined;
  onPick: (id: string) => void;
  onDelete: (session: { id: string; title: string }) => void;
  onCreate: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const searching = search.trim().length > 0;
  const hits = useQuery({ ...q.chatSearch(projectId, term), enabled: open && term.length > 0 });
  const searchBox = useRef<HTMLInputElement>(null);
  // One row per conversation: the first message or title that matched.
  const found = [...new Map((hits.data ?? []).map((hit) => [hit.sessionId, hit])).values()];

  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => unwrap(client.chat[':sessionId'].$patch({ param: { sessionId: id }, json: { title } })),
    onMutate: ({ id, title }) => {
      queryClient.setQueryData(q.chatSessions(projectId).queryKey, (list) => list?.map((item) => (item.id === id ? { ...item, title } : item)));
    },
  });
  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    const before = sessions?.find((session) => session.id === renaming.id)?.title;
    if (title && title !== before) rename.mutate({ id: renaming.id, title });
    setRenaming(null);
  };

  // While the search box has focus the menu must not move focus to the row under the pointer.
  const keepSearchFocus = (event: { preventDefault: () => void }) => {
    if (document.activeElement === searchBox.current) event.preventDefault();
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch('');
          setRenaming(null);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="min-w-0 flex-1 justify-start">
          <History className="text-muted-foreground" />
          <span className="truncate">{currentTitle ?? '대화 없음'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-xs font-semibold text-foreground">대화</DropdownMenuLabel>
        <div className="relative px-1 pb-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-[60%] text-muted-foreground" />
          <Input
            ref={searchBox}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // Typing must not trigger the menu's type-ahead; arrows and Esc stay with the menu.
              if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) event.stopPropagation();
            }}
            placeholder="제목·내용으로 대화 찾기"
            aria-label="대화 검색"
            className="pl-7"
          />
        </div>
        {searching ? (
          <>
            {found.map((hit) => (
              <DropdownMenuItem key={hit.sessionId} onSelect={() => onPick(hit.sessionId)} onPointerMove={keepSearchFocus} className={cn('flex-col items-start gap-0', hit.sessionId === sessionId && 'font-medium')}>
                <span className="w-full truncate">{hit.title}</span>
                {hit.role !== 'title' && <span className="w-full truncate text-xs font-normal text-muted-foreground">{hit.snippet}</span>}
              </DropdownMenuItem>
            ))}
            {!found.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">{hits.isFetching || term !== search.trim() ? '찾는 중…' : '찾는 대화가 없습니다.'}</p>}
          </>
        ) : (
          <>
            {sessions?.map((session) =>
              renaming?.id === session.id ? (
                <div key={session.id} className="flex items-center gap-1 px-1 py-0.5">
                  <Input
                    autoFocus
                    value={renaming.title}
                    aria-label="대화 이름"
                    onChange={(event) => setRenaming({ id: session.id, title: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return event.stopPropagation();
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') setRenaming(null);
                      event.stopPropagation();
                    }}
                  />
                  <Button variant="ghost" size="icon-xs" aria-label="이름 저장" onClick={commitRename} disabled={!renaming.title.trim()}>
                    <Check />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label="이름 바꾸기 취소" onClick={() => setRenaming(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <DropdownMenuItem key={session.id} onSelect={() => onPick(session.id)} className={cn('group/session pr-1', session.id === sessionId && 'font-medium')}>
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  {session.calls > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {session.calls}건 · {compactTokens(session.tokens)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground opacity-0 group-hover/session:opacity-100 group-focus/session:opacity-100"
                    aria-label={`${session.title} 이름 바꾸기`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRenaming({ id: session.id, title: session.title });
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground opacity-0 group-hover/session:opacity-100 group-focus/session:opacity-100 hover:text-destructive"
                    aria-label={`${session.title} 삭제`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      onDelete({ id: session.id, title: session.title });
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Trash2 />
                  </Button>
                </DropdownMenuItem>
              ),
            )}
            {!sessions?.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">아직 대화가 없습니다.</p>}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus /> 새 대화
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
