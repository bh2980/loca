import { useEffect, useRef, useState, type ReactNode } from 'react';
import { initialRunScope, type RunScopeMode } from '@/lib/run-scope';
import { keepPreviousData, useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Play } from 'lucide-react';
import { SearchInput, Button, Checkbox, Label, RadioGroup, RadioGroupItem, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Skeleton, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, StatusIcon, SectionHeading, FieldRows, FieldRow } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { KNOWLEDGE_STATUS_LABELS, LINE_MARK_IDS, type AutoMark, type LineMark, UNREVIEWED_MARKS } from '@tw/shared';
import { MarkChip } from '@/components/status';
import type { ModelValue } from '@/components/model-picker';
import { Pace, RunModels } from './run-estimate';
import { lineTags, q } from '@/lib/queries';
import { SCRIPT_VIEW } from '@/lib/labels';
import { cn } from '@/lib/utils';

type GroupKind = 'scene' | 'ui' | 'document';
const KIND_ORDER: GroupKind[] = ['scene', 'ui', 'document'];

/**
 * Start a workflow: one screen with what a person decides on before pressing
 * start — which lines (the scene in view, picked scenes, tagged lines, picked lines, every line of
 * one kind — 대사 · UI · 문서, preselected only from the UI or documents view — or the whole
 * project, never preselected), what in those lines would spoil the translation and where to fix it,
 * how long and how much in plain words, and which models.
 */
export function RunDialog({ projectId, workflowId: fixedWorkflowId, groupIds: givenGroupIds, unitIds: givenUnitIds, termIds: givenTermIds, subject: givenSubject = 'lines', unitsLabel, viewKind, dirty, disabled, trigger, defaultIgnoreStatus = false, remember, open: controlledOpen, onOpenChange, hideTrigger = false }: {
  projectId: string;
  /** Omit to let the user pick a workflow (when starting from a scene or a line selection). */
  workflowId?: string;
  groupIds?: string[];
  unitIds?: string[];
  /** What the run starts on (the dialog's 대사 / 용어 choice, which the person can change): 'terms' takes the glossary terms in `termIds` (none = the workflow's own 대상 용어). With `workflowId` the workflow's own 대상 decides. */
  subject?: 'lines' | 'terms';
  termIds?: string[];
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
  /** A button's own key: the dialog opens on the workflow last run from it, and with none picked the first time. */
  remember?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean;
}) {
  const navigate = useNavigate();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  // The lines and scenes it was opened with stay its scope while it is open: picks cleared or changed
  // behind it (another tab, a refresh of the list) must not turn '고른 대사' into the whole project.
  const [opened, setOpened] = useState<{ unitIds?: string[]; groupIds?: string[]; termIds?: string[] }>({});
  const unitIds = open ? opened.unitIds : givenUnitIds;
  const groupIds = open ? opened.groupIds : givenGroupIds;
  const termIds = open ? opened.termIds : givenTermIds;
  // Dialogue is nearly the whole project, so like the whole project it is never preselected.
  const preselectKind = viewKind && viewKind !== 'scene' ? viewKind : undefined;

  // Which groups the run starts from: the lines or groups it was opened with, the whole project, or groups picked here.
  const [scopeTarget, setScopeTarget] = useState<ScopeTarget>(() => (unitIds?.length ? 'units' : groupIds?.length ? 'here' : 'groups'));
  const [pickedScenes, setPickedScenes] = useState<Set<string>>(new Set());
  const [sceneFilter, setSceneFilter] = useState('');
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [pickedMarks, setPickedMarks] = useState<Set<string>>(new Set());
  const [pickedStatuses, setPickedStatuses] = useState<Set<string>>(new Set());

  const statuses = useQuery({ ...q.statuses(projectId), enabled: open });
  const tags = lineTags(statuses.data?.tags);
  // This run's models by AI node, where the person picked another than the node's own (the workflow is not changed).
  const [runModels, setRunModels] = useState<Record<string, ModelValue>>({});
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open });
  // 대사 or 용어, picked in the dialog (it starts on the page's); a fixed workflow runs on its own 대상.
  const [pickedSubject, setPickedSubject] = useState<'lines' | 'terms'>(givenSubject);
  const subject = fixedWorkflowId ? (workflows.data?.find((item) => item.id === fixedWorkflowId)?.subject ?? givenSubject) : pickedSubject;
  const terms = subject === 'terms';
  const unit = terms ? '개' : '줄';
  const rememberKey = remember && `run-dialog:${projectId}:${remember}`;
  const [chosen, setChosen] = useState<string | undefined>(() => {
    if (!rememberKey) return undefined;
    try {
      return localStorage.getItem(rememberKey) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const choose = (id: string) => {
    setChosen(id);
    if (rememberKey) {
      try {
        localStorage.setItem(rememberKey, id);
      } catch {
        // A blocked storage only loses the memory.
      }
    }
  };
  // Only workflows of this subject can be picked (a list entry without a subject is a line workflow).
  const pickable = workflows.data?.filter((item) => item.subject === subject);
  const valid = (id: string | undefined) => (id && pickable?.some((workflow) => workflow.id === id && !workflow.errorCount) ? id : undefined);
  // A remembered button never falls back to some other workflow: the person picks one.
  const workflowId = fixedWorkflowId ?? valid(chosen) ?? (rememberKey ? undefined : pickable?.find((workflow) => !workflow.errorCount)?.id);
  const workflow = workflows.data?.find((item) => item.id === workflowId);
  const groups = useQuery({ ...q.groups(projectId), enabled: open });
  const here = groupIds?.length ? groups.data?.filter((group) => groupIds.includes(group.id)) : undefined;

  // The workflow's own start (대상 상태) picks the statuses; opened for named lines, none are.
  const entryStatuses = defaultIgnoreStatus ? '' : (workflow?.entryStatusIds ?? []).join(',');
  useEffect(() => {
    if (!open) return;
    setPickedStatuses(new Set(entryStatuses ? entryStatuses.split(',') : []));
  }, [open, workflowId, entryStatuses]);

  // Opened from the UI strings or documents view: every group of that kind starts picked.
  // The table starts with everything ticked (the whole project), or only the kind of the view it was opened from.
  const startPicks = () => new Set((groups.data ?? []).filter((group) => !preselectKind || group.kind === preselectKind).map((group) => group.id));
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !groups.data) return;
    preselected.current = true;
    setPickedScenes(startPicks());
  }, [groups.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const allGroups = (groups.data ?? []).length;
  const wholeProject = scopeTarget === 'groups' && allGroups > 0 && pickedScenes.size === allGroups;

  let computedUnitIds: string[] | undefined;
  let computedGroupIds: string[] | undefined;
  if (scopeTarget === 'units') computedUnitIds = unitIds;
  else if (scopeTarget === 'here') computedGroupIds = groupIds;
  else if (!wholeProject) computedGroupIds = pickedScenes.size ? [...pickedScenes] : ['__none__'];

  const statusScope =
    pickedStatuses.size > 0
      ? { statusIds: [...pickedStatuses], ignoreStatus: false }
      : { statusIds: [], ignoreStatus: true };

  const scope = terms ? (termIds?.length ? { termIds } : {}) : {
    ...(computedUnitIds ? { unitIds: computedUnitIds } : {}),
    ...(computedGroupIds ? { groupIds: computedGroupIds } : {}),
    ...statusScope,
    ...(pickedTags.size ? { tagIds: [...pickedTags] } : {}),
    ...(pickedMarks.size ? { marks: [...pickedMarks] as LineMark[] } : {}),
  };

  const ready =
    terms ||
    (scopeTarget === 'units' && Boolean(unitIds?.length)) ||
    (scopeTarget === 'here' && Boolean(groupIds?.length)) ||
    (scopeTarget === 'groups' && pickedScenes.size > 0);
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
  const total = data?.lines.total;

  // Opened by its trigger or by the page (controlled `open`): the scope it opens with is taken then.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setOpened({ unitIds: givenUnitIds, groupIds: givenGroupIds, termIds: givenTermIds });
      setPickedSubject(givenSubject);
      setScopeTarget(givenUnitIds?.length ? 'units' : givenGroupIds?.length ? 'here' : 'groups');
      setPickedScenes(startPicks());
      setSceneFilter('');
      setPickedTags(new Set());
      setPickedMarks(new Set());
      setRunModels({});
    }
    wasOpen.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
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
            <div className="space-y-2">
            <RadioGroup value={subject} onValueChange={(value) => setPickedSubject(value as 'lines' | 'terms')} className="flex gap-4" aria-label="실행할 대상">
              <Label className="text-sm font-normal">
                <RadioGroupItem value="lines" />
                대사
              </Label>
              <Label className="text-sm font-normal">
                <RadioGroupItem value="terms" />
                용어
              </Label>
            </RadioGroup>
            <Select value={workflowId ?? ''} onValueChange={choose}>
              <SelectTrigger className="w-full" aria-label="워크플로">
                <SelectValue placeholder="워크플로 선택" />
              </SelectTrigger>
              <SelectContent>
                {pickable?.map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={item.errorCount > 0}>
                    {item.name} {item.errorCount > 0 && <span className="text-muted-foreground">· 오류 있음</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {!pickable?.length && (terms ? '용어 워크플로가 없습니다. ' : '저장된 워크플로가 없습니다. ')}
              <Link to="/p/$projectId/workflows" params={{ projectId }} className="underline underline-offset-2">워크플로 관리</Link>
            </p>
            </div>
          )}

          <section className="space-y-4">
            {terms && (
              <div className="space-y-1">
                <SectionHeading>대상</SectionHeading>
                {termIds?.length ? (
                  <p className="text-sm">고른 용어 {termIds.length.toLocaleString()}개</p>
                ) : (
                  // The workflow's own 대상 용어 (its entry node): which statuses, carrying which automatic tags.
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    {(workflow?.termScope?.statuses ?? []).map((status) => KNOWLEDGE_STATUS_LABELS[status]).join('·') || '모든'} 용어
                    {(workflow?.termScope?.marks ?? []).length > 0 && (
                      <>
                        <span className="text-muted-foreground">중</span>
                        {workflow!.termScope!.marks.map((mark) => <MarkChip key={mark} mark={mark as AutoMark} projectId={projectId} />)}
                        <span className="text-muted-foreground">{workflow!.termScope!.marks.length > 1 ? '이 모두 붙은 것' : '이 붙은 것'}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {!terms && <fieldset className="space-y-2">
              <SectionHeading as="legend" className="mb-2">대상</SectionHeading>
              {/* A choice only when the dialog came with lines or groups picked; otherwise the table is the whole choice. */}
              {unitIds?.length || groupIds?.length ? (
                <RadioGroup value={scopeTarget} onValueChange={(value) => setScopeTarget(value as ScopeTarget)} className="gap-2">
                  {unitIds?.length ? (
                    <Label className="text-sm font-normal">
                      <RadioGroupItem value="units" />
                      {unitsLabel ?? '고른 대사'} {unitIds.length.toLocaleString()}줄
                    </Label>
                  ) : null}
                  {groupIds?.length ? (
                    <Label className="text-sm font-normal">
                      <RadioGroupItem value="here" />
                      {here?.length === 1 ? `지금 연 묶음 (${here[0].title})` : `지금 연 묶음 ${groupIds.length}개`}
                    </Label>
                  ) : null}
                  <Label className="text-sm font-normal">
                    <RadioGroupItem value="groups" />
                    직접 고르기
                  </Label>
                </RadioGroup>
              ) : null}
              {scopeTarget === 'groups' && (
                <div className={cn((unitIds?.length || groupIds?.length) && 'ml-6')}>
                  <GroupPicker groups={groups.data ?? []} picked={pickedScenes} setPicked={setPickedScenes} filter={sceneFilter} setFilter={setSceneFilter} />
                </div>
              )}
            </fieldset>}

            {!terms && <fieldset className="space-y-2">
              <SectionHeading as="legend" className="mb-2">필터</SectionHeading>
              <FieldRows>
                <FieldRow label="상태">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {(statuses.data?.statuses ?? []).map((status) => (
                      <Label key={status.id} className="text-sm font-normal">
                        <Checkbox checked={pickedStatuses.has(status.id)} onCheckedChange={(checked) => toggled(setPickedStatuses, status.id, checked === true)} />
                        <StatusIcon status={status} />
                        {status.name}
                      </Label>
                    ))}
                  </div>
                </FieldRow>
                <FieldRow label="태그">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {LINE_MARK_IDS.map((mark) => (
                      <Label key={mark} className="text-sm font-normal">
                        <Checkbox checked={pickedMarks.has(mark)} onCheckedChange={(checked) => toggled(setPickedMarks, mark, checked === true)} />
                        <MarkChip mark={mark} />
                      </Label>
                    ))}
                    {tags.map((tag) => (
                      <Label key={tag.id} className="text-sm font-normal">
                        <Checkbox checked={pickedTags.has(tag.id)} onCheckedChange={(checked) => toggled(setPickedTags, tag.id, checked === true)} />
                        #{tag.name}
                      </Label>
                    ))}
                  </div>
                </FieldRow>
              </FieldRows>
            </fieldset>}

            <p className="text-sm">
              {!ready ? null : total === undefined && plan.isError ? (
                <span className="text-destructive">
                  {terms ? '용어' : '줄'} 수를 세지 못했습니다: {plan.error.message}{' '}
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
                <span className="text-muted-foreground">{terms ? (termIds?.length ? '고른 용어 중 실행할 것이 없습니다.' : '조건에 맞는 용어가 없습니다. 워크플로 진입 노드에서 대상을 바꾸거나, 용어집에서 용어를 골라 실행하세요.') : '이 범위에는 실행할 대사가 없습니다.'}</span>
              ) : (
                <>
                  <b className="font-medium tabular-nums">{total.toLocaleString()}{unit}</b>{terms ? '를' : '을'} 실행합니다
                  {data!.lines.translated > 0 && <span className="text-muted-foreground"> (그중 이미 {terms ? '표기가 있는 용어' : '번역 있는 줄'} {data!.lines.translated.toLocaleString()})</span>}
                </>
              )}
              {data && data.lines.excluded > 0 && <span className="text-muted-foreground"> · 번역 제외 {data.lines.excluded.toLocaleString()}줄은 빠집니다</span>}
            </p>
            {!terms && wholeProject && Boolean(total) && (
              <p className="text-xs text-warning">프로젝트 전체입니다. 처음이면 장면 하나로 먼저 시험해 보세요.</p>
            )}
          </section>

          {/* Listeners, speech rules and glossary checks are about lines: a term run has none of them. */}
          {data && total && !terms ? (
            <Readiness
              projectId={projectId}
              readiness={data.readiness}
              oneScene={scopeTarget === 'here' && here?.length === 1 ? here[0].id : undefined}
              onLeave={() => setOpen(false)}
            />
          ) : null}
          {data && total ? <Pace data={data} projectId={projectId} /> : null}
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
            {start.isPending ? <Spinner /> : <Play />} {total ? `${total.toLocaleString()}${unit} 실행` : '실행 시작'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Plan = UseQueryResult<InferResponseType<(typeof client.workflows)[':id']['preflight']['$post'], 200>>;
type PlanData = NonNullable<Plan['data']>;

type ScopeTarget = 'units' | 'here' | 'groups';

/**
 * Every group of the project as one table: 전체, then each kind (대사 · UI · 문서) with its own
 * checkbox and fold, then its groups. Kinds start folded; a search opens them.
 */
function GroupPicker({ groups, picked, setPicked, filter, setFilter }: { groups: { id: string; key: string; kind: GroupKind; title: string; total: number }[]; picked: Set<string>; setPicked: SetPicked; filter: string; setFilter: (value: string) => void }) {
  const [open, setOpen] = useState<Set<GroupKind>>(new Set());
  const needle = filter.trim().toLowerCase();
  const sections = KIND_ORDER.map((kind) => ({ kind, all: groups.filter((group) => group.kind === kind) }))
    .filter((section) => section.all.length)
    .map((section) => ({ ...section, shown: needle ? section.all.filter((group) => `${group.title} ${group.key}`.toLowerCase().includes(needle)) : section.all }));
  const lines = (list: typeof groups) => list.reduce((sum, group) => sum + group.total, 0);
  const pickedLines = lines(groups.filter((group) => picked.has(group.id)));
  const state = (list: typeof groups) => {
    const count = list.filter((group) => picked.has(group.id)).length;
    return count === list.length ? true : count > 0 ? ('indeterminate' as const) : false;
  };
  const setMany = (list: typeof groups, on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      for (const group of list) on ? next.add(group.id) : next.delete(group.id);
      return next;
    });
  const row = 'flex min-w-0 items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted';
  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <div className="border-b p-1">
        <SearchInput value={filter} onChange={(value) => setFilter(value ?? '')} placeholder="찾기" className="w-full" end={`${pickedLines.toLocaleString()}줄`} />
      </div>
      <div className="max-h-64 overflow-auto p-1">
        <label className={cn(row, 'font-medium')}>
          <Checkbox checked={state(groups)} onCheckedChange={(checked) => setMany(groups, checked === true)} />
          <span className="min-w-0 flex-1">전체</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{lines(groups).toLocaleString()}줄</span>
        </label>
        {sections.map(({ kind, all, shown }) => {
          const expanded = Boolean(needle) || open.has(kind);
          return (
            <div key={kind}>
              {/* Each level steps in by 16px: 전체 → kind → its groups. The fold arrow sits in that step. */}
              <div className="flex min-w-0 items-center pl-2">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="w-4"
                  aria-label={`${SCRIPT_VIEW[kind]} ${expanded ? '접기' : '펼치기'}`}
                  aria-expanded={expanded}
                  onClick={() => toggled(setOpen as SetPicked, kind, !open.has(kind))}
                >
                  <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
                </Button>
                <label className={cn(row, 'min-w-0 flex-1 pl-0')}>
                  <Checkbox checked={state(all)} onCheckedChange={(checked) => setMany(all, checked === true)} />
                  <span className="min-w-0 flex-1 truncate">{SCRIPT_VIEW[kind]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{all.length.toLocaleString()}개 · {lines(all).toLocaleString()}줄</span>
                </label>
              </div>
              {expanded && (
                <ul className="ml-8">
                  {shown.map((group) => (
                    <li key={group.id}>
                      <label className={row}>
                        <Checkbox checked={picked.has(group.id)} onCheckedChange={(checked) => toggled(setPicked, group.id, checked === true)} />
                        <span className="min-w-0 flex-1 truncate">{group.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{group.total}줄</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
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

/** What in these lines would make the translation worse, each with where to fix it. */
function Readiness({ projectId, readiness, oneScene, onLeave }: { projectId: string; readiness: PlanData['readiness']; oneScene?: string; /** A link was followed: the dialog closes. */ onLeave: () => void }) {
  const checks: { ok: boolean; text: ReactNode; link?: ReactNode; uses: 'speech' | 'glossary' }[] = [
    {
      uses: 'speech',
      ok: readiness.unknownListenerLines === 0,
      text: readiness.unknownListenerLines ? `청자 미상 ${readiness.unknownListenerLines.toLocaleString()}줄` : '청자 모두 정해짐',
      link: readiness.unknownListenerLines > 0 && (
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ marks: ['unknownListener'], ...(oneScene && { group: oneScene }) }} onClick={onLeave}>
          청자 정하기
        </Link>
      ),
    },
    {
      uses: 'speech',
      ok: readiness.unreviewedRules.count === 0,
      text: readiness.unreviewedRules.count ? `확인 안 한 말투 규칙 ${readiness.unreviewedRules.count}개 (${readiness.unreviewedRules.examples.join(', ')}${readiness.unreviewedRules.count > readiness.unreviewedRules.examples.length ? ' 등' : ''})` : '쓰이는 말투 규칙은 모두 확인됨',
      link: readiness.unreviewedRules.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', marks: [...UNREVIEWED_MARKS], ...(!readiness.unreviewedRules.more && { ids: readiness.unreviewedRules.ids }) }} onClick={onLeave}>
          확인하기
        </Link>
      ),
    },
    {
      uses: 'speech',
      ok: readiness.pairsWithoutRule.count === 0,
      text: readiness.pairsWithoutRule.count ? `말투 규칙 없는 쌍 ${readiness.pairsWithoutRule.count} (${readiness.pairsWithoutRule.examples.join(', ')}${readiness.pairsWithoutRule.count > readiness.pairsWithoutRule.examples.length ? ' 등' : ''})` : '자주 말하는 쌍마다 말투 규칙 있음',
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
          확인하기
        </Link>
      ),
    },
  ];
  const rows = checks.filter((row) => readiness.applies[row.uses]);
  // A workflow that neither writes nor judges translations with this context has nothing to get ready.
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <SectionHeading>준비 상태</SectionHeading>
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
