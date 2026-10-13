import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Play, Search, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Mode = 'all' | 'here' | 'groups' | 'units' | 'tags';

const range = (value: { min: number; expected: number | null; max: number }, unit: string) =>
  value.expected !== null ? `${value.expected.toLocaleString()}${unit}` : `${value.min.toLocaleString()}~${value.max.toLocaleString()}${unit}`;

/** A cap field: empty means no cap; anything else must be a positive whole number. */
const parseCap = (text: string) => {
  const value = Number(text.replace(/,/g, '').trim());
  return text.trim() !== '' && Number.isInteger(value) && value > 0 ? value : undefined;
};

/**
 * Start a workflow (docs/DESIGN.md J6): one screen with what a person decides on before pressing
 * start — which lines (the scene in view, picked scenes, tagged lines, picked lines or the whole
 * project, never preselected), what in those lines would spoil the translation and where to fix it,
 * how long and how much in plain words, and which models. Batches, tokens and caps are under
 * "자세히". The count is exactly what will run: scope ∩ entry statuses (unless ignored).
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
  // undefined = untouched: the field shows the server's suggestion.
  const [caps, setCaps] = useState<{ calls?: string; tokens?: string }>({});
  const initialMode: Mode | undefined = unitIds?.length ? 'units' : groupIds?.length ? 'here' : undefined;
  const [mode, setMode] = useState<Mode | undefined>(initialMode);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const statuses = useQuery({ ...q.statuses(projectId), enabled: open });
  const tags = statuses.data?.tags ?? [];
  const [filter, setFilter] = useState('');
  const [ignoreStatus, setIgnoreStatus] = useState(defaultIgnoreStatus);
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open });
  const [chosen, setChosen] = useState<string>();
  const workflowId = fixedWorkflowId ?? chosen ?? (preferWorkflow && workflows.data?.find((workflow) => workflow.name === preferWorkflow && !workflow.errorCount)?.id) ?? workflows.data?.find((workflow) => !workflow.errorCount)?.id;
  const workflow = workflows.data?.find((item) => item.id === workflowId);
  const groups = useQuery({ ...q.groups(projectId), enabled: open });
  const here = groupIds?.length ? groups.data?.filter((group) => groupIds.includes(group.id)) : undefined;

  const scope =
    mode === 'units' ? { unitIds, ignoreStatus } : mode === 'here' ? { groupIds, ignoreStatus } : mode === 'groups' ? { groupIds: [...picked], ignoreStatus } : mode === 'tags' ? { tagIds: [...pickedTags], ignoreStatus } : { ignoreStatus };
  const ready = mode === 'all' || mode === 'units' || mode === 'here' || (mode === 'groups' && picked.size > 0) || (mode === 'tags' && pickedTags.size > 0);
  const plan = useQuery({
    queryKey: ['units', 'run-preflight', workflowId, scope],
    queryFn: () => unwrap(client.workflows[':id'].preflight.$post({ param: { id: workflowId! }, json: scope })),
    enabled: open && Boolean(workflowId) && ready,
  });
  const data = ready ? plan.data : undefined;
  const suggested = data?.suggestedLimits;
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
  const total = data?.lines.total;
  const projectLines = (groups.data ?? []).reduce((sum, group) => sum + group.total, 0);
  const scopeButton = (value: Mode, label: ReactNode) => (
    <Button key={value} variant={mode === value ? 'secondary' : 'outline'} className={cn(mode === value && 'ring-1 ring-ring')} onClick={() => setMode(value)}>
      {label}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCaps({});
          setMode(initialMode);
          setPicked(new Set());
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{workflow ? `${workflow.name} 실행` : '워크플로 실행'}</DialogTitle>
          <DialogDescription>
            저장된 워크플로와 지금의 모델 설정으로 실행합니다.{dirty && ' 저장하지 않은 편집은 들어가지 않습니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70svh] space-y-5 overflow-auto pr-1">
          {!fixedWorkflowId && (
            <Select value={workflowId} onValueChange={setChosen}>
              <SelectTrigger className="w-full" aria-label="워크플로">
                <SelectValue placeholder="워크플로 선택" />
              </SelectTrigger>
              <SelectContent>
                {workflows.data?.map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={item.errorCount > 0}>
                    {item.name} {item.errorCount > 0 && <span className="text-muted-foreground">· 오류 있음</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <section className="space-y-2">
            <h3 className="text-xs text-muted-foreground">무엇을</h3>
            <div className="flex flex-wrap gap-2">
              {unitIds?.length ? scopeButton('units', `고른 대사 ${unitIds.length}줄`) : null}
              {groupIds?.length ? scopeButton('here', here?.length === 1 ? `이 장면 · ${here[0].title}` : `이 장면들 ${groupIds.length}개`) : null}
              {scopeButton('groups', mode === 'groups' && picked.size ? `장면 ${picked.size}개` : '장면 고르기')}
              {tags.length > 0 && scopeButton('tags', '태그로')}
              {scopeButton('all', `전체${projectLines ? ` ${projectLines.toLocaleString()}줄` : ''}`)}
            </div>
            {mode === 'groups' && <ScenePicker visible={visible} picked={picked} setPicked={setPicked} filter={filter} setFilter={setFilter} />}
            {mode === 'tags' && <TagPicker tags={tags} picked={pickedTags} setPicked={setPickedTags} />}
            <p className="text-sm">
              {!mode ? (
                <span className="text-muted-foreground">번역할 범위를 고르세요.</span>
              ) : total === undefined ? (
                <span className="text-muted-foreground">세는 중…</span>
              ) : total === 0 ? (
                <span className="text-muted-foreground">이 범위에는 실행할 대사가 없습니다.{!ignoreStatus && ' 이미 진행된 줄이면 아래 "이미 진행된 줄도"를 켜세요.'}</span>
              ) : (
                <>
                  <b className="font-medium tabular-nums">{total.toLocaleString()}줄</b>을 실행합니다
                  {data!.lines.translated > 0 && <span className="text-muted-foreground"> (그중 이미 번역 있는 줄 {data!.lines.translated.toLocaleString()})</span>}
                </>
              )}
            </p>
            {mode === 'all' && Boolean(total) && <p className="text-xs text-warning">프로젝트 전체입니다. 처음이면 장면 하나로 먼저 시험해 보세요.</p>}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={ignoreStatus} onCheckedChange={(checked) => setIgnoreStatus(Boolean(checked))} />
              이미 진행된 줄도 다시 돌리기 (워크플로의 시작 상태 조건 무시)
            </label>
          </section>

          {data && total ? <Readiness projectId={projectId} readiness={data.readiness} oneScene={mode === 'here' && here?.length === 1 ? here[0].id : undefined} /> : null}
          {data && total ? <Pace data={data} /> : null}
          {ready && plan.isError && <p className="text-sm text-destructive">계획을 계산하지 못했습니다: {plan.error.message}</p>}
          {ready && plan.isPending && <Skeleton className="h-24 w-full" />}

          {data && total ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="group -ml-2 text-muted-foreground">
                  <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" /> 자세히 (단계별 요청, 묶음, 상한)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-4">
                <Details data={data} callsText={callsText} tokensText={tokensText} onCalls={(value) => setCaps((previous) => ({ ...previous, calls: value }))} onTokens={(value) => setCaps((previous) => ({ ...previous, tokens: value }))} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>

        {start.isError && <p className="text-sm text-destructive">{start.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={!total || capsInvalid || !workflowId || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner /> : <Play />} {total ? `${total.toLocaleString()}줄 실행 시작` : '실행 시작'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Plan = UseQueryResult<InferResponseType<(typeof client.workflows)[':id']['preflight']['$post'], 200>>;
type PlanData = NonNullable<Plan['data']>;

function ScenePicker({ visible, picked, setPicked, filter, setFilter }: { visible: { id: string; title: string; total: number }[]; picked: Set<string>; setPicked: (update: (previous: Set<string>) => Set<string>) => void; filter: string; setFilter: (value: string) => void }) {
  return (
    <div className="min-w-0 space-y-2">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="장면 찾기" />
        <InputGroupAddon align="inline-end" className="text-xs tabular-nums">
          {picked.size}개 선택
        </InputGroupAddon>
      </InputGroup>
      <ul className="max-h-52 overflow-auto rounded-md border p-1">
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
  );
}

function TagPicker({ tags, picked, setPicked }: { tags: { id: string; name: string; units: number }[]; picked: Set<string>; setPicked: (update: (previous: Set<string>) => Set<string>) => void }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-md border p-2">
      {tags.map((tag) => (
        <label key={tag.id} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted">
          <Checkbox
            checked={picked.has(tag.id)}
            onCheckedChange={(checked) =>
              setPicked((previous) => {
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
  );
}

/** What in these lines would make the translation worse, each with where to fix it. */
function Readiness({ projectId, readiness, oneScene }: { projectId: string; readiness: PlanData['readiness']; oneScene?: string }) {
  const rows: { ok: boolean; text: ReactNode; link?: ReactNode }[] = [
    {
      ok: readiness.unknownListenerLines === 0,
      text: readiness.unknownListenerLines ? `청자를 모르는 대사 ${readiness.unknownListenerLines.toLocaleString()}줄 (말투 규칙이 안 걸림)` : '대사마다 청자가 정해짐',
      link: readiness.unknownListenerLines > 0 && (
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ listener: '-', view: 'find', ...(oneScene && { group: oneScene }) }}>
          찾아가기
        </Link>
      ),
    },
    {
      ok: readiness.unreviewedRules.count === 0,
      text: readiness.unreviewedRules.count ? `확인 안 한 말투 규칙 ${readiness.unreviewedRules.count}개 (${readiness.unreviewedRules.examples.join(', ')}${readiness.unreviewedRules.count > readiness.unreviewedRules.examples.length ? ' 등' : ''})` : '쓰이는 말투 규칙은 모두 확인됨',
      link: readiness.unreviewedRules.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', state: 'ai' }}>
          확인하기
        </Link>
      ),
    },
    {
      ok: readiness.unreviewedTerms.count === 0,
      text: readiness.unreviewedTerms.count ? `확인 안 한 용어 ${readiness.unreviewedTerms.count}개 (${readiness.unreviewedTerms.examples.join(', ')}${readiness.unreviewedTerms.count > readiness.unreviewedTerms.examples.length ? ' 등' : ''})` : '나오는 용어는 모두 확인됨',
      link: readiness.unreviewedTerms.count > 0 && (
        <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ state: 'ai' }}>
          확인하기
        </Link>
      ),
    },
  ];
  return (
    <section className="space-y-2">
      <h3 className="text-xs text-muted-foreground">준비 상태 · 이 줄들 기준</h3>
      <ul className="divide-y rounded-md border text-sm">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-2 px-3 py-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', row.ok ? 'bg-success' : 'bg-warning')} />
            <span className={cn('min-w-0 flex-1', row.ok && 'text-muted-foreground')}>{row.text}</span>
            {row.link && (
              <Button variant="ghost" size="inline" asChild>
                {row.link}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {rows.some((row) => !row.ok) && <p className="text-xs text-muted-foreground">고치지 않고 시작해도 됩니다. 고치면 그만큼 번역이 정확해집니다.</p>}
    </section>
  );
}

const duration = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds / 10) * 10)}초` : seconds < 5400 ? `${Math.round(seconds / 60)}분` : `${(seconds / 3600).toFixed(1)}시간`);

/** How long and how much, in plain words; the models in one line when every step uses the same. */
function Pace({ data }: { data: PlanData }) {
  const calls = data.totals.calls;
  const callText = calls.expected !== null ? `${calls.expected.toLocaleString()}회` : `${calls.min.toLocaleString()}~${calls.max.toLocaleString()}회`;
  const { seconds, costUsd, subscription } = data.pace;
  const money = subscription && (costUsd === 0 || costUsd === null) ? '구독 사용 (추가 비용 없음)' : costUsd === null ? '비용은 첫 실행 뒤에 압니다' : costUsd < 0.01 ? '1센트 미만' : `약 $${costUsd.toFixed(2)}${subscription ? ' + 구독 사용' : ''}`;
  const models = [...new Set(data.nodes.map((node) => node.model ?? '모델 없음'))];
  return (
    <section className="space-y-1">
      <h3 className="text-xs text-muted-foreground">얼마나</h3>
      <p className="text-sm">
        AI 요청 <b className="font-medium tabular-nums">{callText}</b> · {seconds === null ? '시간은 첫 실행 뒤에 압니다' : <>약 <b className="font-medium">{duration(seconds)}</b></>} · {money}
      </p>
      <p className="text-xs text-muted-foreground">
        {models.length === 1 ? `모델: ${models[0]} (모든 단계)` : `모델: ${data.nodes.map((node) => `${node.name} ${node.model ?? '없음'}`).join(' · ')}`}
      </p>
    </section>
  );
}

/** The numbers behind the estimate, for whoever wants them: requests per step, the batches, the caps. */
function Details({ data, callsText, tokensText, onCalls, onTokens }: { data: PlanData; callsText: string; tokensText: string; onCalls: (value: string) => void; onTokens: (value: string) => void }) {
  return (
    <>
      <ul className="divide-y rounded-md border">
        {data.nodes.map((node) => (
          <li key={node.nodeId} className="space-y-0.5 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="shrink-0 tabular-nums">
                요청 {range(node.requests, '회')}
                {!node.everyLine && node.requests.expected === null && <span className="ml-1 text-xs text-muted-foreground">(실패한 줄만, 이력 없음)</span>}
              </span>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
              <span>{node.model ?? '연결 없음'}</span>
              {node.connection?.cli && <Badge variant="outline">CLI</Badge>}
              {node.sharedWith.length > 0 && <span>함께: {node.sharedWith.join(', ')}</span>}
              <span>요청당 약 {(node.promptTokens + (node.overheadTokens ?? 0)).toLocaleString()}토큰</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        장면을 묶어 {data.plan.batches.toLocaleString()}번에 나눠 보냅니다
        {data.plan.linesPerBatch && ` (한 번에 ${data.plan.linesPerBatch.min}~${data.plan.linesPerBatch.max}줄)`} · 입력 토큰 {range(data.totals.inputTokens, '')}
      </p>
      <BatchList list={data.plan.list} />
      {data.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {data.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {warning}
            </li>
          ))}
        </ul>
      )}
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
      <p className="text-xs text-muted-foreground">닿으면 실행이 일시정지합니다. 예상의 1.3배로 채워 두었습니다.</p>
    </>
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
