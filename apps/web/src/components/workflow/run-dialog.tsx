import { useEffect, useRef, useState, type ReactNode } from 'react';
import { initialRunScope, type RunScopeMode } from '@/lib/run-scope';
import { keepPreviousData, useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Play } from 'lucide-react';
import { Box, Heading, Icon, Inline, ReadinessDot, ScopeRow, SearchField, Button, Checkbox, Label, RadioGroup, RadioGroupItem, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Skeleton, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, Spinner, StatusIcon, SectionHeading, Text, Bleed, KeyValue, KeyValueRow } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { INPUT_TYPES, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, TERM_MARK_IDS, WORKFLOW_SUBJECT_IDS, LINE_MARK_IDS, type AutoMark, type LineMark, AUTO_MARK_IDS } from '@tw/shared';
import { MarkChip } from '@/components/status';
import type { ModelValue } from '@/components/model-picker';
import { Pace, RunCaps, RunModels } from './run-estimate';
import { startLimits, type CapEdits } from '@/lib/run-limits';
import { tagsIn, q } from '@/lib/queries';
import { SCRIPT_VIEW } from '@/lib/labels';
import { useTerms } from '@/lib/terms';
import { useTaxonomy } from '@/lib/knowledge';

/** Run-scope filters on what a row shows (the list pages' 최종 아님, 정한 쪽, 메모, 번역 비어 있음), beside statuses. */
const RUN_FACTS = {
  unfinished: { label: '최종 아님', on: 'lines' },
  ai: { label: 'AI가 정함 (✦)', on: 'both' },
  noted: { label: '메모 있음', on: 'lines' },
  emptyTarget: { label: '번역 비어 있음', on: 'terms' },
} as const;
type RunFact = keyof typeof RUN_FACTS;

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
  /** What the page holds: a workflow of this input is picked first, and the page's lines or `termIds` are its scope. The picked workflow's input decides the scope fields. */
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
  // What a row shows, as filters: 최종 아님, 정한 쪽 AI, 메모 있음 (lines), 번역 비어 있음 (terms).
  const [pickedFacts, setPickedFacts] = useState<Set<string>>(new Set());

  const taxonomy = useTaxonomy(projectId, { enabled: open });
  // This run's models by AI node, where the person picked another than the node's own (the workflow is not changed).
  const [runModels, setRunModels] = useState<Record<string, ModelValue>>({});
  const [capEdits, setCapEdits] = useState<CapEdits>({});
  const workflows = useQuery({ ...q.workflows(projectId), enabled: open });
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
  const pickable = workflows.data;
  const valid = (id: string | undefined) => (id && pickable?.some((workflow) => workflow.id === id && !workflow.errorCount) ? id : undefined);
  // A remembered button never falls back to some other workflow: the person picks one.
  // With none chosen, the first workflow whose input is what the page holds (scenes, lines or terms).
  const workflowId = fixedWorkflowId ?? valid(chosen) ?? (rememberKey ? undefined : (pickable?.find((workflow) => !workflow.errorCount && workflow.input === givenSubject) ?? pickable?.find((workflow) => !workflow.errorCount))?.id);
  const workflow = workflows.data?.find((item) => item.id === workflowId);
  // What the run takes is the workflow's input (its entry node); the scope fields below follow it.
  const subject = workflow?.input ?? givenSubject;
  const terms = subject === 'terms';
  const tags = tagsIn(taxonomy.tags, terms ? 'terms' : 'lines');
  const unit = terms ? '개' : '줄';
  const groups = useQuery({ ...q.groups(projectId), enabled: open });
  const here = groupIds?.length ? groups.data?.filter((group) => groupIds.includes(group.id)) : undefined;

  const termList = useTerms(projectId, { enabled: open && terms });
  const [pickedTerms, setPickedTerms] = useState<Set<string>>(new Set());

  // The filters start as they were the last time this workflow ran from here (this browser only).
  const filtersKey = workflowId && `run-filters:${projectId}:${workflowId}`;
  useEffect(() => {
    if (!open) return;
    let saved: { statuses?: string[]; marks?: string[]; tags?: string[]; facts?: RunFact[] } = {};
    try {
      saved = filtersKey && !defaultIgnoreStatus ? JSON.parse(localStorage.getItem(filtersKey) ?? '{}') : {};
    } catch {
      // A blocked or broken storage starts with no filters.
    }
    setPickedStatuses(new Set(saved.statuses ?? []));
    setPickedMarks(new Set((saved.marks ?? []).filter((mark) => (AUTO_MARK_IDS as readonly string[]).includes(mark))));
    setPickedTags(new Set(saved.tags ?? []));
    setPickedFacts(new Set((saved.facts ?? []).filter((fact) => fact in RUN_FACTS)));
  }, [open, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rememberFilters = () => {
    try {
      if (filtersKey) localStorage.setItem(filtersKey, JSON.stringify({ statuses: [...pickedStatuses], marks: [...pickedMarks], tags: [...pickedTags], facts: [...pickedFacts] }));
    } catch {
      // Not remembered: the next run starts without filters.
    }
  };

  // Opened from the UI strings or documents view: every group of that kind starts picked.
  // The table starts with everything ticked (the whole project), or only the kind of the view it was opened from.
  const startPicks = () => new Set((groups.data ?? []).filter((group) => !preselectKind || group.kind === preselectKind).map((group) => group.id));
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !groups.data) return;
    preselected.current = true;
    setPickedScenes(startPicks());
  }, [groups.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every term starts picked once the glossary is in.
  const termsPreselected = useRef(false);
  useEffect(() => {
    if (termsPreselected.current || !termList.data) return;
    termsPreselected.current = true;
    setPickedTerms(new Set(termList.data.map((term) => term.id)));
  }, [termList.data]);
  const allGroups = (groups.data ?? []).length;
  const wholeProject = scopeTarget === 'groups' && allGroups > 0 && pickedScenes.size === allGroups;
  const allTerms = scopeTarget === 'groups' && (termList.data?.length ?? 0) > 0 && pickedTerms.size === termList.data!.length;
  // What the picker lists: scenes by kind for lines; terms as one flat list (their status is a filter, like in the glossary).
  const sections: PickSection[] = terms
    ? [{ key: 'terms', items: (termList.data ?? []).filter((term) => term.status !== 'rejected').map((term) => ({ id: term.id, title: term.source, search: `${term.source} ${term.target}`, total: 1, detail: term.target || '—' })) }]
    : KIND_ORDER.map((kind) => ({
        key: kind,
        label: SCRIPT_VIEW[kind],
        items: (groups.data ?? []).filter((group) => group.kind === kind).map((group) => ({ id: group.id, title: group.title, search: `${group.title} ${group.key}`, total: group.total, detail: `${group.total}줄` })),
      }));

  let computedUnitIds: string[] | undefined;
  let computedGroupIds: string[] | undefined;
  if (scopeTarget === 'units') computedUnitIds = unitIds;
  else if (scopeTarget === 'here') computedGroupIds = groupIds;
  else if (!wholeProject) computedGroupIds = pickedScenes.size ? [...pickedScenes] : ['__none__'];

  // The filters, the list pages' rules: statuses (a line's project statuses, a term's 후보·확정), automatic marks and tags.
  const filters = {
    ...(pickedStatuses.size ? { statusIds: [...pickedStatuses] } : {}),
    ...(pickedMarks.size ? { marks: [...pickedMarks] as LineMark[] } : {}),
    ...(pickedTags.size ? { tagIds: [...pickedTags] } : {}),
    ...(pickedFacts.has('unfinished') && !terms ? { unfinished: true } : {}),
    ...(pickedFacts.has('noted') && !terms ? { noted: true } : {}),
    ...(pickedFacts.has('ai') ? { decidedBy: 'ai' as const } : {}),
    ...(pickedFacts.has('emptyTarget') && terms ? { emptyTarget: true } : {}),
  };
  const pickedTermIds = scopeTarget === 'units' ? termIds : allTerms ? undefined : [...pickedTerms];
  const scope = terms
    ? { ...(pickedTermIds?.length ? { termIds: pickedTermIds } : {}), ...filters }
    : {
        ...(computedUnitIds ? { unitIds: computedUnitIds } : {}),
        ...(computedGroupIds ? { groupIds: computedGroupIds } : {}),
        ...filters,
      };

  const ready =
    (terms && scopeTarget === 'units' && Boolean(termIds?.length)) ||
    (terms && scopeTarget === 'groups' && pickedTerms.size > 0) ||
    (!terms && scopeTarget === 'units' && Boolean(unitIds?.length)) ||
    (!terms && scopeTarget === 'here' && Boolean(groupIds?.length)) ||
    (!terms && scopeTarget === 'groups' && pickedScenes.size > 0);
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
      // The caps the fields hold (the suggestion until changed), past which the run pauses.
      const limits = startLimits(suggested, capEdits);
      return unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId! }, json: { ...request, ...(Object.keys(limits).length ? { limits } : {}) } }));
    },
    onSuccess: (run) => {
      rememberFilters();
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
      setScopeTarget(givenUnitIds?.length || givenTermIds?.length ? 'units' : givenGroupIds?.length ? 'here' : 'groups');
      setPickedScenes(startPicks());
      if (termList.data) setPickedTerms(new Set(termList.data.map((term) => term.id)));
      setSceneFilter('');
      setPickedTags(new Set());
      setPickedMarks(new Set());
      setPickedFacts(new Set());
      setRunModels({});
      setCapEdits({});
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
      <DialogContent size="lg">
        <DialogHeader>
          {/* With the workflow picker below, the title would only repeat its name. */}
          <DialogTitle>{fixedWorkflowId && workflow ? `${workflow.name} 실행` : '워크플로 실행'}</DialogTitle>
          {dirty ? <Box asChild tone="warning"><DialogDescription>저장하지 않은 편집은 들어가지 않습니다.</DialogDescription></Box> : <Box asChild srOnly><DialogDescription>실행할 범위를 고르고 시작합니다.</DialogDescription></Box>}
        </DialogHeader>

        {/* Side padding so focus rings and the picked scope are not cut by the scroll box. */}
        <Bleed by="tight" maxHeight="dialog" spaceY="comfortable" overflow="auto" paddingX="tight" paddingY="hair">
          {!fixedWorkflowId && (
            <Box spaceY="condensed">
            <Select value={workflowId ?? ''} onValueChange={choose}>
              <Box asChild width="full"><SelectTrigger aria-label="워크플로">
                <SelectValue placeholder="워크플로 선택" />
              </SelectTrigger></Box>
              <SelectContent>
                {WORKFLOW_SUBJECT_IDS.map((input) => {
                  const rows = pickable?.filter((item) => item.input === input) ?? [];
                  return rows.length ? (
                    <SelectGroup key={input}>
                      <SelectLabel>{INPUT_TYPES[input].label} 입력</SelectLabel>
                      {rows.map((item) => (
                        <SelectItem key={item.id} value={item.id} disabled={item.errorCount > 0}>
                          {item.name} {item.errorCount > 0 && <Text tone="muted">· 오류 있음</Text>}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null;
                })}
              </SelectContent>
            </Select>
            <Text as="p" variant="caption" tone="muted">
              {!pickable?.length && '저장된 워크플로가 없습니다. '}
              <Text asChild underline="offset"><Link to="/p/$projectId/workflows" params={{ projectId }}>워크플로 관리</Link></Text>
            </Text>
            </Box>
          )}

          <Box as="section" spaceY="comfortable">
            <Box as="fieldset" spaceY="condensed">
              <Heading as="legend" minWidth={0} marginBottom="condensed">대상</Heading>
              {/* A choice only when the dialog came with items picked; otherwise the list is the whole choice. */}
              {(terms ? termIds?.length : unitIds?.length || groupIds?.length) ? (
                <Box asChild gap="condensed"><RadioGroup value={scopeTarget} onValueChange={(value) => setScopeTarget(value as ScopeTarget)}>
                  {terms && termIds?.length ? (
                    <Box asChild variant="body" weight="normal"><Label>
                      <RadioGroupItem value="units" />
                      고른 용어 {termIds.length.toLocaleString()}개
                    </Label></Box>
                  ) : null}
                  {!terms && unitIds?.length ? (
                    <Box asChild variant="body" weight="normal"><Label>
                      <RadioGroupItem value="units" />
                      {unitsLabel ?? '고른 대사'} {unitIds.length.toLocaleString()}줄
                    </Label></Box>
                  ) : null}
                  {!terms && groupIds?.length ? (
                    <Box asChild variant="body" weight="normal"><Label>
                      <RadioGroupItem value="here" />
                      {here?.length === 1 ? `지금 연 묶음 (${here[0].title})` : `지금 연 묶음 ${groupIds.length}개`}
                    </Label></Box>
                  ) : null}
                  <Box asChild variant="body" weight="normal"><Label>
                    <RadioGroupItem value="groups" />
                    직접 고르기
                  </Label></Box>
                </RadioGroup></Box>
              ) : null}
              {scopeTarget === 'groups' && (
                <Box marginLeft={(terms ? termIds?.length : unitIds?.length || groupIds?.length) ? 'spacious' : undefined}>
                  <ScopePicker sections={sections} unit={unit} picked={terms ? pickedTerms : pickedScenes} setPicked={terms ? setPickedTerms : setPickedScenes} filter={sceneFilter} setFilter={setSceneFilter} />
                </Box>
              )}
            </Box>

            <Box as="fieldset" spaceY="condensed">
              <Heading as="legend" minWidth={0} marginBottom="condensed">필터</Heading>
              <KeyValue align="start">
                <KeyValueRow label="상태">
                  <Inline wrap gapX="comfortable" gapY="tight">
                    {terms
                      ? KNOWLEDGE_STATUSES.filter((status) => status !== 'rejected').map((status) => (
                          <Box asChild key={status} variant="body" weight="normal"><Label>
                            <Checkbox checked={pickedStatuses.has(status)} onCheckedChange={(checked) => toggled(setPickedStatuses, status, checked === true)} />
                            {KNOWLEDGE_STATUS_LABELS[status]}
                          </Label></Box>
                        ))
                      : (taxonomy.statuses ?? []).map((status) => (
                        <Box asChild key={status.id} variant="body" weight="normal"><Label>
                          <Checkbox checked={pickedStatuses.has(status.id)} onCheckedChange={(checked) => toggled(setPickedStatuses, status.id, checked === true)} />
                          <StatusIcon status={status} />
                          {status.name}
                        </Label></Box>
                      ))}
                    {(Object.keys(RUN_FACTS) as RunFact[]).filter((fact) => RUN_FACTS[fact].on === 'both' || RUN_FACTS[fact].on === (terms ? 'terms' : 'lines')).map((fact) => (
                      <Box asChild key={fact} variant="body" weight="normal"><Label>
                        <Checkbox checked={pickedFacts.has(fact)} onCheckedChange={(checked) => toggled(setPickedFacts, fact, checked === true)} />
                        {RUN_FACTS[fact].label}
                      </Label></Box>
                    ))}
                  </Inline>
                </KeyValueRow>
                <KeyValueRow label="태그">
                  <Inline wrap gapX="comfortable" gapY="tight">
                    {(terms ? TERM_MARK_IDS : LINE_MARK_IDS).map((mark) => (
                      <Box asChild key={mark} variant="body" weight="normal"><Label>
                        <Checkbox checked={pickedMarks.has(mark)} onCheckedChange={(checked) => toggled(setPickedMarks, mark, checked === true)} />
                        <MarkChip mark={mark as AutoMark} />
                      </Label></Box>
                    ))}
                    {tags.map((tag) => (
                      <Box asChild key={tag.id} variant="body" weight="normal"><Label>
                        <Checkbox checked={pickedTags.has(tag.id)} onCheckedChange={(checked) => toggled(setPickedTags, tag.id, checked === true)} />
                        #{tag.name}
                      </Label></Box>
                    ))}
                  </Inline>
                </KeyValueRow>
              </KeyValue>
            </Box>

            <Text as="p" variant="body">
              {!ready ? null : total === undefined && plan.isError ? (
                <Text tone="danger">
                  {terms ? '용어' : '줄'} 수를 세지 못했습니다: {plan.error.message}{' '}
                  <Button variant="ghost" size="inline" onClick={() => void plan.refetch()}>
                    다시 시도
                  </Button>
                </Text>
              ) : total === undefined ? (
                <Text tone="muted">
                  세는 중…
                  {slow && (
                    <>
                      {' '}서버 응답이 늦습니다.{' '}
                      <Button variant="ghost" size="inline" onClick={() => void plan.refetch()}>
                        다시 시도
                      </Button>
                    </>
                  )}
                </Text>
              ) : total === 0 ? (
                <Text tone="muted">{terms ? (termIds?.length ? '고른 용어 중 실행할 것이 없습니다.' : '조건에 맞는 용어가 없습니다. 필터를 줄이거나 용어집에서 용어를 골라 실행하세요.') : '이 범위에는 실행할 대사가 없습니다.'}</Text>
              ) : (
                <>
                  <Text as="b" weight="medium" tabular>{total.toLocaleString()}{unit}</Text>{terms ? '를' : '을'} 실행합니다
                  {data!.lines.translated > 0 && <Text tone="muted"> (그중 이미 {terms ? '표기가 있는 용어' : '번역 있는 줄'} {data!.lines.translated.toLocaleString()})</Text>}
                </>
              )}
              {data && data.lines.excluded > 0 && <Text tone="muted"> · 번역 제외 {data.lines.excluded.toLocaleString()}줄은 빠집니다</Text>}
            </Text>
            {!terms && wholeProject && Boolean(total) && (
              <Text as="p" variant="caption" tone="warning">프로젝트 전체입니다. 처음이면 장면 하나로 먼저 시험해 보세요.</Text>
            )}
          </Box>

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
          {data && total ? <RunCaps suggested={suggested} edits={capEdits} onChange={setCapEdits} /> : null}
          {data && total ? (
            <RunModels
              nodes={data.nodes}
              picked={runModels}
              onPick={(nodeId, value) => setRunModels((previous) => ({ ...previous, [nodeId]: value }))}
              onReset={(nodeId) => setRunModels(({ [nodeId]: _gone, ...rest }) => rest)}
            />
          ) : null}
          {ready && plan.isError && plan.data && <Text as="p" variant="body" tone="danger">계획을 다시 계산하지 못했습니다: {plan.error.message}</Text>}
          {ready && plan.isPending && <Skeleton height="placeholder-sm" width="full" />}

        </Bleed>

        {start.isError && <Text as="p" variant="body" tone="danger">{start.error.message}</Text>}
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
/** One section of the picker: a fold with its items (scenes of a kind, or terms of a status). */
interface PickSection {
  key: string;
  /** None: the items sit right under 전체 (terms have no grouping). */
  label?: string;
  items: { id: string; title: string; search: string; total: number; detail: string }[];
}

/** The run's items to pick: 전체 → sections → items, with a search; the same for lines (scenes) and terms. */
function ScopePicker({ sections, unit, picked, setPicked, filter, setFilter }: { sections: PickSection[]; unit: string; picked: Set<string>; setPicked: SetPicked; filter: string; setFilter: (value: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const needle = filter.trim().toLowerCase();
  const all = sections.flatMap((section) => section.items);
  const shownOf = (section: PickSection) => (needle ? section.items.filter((item) => item.search.toLowerCase().includes(needle)) : section.items);
  const total = (list: PickSection['items']) => list.reduce((sum, item) => sum + item.total, 0);
  const state = (list: PickSection['items']) => {
    const count = list.filter((item) => picked.has(item.id)).length;
    return count === list.length ? true : count > 0 ? ('indeterminate' as const) : false;
  };
  const setMany = (list: PickSection['items'], on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      for (const item of list) on ? next.add(item.id) : next.delete(item.id);
      return next;
    });
  const itemRow = (item: PickSection['items'][number]) => (
    <li key={item.id}>
      <ScopeRow>
        <Checkbox checked={picked.has(item.id)} onCheckedChange={(checked) => toggled(setPicked, item.id, checked === true)} />
        <Text minWidth={0} grow truncate>{item.title}</Text>
        <Text shrink={false} variant="caption" tone="muted" tabular>{item.detail}</Text>
      </ScopeRow>
    </li>
  );
  return (
    <Box minWidth={0} overflow="hidden" radius="md" border="all">
      <Box border="bottom" padding="tight">
        <SearchField size="fill" value={filter} onChange={(value) => setFilter(value ?? '')} placeholder="찾기" end={`${total(all.filter((item) => picked.has(item.id))).toLocaleString()}${unit}`} />
      </Box>
      <Box maxHeight="scroll" overflow="auto" padding="tight">
        <ScopeRow kind="all">
          <Checkbox checked={state(all)} onCheckedChange={(checked) => setMany(all, checked === true)} />
          <Text minWidth={0} grow>전체</Text>
          <Text shrink={false} variant="caption" weight="normal" tone="muted" tabular>{total(all).toLocaleString()}{unit}</Text>
        </ScopeRow>
        {sections.filter((section) => section.items.length).map((section) => {
          if (!section.label)
            return (
              <Box as="ul" key={section.key} marginLeft="comfortable">
                {shownOf(section).map(itemRow)}
              </Box>
            );
          const expanded = Boolean(needle) || open.has(section.key);
          return (
            <div key={section.key}>
              {/* Each level steps in by 16px: 전체 → section → its items. The fold arrow sits in that step. */}
              <Inline minWidth={0} paddingLeft="condensed">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  width="icon"
                  aria-label={`${section.label} ${expanded ? '접기' : '펼치기'}`}
                  aria-expanded={expanded}
                  onClick={() => toggled(setOpen as SetPicked, section.key, !open.has(section.key))}
                >
                  <Icon icon={ChevronRight} turn={expanded} />
                </Button>
                <ScopeRow kind="section">
                  <Checkbox checked={state(section.items)} onCheckedChange={(checked) => setMany(section.items, checked === true)} />
                  <Text minWidth={0} grow truncate>{section.label}</Text>
                  <Text shrink={false} variant="caption" tone="muted" tabular>{section.items.length.toLocaleString()}개{unit === '줄' && ` · ${total(section.items).toLocaleString()}줄`}</Text>
                </ScopeRow>
              </Inline>
              {expanded && (
                <Box as="ul" marginLeft="wide">
                  {shownOf(section).map(itemRow)}
                </Box>
              )}
            </div>
          );
        })}
      </Box>
    </Box>
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
      text: readiness.unknownListenerLines ? `청자 모름 ${readiness.unknownListenerLines.toLocaleString()}줄` : '청자 모두 정해짐',
      link: readiness.unknownListenerLines > 0 && (
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ listener: '-', ...(oneScene && { group: oneScene }) }} onClick={onLeave}>
          청자 정하기
        </Link>
      ),
    },
    {
      uses: 'speech',
      ok: readiness.candidateRules.count === 0,
      text: readiness.candidateRules.count ? `후보 말투 규칙 ${readiness.candidateRules.count}개 (${readiness.candidateRules.examples.join(', ')}${readiness.candidateRules.count > readiness.candidateRules.examples.length ? ' 등' : ''})` : '쓰이는 말투 규칙은 모두 확정됨',
      link: readiness.candidateRules.count > 0 && (
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', status: 'candidate', ...(!readiness.candidateRules.more && { ids: readiness.candidateRules.ids }) }} onClick={onLeave}>
          후보 보기
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
      ok: readiness.candidateTerms.count === 0,
      text: readiness.candidateTerms.count ? `후보 용어 ${readiness.candidateTerms.count}개 (${readiness.candidateTerms.examples.join(', ')}${readiness.candidateTerms.count > readiness.candidateTerms.examples.length ? ' 등' : ''})` : '나오는 용어는 모두 확정됨',
      link: readiness.candidateTerms.count > 0 && (
        <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ status: 'candidate', ...(!readiness.candidateTerms.more && { ids: readiness.candidateTerms.ids }) }} onClick={onLeave}>
          후보 보기
        </Link>
      ),
    },
  ];
  const rows = checks.filter((row) => readiness.applies[row.uses]);
  // A workflow that neither writes nor judges translations with this context has nothing to get ready.
  if (!rows.length) return null;
  return (
    <Box as="section" spaceY="condensed">
      <SectionHeading>준비 상태</SectionHeading>
      <Box as="ul" radius="md" border="all" variant="body">
        {rows.map((row, index) => (
          <Inline as="li" key={index} gap="condensed" paddingX="normal" paddingY="condensed">
            <ReadinessDot ok={row.ok} />
            <Text minWidth={0} grow truncate tone={row.ok ? 'muted' : undefined} title={typeof row.text === 'string' ? row.text : undefined}>
              {row.text}
            </Text>
            {row.link && (
              <Button variant="ghost" size="inline" shrink={false} asChild>
                {row.link}
              </Button>
            )}
          </Inline>
        ))}
      </Box>
    </Box>
  );
}
