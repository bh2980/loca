import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { DOCUMENT_KINDS } from '@tw/shared';
import { Page } from '@/components/page';
import { PeopleTab } from '@/components/people/people-tab';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

type Tab = 'documents' | 'people';
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
      tab: raw.tab === 'people' || raw.tab === 'characters' || raw.tab === 'relationships' ? 'people' : undefined,
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
const fail = (error: Error) => toast.error(error.message);

function Knowledge() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? 'documents';
  const set = (next: Partial<KnowledgeSearch>, replace = true) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });

  return (
    <Page title="작품 자료" flush>
      <Tabs value={tab} onValueChange={(value) => set({ tab: value === 'documents' ? undefined : (value as Tab), doc: undefined, char: undefined, rel: undefined }, false)} className="h-full min-h-0 gap-0">
        <div className="px-6 py-2">
          <TabsList>
            <TabsTrigger value="documents">문서</TabsTrigger>
            <TabsTrigger value="people">인물·관계</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 border-t">
          {tab === 'documents' && <DocumentsTab projectId={projectId} selectedId={search.doc} onSelect={(doc) => set({ doc })} />}
          {tab === 'people' && <PeopleTab projectId={projectId} selection={{ char: search.char, rel: search.rel }} onSelect={(next) => set({ char: next.char, rel: next.rel })} />}
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
