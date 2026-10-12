import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ChevronRight, Play, Search, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

type Mode = 'all' | 'groups' | 'units' | 'tags';

const range = (value: { min: number; expected: number | null; max: number }, unit: string) =>
  value.expected !== null ? `${value.expected.toLocaleString()}${unit}` : `${value.min.toLocaleString()}~${value.max.toLocaleString()}${unit}`;

/** A cap field: empty means no cap; anything else must be a positive whole number. */
const parseCap = (text: string) => {
  const value = Number(text.replace(/,/g, '').trim());
  return text.trim() !== '' && Number.isInteger(value) && value > 0 ? value : undefined;
};

/**
 * Start a workflow on the whole project, chosen groups, tagged lines, or picked lines. The count shown is
 * exactly what will run: scope ∩ entry statuses (unless the user chooses to ignore statuses).
 * Without a selection no scope is preselected: running the whole project is always a deliberate choice.
 */
export function RunDialog({ projectId, workflowId: fixedWorkflowId, groupIds, unitIds, dirty, disabled, trigger, defaultIgnoreStatus = false, preferWorkflow }: {
  projectId: string;
  /** Omit to let the user pick a workflow (when starting from a scene or a line selection). */
  workflowId?: string;
  groupIds?: string[];
  unitIds?: string[];
  dirty?: boolean;
  disabled?: boolean;
  trigger?: ReactNode;
  /** Start with the entry-status check off (re-running lines that are already done). */
  defaultIgnoreStatus?: boolean;
  /** Preselect the workflow with this name when it exists (e.g. "말투만 고치기"). */
  preferWorkflow?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  // undefined = untouched: the field shows the server's suggestion.
  const [caps, setCaps] = useState<{ calls?: string; tokens?: string }>({});
  const initialMode: Mode | undefined = unitIds?.length ? 'units' : groupIds?.length ? 'groups' : undefined;
  const [mode, setMode] = useState<Mode | undefined>(initialMode);
  const [picked, setPicked] = useState<Set<string>>(new Set(groupIds));
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const statuses = useQuery({ ...q.statuses(projectId), enabled: open });
  const tags = statuses.data?.tags ?? [];
  const [filter, setFilter] = useState('');
  const [ignoreStatus, setIgnoreStatus] = useState(defaultIgnoreStatus);
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open && !fixedWorkflowId });
  const [chosen, setChosen] = useState<string>();
  const workflowId = fixedWorkflowId ?? chosen ?? (preferWorkflow && workflows.data?.find((workflow) => workflow.name === preferWorkflow && !workflow.errorCount)?.id) ?? workflows.data?.find((workflow) => !workflow.errorCount)?.id;
  const groups = useQuery({ ...q.groups(projectId), enabled: open && mode === 'groups' });

  const scope =
    mode === 'units' ? { unitIds, ignoreStatus } : mode === 'groups' ? { groupIds: [...picked], ignoreStatus } : mode === 'tags' ? { tagIds: [...pickedTags], ignoreStatus } : {};
  const ready = mode === 'all' || mode === 'units' || (mode === 'groups' && picked.size > 0) || (mode === 'tags' && pickedTags.size > 0);
  const preview = useQuery({
    queryKey: ['units', 'run-preview', workflowId, scope],
    queryFn: () => unwrap(client.workflows[':id'].preview.$post({ param: { id: workflowId! }, json: scope })),
    enabled: open && Boolean(workflowId) && ready,
  });
  const plan = useQuery({
    queryKey: ['units', 'run-preflight', workflowId, scope],
    queryFn: () => unwrap(client.workflows[':id'].preflight.$post({ param: { id: workflowId! }, json: scope })),
    enabled: open && step === 2 && Boolean(workflowId) && ready,
  });
  const suggested = plan.data?.suggestedLimits;
  const callsText = caps.calls ?? (suggested?.maxCalls ? String(suggested.maxCalls) : '');
  const tokensText = caps.tokens ?? (suggested?.maxInputTokens ? String(suggested.maxInputTokens) : '');
  const callsCap = parseCap(callsText);
  const tokensCap = parseCap(tokensText);
  const capsInvalid = (callsText.trim() !== '' && callsCap === undefined) || (tokensText.trim() !== '' && tokensCap === undefined);
  const start = useMutation({
    mutationFn: () => {
      const limits = { ...(callsCap ? { maxCalls: callsCap } : {}), ...(tokensCap ? { maxInputTokens: tokensCap } : {}) };
      return unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId! }, json: { ...scope, ...(Object.keys(limits).length ? { limits } : {}) } }));
    },
    onSuccess: (run) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.runId } });
    },
  });
  const visible = useMemo(() => (groups.data ?? []).filter((group) => `${group.title} ${group.key}`.toLowerCase().includes(filter.toLowerCase())), [groups.data, filter]);
  const count = !ready ? undefined : preview.data?.count;
  const selectedTotal = mode === 'units' ? unitIds!.length : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStep(1);
          setCaps({});
          setMode(initialMode);
          setPicked(new Set(groupIds));
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button disabled={disabled}>
            <Play /> 실행
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={step === 2 ? 'sm:max-w-3xl' : 'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{step === 1 ? '워크플로 실행 · 범위 고르기' : '워크플로 실행 · 번역 준비'}</DialogTitle>
          <DialogDescription>저장된 버전과 현재 AI 프로필 설정을 고정해서 실행합니다.{dirty && ' 저장하지 않은 편집은 포함되지 않습니다.'}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <>
        {!fixedWorkflowId && (
          <Select value={workflowId} onValueChange={setChosen}>
            <SelectTrigger className="w-full" aria-label="워크플로">
              <SelectValue placeholder="워크플로 선택" />
            </SelectTrigger>
            <SelectContent>
              {workflows.data?.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id} disabled={workflow.errorCount > 0}>
                  {workflow.name} <span className="text-muted-foreground">v{workflow.version}{workflow.errorCount > 0 && ' · 오류 있음'}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <RadioGroup value={mode ?? ''} onValueChange={(value) => setMode(value as Mode)} className="gap-2">
          {unitIds?.length ? (
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="units" /> 선택한 대사 {unitIds.length}개
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="groups" /> 장면·묶음 선택{groupIds?.length && mode === 'groups' ? ` (${picked.size}개)` : ''}
          </label>
          {tags.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="tags" /> 태그가 붙은 대사
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all" /> 프로젝트 전체
          </label>
        </RadioGroup>

        {mode === 'groups' && (
          <div className="min-w-0 space-y-2">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="장면·묶음 찾기" />
              <InputGroupAddon align="inline-end" className="text-xs tabular-nums">
                {picked.size}개 선택
              </InputGroupAddon>
            </InputGroup>
            <div className="rounded-md border">
            <ul className="max-h-60 overflow-auto p-1">
              {visible.map((group) => (
                <li key={group.id}>
                  <label className="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                    <Checkbox
                      checked={picked.has(group.id)}
                      onCheckedChange={(checked) =>
                        setPicked((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(group.id);
                          else next.delete(group.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{group.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{group.total}</span>
                  </label>
                </li>
              ))}
            </ul>
            </div>
          </div>
        )}

        {mode === 'tags' && (
          <div className="flex flex-wrap gap-2 rounded-md border p-2">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted">
                <Checkbox
                  checked={pickedTags.has(tag.id)}
                  onCheckedChange={(checked) =>
                    setPickedTags((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(tag.id);
                      else next.delete(tag.id);
                      return next;
                    })
                  }
                />
                #{tag.name} <span className="text-xs text-muted-foreground tabular-nums">{tag.units}</span>
              </label>
            ))}
          </div>
        )}

        {mode && mode !== 'all' && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ignoreStatus} onCheckedChange={(checked) => setIgnoreStatus(Boolean(checked))} className="mt-0.5" />
            <span>
              진입 노드의 상태 조건 무시
              <span className="block text-xs text-muted-foreground">이미 확정된 대사도 다시 돌립니다. 끄면 진입 조건(예: 미번역)에 맞는 대사만 실행합니다.</span>
            </span>
          </label>
        )}

        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
          실행할 대사: <b className="tabular-nums">{!workflowId || !ready ? '—' : count === undefined ? '…' : `${count.toLocaleString()}개`}</b>
          {!mode && <span className="text-muted-foreground"> — 실행 범위를 고르세요.</span>}
          {mode === 'all' && count !== undefined && count > 0 && (
            <span className="mt-1 block text-warning">프로젝트 전체에서 진입 조건에 맞는 대사 모두에 AI를 호출합니다. 비용과 시간을 확인하세요.</span>
          )}
          {selectedTotal !== undefined && count !== undefined && count < selectedTotal && (
            <span className="text-muted-foreground"> (선택 {selectedTotal}개 중 {selectedTotal - count}개는 진입 상태 조건에 맞지 않음)</span>
          )}
        </p>
          </>
        )}
        {step === 2 && <PlanStep plan={plan} callsText={callsText} tokensText={tokensText} onCalls={(value) => setCaps((previous) => ({ ...previous, calls: value }))} onTokens={(value) => setCaps((previous) => ({ ...previous, tokens: value }))} />}
        {start.isError && <p className="text-sm text-destructive">{start.error.message}</p>}
        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button disabled={!count || !workflowId} onClick={() => setStep(2)}>
                다음 <ArrowRight />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={start.isPending}>
                <ArrowLeft /> 뒤로
              </Button>
              <Button disabled={!plan.data || !plan.data.lines.total || capsInvalid || !workflowId || start.isPending} onClick={() => start.mutate()}>
                {start.isPending && <Spinner />} 시작
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Plan = UseQueryResult<InferResponseType<(typeof client.workflows)[':id']['preflight']['$post'], 200>>;

function PlanStep({ plan, callsText, tokensText, onCalls, onTokens }: { plan: Plan; callsText: string; tokensText: string; onCalls: (value: string) => void; onTokens: (value: string) => void }) {
  if (plan.isError) return <p className="rounded-md border px-3 py-2 text-sm">계획을 계산하지 못했습니다: {plan.error.message}</p>;
  const data = plan.data;
  if (!data)
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  const perBatch = data.plan.linesPerBatch;
  const speechRules = data.knowledge.speechRules.confirmed ?? 0;
  const candidateRules = data.knowledge.speechRules.candidate ?? 0;
  return (
    <div className="max-h-[70svh] space-y-4 overflow-auto pr-1">
      <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2 text-sm">
        <p>
          계획 묶음 {data.plan.batches.toLocaleString()}개
          {perBatch && ` · 묶음당 ${perBatch.min.toLocaleString()}~${perBatch.max.toLocaleString()}줄(중앙 ${perBatch.median.toLocaleString()}) · 5줄 이하 ${Math.round(data.plan.smallShare * 100)}%`}
        </p>
        <p>
          예상 호출 <b className="tabular-nums">{range(data.totals.calls, '회')}</b>
          {' · '}입력 토큰 <b className="tabular-nums">{range(data.totals.inputTokens, '')}</b>
        </p>
        <p>
          대사 {data.lines.total.toLocaleString()}줄 (미번역 {data.lines.untranslated.toLocaleString()} · 번역됨 {data.lines.translated.toLocaleString()})
        </p>
      </div>

      <ul className="divide-y rounded-md border">
        {data.nodes.map((node) => (
          <li key={node.nodeId} className="space-y-0.5 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
              <span className="shrink-0 tabular-nums">
                요청 {range(node.requests, '')}
                {!node.everyLine && node.requests.expected === null && <span className="ml-1 text-xs text-muted-foreground">이력 없음</span>}
              </span>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
              {node.connection ? (
                <>
                  <span>{node.connection.name}</span>
                  {node.connection.cli && <Badge variant="outline">CLI</Badge>}
                  {node.sharedWith.length > 0 && <span>함께: {node.sharedWith.join(', ')}</span>}
                </>
              ) : (
                <span>연결 없음</span>
              )}
              <span>프롬프트/요청 {node.promptTokens.toLocaleString()}</span>
              <span>고정/요청 {node.overheadTokens === null ? '미측정' : node.overheadTokens.toLocaleString()}</span>
            </p>
          </li>
        ))}
      </ul>

      <BatchList list={data.plan.list} />

      <ul className="space-y-0.5 text-sm">
        <li>
          작품 분석: {data.knowledge.analysis ? `${data.knowledge.analysis.finishedAt ? new Date(data.knowledge.analysis.finishedAt).toLocaleDateString() : '날짜 미상'} · ${data.knowledge.analysis.model ?? '모델 미상'}` : '없음'}
        </li>
        <li>
          확정 말투 규칙 {speechRules.toLocaleString()}개{candidateRules > 0 && <span className="text-muted-foreground"> (후보 {candidateRules.toLocaleString()}개는 번역에 쓰이지 않음)</span>}
        </li>
        <li>
          청자 미상 {data.knowledge.unknownListenerLines.toLocaleString()} / {data.knowledge.dialogueLines.toLocaleString()}줄
        </li>
      </ul>

      {data.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border px-3 py-2 text-sm">
          {data.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {warning}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            호출 상한 (회)
            <Input inputMode="numeric" value={callsText} onChange={(event) => onCalls(event.target.value)} placeholder="상한 없음" />
          </label>
          <label className="space-y-1 text-sm">
            입력 토큰 상한
            <Input inputMode="numeric" value={tokensText} onChange={(event) => onTokens(event.target.value)} placeholder="상한 없음" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          실행 중 이 값에 닿으면 실행이 일시정지하고 이유를 보여 줍니다. 예상치의 1.3배로 채워 두었습니다.
          {data.suggestedLimits.maxInputTokens === undefined && ' 요청당 고정 토큰을 아직 잰 적 없는 연결이 있어 입력 토큰 상한은 비워 두었습니다(한 번 실행하면 측정됩니다).'}
        </p>
      </div>
    </div>
  );
}

const JOINED = { link: '그래프로 이어짐', speaker: '화자 겹침', fill: '덜 찬 묶음 채움' } as const;

/** The plan batch by batch: which scenes travel in one request, and why each joined the one before. */
export function BatchList({ list, defaultOpen = false }: { list: NonNullable<Plan['data']>['plan']['list']; defaultOpen?: boolean }) {
  if (!list.total) return null;
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="group -ml-2">
          <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
          묶음 구성 보기 ({list.total.toLocaleString()}개)
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 divide-y rounded-md border">
          {list.batches.map((batch, index) => (
            <li key={index} className="space-y-1 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground tabular-nums">
                #{index + 1} · {batch.lines.toLocaleString()}줄 · 원문 토큰 {batch.tokens.toLocaleString()}
              </p>
              <ul className="space-y-0.5">
                {batch.scenes.map((scene) => (
                  <li key={scene.groupId}>
                    {scene.title} <span className="tabular-nums text-muted-foreground">({scene.lines})</span>
                    {scene.joined && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ← {JOINED[scene.joined.why]}
                        {scene.joined.why === 'speaker' && `: ${scene.joined.speakers.join(', ')}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {list.total > list.batches.length && <p className="mt-1 text-xs text-muted-foreground">앞 {list.batches.length.toLocaleString()}개만 보여 줍니다.</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
