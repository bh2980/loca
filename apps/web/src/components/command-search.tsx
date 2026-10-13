import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BookA, FileText, ListTree, ScrollText, Search, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { q } from '@/lib/queries';
import { keyLabel } from '@/lib/keys';

/** Up to this many of each kind besides lines. */
const FEW = 5;
const has = (needle: string, ...texts: (string | null | undefined)[]) => texts.some((text) => text?.toLowerCase().includes(needle));

/**
 * ⌘K: anywhere in the project — scenes, glossary terms, people, documents and lines (source,
 * translation, speaker, key) — and jump there. The line list's own 찾기 only narrows what it shows.
 */
export function CommandSearch({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const query = useDeferredValue(text.trim());
  const lines = useQuery({ ...q.units(projectId, { q: query, limit: 30 }), enabled: open && query.length > 0 });
  const scenes = useQuery({ ...q.groups(projectId, { q: query }), enabled: open && query.length > 0 });
  // The glossary and the knowledge lists are small and already cached by their pages; matched here.
  const termList = useQuery({ ...q.terms(projectId), enabled: open });
  const characterList = useQuery({ ...q.characters(projectId), enabled: open });
  const documentList = useQuery({ ...q.documents(projectId), enabled: open });
  const needle = query.toLowerCase();
  const terms = needle ? (termList.data ?? []).filter((term) => has(needle, term.source, term.target)).slice(0, FEW) : [];
  const people = needle ? (characterList.data?.characters ?? []).filter((person) => has(needle, person.name, ...person.aliases)).slice(0, FEW) : [];
  const documents = needle ? (documentList.data ?? []).filter((doc) => has(needle, doc.title, doc.body)).slice(0, FEW) : [];

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
      <Button variant="outline" className="w-56 justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Search /> 대사·용어·인물·자료 검색
        <Kbd className="ml-auto">{keyLabel('Mod+K')}</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false} title="검색" description="장면, 용어, 인물, 자료, 대사(원문·번역·화자·ID)에서 찾습니다.">
        <CommandInput value={text} onValueChange={setText} placeholder="찾을 내용을 입력하세요" />
        <CommandList>
          {query && <CommandEmpty>{lines.isFetching ? '찾는 중…' : '결과가 없습니다.'}</CommandEmpty>}
          {!!scenes.data?.length && (
            <CommandGroup heading="장면">
              {scenes.data.slice(0, 8).map((scene) => (
                <CommandItem key={scene.id} value={`scene-${scene.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/script', params: { projectId }, search: { group: scene.id } }))}>
                  <ListTree /> <span className="truncate">{scene.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{scene.total}줄</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!terms.length && (
            <CommandGroup heading="용어">
              {terms.map((term) => (
                <CommandItem key={term.id} value={`term-${term.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/glossary', params: { projectId }, search: { term: term.id } }))}>
                  <BookA /> <span className="truncate">{term.source}</span>
                  {term.target && <span className="truncate text-muted-foreground">→ {term.target}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!people.length && (
            <CommandGroup heading="인물">
              {people.map((person) => (
                <CommandItem key={person.id} value={`person-${person.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'people', display: 'table', view: 'characters', item: person.id } }))}>
                  <UserRound /> <span className="truncate">{person.name}</span>
                  {!!person.aliases.length && <span className="truncate text-muted-foreground">{person.aliases.join(', ')}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!documents.length && (
            <CommandGroup heading="자료">
              {documents.map((doc) => (
                <CommandItem key={doc.id} value={`doc-${doc.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/knowledge', params: { projectId }, search: { tab: 'documents', item: doc.id } }))}>
                  <ScrollText /> <span className="truncate">{doc.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!lines.data?.rows.length && (
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
        </CommandList>
      </CommandDialog>
    </>
  );
}
