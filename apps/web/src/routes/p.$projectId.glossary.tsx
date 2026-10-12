import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, ScanSearch, Sparkles, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { HeaderFilter } from '@/components/header-filter';
import { Page } from '@/components/page';
import { SplitPane } from '@/components/split-pane';
import { SearchInput, Toolbar } from '@/components/toolbar';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { matches, SourceBadge } from '@/components/knowledge/draft-editor';
import { isSettled, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
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
  lines: number | null;
  examples: string[];
}

function Glossary() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const terms = useQuery(q.terms(projectId));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const suggest = useQuery(q.termSuggest(projectId));
  const fill = suggest.data?.state;
  const discover = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.discover.$post({ param: { projectId } })),
    onSuccess: ({ found, added, updated }) => toast.success(added > 0 ? `새 후보 ${added.toLocaleString()}개 (전체 발견 ${found.toLocaleString()}개)` : `새 후보 없음 (기존 ${updated.toLocaleString()}개 갱신)`),
    onError: (error) => toast.error(error.message),
  });
  const cancelFill = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.suggest.cancel.$post({ param: { projectId } })),
    onError: (error) => toast.error(error.message),
  });
  // A finished fill reports its error once; the muted text below stays until the next run.
  const reported = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (fill && !fill.running && fill.error && reported.current !== fill.error) {
      reported.current = fill.error;
      toast.error(fill.error);
    }
  }, [fill]);

  // AI terms (a workflow's "add terms") show as AI 후보 or, when auto-confirmed, AI until a person promotes them.
  const asDraft = (term: Term) => ({ ...term, evidence: [] });
  const all = (terms.data ?? []).filter((term) => matches(asDraft(term), search.source, search.state));
  const decide = useMutation({
    mutationFn: ({ ids, accept }: { ids: string[]; accept: boolean }) => unwrap(client.projects[':projectId'].drafts.$post({ param: { projectId }, json: { kind: 'terms', ids, action: accept ? 'confirm' : 'discard' } })),
    onSuccess: ({ changed }, { accept }) => toast.success(accept ? `${changed}개를 정식 용어로 올렸습니다.` : `${changed}개 후보를 버렸습니다.`),
    onError: (error) => toast.error(error.message),
  });
  const needle = search.q?.toLowerCase();
  const filtered = needle ? all.filter((term) => [term.source, term.target, term.note].some((text) => text.toLowerCase().includes(needle))) : all;
  // Candidates first, the most frequent on top; settled terms follow by source.
  const rows = [...filtered].sort((a, b) => Number(isSettled(a)) - Number(isSettled(b)) || (!isSettled(a) ? (b.lines ?? -1) - (a.lines ?? -1) : 0));
  const creating = search.term === NEW_TERM;
  const selected = creating ? undefined : all.find((term) => term.id === search.term);
  useReportView('glossary-term', [selected && { kind: '용어', id: selected.id, label: `${selected.source} → ${selected.target}` }]);

  const select = (id?: string) => void navigate({ search: (previous) => ({ ...previous, term: id }), replace: true });
  const setFilter = (next: { source?: KnowledgeSource | undefined; state?: 'confirmed' | 'candidate' | undefined }) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true });

  // Picked candidates: a term without a Korean form cannot be official (it would put an empty target in every prompt).
  const pickedTerms = rows.filter((term) => picked.has(term.id));
  const promotable = pickedTerms.filter((term) => !isSettled(term) && term.target.trim());
  const discardable = pickedTerms.filter((term) => !isSettled(term));
  const afterBulk = { onSuccess: () => setPicked(new Set()) };

  const columns: ColumnDef<Term, unknown>[] = [
    { id: 'source', header: '원문', cell: ({ row }) => <span className="font-medium">{row.original.source}</span> },
    { id: 'target', header: '번역', cell: ({ row }) => row.original.target || <span className="text-muted-foreground">—</span> },
    { id: 'lines', header: '줄 수', meta: { width: 72, align: 'end' }, cell: ({ row }) => row.original.lines ?? <span className="text-muted-foreground">—</span> },
    { id: 'note', header: '메모', meta: { className: 'text-muted-foreground' }, cell: ({ row }) => row.original.note },
    {
      id: 'origin',
      header: () => (
        <HeaderFilter label="출처" value={search.source} options={KNOWLEDGE_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }))} onChange={(source) => setFilter({ source: source as KnowledgeSource | undefined })} />
      ),
      meta: { width: 96 },
      cell: ({ row }) => <SourceBadge row={asDraft(row.original)} />,
    },
    {
      id: 'state',
      header: () => (
        <HeaderFilter
          label="상태"
          value={search.state}
          options={(['confirmed', 'candidate'] as const).map((value) => ({ value, label: KNOWLEDGE_STATUS_LABELS[value] }))}
          onChange={(state) => setFilter({ state: state as 'confirmed' | 'candidate' | undefined })}
        />
      ),
      meta: { width: 88 },
      cell: ({ row }) => (isSettled(row.original) ? <span className="text-xs text-muted-foreground">{KNOWLEDGE_STATUS_LABELS.confirmed}</span> : <Badge variant="outline">후보</Badge>),
    },
  ];

  return (
    <Page title="용어집" flush>
      <SplitPane
        id="glossary"
        defaultWidth="380px"
        className="h-full"
        pane={
          creating ? (
            <NewTermPane key="new" projectId={projectId} onClose={() => select(undefined)} onCreated={(id) => select(id)} />
          ) : (
            selected && (
              <TermEditor
                key={selected.id}
                projectId={projectId}
                term={selected}
                onClose={() => select(undefined)}
                onDecide={(accept) => decide.mutate({ ids: [selected.id], accept }, { onSuccess: () => !accept && select(undefined) })}
                deciding={decide.isPending}
              />
            )
          )
        }
      >
        <Toolbar
          count={terms.data && `${rows.length.toLocaleString()}개${needle ? ` / 전체 ${all.length.toLocaleString()}개` : ''}`}
          actions={
            <>
              {fill?.running ? (
                <span className="flex items-center gap-2 text-sm tabular-nums">
                  <Sparkles className="size-4 animate-pulse" /> 용어 번역 채우는 중 {fill.done.toLocaleString()}/{fill.total.toLocaleString()}
                  <Button variant="ghost" disabled={cancelFill.isPending} onClick={() => cancelFill.mutate()}>
                    <Square /> 중단
                  </Button>
                </span>
              ) : (
                <>
                  {fill && (fill.error ? <span className="text-xs text-muted-foreground">용어 번역 채우기 실패: {fill.error}</span> : fill.done > 0 && <span className="text-xs text-muted-foreground tabular-nums">{fill.done.toLocaleString()}개 채움</span>)}
                  {!!suggest.data?.pending && <FillDialog projectId={projectId} pending={suggest.data.pending} calls={suggest.data.calls} batch={suggest.data.batch} />}
                </>
              )}
              <Button variant="outline" disabled={discover.isPending} onClick={() => discover.mutate()}>
                <ScanSearch /> 대본에서 찾기
              </Button>
              <Button onClick={() => select(NEW_TERM)}>
                <Plus /> 용어 추가
              </Button>
            </>
          }
        >
          <SearchInput value={search.q} placeholder="원문·번역·메모 검색" onChange={(value) => void navigate({ search: (previous) => ({ ...previous, q: value }), replace: true })} />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={terms.data && rows}
          rowId={(term) => term.id}
          loading={terms.isLoading}
          empty={needle || search.source || search.state ? '조건에 맞는 용어가 없습니다.' : '아직 용어가 없습니다. ‘대본에서 찾기’로 후보를 찾거나 ‘용어 추가’로 직접 넣으세요.'}
          selected={selected?.id}
          onRowClick={(term) => select(term.id === search.term ? undefined : term.id)}
          picked={picked}
          onPick={(ids, on) =>
            setPicked((previous) => {
              const next = new Set(previous);
              for (const id of ids) if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          bulk={
            <>
              <Button variant="outline" disabled={promotable.length === 0 || decide.isPending} title={promotable.length < discardable.length ? '번역이 빈 후보는 번역을 채운 뒤 정식으로 올릴 수 있습니다.' : undefined} onClick={() => decide.mutate({ ids: promotable.map((term) => term.id), accept: true }, afterBulk)}>
                <Check /> 정식으로 올리기 ({promotable.length.toLocaleString()})
              </Button>
              <Button variant="ghost" className="text-destructive" disabled={discardable.length === 0 || decide.isPending} onClick={() => decide.mutate({ ids: discardable.map((term) => term.id), accept: false }, afterBulk)}>
                <Trash2 /> 버리기 ({discardable.length.toLocaleString()})
              </Button>
            </>
          }
        />
      </SplitPane>
    </Page>
  );
}

/** `?term=new` opens the pane for a term that does not exist yet. */
const NEW_TERM = 'new';

/** The three editable fields of a term, shared by the new-term and edit panes. */
function TermFields({ form, onChange }: { form: { source: string; target: string; note: string }; onChange: (form: { source: string; target: string; note: string }) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="term-source">원문</Label>
        <Input id="term-source" value={form.source} onChange={(event) => onChange({ ...form, source: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-target">번역</Label>
        <Input id="term-target" value={form.target} onChange={(event) => onChange({ ...form, target: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-note">메모</Label>
        <Textarea id="term-note" rows={4} value={form.note} placeholder="선택" onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </div>
    </div>
  );
}

function NewTermPane({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ source: '', target: '', note: '' });
  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.$post({ param: { projectId }, json: form })),
    onSuccess: (created) => {
      toast.success('용어를 추가했습니다.');
      if (created && typeof created === 'object' && 'id' in created && typeof created.id === 'string') onCreated(created.id);
      else onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <DetailPane
      kicker="용어"
      title="새 용어"
      onClose={onClose}
      footer={
        <Button className="ml-auto" disabled={!form.source.trim() || create.isPending} onClick={() => create.mutate()}>
          <Plus /> 추가
        </Button>
      }
    >
      <TermFields form={form} onChange={setForm} />
    </DetailPane>
  );
}

function TermEditor({ projectId, term, onClose, onDecide, deciding }: { projectId: string; term: Term; onClose: () => void; onDecide: (accept: boolean) => void; deciding: boolean }) {
  const [form, setForm] = useState({ source: term.source, target: term.target, note: term.note });
  const dirty = form.source !== term.source || form.target !== term.target || form.note !== term.note;
  const candidate = !isSettled(term);
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
    <DetailPane
      kicker="용어"
      title={term.source}
      subtitle={
        <span className="flex items-center gap-2">
          <SourceBadge row={{ ...term, evidence: [] }} />
          {candidate && <span>후보 · 아직 문맥에 쓰이지 않음</span>}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="text-destructive">
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
          {candidate && (
            <>
              <Button variant="ghost" className="text-destructive" disabled={deciding} onClick={() => onDecide(false)}>
                버리기
              </Button>
              <Button variant="outline" disabled={deciding || dirty || !term.target.trim()} title={term.target.trim() ? (dirty ? '먼저 저장하세요.' : undefined) : '번역을 채운 뒤 정식으로 올릴 수 있습니다.'} onClick={() => onDecide(true)}>
                <Check /> 정식으로 올리기
              </Button>
            </>
          )}
          <Button className="ml-auto" disabled={!dirty || !form.source.trim() || save.isPending} onClick={() => save.mutate()}>
            저장
          </Button>
        </>
      }
    >
      <TermFields form={form} onChange={setForm} />
      <PaneSection
        title={`이 용어가 나오는 대사 ${usage.data?.count ?? '…'}개`}
        actions={
          !!usage.data?.count && (
            <RunDialog
              projectId={projectId}
              unitIds={usage.data.unitIds}
              defaultIgnoreStatus
              trigger={
                <Button variant="outline">
                  <Play /> 다시 실행
                </Button>
              }
            />
          )
        }
      >
        <p className="mb-2 text-xs text-muted-foreground">번역이나 메모를 바꿨다면 이 대사들을 워크플로로 다시 돌려 새 용어를 반영하세요.</p>
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
      </PaneSection>
      <Examples projectId={projectId} keys={term.examples} />
    </DetailPane>
  );
}

/** The first lines containing the term: speaker, source and current translation, each opening in the script. */
function Examples({ projectId, keys }: { projectId: string; keys: string[] }) {
  const shown = keys.slice(0, 3);
  const lines = useQuery(q.linesByKeys(projectId, shown));
  return (
    <PaneSection title="등장 예문">
      {shown.length === 0 && <p className="text-xs text-muted-foreground">예문이 없습니다. ‘대본에서 찾기’로 다시 찾으면 채워집니다.</p>}
      <ul className="space-y-1">
        {lines.data?.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{line.groupTitle} · </span>
              {line.speaker && <span className="font-medium">{line.speaker}: </span>}
              {line.source}
              <span className="block text-muted-foreground">{line.translation || '번역 없음'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PaneSection>
  );
}

/** Confirm a batched AI fill of the empty translations: the expected number of requests, and the profile to use. */
function FillDialog({ projectId, pending, calls, batch }: { projectId: string; pending: number; calls: number; batch: number }) {
  const profiles = useQuery(q.profiles());
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState<string>();
  const start = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.suggest.$post({ param: { projectId }, json: { profileId: profileId! } })),
    onSuccess: () => {
      setOpen(false);
      toast.success('용어 번역 채우기를 시작했습니다. 후보로 들어옵니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles /> 빈 번역 AI로 채우기
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>빈 번역 AI로 채우기</DialogTitle>
          <DialogDescription>
            번역이 빈 후보 {pending.toLocaleString()}개 · 예상 요청 {calls.toLocaleString()}회 (요청당 {batch}개, 예문 2줄씩)
          </DialogDescription>
        </DialogHeader>
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="w-full" aria-label="모델 프로필">
            <SelectValue placeholder="모델 프로필 선택" />
          </SelectTrigger>
          <SelectContent>
            {profiles.data?.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name} · {profile.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button disabled={!profileId || start.isPending} onClick={() => start.mutate()}>
            <Play /> 시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
