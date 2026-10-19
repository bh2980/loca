import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BookA, FileText, ListTree, MessageSquare, ScrollText, Search, UserRound } from 'lucide-react';
import { Badge, Button, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Kbd } from '@loca/ui';
import { q } from '@/lib/queries';
import { keyLabel } from '@/lib/keys';
import { chatDock } from '@/lib/chat-dock';

export type SearchScope = 'all' | 'lines' | 'scenes' | 'terms' | 'people' | 'docs' | 'chat';

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'lines', label: '대사' },
  { id: 'scenes', label: '장면' },
  { id: 'terms', label: '용어' },
  { id: 'people', label: '인물' },
  { id: 'docs', label: '자료' },
  { id: 'chat', label: '채팅' },
];

/** Up to this many of each kind besides lines. */
const FEW = 5;
const has = (needle: string, ...texts: (string | null | undefined)[]) => texts.some((text) => text?.toLowerCase().includes(needle));

/**
 * ⌘K: anywhere in the project — scenes, glossary terms, people, documents, chat history and lines (source,
 * translation, speaker, key) — and jump there. The line list's own 찾기 only narrows what it shows.
 */
export function CommandSearch({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SearchScope>('all');
  const [text, setText] = useState('');
  const query = useDeferredValue(text.trim());

  const cap = (targetScope: SearchScope, defaultCap: number) => (scope === targetScope ? 50 : defaultCap);

  const lines = useQuery({
    ...q.units(projectId, { q: query, limit: scope === 'lines' ? 50 : 30 }),
    enabled: open && query.length > 0 && (scope === 'all' || scope === 'lines'),
  });
  const scenes = useQuery({
    ...q.groups(projectId, { q: query }),
    enabled: open && query.length > 0 && (scope === 'all' || scope === 'scenes'),
  });
  // The glossary and the knowledge lists are small and already cached by their pages; matched here.
  const termList = useQuery({
    ...q.terms(projectId),
    enabled: open && (scope === 'all' || scope === 'terms'),
  });
  const characterList = useQuery({
    ...q.characters(projectId),
    enabled: open && (scope === 'all' || scope === 'people'),
  });
  const documentList = useQuery({
    ...q.documents(projectId),
    enabled: open && (scope === 'all' || scope === 'docs'),
  });
  const chatSearch = useQuery({
    ...q.chatSearch(projectId, query),
    enabled: open && query.length > 0 && (scope === 'all' || scope === 'chat'),
  });

  const needle = query.toLowerCase();
  const sceneHits = (scope === 'all' || scope === 'scenes') ? (scenes.data ?? []).slice(0, cap('scenes', 8)) : [];
  const terms = needle && (scope === 'all' || scope === 'terms')
    ? (termList.data ?? []).filter((term) => has(needle, term.source, term.target)).slice(0, cap('terms', FEW))
    : [];
  const people = needle && (scope === 'all' || scope === 'people')
    ? (characterList.data?.characters ?? []).filter((person) => has(needle, person.name, ...person.aliases)).slice(0, cap('people', FEW))
    : [];
  const documents = needle && (scope === 'all' || scope === 'docs')
    ? (documentList.data ?? []).filter((doc) => has(needle, doc.title, doc.body)).slice(0, cap('docs', FEW))
    : [];
  const chatHits = (scope === 'all' || scope === 'chat')
    ? (chatSearch.data ?? []).slice(0, cap('chat', 5))
    : [];

  const isFetching =
    ((scope === 'all' || scope === 'lines') && lines.isFetching) ||
    ((scope === 'all' || scope === 'scenes') && scenes.isFetching) ||
    ((scope === 'all' || scope === 'terms') && termList.isFetching) ||
    ((scope === 'all' || scope === 'people') && characterList.isFetching) ||
    ((scope === 'all' || scope === 'docs') && documentList.isFetching) ||
    ((scope === 'all' || scope === 'chat') && chatSearch.isFetching);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (to: () => void) => {
    setOpen(false);
    to();
  };

  return (
    <>
      <Button variant="ghost" size={compact ? "icon-sm" : "default"} aria-label={`검색 (${keyLabel('Mod+K')})`} onClick={() => setOpen(true)}>
        <Search /> {!compact && <>검색 <Kbd>{keyLabel('Mod+K')}</Kbd></>}
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false} title="검색" description="장면, 용어, 인물, 자료, 대사(원문·번역·화자·ID), 대화 기록에서 찾습니다.">
        <CommandInput value={text} onValueChange={setText} placeholder="찾을 내용을 입력하세요" />
        <div className="flex items-center gap-1 border-b px-3 py-1.5 overflow-x-auto">
          {SCOPES.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={scope === item.id ? 'secondary' : 'ghost'}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <CommandList>
          {query && <CommandEmpty>{isFetching ? '찾는 중…' : '결과가 없습니다.'}</CommandEmpty>}
          {(scope === 'all' || scope === 'scenes') && !!sceneHits.length && (
            <CommandGroup heading="장면">
              {sceneHits.map((scene) => (
                <CommandItem key={scene.id} value={`scene-${scene.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { group: scene.id } }))}>
                  <ListTree /> <span className="truncate">{scene.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{scene.total}줄</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'terms') && !!terms.length && (
            <CommandGroup heading="용어">
              {terms.map((term) => (
                <CommandItem key={term.id} value={`term-${term.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/glossary', params: { projectId }, search: { term: term.id } }))}>
                  <BookA /> <span className="truncate">{term.source}</span>
                  {term.target && <span className="truncate text-muted-foreground">→ {term.target}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'people') && !!people.length && (
            <CommandGroup heading="인물">
              {people.map((person) => (
                <CommandItem key={person.id} value={`person-${person.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'people', display: 'characters', item: person.id } }))}>
                  <UserRound /> <span className="truncate">{person.name}</span>
                  {!!person.aliases.length && <span className="truncate text-muted-foreground">{person.aliases.join(', ')}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'docs') && !!documents.length && (
            <CommandGroup heading="자료">
              {documents.map((doc) => (
                <CommandItem key={doc.id} value={`doc-${doc.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'documents', item: doc.id } }))}>
                  <ScrollText /> <span className="truncate">{doc.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'lines') && !!lines.data?.rows.length && (
            <CommandGroup heading={`대사 ${lines.data.total.toLocaleString()}개 중 ${lines.data.rows.length}개`}>
              {lines.data.rows.map((line) => (
                <CommandItem
                  key={line.id}
                  value={`line-${line.id}`}
                  onSelect={() => go(() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { group: line.groupId, line: line.id } }))}
                >
                  <FileText />
                  <div className="min-w-0">
                    <p className="truncate">
                      {line.speaker && <span className="text-muted-foreground">{line.speaker}: </span>}
                      {line.source}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {line.groupTitle} · {line.key}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'chat') && !!chatHits.length && (
            <CommandGroup heading="채팅">
              {chatHits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={`chat-${hit.id}`}
                  onSelect={() =>
                    go(() => {
                      chatDock.openSession(projectId, hit.sessionId);
                    })
                  }
                >
                  <MessageSquare />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="truncate font-medium">{hit.title}</span>
                      <Badge variant="secondary">
                        {hit.role === 'user' ? '질문' : hit.role === 'assistant' ? '답변' : '제목'}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{hit.snippet}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
