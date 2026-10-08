import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileText, ListTree, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { q } from '@/lib/queries';

/** ⌘K: find any line (source, translation, speaker, key) or scene and jump to it. */
export function CommandSearch({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const query = useDeferredValue(text.trim());
  const lines = useQuery({ ...q.units(projectId, { q: query, limit: 30 }), enabled: open && query.length > 0 });
  const scenes = useQuery({ ...q.groups(projectId, { q: query }), enabled: open && query.length > 0 });

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
      <Button variant="outline" size="sm" className="w-56 justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Search /> 원문·번역·화자·ID 검색
        <Kbd className="ml-auto">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false} title="검색" description="원문, 번역, 화자, ID, 장면 제목으로 찾습니다.">
        <CommandInput value={text} onValueChange={setText} placeholder="찾을 내용을 입력하세요" />
        <CommandList>
          {query && <CommandEmpty>{lines.isFetching ? '찾는 중…' : '결과가 없습니다.'}</CommandEmpty>}
          {!!scenes.data?.length && (
            <CommandGroup heading="장면">
              {scenes.data.slice(0, 8).map((scene) => (
                <CommandItem key={scene.id} value={`scene-${scene.id}`} onSelect={() => go(() => void navigate({ to: '/p/$projectId/scenes/$groupId', params: { projectId, groupId: scene.id } }))}>
                  <ListTree /> <span className="truncate">{scene.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{scene.total}줄</span>
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
                  onSelect={() => go(() => void navigate({ to: '/p/$projectId/scenes/$groupId', params: { projectId, groupId: line.groupId }, search: { line: line.id } }))}
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
