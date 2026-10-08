import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { DOCUMENT_KINDS } from '@tw/shared';
import { Page } from '@/components/page';
import { RelationshipGraph } from '@/components/relationship-graph';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

type Tab = 'documents' | 'characters' | 'relationships';
interface KnowledgeSearch {
  tab?: Tab;
  doc?: string;
  char?: string;
  rel?: string;
}

export const Route = createFileRoute('/p/$projectId/knowledge')({
  validateSearch: (raw: Record<string, unknown>): KnowledgeSearch => {
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    return {
      tab: raw.tab === 'characters' || raw.tab === 'relationships' ? raw.tab : undefined,
      doc: text(raw.doc),
      char: text(raw.char),
      rel: text(raw.rel),
    };
  },
  component: Knowledge,
});

type Kind = (typeof DOCUMENT_KINDS)[number];
interface Doc {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  alwaysInclude: boolean;
}
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

const fail = (error: Error) => toast.error(error.message);

function Knowledge() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? 'documents';
  const set = (next: Partial<KnowledgeSearch>, replace = true) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });

  return (
    <Page title="작품 자료" description="AI가 번역할 때 참고하는 설정 문서, 인물, 인물 관계입니다." flush>
      <Tabs value={tab} onValueChange={(value) => set({ tab: value === 'documents' ? undefined : (value as Tab) }, false)} className="h-full min-h-0 gap-0">
        <div className="px-6 py-2">
          <TabsList>
            <TabsTrigger value="documents">문서</TabsTrigger>
            <TabsTrigger value="characters">인물</TabsTrigger>
            <TabsTrigger value="relationships">관계</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 border-t">
          {tab === 'documents' && <DocumentsTab projectId={projectId} selectedId={search.doc} onSelect={(doc) => set({ doc })} />}
          {tab === 'characters' && <CharactersTab projectId={projectId} selectedId={search.char} onSelect={(char) => set({ char })} onOpenRelationship={(rel) => set({ tab: 'relationships', rel, char: undefined }, false)} />}
          {tab === 'relationships' && <RelationshipsTab projectId={projectId} search={search} onSelect={set} />}
        </div>
      </Tabs>
    </Page>
  );
}

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

/* ───────────────────────────── documents ───────────────────────────── */

function DocumentsTab({ projectId, selectedId, onSelect }: { projectId: string; selectedId?: string; onSelect: (id?: string) => void }) {
  const documents = useQuery(q.documents(projectId));
  const docs = (documents.data ?? []) as Doc[];
  const selected = docs.find((doc) => doc.id === selectedId);
  const [editing, setEditing] = useState(false);
  useReportView('knowledge-doc', [selected && { kind: '작품 문서', id: selected.id, label: selected.title }]);

  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].documents.$post({ param: { projectId }, json: { title: '새 문서', kind: 'note', body: '', alwaysInclude: false } })),
    onSuccess: (row) => {
      onSelect(row.id);
      setEditing(true);
    },
    onError: fail,
  });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-sm text-muted-foreground tabular-nums">{docs.length}개</span>
          <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            <Plus /> 새 문서
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {DOCUMENT_KINDS.map((kind) => {
            const group = docs.filter((doc) => doc.kind === kind);
            if (!group.length) return null;
            return (
              <div key={kind} className="pb-2">
                <p className="px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  {DOCUMENT_KIND[kind]} <span className="tabular-nums">{group.length}</span>
                </p>
                {group.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      onSelect(doc.id);
                    }}
                    className={cn('flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-muted/60', doc.id === selectedId && 'bg-muted font-medium')}
                  >
                    <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                    {doc.alwaysInclude && (
                      <Badge variant="secondary" className="shrink-0">
                        항상 포함
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
          {documents.data && docs.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">문서가 없습니다.</p>}
        </ScrollArea>
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {selected ? (
          editing ? (
            <DocumentEditor key={selected.id} projectId={projectId} doc={selected} onDone={() => setEditing(false)} />
          ) : (
            <DocumentView projectId={projectId} doc={selected} onEdit={() => setEditing(true)} onDeleted={() => onSelect(undefined)} />
          )
        ) : (
          <p className="p-8 text-sm text-muted-foreground">왼쪽에서 문서를 고르거나 새 문서를 만드세요.</p>
        )}
      </div>
    </div>
  );
}

function DocumentView({ projectId, doc, onEdit, onDeleted }: { projectId: string; doc: Doc; onEdit: () => void; onDeleted: () => void }) {
  const remove = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].documents[':id'].$delete({ param: { projectId, id: doc.id } })),
    onSuccess: () => {
      toast.success('문서를 삭제했습니다.');
      onDeleted();
    },
    onError: fail,
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{doc.title}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {DOCUMENT_KIND[doc.kind]}
            {doc.alwaysInclude && <Badge variant="secondary">항상 포함</Badge>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil /> 편집
          </Button>
          <DeleteButton title="문서를 삭제할까요?" description={`“${doc.title}” 문서가 삭제됩니다.`} onConfirm={() => remove.mutate()} />
        </div>
      </div>
      {doc.body.trim() ? <div className="prose-chat">
          <Markdown>{doc.body}</Markdown>
        </div> : <p className="text-sm text-muted-foreground">본문이 비어 있습니다.</p>}
    </div>
  );
}

function DocumentEditor({ projectId, doc, onDone }: { projectId: string; doc: Doc; onDone: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState<Kind>(doc.kind);
  const [alwaysInclude, setAlwaysInclude] = useState(doc.alwaysInclude);
  const [body, setBody, clearBody] = useDraft(`doc:${doc.id}:body`, doc.body);
  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].documents[':id'].$patch({ param: { projectId, id: doc.id }, json: { title, kind, alwaysInclude, body } })),
    onSuccess: () => {
      clearBody();
      toast.success('저장했습니다.');
      onDone();
    },
    onError: fail,
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <PaneHeader title="문서 편집" />
      <div className="space-y-1.5">
        <Label htmlFor="doc-title">제목</Label>
        <Input id="doc-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-1.5">
          <Label>종류</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
            <SelectTrigger className="w-36" aria-label="종류">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_KINDS.map((item) => (
                <SelectItem key={item} value={item}>
                  {DOCUMENT_KIND[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <Switch id="doc-always" checked={alwaysInclude} onCheckedChange={setAlwaysInclude} />
          <Label htmlFor="doc-always">항상 포함 (모든 번역 요청에 이 문서를 넣음)</Label>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="doc-body">본문 (마크다운)</Label>
        <Textarea id="doc-body" rows={20} className="font-mono" value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          취소
        </Button>
        <Button size="sm" disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── characters ───────────────────────────── */

function CharactersTab({ projectId, selectedId, onSelect, onOpenRelationship }: { projectId: string; selectedId?: string; onSelect: (id?: string) => void; onOpenRelationship: (relId: string) => void }) {
  const data = useQuery(q.characters(projectId));
  const characters = (data.data?.characters ?? []) as Character[];
  const relationships = (data.data?.relationships ?? []) as Relationship[];
  const selected = characters.find((character) => character.id === selectedId);
  useReportView('knowledge-character', [selected && { kind: '인물', id: selected.id, label: selected.name }]);

  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].characters.$post({ param: { projectId }, json: { name: '새 인물', aliases: [], profile: '' } })),
    onSuccess: (row) => onSelect(row.id),
    onError: fail,
  });

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="flex items-center justify-between px-6 py-2">
          <span className="text-sm text-muted-foreground tabular-nums">{characters.length}명</span>
          <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            <Plus /> 새 인물
          </Button>
        </div>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">이름</TableHead>
              <TableHead className="w-56">별칭</TableHead>
              <TableHead>프로필</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {characters.map((character) => (
              <TableRow key={character.id} data-state={character.id === selectedId ? 'selected' : undefined} className="cursor-pointer" onClick={() => onSelect(character.id === selectedId ? undefined : character.id)}>
                <TableCell className="truncate font-medium">{character.name}</TableCell>
                <TableCell className="truncate text-muted-foreground">{character.aliases.join(', ')}</TableCell>
                <TableCell className="truncate text-muted-foreground">{character.profile.split('\n').find((line) => line.trim()) ?? ''}</TableCell>
              </TableRow>
            ))}
            {data.data && characters.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  등록된 인물이 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {selected && (
        <div className="w-[420px] shrink-0 overflow-auto border-l">
          <CharacterEditor key={selected.id} projectId={projectId} character={selected} characters={characters} relationships={relationships} onClose={() => onSelect(undefined)} onOpenRelationship={onOpenRelationship} />
        </div>
      )}
    </div>
  );
}

function CharacterEditor({ projectId, character, characters, relationships, onClose, onOpenRelationship }: { projectId: string; character: Character; characters: Character[]; relationships: Relationship[]; onClose: () => void; onOpenRelationship: (relId: string) => void }) {
  const [name, setName] = useState(character.name);
  const [aliases, setAliases] = useState(character.aliases.join(', '));
  const [profile, setProfile, clearProfile] = useDraft(`char:${character.id}:profile`, character.profile);
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
      toast.success('인물을 삭제했습니다.');
      onClose();
    },
    onError: fail,
  });
  const nameOf = (id: string) => characters.find((item) => item.id === id)?.name ?? '(알 수 없음)';
  const mine = relationships.filter((relationship) => relationship.fromId === character.id || relationship.toId === character.id);

  return (
    <div className="space-y-4 p-4">
      <PaneHeader title="인물 편집" onClose={onClose} />
      <div className="space-y-1.5">
        <Label htmlFor="char-name">이름</Label>
        <Input id="char-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="char-aliases">별칭 (쉼표로 구분)</Label>
        <Input id="char-aliases" value={aliases} onChange={(event) => setAliases(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="char-profile">프로필 (마크다운)</Label>
        <Textarea id="char-profile" rows={12} value={profile} onChange={(event) => setProfile(event.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <DeleteButton title="인물을 삭제할까요?" description={`“${character.name}”과(와) 연결된 관계 ${mine.length}개도 함께 삭제될 수 있습니다.`} onConfirm={() => remove.mutate()} />
        <Button size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">저장된 관계 {mine.length}개</h3>
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

/* ───────────────────────────── relationships ───────────────────────────── */

function RelationshipsTab({ projectId, search, onSelect }: { projectId: string; search: KnowledgeSearch; onSelect: (next: Partial<KnowledgeSearch>, replace?: boolean) => void }) {
  const data = useQuery(q.characters(projectId));
  const characters = (data.data?.characters ?? []) as Character[];
  const relationships = (data.data?.relationships ?? []) as Relationship[];
  const creating = search.rel === 'new';
  const selectedRel = creating ? undefined : relationships.find((relationship) => relationship.id === search.rel);
  const selectedChar = characters.find((character) => character.id === search.char);
  const nameOf = (id: string) => characters.find((item) => item.id === id)?.name ?? '(알 수 없음)';
  const unresolved = relationships.filter((relationship) => !characters.some((c) => c.id === relationship.fromId) || !characters.some((c) => c.id === relationship.toId)).length;
  useReportView('knowledge-relationship', [
    selectedRel && { kind: '인물 관계', id: selectedRel.id, label: `${nameOf(selectedRel.fromId)} → ${nameOf(selectedRel.toId)} (${selectedRel.kind})` },
    selectedChar && { kind: '인물', id: selectedChar.id, label: selectedChar.name },
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-6 py-2">
        <p className="text-sm text-muted-foreground">
          저장된 관계만 표시합니다. 대사에서 추정한 관계는 포함하지 않습니다. 인물 {characters.length}명 · 관계 {relationships.length}개
          {unresolved > 0 && ` (인물을 찾을 수 없어 그리지 못한 관계 ${unresolved}개)`}
        </p>
        <Button size="sm" variant="outline" className="ml-auto" disabled={characters.length < 2} onClick={() => onSelect({ rel: 'new', char: undefined })}>
          <Plus /> 새 관계
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 border-t">
        <div className="relative min-w-0 flex-1">
          {data.data && characters.length === 0 ? (
            <p className="p-8 text-sm text-muted-foreground">인물이 없습니다. 인물 탭에서 먼저 추가하세요.</p>
          ) : data.data ? (
            <RelationshipGraph
              characters={characters}
              relationships={relationships}
              selectedCharacterId={search.char}
              selectedRelationshipId={creating ? undefined : search.rel}
              onSelectCharacter={(char) => onSelect({ char, rel: undefined })}
              onSelectRelationship={(rel) => onSelect({ rel, char: undefined })}
              onClear={() => onSelect({ char: undefined, rel: undefined })}
            />
          ) : null}
        </div>
        {(creating || selectedRel || selectedChar) && (
          <div className="w-[400px] shrink-0 overflow-auto border-l">
            {creating ? (
              <RelationshipEditor key="new" projectId={projectId} characters={characters} initial={{ fromId: search.char ?? characters[0]?.id ?? '', toId: '', kind: '', description: '', mutual: false }} onDone={(rel) => onSelect({ rel }, true)} />
            ) : selectedRel ? (
              <RelationshipEditor key={selectedRel.id} projectId={projectId} characters={characters} relationship={selectedRel} initial={selectedRel} onDone={(rel) => onSelect({ rel })} />
            ) : selectedChar ? (
              <div className="space-y-3 p-4">
                <PaneHeader title={selectedChar.name} onClose={() => onSelect({ char: undefined })} />
                <p className="line-clamp-4 text-sm text-muted-foreground">{selectedChar.profile || '프로필이 없습니다.'}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onSelect({ rel: 'new' })}>
                    <Plus /> 이 인물에서 새 관계
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onSelect({ tab: 'characters' }, false)}>
                    인물 편집
                  </Button>
                </div>
                <h3 className="pt-2 text-sm font-semibold">저장된 관계</h3>
                {relationships
                  .filter((relationship) => relationship.fromId === selectedChar.id || relationship.toId === selectedChar.id)
                  .map((relationship) => (
                    <button key={relationship.id} type="button" onClick={() => onSelect({ rel: relationship.id, char: undefined })} className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/60">
                      {nameOf(relationship.fromId)} {relationship.mutual ? '↔' : '→'} {nameOf(relationship.toId)} <span className="text-muted-foreground">· {relationship.kind}</span>
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        )}
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
        {relationship ? <DeleteButton title="관계를 삭제할까요?" description={`${characters.find((c) => c.id === relationship.fromId)?.name} 와(과) ${characters.find((c) => c.id === relationship.toId)?.name} 사이의 “${relationship.kind}” 관계가 삭제됩니다.`} onConfirm={() => remove.mutate()} /> : <span />}
        <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
    </div>
  );
}
