import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BookA, Download, FileText, Keyboard, ListTree, MessageSquare, ScrollText, Search, UserRound } from 'lucide-react';
import { Chip, Box, Button, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Inline, Kbd, Text } from '@loca/ui';
import { q } from '@/lib/queries';
import { keyLabel } from '@/lib/keys';
import { keyOf, useShortcuts } from '@/lib/shortcuts';
import { openShortcutHelp } from '@/components/shortcut-help';
import { chatDock } from '@/lib/chat-dock';
import { exportDialog } from '@/lib/export-dialog';
import { PersonName } from '@/lib/person-colors';
import { useCharacters, useDocuments } from '@/lib/knowledge';
import { useTerms } from '@/lib/terms';
import { useGroups, useGroupsById } from '@/lib/groups';
import { useLinePage } from '@/lib/units';

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
export function CommandSearch({ projectId, compact = false, listen = true }: { projectId: string; compact?: boolean; /** Off for a copy that is mounted but hidden, so ⌘K opens one dialog. */ listen?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SearchScope>('all');
  const [text, setText] = useState('');
  const query = useDeferredValue(text.trim());

  const cap = (targetScope: SearchScope, defaultCap: number) => (scope === targetScope ? 50 : defaultCap);

  // Which lines match is asked of the server (ids); the lines come from the units collection.
  const lines = useLinePage(projectId, { q: query, limit: scope === 'lines' ? 50 : 30 }, { enabled: open && query.length > 0 && (scope === 'all' || scope === 'lines') });
  const scenes = useGroups(projectId, { q: query, enabled: open && query.length > 0 && (scope === 'all' || scope === 'scenes') });
  const groupOf = useGroupsById(projectId);
  // The glossary and the knowledge lists are the browser's collections; matched here.
  const termList = useTerms(projectId, { enabled: open && (scope === 'all' || scope === 'terms') });
  const characterList = useCharacters(projectId, { enabled: open && (scope === 'all' || scope === 'people') });
  const documentList = useDocuments(projectId, { enabled: open && (scope === 'all' || scope === 'docs') });
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
    ? (characterList.data ?? []).filter((person) => has(needle, person.name, ...person.aliases)).slice(0, cap('people', FEW))
    : [];
  const documents = needle && (scope === 'all' || scope === 'docs')
    ? (documentList.data ?? []).filter((doc) => has(needle, doc.title, doc.body)).slice(0, cap('docs', FEW))
    : [];
  const chatHits = (scope === 'all' || scope === 'chat')
    ? (chatSearch.data ?? []).slice(0, cap('chat', 5))
    : [];

  const isFetching =
    ((scope === 'all' || scope === 'lines') && lines.isPlaceholderData) ||
    ((scope === 'all' || scope === 'scenes') && scenes.isLoading) ||
    ((scope === 'all' || scope === 'terms') && termList.isLoading) ||
    ((scope === 'all' || scope === 'people') && characterList.isLoading) ||
    ((scope === 'all' || scope === 'docs') && documentList.isLoading) ||
    ((scope === 'all' || scope === 'chat') && chatSearch.isFetching);

  useShortcuts({ search: () => setOpen((value) => !value) }, { enabled: listen });

  const go = (to: () => void) => {
    setOpen(false);
    to();
  };

  return (
    <>
      <Button variant="ghost" size={compact ? "icon-sm" : "default"} aria-label={`검색 (${keyLabel(keyOf('search'))})`} onClick={() => setOpen(true)}>
        <Search /> {!compact && <>검색 <Kbd>{keyLabel(keyOf('search'))}</Kbd></>}
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false} title="검색" description="장면, 용어, 인물, 자료, 대사(원문·번역·화자·ID), 대화 기록에서 찾습니다.">
        <CommandInput value={text} onValueChange={setText} placeholder="찾을 내용을 입력하세요" />
        <Inline gap="tight" border="bottom" paddingX="normal" paddingY="condensed" overflow="x">
          {SCOPES.map((item) => (
            <Button
              key={item.id}
              variant={scope === item.id ? 'secondary' : 'ghost'}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </Inline>
        <CommandList>
          {query && <CommandEmpty>{isFetching ? '찾는 중…' : '결과가 없습니다.'}</CommandEmpty>}
          {/* Things to do, not only to find: shown with no query, or when the query names them. */}
          {(!query || '번역 결과 내보내기 export'.includes(query.trim().toLowerCase())) && (
            <CommandGroup heading="동작">
              <CommandItem value="export" onSelect={() => go(() => exportDialog.open())}>
                <Download /> 번역 결과 내보내기
              </CommandItem>
            </CommandGroup>
          )}
          {!query && (
            <CommandGroup heading="도움말">
              <CommandItem value="shortcut-help" onSelect={() => go(openShortcutHelp)}>
                <Keyboard /> 단축키 보기
                <Kbd>?</Kbd>
              </CommandItem>
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'scenes') && !!sceneHits.length && (
            <CommandGroup heading="장면">
              {sceneHits.map((scene) => (
                <CommandItem key={scene.id} value={`scene-${scene.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { group: scene.id } }))}>
                  <ListTree /> <Text truncate>{scene.title}</Text>
                  <Text marginLeft="auto" variant="caption" tone="muted" tabular>{scene.total}줄</Text>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'terms') && !!terms.length && (
            <CommandGroup heading="용어">
              {terms.map((term) => (
                <CommandItem key={term.id} value={`term-${term.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/glossary', params: { projectId }, search: { term: term.id } }))}>
                  <BookA /> <Text truncate>{term.source}</Text>
                  {term.target && <Text truncate tone="muted">→ {term.target}</Text>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'people') && !!people.length && (
            <CommandGroup heading="인물">
              {people.map((person) => (
                <CommandItem key={person.id} value={`person-${person.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'people', display: 'characters', item: person.id } }))}>
                  <UserRound /> <Text truncate>{person.name}</Text>
                  {!!person.aliases.length && <Text truncate tone="muted">{person.aliases.join(', ')}</Text>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(scope === 'all' || scope === 'docs') && !!documents.length && (
            <CommandGroup heading="자료">
              {documents.map((doc) => (
                <CommandItem key={doc.id} value={`doc-${doc.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'documents', item: doc.id } }))}>
                  <ScrollText /> <Text truncate>{doc.title}</Text>
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
                  <Box minWidth={0}>
                    <Text as="p" truncate>
                      {line.speaker && <Text tone="muted"><PersonName projectId={projectId} name={line.speaker} />: </Text>}
                      {line.source}
                    </Text>
                    <Text as="p" truncate variant="caption" tone="muted">
                      {groupOf.get(line.groupId)?.title} · {line.key}
                    </Text>
                  </Box>
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
                  <Box minWidth={0} grow>
                    <Inline gap="tight" truncate>
                      <Text truncate weight="medium">{hit.title}</Text>
                      <Chip variant="quiet">
                        {hit.role === 'user' ? '질문' : hit.role === 'assistant' ? '답변' : '제목'}
                      </Chip>
                    </Inline>
                    <Text as="p" truncate variant="caption" tone="muted">{hit.snippet}</Text>
                  </Box>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
