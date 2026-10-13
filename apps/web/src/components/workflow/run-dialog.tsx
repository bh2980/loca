import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { AUTO_MARKS, type AutoMark } from '@/lib/marks';
import { lineTags, q } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Mode = 'all' | 'here' | 'groups' | 'units' | 'tags';

/**
 * Start a workflow (docs/DESIGN.md J6): one screen with what a person decides on before pressing
 * start — which lines (the scene in view, picked scenes, tagged lines, picked lines or the whole
 * project, never preselected), what in those lines would spoil the translation and where to fix it,
 * how long and how much in plain words, and which models. Nothing more: the batches are the run
 * page's 번역 계획, and the run is capped at the suggested limits (1.3× the estimate; it pauses
 * there, the run page shows them). The count is exactly what will run: scope ∩ entry statuses
 * (unless ignored).
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
  const initialMode: Mode | undefined = unitIds?.length ? 'units' : groupIds?.length ? 'here' : undefined;
  const [mode, setMode] = useState<Mode | undefined>(initialMode);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [pickedMarks, setPickedMarks] = useState<Set<string>>(new Set());
  const statuses = useQuery({ ...q.statuses(projectId), enabled: open });
  const tags = lineTags(statuses.data?.tags);
  const [filter, setFilter] = useState('');
  const [ignoreStatus, setIgnoreStatus] = useState(defaultIgnoreStatus);
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open });
  const [chosen, setChosen] = useState<string>();
  const workflowId = fixedWorkflowId ?? chosen ?? (preferWorkflow && workflows.data?.find((workflow) => workflow.name === preferWorkflow && !workflow.errorCount)?.id) ?? workflows.data?.find((workflow) => !workflow.errorCount)?.id;
  const workflow = workflows.data?.find((item) => item.id === workflowId);
  const groups = useQuery({ ...q.groups(projectId), enabled: open });
  const here = groupIds?.length ? groups.data?.filter((group) => groupIds.includes(group.id)) : undefined;

  const scope =
    mode === 'units' ? { unitIds, ignoreStatus } : mode === 'here' ? { groupIds, ignoreStatus } : mode === 'groups' ? { groupIds: [...picked], ignoreStatus } : mode === 'tags' ? { tagIds: [...pickedTags], marks: [...pickedMarks] as AutoMark[], ignoreStatus } : { ignoreStatus };
  const ready = mode === 'all' || mode === 'units' || mode === 'here' || (mode === 'groups' && picked.size > 0) || (mode === 'tags' && (pickedTags.size > 0 || pickedMarks.size > 0));
  const plan = useQuery({
    queryKey: ['units', 'run-preflight', workflowId, scope],
    queryFn: () => unwrap(client.workflows[':id'].preflight.$post({ param: { id: workflowId! }, json: scope })),
    enabled: open && Boolean(workflowId) && ready,
  });
  const data = ready ? plan.data : undefined;
  const suggested = data?.suggestedLimits;
  const start = useMutation({
    mutationFn: () => {
      // A safety net, not a choice: the suggested caps, past which the run pauses.
      const limits = { ...(suggested?.maxCalls ? { maxCalls: suggested.maxCalls } : {}), ...(suggested?.maxInputTokens ? { maxInputTokens: suggested.maxInputTokens } : {}) };
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
    <Button key={value} variant={mode === value ? 'secondary' : 'outline'} className={cn(mode === value && 'ring-1 ring-ring ring-inset')} onClick={() => setMode(value)}>
      {label}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          {/* With the workflow picker below, the title would only repeat its name. */}
          <DialogTitle>{fixedWorkflowId && workflow ? `${workflow.name} 실행` : '워크플로 실행'}</DialogTitle>
          {dirty ? <DialogDescription className="text-warning">저장하지 않은 편집은 들어가지 않습니다.</DialogDescription> : <DialogDescription className="sr-only">실행할 범위를 고르고 시작합니다.</DialogDescription>}
        </DialogHeader>

        {/* Side padding so focus rings and the picked scope are not cut by the scroll box. */}
        <div className="-mx-1 max-h-[70svh] space-y-5 overflow-auto px-1 py-0.5">
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
              {scopeButton('tags', '태그로')}
              {scopeButton('all', `전체${projectLines ? ` ${projectLines.toLocaleString()}줄` : ''}`)}
            </div>
            {mode === 'groups' && <ScenePicker visible={visible} picked={picked} setPicked={setPicked} filter={filter} setFilter={setFilter} />}
            {mode === 'tags' && <TagPicker tags={tags} picked={pickedTags} setPicked={setPickedTags} marks={pickedMarks} setMarks={setPickedMarks} />}
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
              이미 진행된 줄도 다시
            </label>
          </section>

          {data && total ? <Readiness projectId={projectId} readiness={data.readiness} oneScene={mode === 'here' && here?.length === 1 ? here[0].id : undefined} onLeave={() => setOpen(false)} /> : null}
          {data && total ? <Pace data={data} /> : null}
          {ready && plan.isError && <p className="text-sm text-destructive">계획을 계산하지 못했습니다: {plan.error.message}</p>}
          {ready && plan.isPending && <Skeleton className="h-24 w-full" />}

        </div>

        {start.isError && <p className="text-sm text-destructive">{start.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={!total || !workflowId || start.isPending} onClick={() => start.mutate()}>
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

type SetPicked = (update: (previous: Set<string>) => Set<string>) => void;

/** Ticks one id in or out of a picked set. */
const toggled = (setPicked: SetPicked, id: string, checked: boolean) =>
  setPicked((previous) => {
    const next = new Set(previous);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });

/** Automatic marks above the tags; a line must have every one picked, as in the line list's filter. */
function TagPicker({ tags, picked, setPicked, marks, setMarks }: { tags: { id: string; name: string; units: number }[]; picked: Set<string>; setPicked: SetPicked; marks: Set<string>; setMarks: SetPicked }) {
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="space-y-1">
        <p className="px-2 text-xs text-muted-foreground">고른 표시와 태그를 모두 가진 줄 · 자동 표시</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(AUTO_MARKS) as AutoMark[]).map((mark) => (
            <label key={mark} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted">
              <Checkbox checked={marks.has(mark)} onCheckedChange={(checked) => toggled(setMarks, mark, checked === true)} />#{AUTO_MARKS[mark]}
            </label>
          ))}
        </div>
      </div>
      {tags.length > 0 && (
        <div className="space-y-1">
          <p className="px-2 text-xs text-muted-foreground">태그</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted">
                <Checkbox checked={picked.has(tag.id)} onCheckedChange={(checked) => toggled(setPicked, tag.id, checked === true)} />#{tag.name} <span className="text-xs text-muted-foreground tabular-nums">{tag.units}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** What in these lines would make the translation worse, each with where to fix it. */
function Readiness({ projectId, readiness, oneScene, onLeave }: { projectId: string; readiness: PlanData['readiness']; oneScene?: string; /** A link was followed: the dialog closes. */ onLeave: () => void }) {
  const rows: { ok: boolean; text: ReactNode; link?: ReactNode }[] = [
    {
      ok: readiness.unknownListenerLines === 0,
      text: readiness.unknownListenerLines ? `청자를 모르는 대사 ${readiness.unknownListenerLines.toLocaleString()}줄 (말투 규칙이 안 걸림)` : '대사마다 청자가 정해짐',
      link: readiness.unknownListenerLines > 0 && (
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ listener: '-', ...(oneScene && { group: oneScene }) }} onClick={onLeave}>
          청자 정하기
        </Link>
      ),
    },
    {
      ok: readiness.unreviewedRules.count === 0,
      text: readiness.unreviewedRules.count ? `확인 안 한 말투 규칙 ${readiness.unreviewedRules.count}개 (${readiness.unreviewedRules.examples.join(', ')}${readiness.unreviewedRules.count > readiness.unreviewedRules.examples.length ? ' 등' : ''})` : '쓰이는 말투 규칙은 모두 확인됨',
      link: readiness.unreviewedRules.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', state: 'ai' }} onClick={onLeave}>
          확인하기
        </Link>
      ),
    },
    {
      ok: readiness.pairsWithoutRule.count === 0,
      text: readiness.pairsWithoutRule.count ? `말투 규칙 없는 화자→청자 ${readiness.pairsWithoutRule.count}쌍 (${readiness.pairsWithoutRule.examples.join(', ')}${readiness.pairsWithoutRule.count > readiness.pairsWithoutRule.examples.length ? ' 등' : ''})` : '자주 말하는 쌍마다 말투 규칙 있음',
      link: readiness.pairsWithoutRule.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people' }} onClick={onLeave}>
          규칙 정하기
        </Link>
      ),
    },
    {
      ok: readiness.unreviewedTerms.count === 0,
      text: readiness.unreviewedTerms.count ? `확인 안 한 용어 ${readiness.unreviewedTerms.count}개 (${readiness.unreviewedTerms.examples.join(', ')}${readiness.unreviewedTerms.count > readiness.unreviewedTerms.examples.length ? ' 등' : ''})` : '나오는 용어는 모두 확인됨',
      link: readiness.unreviewedTerms.count > 0 && (
        <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ state: 'ai' }} onClick={onLeave}>
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
            <span className={cn('min-w-0 flex-1 truncate', row.ok && 'text-muted-foreground')} title={typeof row.text === 'string' ? row.text : undefined}>
              {row.text}
            </span>
            {row.link && (
              <Button variant="ghost" size="inline" className="shrink-0" asChild>
                {row.link}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const duration = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds / 10) * 10)}초` : seconds < 5400 ? `${Math.round(seconds / 60)}분` : `${(seconds / 3600).toFixed(1)}시간`);

/** How long and how much, in plain words; the models in one line when every step uses the same. */
function Pace({ data }: { data: PlanData }) {
  const calls = data.totals.calls;
  const callText = calls.expected !== null ? `${calls.expected.toLocaleString()}회` : `${calls.min.toLocaleString()}~${calls.max.toLocaleString()}회`;
  const { seconds, costUsd, subscription } = data.pace;
  // Only what is known: no time without history, no cost the provider never reported.
  const money = subscription && !costUsd ? '구독 사용' : costUsd === null ? null : costUsd < 0.01 ? '1센트 미만' : `약 $${costUsd.toFixed(2)}${subscription ? ' + 구독' : ''}`;
  const models = [...new Set(data.nodes.map((node) => node.model ?? '모델 없음'))];
  return (
    <section className="space-y-1">
      <h3 className="text-xs text-muted-foreground">얼마나</h3>
      <p className="text-sm">
        AI 요청 <b className="font-medium tabular-nums">{callText}</b>
        {seconds !== null && (
          <>
            {' · 약 '}
            <b className="font-medium">{duration(seconds)}</b>
          </>
        )}
        {money && ` · ${money}`}
      </p>
      <p className="text-xs text-muted-foreground">
        {models.length === 1 ? `모델: ${models[0]} (모든 단계)` : `모델: ${data.nodes.map((node) => `${node.name} ${node.model ?? '없음'}`).join(' · ')}`}
      </p>
    </section>
  );
}
