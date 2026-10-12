import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { AiButton } from '@/components/ai-button';
import { Page } from '@/components/page';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { candidateRow, KnowledgeFilters, matches, SourceBadge } from '@/components/knowledge/draft-editor';
import { isSettled, KNOWLEDGE_SOURCES, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus } from '@tw/shared';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

export const Route = createFileRoute('/p/$projectId/glossary')({
  validateSearch: (raw: Record<string, unknown>): { q?: string; term?: string; source?: KnowledgeSource; state?: 'confirmed' | 'candidate' } => ({
    q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
    source: typeof raw.source === 'string' && (KNOWLEDGE_SOURCES as readonly string[]).includes(raw.source) ? (raw.source as KnowledgeSource) : undefined,
    state: raw.state === 'confirmed' || raw.state === 'candidate' ? raw.state : undefined,
    term: typeof raw.term === 'string' && raw.term ? raw.term : undefined,
  }),
  component: Glossary,
});

interface Term {
  id: string;
  source: string;
  target: string;
  note: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  reviewed: boolean;
  evidence?: string[];
}

function Glossary() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const terms = useQuery(q.terms(projectId));
  const [draft, setDraft] = useState({ source: '', target: '', note: '' });

  // AI terms (a workflow's "add terms") show as AI 후보 or, when auto-confirmed, AI until a person promotes them.
  const asDraft = (term: Term) => ({ ...term, evidence: [] });
  const unofficial = (terms.data ?? []).filter((term) => !isSettled(term));
  const all = (terms.data ?? []).filter((term) => matches(asDraft(term), search.source, search.state));
  const decide = useMutation({
    mutationFn: ({ ids, accept }: { ids: string[]; accept: boolean }) => unwrap(client.projects[':projectId'].drafts.$post({ param: { projectId }, json: { kind: 'terms', ids, action: accept ? 'confirm' : 'discard' } })),
    onSuccess: ({ changed }, { accept }) => toast.success(accept ? `${changed}개를 정식 용어로 올렸습니다.` : `${changed}개 AI 용어를 버렸습니다.`),
    onError: (error) => toast.error(error.message),
  });
  const needle = search.q?.toLowerCase();
  const rows = needle ? all.filter((term) => [term.source, term.target, term.note].some((text) => text.toLowerCase().includes(needle))) : all;
  const selected = all.find((term) => term.id === search.term);
  useReportView('glossary-term', [selected && { kind: '용어', id: selected.id, label: `${selected.source} → ${selected.target}` }]);

  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.$post({ param: { projectId }, json: draft })),
    onSuccess: () => {
      setDraft({ source: '', target: '', note: '' });
      toast.success('용어를 추가했습니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  const select = (id?: string) => void navigate({ search: (previous) => ({ ...previous, term: id }), replace: true });

  return (
    <Page title="용어집">
      <div className="flex min-h-0 gap-0 rounded-lg border">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <KnowledgeFilters
              source={search.source}
              status={search.state}
              onChange={(next) => void navigate({ search: (previous) => ({ ...previous, ...('source' in next && { source: next.source }), ...('status' in next && { state: next.status }), term: undefined }), replace: true })}
            />
            {unofficial.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => decide.mutate({ ids: all.filter((term) => !isSettled(term)).map((term) => term.id), accept: true })}>
                보이는 AI 용어 모두 정식으로
              </Button>
            )}
            <InputGroup className="w-64">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                defaultValue={search.q}
                placeholder="원문·번역·메모 검색"
                onChange={(event) => void navigate({ search: (previous) => ({ ...previous, q: event.target.value.trim() || undefined }), replace: true })}
              />
            </InputGroup>
            {unofficial.some((term) => !term.target.trim()) && (
              <AiButton prompt="번역이 비어 있는 용어 후보를 채워줘.">
                빈 번역 AI로 채우기
              </AiButton>
            )}
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {rows.length.toLocaleString()}개{needle && ` / 전체 ${all.length.toLocaleString()}개`}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/4">원문</TableHead>
                <TableHead className="w-1/4">번역</TableHead>
                <TableHead>메모</TableHead>
                <TableHead className="w-56">출처</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!search.source && !search.state && (
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                {(['source', 'target', 'note'] as const).map((field) => (
                  <TableCell key={field}>
                    <Input
                      aria-label={{ source: '새 용어 원문', target: '새 용어 번역', note: '새 용어 메모' }[field]}
                      placeholder={{ source: '원문', target: '번역', note: '메모 (선택)' }[field]}
                      value={draft[field]}
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                      onKeyDown={(event) => event.key === 'Enter' && draft.source.trim() && create.mutate()}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Button size="sm" disabled={!draft.source.trim() || create.isPending} onClick={() => create.mutate()}>
                    <Plus /> 용어 추가
                  </Button>
                </TableCell>
              </TableRow>
              )}
              {rows.map((term) => (
                <TableRow key={term.id} data-state={term.id === search.term ? 'selected' : undefined} className={cn('cursor-pointer', candidateRow(asDraft(term)))} onClick={() => select(term.id === search.term ? undefined : term.id)}>
                  <TableCell className="font-medium">{term.source}</TableCell>
                  <TableCell>{term.target || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{term.note}</TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {isSettled(term) ? (
                      <SourceBadge row={asDraft(term)} />
                    ) : (
                      <div className="flex items-center gap-1">
                        <SourceBadge row={asDraft(term)} />
                        <Button size="sm" variant="outline" className="h-7" onClick={() => decide.mutate({ ids: [term.id], accept: true })}>
                          정식으로
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => decide.mutate({ ids: [term.id], accept: false })}>
                          버리기
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {terms.data && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    {needle ? '조건에 맞는 용어가 없습니다.' : search.source || search.state ? '조건에 맞는 용어가 없습니다. 워크플로의 ‘용어 후보 추가’ 함수가 AI 용어를 모읍니다.' : '아직 용어가 없습니다. 위에서 추가하세요.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {selected && (
          <div className="w-[380px] shrink-0 border-l">
            <TermEditor key={selected.id} projectId={projectId} term={selected} onClose={() => select(undefined)} />
          </div>
        )}
      </div>
    </Page>
  );
}

function TermEditor({ projectId, term, onClose }: { projectId: string; term: Term; onClose: () => void }) {
  const [form, setForm] = useState({ source: term.source, target: term.target, note: term.note });
  const dirty = form.source !== term.source || form.target !== term.target || form.note !== term.note;
  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms[':id'].$patch({ param: { projectId, id: term.id }, json: form })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms[':id'].$delete({ param: { projectId, id: term.id } })),
    onSuccess: () => {
      toast.success('용어를 삭제했습니다.');
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const usage = useQuery(q.termUsage(projectId, term.id));

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">용어 편집</h2>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="닫기">
          <X />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-source">원문</Label>
        <Input id="term-source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-target">번역</Label>
        <Input id="term-target" value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-note">메모</Label>
        <Textarea id="term-note" rows={4} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      </div>
      <section className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">이 용어가 나오는 대사 {usage.data?.count ?? '…'}개</h3>
          {!!usage.data?.count && (
            <RunDialog
              projectId={projectId}
              unitIds={usage.data.unitIds}
              defaultIgnoreStatus
              trigger={
                <Button size="sm" variant="outline">
                  <Play /> 다시 실행
                </Button>
              }
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">번역이나 메모를 바꿨다면 이 대사들을 워크플로로 다시 돌려 새 용어를 반영하세요.</p>
        <ul className="max-h-60 space-y-1 overflow-auto">
          {usage.data?.rows.map((row) => (
            <li key={row.id}>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: row.groupId, line: row.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
                <span className="text-muted-foreground">{row.groupTitle} · </span>
                {row.source}
                {row.translation && <span className="block text-muted-foreground">{row.translation}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex items-center justify-between">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 /> 삭제
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>용어를 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>“{term.source}” 용어가 용어집에서 사라집니다. 이미 번역된 대사는 바뀌지 않습니다.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button size="sm" disabled={!dirty || !form.source.trim() || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
    </div>
  );
}
