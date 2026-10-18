import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { initialRunScope, type RunScopeMode } from '@/lib/run-scope';
import { keepPreviousData, useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { SearchInput, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Skeleton, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, HelpTip } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { LINE_MARK_IDS, type LineMark, UNREVIEWED_MARKS } from '@tw/shared';
import { MarkChip } from '@/components/status';
import type { ModelValue } from '@/components/model-picker';
import { Pace, RunModels } from './run-estimate';
import { lineTags, q } from '@/lib/queries';
import { SCRIPT_VIEW } from '@/lib/labels';
import { cn } from '@/lib/utils';

type Mode = RunScopeMode;
type GroupKind = 'scene' | 'ui' | 'document';
const KIND_ORDER: GroupKind[] = ['scene', 'ui', 'document'];

/**
 * Start a workflow (docs/DESIGN.md J6): one screen with what a person decides on before pressing
 * start — which lines (the scene in view, picked scenes, tagged lines, picked lines, every line of
 * one kind — 대사 · UI · 문서, preselected only from the UI or documents view — or the whole
 * project, never preselected), what in those lines would spoil the translation and where to fix it,
 * how long and how much in plain words, and which models. Nothing more: the batches are the run
 * page's 번역 계획, and the run is capped at the suggested limits (1.3× the estimate; it pauses
 * there, the run page shows them). The count is exactly what will run: scope ∩ entry statuses
 * (unless ignored).
 */
export function RunDialog({ projectId, workflowId: fixedWorkflowId, groupIds: givenGroupIds, unitIds: givenUnitIds, unitsLabel, viewKind, dirty, disabled, trigger, defaultIgnoreStatus = false, preferWorkflow, open: controlledOpen, onOpenChange, hideTrigger = false }: {
  projectId: string;
  /** Omit to let the user pick a workflow (when starting from a scene or a line selection). */
  workflowId?: string;
  groupIds?: string[];
  unitIds?: string[];
  /** What the named lines are, when they are not simply picked ('이번 길 번역 안 한 줄'); the scope button reads it with the count. */
  unitsLabel?: string;
  /** Opened from the script's UI or documents view: every line of that kind is the scope to start from. */
  viewKind?: GroupKind;
  dirty?: boolean;
  disabled?: boolean;
  trigger?: ReactNode;
  /** Start with the entry-status check off (re-running lines that are already done). */
  defaultIgnoreStatus?: boolean;
  /** Preselect the workflow with this name when it exists (e.g. "말투만 고치기"). */
  preferWorkflow?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean;
}) {
  const navigate = useNavigate();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  // The lines and scenes it was opened with stay its scope while it is open: picks cleared or changed
  // behind it (another tab, a refresh of the list) must not turn '고른 대사' into the whole project.
  const [opened, setOpened] = useState<{ unitIds?: string[]; groupIds?: string[] }>({});
  const unitIds = open ? opened.unitIds : givenUnitIds;
  const groupIds = open ? opened.groupIds : givenGroupIds;
  // Dialogue is nearly the whole project, so like the whole project it is never preselected.
  const preselectKind = viewKind && viewKind !== 'scene' ? viewKind : undefined;
  const [mode, setMode] = useState<Mode | undefined>(() => initialRunScope({ unitIds, groupIds, kind: preselectKind }));
  const [pickedKind, setPickedKind] = useState<GroupKind | undefined>(preselectKind);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [pickedMarks, setPickedMarks] = useState<Set<string>>(new Set());
  const statuses = useQuery({ ...q.statuses(projectId), enabled: open });
  const tags = lineTags(statuses.data?.tags);
  const [filter, setFilter] = useState('');
  const [ignoreStatus, setIgnoreStatus] = useState(defaultIgnoreStatus);
  // This run's models by AI node, where the person picked another than the node's own (the workflow is not changed).
  const [runModels, setRunModels] = useState<Record<string, ModelValue>>({});
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open });
  const [chosen, setChosen] = useState<string>();
  const workflowId = fixedWorkflowId ?? chosen ?? (preferWorkflow && workflows.data?.find((workflow) => workflow.name === preferWorkflow && !workflow.errorCount)?.id) ?? workflows.data?.find((workflow) => !workflow.errorCount)?.id;
  const workflow = workflows.data?.find((item) => item.id === workflowId);
  const groups = useQuery({ ...q.groups(projectId), enabled: open });
  const here = groupIds?.length ? groups.data?.filter((group) => groupIds.includes(group.id)) : undefined;

  // Each kind the project has, with its groups and lines (only offered when there is more than one).
  const kinds = KIND_ORDER.map((kind) => {
    const list = (groups.data ?? []).filter((group) => group.kind === kind);
    return { kind, ids: list.map((group) => group.id), lines: list.reduce((sum, group) => sum + group.total, 0) };
  }).filter((entry) => entry.ids.length);
  const kindIds = kinds.find((entry) => entry.kind === pickedKind)?.ids ?? [];
  const scope =
    mode === 'kind' ? { groupIds: kindIds, ignoreStatus } : mode === 'units' ? { unitIds, ignoreStatus } : mode === 'here' ? { groupIds, ignoreStatus } : mode === 'groups' ? { groupIds: [...picked], ignoreStatus } : mode === 'tags' ? { tagIds: [...pickedTags], marks: [...pickedMarks] as LineMark[], ignoreStatus } : { ignoreStatus };
  const ready = (mode === 'kind' && kindIds.length > 0) || mode === 'all' || (mode === 'units' && Boolean(unitIds?.length)) || (mode === 'here' && Boolean(groupIds?.length)) || (mode === 'groups' && picked.size > 0) || (mode === 'tags' && (pickedTags.size > 0 || pickedMarks.size > 0));
  // Only finished picks go out; one still missing its model stays in the picker meanwhile.
  const chosenModels = Object.fromEntries(Object.entries(runModels).filter(([, value]) => value.connectionId && value.model));
  const request = { ...scope, ...(Object.keys(chosenModels).length ? { models: chosenModels } : {}) };
  const plan = useQuery({
    queryKey: ['units', 'run-preflight', workflowId, request],
    queryFn: () => unwrap(client.workflows[':id'].preflight.$post({ param: { id: workflowId! }, json: request })),
    enabled: open && Boolean(workflowId) && ready,
    // Picking another model re-estimates without blanking the dialog (its pickers stay put).
    placeholderData: keepPreviousData,
  });
  const data = ready ? plan.data : undefined;
  // A count that takes this long is stuck (a dropped connection, a server restart): offer to ask again.
  const [slow, setSlow] = useState(false);
  const counting = open && ready && !plan.data && !plan.isError;
  useEffect(() => {
    setSlow(false);
    if (!counting) return;
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [counting, plan.dataUpdatedAt]);
  // The kept plan is another scope's or model's: its counts and caps must not start this run.
  const stale = plan.isPlaceholderData;
  const suggested = data?.suggestedLimits;
  const start = useMutation({
    mutationFn: () => {
      // A safety net, not a choice: the suggested caps, past which the run pauses.
      const limits = { ...(suggested?.maxCalls ? { maxCalls: suggested.maxCalls } : {}), ...(suggested?.maxInputTokens ? { maxInputTokens: suggested.maxInputTokens } : {}) };
      return unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId! }, json: { ...request, ...(Object.keys(limits).length ? { limits } : {}) } }));
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
          setOpened({ unitIds: givenUnitIds, groupIds: givenGroupIds });
          setMode(initialRunScope({ unitIds: givenUnitIds, groupIds: givenGroupIds, kind: preselectKind }));
          setPickedKind(preselectKind);
          setPicked(new Set());
          setRunModels({});
        }
      }}
    >
      {!hideTrigger && <DialogTrigger asChild>
        {trigger ?? (
          <Button disabled={disabled}>
            <Play /> 실행
          </Button>
        )}
      </DialogTrigger>}
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
              {unitIds?.length ? scopeButton('units', `${unitsLabel ?? '고른 대사'} ${unitIds.length.toLocaleString()}줄`) : null}
              {groupIds?.length ? scopeButton('here', here?.length === 1 ? `이 장면 · ${here[0].title}` : `이 장면들 ${groupIds.length}개`) : null}
              {scopeButton('groups', mode === 'groups' && picked.size ? `장면 ${picked.size}개` : '장면 고르기')}
              {scopeButton('tags', '태그로')}
              {kinds.length > 1 &&
                kinds.map((entry) => (
                  <Button key={entry.kind} variant={mode === 'kind' && pickedKind === entry.kind ? 'secondary' : 'outline'} className={cn(mode === 'kind' && pickedKind === entry.kind && 'ring-1 ring-ring ring-inset')} onClick={() => (setMode('kind'), setPickedKind(entry.kind))}>
                    {SCRIPT_VIEW[entry.kind]} {entry.lines.toLocaleString()}줄
                  </Button>
                ))}
              {scopeButton('all', `전체${projectLines ? ` ${projectLines.toLocaleString()}줄` : ''}`)}
            </div>
            {mode === 'groups' && <ScenePicker visible={visible} picked={picked} setPicked={setPicked} filter={filter} setFilter={setFilter} />}
            {mode === 'tags' && <TagPicker tags={tags} picked={pickedTags} setPicked={setPickedTags} marks={pickedMarks} setMarks={setPickedMarks} />}
            <p className="text-sm">
              {!mode ? (
                null
              ) : total === undefined && plan.isError ? (
                <span className="text-destructive">
                  줄 수를 세지 못했습니다: {plan.error.message}{' '}
                  <Button variant="ghost" size="inline" onClick={() => void plan.refetch()}>
                    다시 시도
                  </Button>
                </span>
              ) : total === undefined ? (
                <span className="text-muted-foreground">
                  세는 중…
                  {slow && (
                    <>
                      {' '}서버 응답이 늦습니다.{' '}
                      <Button variant="ghost" size="inline" onClick={() => void plan.refetch()}>
                        다시 시도
                      </Button>
                    </>
                  )}
                </span>
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

          {data && total ? <Readiness projectId={projectId} readiness={data.readiness} oneScene={mode === 'here' && here?.length === 1 ? here[0].id : undefined} scoped={mode !== 'all'} onLeave={() => setOpen(false)} /> : null}
          {data && total ? <Pace data={data} /> : null}
          {data && total ? (
            <RunModels
              nodes={data.nodes}
              picked={runModels}
              onPick={(nodeId, value) => setRunModels((previous) => ({ ...previous, [nodeId]: value }))}
              onReset={(nodeId) => setRunModels(({ [nodeId]: _gone, ...rest }) => rest)}
            />
          ) : null}
          {ready && plan.isError && plan.data && <p className="text-sm text-destructive">계획을 다시 계산하지 못했습니다: {plan.error.message}</p>}
          {ready && plan.isPending && <Skeleton className="h-24 w-full" />}

        </div>

        {start.isError && <p className="text-sm text-destructive">{start.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          {/* A model picked without its model yet would quietly run on the node's own: finish or undo it first. */}
          <Button disabled={!total || !workflowId || stale || start.isPending || Object.keys(chosenModels).length !== Object.keys(runModels).length} onClick={() => start.mutate()}>
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
      <SearchInput value={filter} onChange={(value) => setFilter(value ?? '')} placeholder="장면 찾기" className="w-full" end={`${picked.size}개 선택`} />
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
        <p className="flex items-center gap-1 px-2 text-xs text-muted-foreground">고른 표시와 태그 <HelpTip>선택한 표시와 태그를 모두 가진 줄만 포함합니다. 자동 표시는 시스템이 붙입니다.</HelpTip></p>
        <div className="flex flex-wrap gap-2">
          {LINE_MARK_IDS.map((mark) => (
            <label key={mark} className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted">
              <Checkbox checked={marks.has(mark)} onCheckedChange={(checked) => toggled(setMarks, mark, checked === true)} />
              <MarkChip mark={mark} />
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
function Readiness({ projectId, readiness, oneScene, scoped, onLeave }: { projectId: string; readiness: PlanData['readiness']; oneScene?: string; /** The run covers part of the project, not all of it. */ scoped: boolean; /** A link was followed: the dialog closes. */ onLeave: () => void }) {
  const checks: { ok: boolean; text: ReactNode; link?: ReactNode; uses: 'speech' | 'glossary' }[] = [
    {
      uses: 'speech',
      ok: readiness.unknownListenerLines === 0,
      text: readiness.unknownListenerLines ? `청자를 모르는 대사 ${readiness.unknownListenerLines.toLocaleString()}줄 (말투 규칙이 안 걸림)` : '대사마다 청자가 정해짐',
      link: readiness.unknownListenerLines > 0 && (
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ marks: ['unknownListener'], ...(oneScene && { group: oneScene }) }} onClick={onLeave}>
          청자 정하기{scoped && !oneScene ? ' (프로젝트 전체 목록)' : ''}
        </Link>
      ),
    },
    {
      uses: 'speech',
      ok: readiness.unreviewedRules.count === 0,
      text: readiness.unreviewedRules.count ? `확인 안 한 말투 규칙 ${readiness.unreviewedRules.count}개 (${readiness.unreviewedRules.examples.join(', ')}${readiness.unreviewedRules.count > readiness.unreviewedRules.examples.length ? ' 등' : ''})` : '쓰이는 말투 규칙은 모두 확인됨',
      link: readiness.unreviewedRules.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', marks: [...UNREVIEWED_MARKS], ...(!readiness.unreviewedRules.more && { ids: readiness.unreviewedRules.ids }) }} onClick={onLeave}>
          확인하기{readiness.unreviewedRules.more ? ' (전체 목록에서 보기)' : ''}
        </Link>
      ),
    },
    {
      uses: 'speech',
      ok: readiness.pairsWithoutRule.count === 0,
      text: readiness.pairsWithoutRule.count ? `말투 규칙 없는 화자→청자 ${readiness.pairsWithoutRule.count}쌍 (${readiness.pairsWithoutRule.examples.join(', ')}${readiness.pairsWithoutRule.count > readiness.pairsWithoutRule.examples.length ? ' 등' : ''})` : '자주 말하는 쌍마다 말투 규칙 있음',
      link: readiness.pairsWithoutRule.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people' }} onClick={onLeave}>
          규칙 정하기
        </Link>
      ),
    },
    {
      uses: 'glossary',
      ok: readiness.unreviewedTerms.count === 0,
      text: readiness.unreviewedTerms.count ? `확인 안 한 용어 ${readiness.unreviewedTerms.count}개 (${readiness.unreviewedTerms.examples.join(', ')}${readiness.unreviewedTerms.count > readiness.unreviewedTerms.examples.length ? ' 등' : ''})` : '나오는 용어는 모두 확인됨',
      link: readiness.unreviewedTerms.count > 0 && (
        <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ marks: [...UNREVIEWED_MARKS], ...(!readiness.unreviewedTerms.more && { ids: readiness.unreviewedTerms.ids }) }} onClick={onLeave}>
          확인하기{readiness.unreviewedTerms.more ? ' (전체 목록에서 보기)' : ''}
        </Link>
      ),
    },
  ];
  const rows = checks.filter((row) => readiness.applies[row.uses]);
  // A workflow that neither writes nor judges translations with this context has nothing to get ready.
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs text-muted-foreground">준비 상태 · 이 줄들 기준</h3>
      <ul className="rounded-md border text-sm">
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
