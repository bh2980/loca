import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, History, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, ListRow, ConversationRowAction, DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Inline, Icon, Input, Text, MenuSearchField, DropdownMenuContent, MenuLabel } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

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
        <Button variant="ghost" minWidth={0} grow justifyContent="start">
          <Icon icon={History} tone="muted" />
          <Text truncate>{currentTitle ?? '대화 없음'}</Text>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="popover">
        <MenuLabel tone="strong">대화</MenuLabel>
        <MenuSearchField
          ref={searchBox}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            // Typing must not trigger the menu's type-ahead; arrows and Esc stay with the menu.
            if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) event.stopPropagation();
          }}
          placeholder="제목·내용으로 대화 찾기"
          aria-label="대화 검색"
        />
        {searching ? (
          <>
            {found.map((hit) => (
              <ListRow as="menuitem" stacked key={hit.sessionId} selected={hit.sessionId === sessionId} onSelect={() => onPick(hit.sessionId)} onPointerMove={keepSearchFocus}>
                <Text width="full" truncate>{hit.title}</Text>
                {hit.role !== 'title' && <Text width="full" variant="caption" weight="normal" tone="muted" truncate>{hit.snippet}</Text>}
              </ListRow>
            ))}
            {!found.length && <Text as="p" paddingX="condensed" paddingY="condensed" variant="body" tone="muted">{hits.isFetching || term !== search.trim() ? '찾는 중…' : '찾는 대화가 없습니다.'}</Text>}
          </>
        ) : (
          <>
            {sessions?.map((session) =>
              renaming?.id === session.id ? (
                <Inline key={session.id} gap="tight" paddingX="tight" paddingY="hair">
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
                </Inline>
              ) : (
                <ListRow as="menuitem" key={session.id} selected={session.id === sessionId} onSelect={() => onPick(session.id)}>
                  <Text minWidth={0} grow truncate>{session.title}</Text>
                  {session.calls > 0 && (
                    <Text shrink={false} variant="caption" tone="muted" tabular>
                      {session.calls}건 · {compactTokens(session.tokens)}
                    </Text>
                  )}
                  <ConversationRowAction
                    aria-label={`${session.title} 이름 바꾸기`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRenaming({ id: session.id, title: session.title });
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Pencil />
                  </ConversationRowAction>
                  <ConversationRowAction
                    danger
                    aria-label={`${session.title} 삭제`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      onDelete({ id: session.id, title: session.title });
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Trash2 />
                  </ConversationRowAction>
                </ListRow>
              ),
            )}
            {!sessions?.length && <Text as="p" paddingX="condensed" paddingY="condensed" variant="body" tone="muted">아직 대화가 없습니다.</Text>}
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
