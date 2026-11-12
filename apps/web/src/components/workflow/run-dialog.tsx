import { useEffect, useRef, useState, type ReactNode } from 'react';
import { initialRunScope, type RunScopeMode } from '@/lib/run-scope';
import { keepPreviousData, useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { Box, ExpandableRow, Heading, Inline, ReadinessDot, Button, Checkbox, Label, RadioGroup, RadioGroupItem, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Skeleton, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, Spinner, StatusIcon, SectionHeading, Text, Bleed, KeyValue, KeyValueRow } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { INPUT_TYPES, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, TERM_MARK_IDS, WORKFLOW_SUBJECT_IDS, LINE_MARK_IDS, type AutoMark, type LineMark, type RunScopeInput, AUTO_MARK_IDS } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { lineScopeSections, ScopePicker, toggled, type PickSection } from '@/components/scope-picker';
import type { ModelValue } from '@/components/model-picker';
import { Pace, RunCaps, RunModels, UntestedModels } from './run-estimate';
import { paceParts } from '@/lib/run-summary';
import { startCaps, startLimits, type CapEdits } from '@/lib/run-limits';
import { tagsIn } from '@/lib/queries';
import { useTerms } from '@/lib/terms';
import { useTaxonomy } from '@/lib/knowledge';
import { useGroups } from '@/lib/groups';
import { useWorkflows } from '@/lib/workflows';

/** Run-scope filters on what a row shows (the list pages' 최종 아님, 정한 쪽, 메모, 번역 비어 있음), beside statuses. */
const RUN_FACTS = {
  unfinished: { label: '최종 아님', on: 'lines' },
  ai: { label: 'AI가 정함 (✦)', on: 'both' },
  noted: { label: '메모 있음', on: 'lines' },
  emptyTarget: { label: '번역 비어 있음', on: 'terms' },
} as const;
type RunFact = keyof typeof RUN_FACTS;

type GroupKind = 'scene' | 'ui' | 'document';

/**
 * Start a workflow: one screen with what a person decides on before pressing
 * start — which lines (the scene in view, picked scenes, tagged lines, picked lines, every line of
 * one kind — 대사 · UI · 문서, preselected only from the UI or documents view — or the whole
 * project, never preselected), what in those lines would spoil the translation and where to fix it,
 * how long and how much in plain words, and which models.
 */
export function RunDialog({ projectId, workflowId: fixedWorkflowId, groupIds: givenGroupIds, unitIds: givenUnitIds, termIds: givenTermIds, subject: givenSubject = 'lines', unitsLabel, viewKind, dirty, disabledReason, trigger, defaultIgnoreStatus = false, remember, open: controlledOpen, onOpenChange, hideTrigger = false }: {
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
  /** Turns the default trigger off and says why (the workflow has errors). */
  disabledReason?: string | false;
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
  const filterCount = (): number => pickedStatuses.size + pickedTags.size + pickedMarks.size + pickedFacts.size;
  // What a row shows, as filters: 최종 아님, 정한 쪽 AI, 메모 있음 (lines), 번역 비어 있음 (terms).
  const [pickedFacts, setPickedFacts] = useState<Set<string>>(new Set());
  // A person's statuses and tags stay unless this is ticked for this run (it is not remembered).
  const [changeHuman, setChangeHuman] = useState(false);

  const taxonomy = useTaxonomy(projectId, { enabled: open });
  // This run's models by AI node, where the person picked another than the node's own (the workflow is not changed).
  const [runModels, setRunModels] = useState<Record<string, ModelValue>>({});
  const [capEdits, setCapEdits] = useState<CapEdits>({});
  const workflows = useWorkflows(projectId, { enabled: open });
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
  const groups = useGroups(projectId, { enabled: open });
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
    : lineScopeSections(groups.data ?? []);

  // The scope as the server takes it (runScopeInputSchema): the line filter of a lines workflow, or the terms of a terms
  // workflow. A list goes out only when it holds something; the server refuses an empty one rather than guess.
  const some = <T,>(list: readonly T[] | undefined) => (list?.length ? [...list] : undefined);
  // Only picks the dialog shows as ticked go out: a remembered status or tag the project no longer has is not sent.
  const statusOptions: readonly string[] = terms ? KNOWLEDGE_STATUSES : (taxonomy.statuses ?? []).map((status) => status.id);
  const markOptions: readonly string[] = terms ? TERM_MARK_IDS : LINE_MARK_IDS;
  const statuses = some([...pickedStatuses].filter((id) => statusOptions.includes(id)));
  const marks = some([...pickedMarks].filter((mark) => markOptions.includes(mark)));
  const tagPicks = some([...pickedTags].filter((id) => tags.some((tag) => tag.id === id)));
  const decidedBy = pickedFacts.has('ai') ? ('ai' as const) : undefined;
  const pickedTermIds = scopeTarget === 'units' ? termIds : allTerms ? undefined : [...pickedTerms];
  const scope: RunScopeInput = terms
    ? { terms: { terms: some(pickedTermIds), statuses, marks: marks as AutoMark[] | undefined, tags: tagPicks, decidedBy, emptyTarget: pickedFacts.has('emptyTarget') ? true : undefined } }
    : {
        filter: {
          // Picked lines, the scenes it was opened in, or the scenes picked here (every scene picked: the whole project, no condition).
          ids: scopeTarget === 'units' ? some(unitIds) : undefined,
          groups: scopeTarget === 'here' ? some(groupIds) : scopeTarget === 'groups' && !wholeProject ? some([...pickedScenes]) : undefined,
          statuses,
          marks: marks as LineMark[] | undefined,
          tags: tagPicks,
          decidedBy,
          unfinished: pickedFacts.has('unfinished') ? true : undefined,
          noted: pickedFacts.has('noted') ? true : undefined,
        },
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
      // The caps past which the run pauses: what the person changed; the server adds the suggestion the fields show for the rest.
      const limits = startLimits(capEdits);
      return unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId! }, json: { ...request, ...(changeHuman && !terms ? { changeHuman: true } : {}), ...(Object.keys(limits).length ? { limits } : {}) } }));
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

  // Why 시작 is off, the first that applies. A model picked without its model yet would quietly run on the node's own: finish or undo it first.
  const startBlocked =
    !workflowId ? '실행할 워크플로를 고르세요.'
    : total === undefined ? `${terms ? '용어' : '줄'} 수를 세는 중입니다.`
    : stale ? '바꾼 범위로 다시 세는 중입니다.'
    : !total ? (terms ? '실행할 용어가 없습니다.' : '이 범위에는 실행할 대사가 없습니다.')
    : Object.keys(chosenModels).length !== Object.keys(runModels).length ? '연결만 고르고 모델을 고르지 않은 노드가 있습니다. 모델을 고르거나 되돌리세요.'
    : false;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      {!hideTrigger && <DialogTrigger asChild>
        {trigger ?? (
          <Button disabledReason={disabledReason}>
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
          {/* What will run, first: the count follows the scope chosen below. */}
          <Box spaceY="tight" border="bottom" paddingBottom="condensed">
            <Text as="p" variant="title">
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
            {data && total ? <Text as="p" variant="body" tone="muted">AI 요청 {paceParts(data).callText}{paceParts(data).time && ` · 약 ${paceParts(data).time}`}{paceParts(data).money && ` · ${paceParts(data).money}`}</Text> : null}
            {data && total ? <UntestedModels projectId={projectId} data={data} /> : null}
            {!terms && wholeProject && Boolean(total) && (
              <Text as="p" variant="caption" tone="warning">프로젝트 전체입니다. 처음이면 장면 하나로 먼저 시험해 보세요.</Text>
            )}
          </Box>
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

            {/* Filters are rarely set here: one line saying which, open to change them. */}
            <ExpandableRow defaultOpen={filterCount() > 0} summary={<Text>필터 <Text tone="muted">· {filterCount() ? `${filterCount()}개` : '없음'}</Text></Text>}>
              <Box as="fieldset" spaceY="condensed">
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
            </ExpandableRow>

          </Box>

          {/* The estimate's detail and the caps: one line, open for the steps and the caps. */}
          {data && total ? (
            <ExpandableRow summary={<Text>예상 자세히 <Text tone="muted">· 단계별 요청 · 상한 {startCaps(capEdits, suggested)}</Text></Text>}>
              <Box spaceY="comfortable">
                <Pace data={data} projectId={projectId} />
                <RunCaps suggested={suggested} edits={capEdits} onChange={setCapEdits} />
              </Box>
            </ExpandableRow>
          ) : null}
          {data && total ? (
            <ExpandableRow summary={<Text>모델 <Text tone="muted">· AI 노드 {data.nodes.length}개{Object.keys(chosenModels).length ? ` · ${Object.keys(chosenModels).length}개 이번만 바꿈` : ' · 워크플로대로'}</Text></Text>}>
            <RunModels
              nodes={data.nodes}
              picked={runModels}
              onPick={(nodeId, value) => setRunModels((previous) => ({ ...previous, [nodeId]: value }))}
              onReset={(nodeId) => setRunModels(({ [nodeId]: _gone, ...rest }) => rest)}
            />
            </ExpandableRow>
          ) : null}
          {ready && plan.isError && plan.data && <Text as="p" variant="body" tone="danger">계획을 다시 계산하지 못했습니다: {plan.error.message}</Text>}
          {ready && plan.isPending && <Skeleton height="placeholder-sm" width="full" />}

        </Bleed>

        {/* The readiness warnings right above the start, read before it is pressed. */}
        {/* Listeners, speech rules and glossary checks are about lines: a term run has none of them. */}
        {data && total && !terms ? (
          <Readiness
            projectId={projectId}
            readiness={data.readiness}
            oneScene={scopeTarget === 'here' && here?.length === 1 ? here[0].id : undefined}
            onLeave={() => setOpen(false)}
          />
        ) : null}
        {/* Right above the start: what this run may do to what a person decided. */}
        {!terms && data && total ? (
          <Inline as="label" gap="condensed" variant="body">
            <Checkbox checked={changeHuman} onCheckedChange={(checked) => setChangeHuman(checked === true)} />
            사람이 정한 상태·붙인 태그도 바꾸기
            <Text variant="caption" tone="muted">끄면 그대로 두고 실행 상세에 남깁니다</Text>
          </Inline>
        ) : null}
        {start.isError && <Text as="p" variant="body" tone="danger">{start.error.message}</Text>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button disabled={start.isPending} disabledReason={startBlocked} onClick={() => start.mutate()}>
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
  const applies = checks.filter((row) => readiness.applies[row.uses]);
  // A workflow that neither writes nor judges translations with this context has nothing to get ready.
  if (!applies.length) return null;
  // Only what is not ready is listed; all ready is one quiet line.
  const rows = applies.filter((row) => !row.ok);
  if (!rows.length) return <Inline gap="condensed" variant="body" tone="muted"><ReadinessDot ok /> 준비됨 · 청자·말투 규칙·용어</Inline>;
  return (
    <Box as="section" spaceY="condensed">
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
