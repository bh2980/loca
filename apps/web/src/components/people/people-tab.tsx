import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { RelationshipGraph } from '@/components/relationship-graph';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

interface Character {
  id: string;
  name: string;
  aliases: string[];
  profile: string;
}
interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  description: string;
  mutual: boolean;
}

export interface PeopleSelection {
  char?: string;
  /** A relationship id, or 'new' while the relationship editor is open for a new relationship. */
  rel?: string;
}

const fail = (error: Error) => toast.error(error.message);

function PaneHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold">{title}</h2>
      {onClose && (
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="닫기">
          <X />
        </Button>
      )}
    </div>
  );
}

function DeleteButton({ title, description, onConfirm }: { title: string; description: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive">
          <Trash2 /> 삭제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PeopleTab({ projectId, selection, onSelect }: { projectId: string; selection: PeopleSelection; onSelect: (next: PeopleSelection) => void }) {
  const data = useQuery(q.characters(projectId));
  const characters = (data.data?.characters ?? []) as Character[];
  const relationships = (data.data?.relationships ?? []) as Relationship[];
  const [filter, setFilter] = useState('');

  const creatingRel = selection.rel === 'new';
  const selectedRel = creatingRel ? undefined : relationships.find((relationship) => relationship.id === selection.rel);
  // A relationship selection takes precedence over a character one in the right pane.
  const selectedChar = characters.find((character) => character.id === selection.char);
  const nameOf = (id: string) => characters.find((item) => item.id === id)?.name ?? '(알 수 없음)';
  const unresolved = relationships.filter((relationship) => !characters.some((c) => c.id === relationship.fromId) || !characters.some((c) => c.id === relationship.toId)).length;

  useReportView('knowledge-people', [
    selectedRel && { kind: '관계', id: selectedRel.id, label: `${nameOf(selectedRel.fromId)} ${selectedRel.mutual ? '↔' : '→'} ${nameOf(selectedRel.toId)} (${selectedRel.kind})` },
    !selectedRel && selectedChar && { kind: '인물', id: selectedChar.id, label: selectedChar.name },
  ]);

  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].characters.$post({ param: { projectId }, json: { name: '새 인물', aliases: [], profile: '' } })),
    onSuccess: (row) => onSelect({ char: row.id }),
    onError: fail,
  });

  const needle = filter.trim().toLowerCase();
  const visible = needle ? characters.filter((character) => character.name.toLowerCase().includes(needle) || character.aliases.some((alias) => alias.toLowerCase().includes(needle))) : characters;
  const showPane = creatingRel || !!selectedRel || !!selectedChar;
  const emphasisChar = selectedRel ? undefined : selection.char;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r">
        <div className="space-y-2 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="이름·별칭 검색" aria-label="인물 검색" className="pl-8" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground tabular-nums">{needle ? `${visible.length} / ${characters.length}명` : `${characters.length}명`}</span>
            <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
              <Plus /> 새 인물
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {visible.map((character) => (
            <button
              key={character.id}
              type="button"
              onClick={() => onSelect({ char: character.id })}
              className={cn('block w-full px-4 py-1.5 text-left text-sm hover:bg-muted/60', character.id === selection.char && 'bg-muted')}
            >
              <span className={cn('block truncate', character.id === selection.char && 'font-medium')}>{character.name}</span>
              {character.aliases.length > 0 && <span className="block truncate text-xs text-muted-foreground">{character.aliases.join(', ')}</span>}
            </button>
          ))}
          {data.data && characters.length > 0 && visible.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">검색 결과가 없습니다.</p>}
        </ScrollArea>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="px-6 py-2 text-sm text-muted-foreground">
          저장된 관계만 표시합니다. 대사에서 추정한 관계는 포함하지 않습니다. 인물 {characters.length}명 · 관계 {relationships.length}개
          {unresolved > 0 && ` (인물을 찾을 수 없어 그리지 못한 관계 ${unresolved}개)`}
        </p>
        <div className="relative min-h-0 flex-1 border-t">
          {data.data && characters.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground">
              <p>등록된 인물이 없습니다.</p>
              <p className="mt-1">왼쪽의 “새 인물” 버튼으로 첫 인물을 추가하세요.</p>
            </div>
          ) : data.data ? (
            <RelationshipGraph
              characters={characters}
              relationships={relationships}
              selectedCharacterId={emphasisChar}
              selectedRelationshipId={selectedRel?.id}
              onSelectCharacter={(char) => onSelect({ char })}
              onSelectRelationship={(rel) => onSelect({ rel })}
              onClear={() => onSelect({})}
            />
          ) : null}
        </div>
      </div>

      {showPane && (
        <div className="w-[380px] shrink-0 overflow-auto border-l">
          {creatingRel ? (
            <RelationshipEditor
              key={`new:${selection.char ?? ''}`}
              projectId={projectId}
              characters={characters}
              initial={{ fromId: selectedChar?.id ?? characters[0]?.id ?? '', toId: '', kind: '', description: '', mutual: false }}
              onDone={(rel) => onSelect(rel ? { rel } : { char: selectedChar?.id })}
            />
          ) : selectedRel ? (
            <RelationshipEditor key={selectedRel.id} projectId={projectId} characters={characters} relationship={selectedRel} initial={selectedRel} onDone={(rel) => onSelect(rel ? { rel } : {})} />
          ) : selectedChar ? (
            <CharacterEditor
              key={selectedChar.id}
              projectId={projectId}
              character={selectedChar}
              characters={characters}
              relationships={relationships}
              onClose={() => onSelect({})}
              onOpenRelationship={(rel) => onSelect({ rel })}
              onAddRelationship={() => onSelect({ char: selectedChar.id, rel: 'new' })}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function CharacterEditor({ projectId, character, characters, relationships, onClose, onOpenRelationship, onAddRelationship }: { projectId: string; character: Character; characters: Character[]; relationships: Relationship[]; onClose: () => void; onOpenRelationship: (relId: string) => void; onAddRelationship: () => void }) {
  const [name, setName] = useState(character.name);
  const [aliases, setAliases] = useState(character.aliases.join(', '));
  const [profile, setProfile, clearProfile] = useDraft(`char:${character.id}:profile`, character.profile);
  const [preview, setPreview] = useState(() => character.profile.trim().length > 0);
  const parsedAliases = aliases.split(',').map((alias) => alias.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].characters[':id'].$patch({ param: { projectId, id: character.id }, json: { name, aliases: parsedAliases, profile } })),
    onSuccess: () => {
      clearProfile();
      toast.success('저장했습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].characters[':id'].$delete({ param: { projectId, id: character.id } })),
    onSuccess: () => {
      clearProfile();
      toast.success('인물을 삭제했습니다.');
      onClose();
    },
    onError: fail,
  });
  const nameOf = (id: string) => characters.find((item) => item.id === id)?.name ?? '(알 수 없음)';
  const mine = relationships.filter((relationship) => relationship.fromId === character.id || relationship.toId === character.id);

  return (
    <div className="space-y-4 p-4">
      <PaneHeader title="인물" onClose={onClose} />
      <div className="space-y-1.5">
        <Label htmlFor="char-name">이름</Label>
        <Input id="char-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="char-aliases">별칭 (쉼표로 구분)</Label>
        <Input id="char-aliases" value={aliases} onChange={(event) => setAliases(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="char-profile">프로필 (마크다운)</Label>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={preview ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setPreview(true)}>
              미리보기
            </Button>
            <Button type="button" size="sm" variant={preview ? 'ghost' : 'secondary'} className="h-7 px-2" onClick={() => setPreview(false)}>
              편집
            </Button>
          </div>
        </div>
        {preview ? (
          <div className="min-h-32 rounded-md border p-3">
            {profile.trim() ? (
              <div className="prose-chat">
                <Markdown>{profile}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">프로필이 비어 있습니다.</p>
            )}
          </div>
        ) : (
          <Textarea id="char-profile" rows={12} value={profile} onChange={(event) => setProfile(event.target.value)} />
        )}
      </div>
      <div className="flex items-center justify-between">
        <DeleteButton title="인물을 삭제할까요?" description={`“${character.name}”을(를) 삭제하면 연결된 관계 ${mine.length}개도 함께 삭제됩니다.`} onConfirm={() => remove.mutate()} />
        <Button size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">저장된 관계 {mine.length}개</h3>
          <Button size="sm" variant="outline" disabled={characters.length < 2} onClick={onAddRelationship}>
            <Plus /> 관계 추가
          </Button>
        </div>
        {mine.length === 0 && <p className="text-sm text-muted-foreground">저장된 관계가 없습니다.</p>}
        {mine.map((relationship) => (
          <button key={relationship.id} type="button" onClick={() => onOpenRelationship(relationship.id)} className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/60">
            {nameOf(relationship.fromId)} {relationship.mutual ? '↔' : '→'} {nameOf(relationship.toId)} <span className="text-muted-foreground">· {relationship.kind}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RelationshipEditor({ projectId, characters, relationship, initial, onDone }: { projectId: string; characters: Character[]; relationship?: Relationship; initial: Omit<Relationship, 'id'>; onDone: (relId?: string) => void }) {
  const [form, setForm] = useState({ fromId: initial.fromId, toId: initial.toId, kind: initial.kind, description: initial.description, mutual: initial.mutual });
  const valid = !!form.fromId && !!form.toId && form.fromId !== form.toId && !!form.kind.trim();
  const save = useMutation({
    mutationFn: async () => {
      if (relationship) {
        await unwrap(client.projects[':projectId'].relationships[':id'].$patch({ param: { projectId, id: relationship.id }, json: form }));
        return relationship.id;
      }
      return (await unwrap(client.projects[':projectId'].relationships.$post({ param: { projectId }, json: form }))).id;
    },
    onSuccess: (id) => {
      toast.success('저장했습니다.');
      onDone(id);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].relationships[':id'].$delete({ param: { projectId, id: relationship!.id } })),
    onSuccess: () => {
      toast.success('관계를 삭제했습니다.');
      onDone(undefined);
    },
    onError: fail,
  });
  const picker = (label: string, field: 'fromId' | 'toId') => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={form[field]} onValueChange={(value) => setForm({ ...form, [field]: value })}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder="인물 선택" />
        </SelectTrigger>
        <SelectContent>
          {characters.map((character) => (
            <SelectItem key={character.id} value={character.id}>
              {character.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <PaneHeader title={relationship ? '관계 편집' : '새 관계'} onClose={() => onDone(undefined)} />
      {picker('시작 인물', 'fromId')}
      {picker('대상 인물', 'toId')}
      {form.fromId && form.fromId === form.toId && <p className="text-sm text-destructive">서로 다른 인물을 고르세요.</p>}
      <div className="space-y-1.5">
        <Label htmlFor="rel-kind">관계 종류</Label>
        <Input id="rel-kind" placeholder="예: 형제, 상사, 연인" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rel-desc">설명</Label>
        <Textarea id="rel-desc" rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="rel-mutual" checked={form.mutual} onCheckedChange={(mutual) => setForm({ ...form, mutual })} />
        <Label htmlFor="rel-mutual">쌍방 관계 (양쪽 화살표)</Label>
      </div>
      <div className="flex items-center justify-between">
        {relationship ? (
          <DeleteButton
            title="관계를 삭제할까요?"
            description={`${characters.find((c) => c.id === relationship.fromId)?.name} 와(과) ${characters.find((c) => c.id === relationship.toId)?.name} 사이의 “${relationship.kind}” 관계가 삭제됩니다.`}
            onConfirm={() => remove.mutate()}
          />
        ) : (
          <span />
        )}
        <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
    </div>
  );
}
