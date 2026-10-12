import { Fragment, useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, ScanSearch, Search, Sparkles, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { candidateRow, KnowledgeFilters, matches, SourceBadge } from '@/components/knowledge/draft-editor';
import { isSettled, KNOWLEDGE_SOURCES, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus } from '@tw/shared';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';
import { SplitPane } from '@/components/split-pane';
import { PaneHeader } from '@/components/pane-header';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const [draft, setDraft] = useState({ source: '', target: '', note: '' });
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
      <SplitPane
        id="glossary"
        defaultWidth="380px"
        className="min-h-0 rounded-lg border"
        pane={
          selected && (
            <div className="h-full">
              <TermEditor key={selected.id} projectId={projectId} term={selected} onClose={() => select(undefined)} />
            </div>
          )
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <KnowledgeFilters
              source={search.source}
              status={search.state}
              onChange={(next) => void navigate({ search: (previous) => ({ ...previous, ...('source' in next && { source: next.source }), ...('status' in next && { state: next.status }), term: undefined }), replace: true })}
            />
            {/* A term without a Korean form cannot be official: it would put an empty target in every prompt. */}
            {all.some((term) => !isSettled(term) && term.target.trim()) && (
              <Button size="sm" variant="outline" onClick={() => decide.mutate({ ids: all.filter((term) => !isSettled(term) && term.target.trim()).map((term) => term.id), accept: true })}>
                <Check /> 번역 있는 후보 모두 정식으로 ({all.filter((term) => !isSettled(term) && term.target.trim()).length.toLocaleString()})
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
            <Button size="sm" variant="outline" disabled={discover.isPending} onClick={() => discover.mutate()}>
              <ScanSearch /> 대본에서 찾기
            </Button>
            {fill?.running ? (
              <span className="flex items-center gap-2 text-sm tabular-nums">
                <Sparkles className="size-4 animate-pulse" /> 용어 번역 채우는 중 {fill.done.toLocaleString()}/{fill.total.toLocaleString()}
                <Button size="sm" variant="ghost" className="h-7" disabled={cancelFill.isPending} onClick={() => cancelFill.mutate()}>
                  <Square /> 중단
                </Button>
              </span>
            ) : (
              <>
                {!!suggest.data?.pending && <FillDialog projectId={projectId} pending={suggest.data.pending} calls={suggest.data.calls} batch={suggest.data.batch} />}
                {fill && (fill.error ? <span className="text-sm text-muted-foreground">용어 번역 채우기 실패: {fill.error}</span> : fill.done > 0 && <span className="text-sm text-muted-foreground tabular-nums">{fill.done.toLocaleString()}개 채움</span>)}
              </>
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
                <TableHead className="w-20 text-right">등장</TableHead>
                <TableHead>메모</TableHead>
                <TableHead className="w-56">출처</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!search.source && !search.state && (
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                {(['source', 'target', 'note'] as const).map((field) => (
                  <Fragment key={field}>
                    {field === 'note' && <TableCell />}
                  <TableCell>
                    <Input
                      aria-label={{ source: '새 용어 원문', target: '새 용어 번역', note: '새 용어 메모' }[field]}
                      placeholder={{ source: '원문', target: '번역', note: '메모 (선택)' }[field]}
                      value={draft[field]}
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                      onKeyDown={(event) => event.key === 'Enter' && draft.source.trim() && create.mutate()}
                    />
                  </TableCell>
                  </Fragment>
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
                  <TableCell className="text-right tabular-nums">{term.lines ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{term.note}</TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {isSettled(term) ? (
                      <SourceBadge row={asDraft(term)} />
                    ) : (
                      <div className="flex items-center gap-1">
                        <SourceBadge row={asDraft(term)} />
                        <Button size="sm" variant="outline" className="h-7" disabled={!term.target.trim()} title={term.target.trim() ? undefined : '번역을 채운 뒤 정식으로 올릴 수 있습니다.'} onClick={() => decide.mutate({ ids: [term.id], accept: true })}>
                          <Check /> 정식으로
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => decide.mutate({ ids: [term.id], accept: false })}>
                          <Trash2 /> 버리기
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {terms.data && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    {needle ? '조건에 맞는 용어가 없습니다.' : search.source || search.state ? '조건에 맞는 용어가 없습니다. 워크플로의 ‘용어 후보 추가’ 함수가 AI 용어를 모읍니다.' : '아직 용어가 없습니다. ‘대본에서 찾기’로 후보를 찾거나 위에서 직접 추가하세요.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SplitPane>
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
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader kicker="용어" title={term.source} subtitle={<SourceBadge row={{ ...term, evidence: [] }} />} onClose={onClose} />
      <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-4">
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
      <Examples projectId={projectId} keys={term.examples} />
      </div>
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-between border-t px-4 py-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive">
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

/** The first lines containing the term: speaker, source and current translation, each opening in the script. */
function Examples({ projectId, keys }: { projectId: string; keys: string[] }) {
  const shown = keys.slice(0, 3);
  const lines = useQuery(q.linesByKeys(projectId, shown));
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-xs font-medium text-muted-foreground">등장 예문</h3>
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
    </section>
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
        <Button size="sm" variant="outline">
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
