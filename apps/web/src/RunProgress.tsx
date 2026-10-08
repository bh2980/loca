import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Clock3, LoaderCircle, Square, Terminal, TriangleAlert } from 'lucide-react';
import { profileAtRoute, STAGE_LABELS, type ChangeRecord, type Group, type JobStep, type Run, type WorkspaceState } from '@workbench/contracts';
import type { Mutate } from './App';
import { SavedTaskSnapshot } from './TaskSnapshotView';
import { apiPath } from './api';
import { runOutcome } from './workflow-state';
import './run-results.css';

type TimedStep = JobStep & { startedAt?: string; finishedAt?: string };
export const runLabels: Record<Run['status'], string> = { queued: '실행 대기', running: '작업 중', paused: '일시정지', completed: '완료', cancelled: '취소됨', failed: '오류 발생' };
const stepLabels: Record<JobStep['status'], string> = { queued: '대기', running: '응답 대기', completed: '완료', failed: '실패' };

export function currentRunStep(run?: Run): TimedStep | undefined {
  if (!run) return undefined;
  if (run.status === 'completed' || run.status === 'cancelled') return undefined;
  return run.steps.find(step => step.status === 'running')
    ?? (run.status === 'failed' ? run.steps.find(step => step.status === 'failed') : undefined)
    ?? run.steps.find(step => step.status === 'queued');
}

export function elapsedLabel(start: string | undefined, end: number): string {
  if (!start) return '시각 기록 없음';
  const parsed = Date.parse(start);
  if (!Number.isFinite(parsed) || !Number.isFinite(end)) return '시각 기록 없음';
  const seconds = Math.max(0, Math.floor((end - parsed) / 1000));
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분`;
}

function scopeLabel(step: JobStep | undefined, groups: Group[]): string {
  if (!step) return '전체 실행';
  return step.groupId ? groups.find(group => group.id === step.groupId)?.title ?? step.groupId : '작품 전체';
}

function activityLabel(run: Run, step?: JobStep): string {
  if (run.status === 'failed') return '오류로 중단';
  if (run.status === 'paused') return step?.status === 'running' ? '일시정지 요청 · 현재 응답 대기' : '일시정지';
  if (run.status === 'cancelled') return '취소됨 · 완료 결과 보존';
  if (run.status === 'completed') return '실행 완료';
  if (step?.status === 'running') {
    const connection = run.connections.find(item => item.id === profileAtRoute(run.profiles[step.stage], step.routeIndex ?? 0).connectionId);
    return connection?.kind === 'mock' ? '모의 응답 처리 중' : '모델 응답 대기';
  }
  return step?.error ? '재시도 대기' : '다음 단계 대기';
}

export function RunProgress({ run, state, mutate, busy, lastSyncAt, disconnected, onOpenTarget }: {
  run: Run; state: WorkspaceState; mutate: Mutate; busy: boolean; lastSyncAt: number;
  disconnected: boolean; onOpenTarget: (step: JobStep) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  const step = currentRunStep(run);
  const active = ['queued', 'running', 'paused'].includes(run.status);
  const inFlight = active && step?.status === 'running';
  const completed = run.steps.filter(item => item.status === 'completed').length;
  const profile = step ? profileAtRoute(run.profiles[step.stage], step.routeIndex ?? 0) : undefined;
  const connection = profile ? run.connections.find(item => item.id === profile.connectionId) : undefined;
  const targetCount = step?.unitIds.length ?? new Set(run.steps.flatMap(item => item.unitIds)).size;
  const start = inFlight ? step?.startedAt ?? run.updatedAt : undefined;
  const remaining = run.steps.filter(item => item.status !== 'completed');
  const canRetryCurrent = ['paused', 'failed', 'cancelled'].includes(run.status) && remaining.length > 0 && !run.steps.some(item => item.status === 'running');
  const retryStages = [...new Set(remaining.map(item => item.stage))];
  const detailId = `run-expanded-${run.id}`;
  useEffect(() => {
    if (!inFlight) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inFlight, step?.id]);

  return <section className={`run-progress compact ${active ? 'is-active' : ''} ${run.status === 'failed' ? 'has-error' : ''}`} aria-label="실시간 작업 진행">
    <div className="run-compact-row">
      <div className="run-compact-status" aria-live="polite" aria-atomic="true">{inFlight ? <LoaderCircle size={13} className="spinning" /> : run.status === 'completed' ? <CheckCircle2 size={13} /> : run.status === 'failed' ? <TriangleAlert size={13} /> : <Terminal size={13} />}<strong>{step ? STAGE_LABELS[step.stage] : runLabels[run.status]}</strong><span>{activityLabel(run, step)}</span></div>
      <span className="run-compact-scope" title={`${state.project.title} · ${scopeLabel(step, state.groups)}`}>{scopeLabel(step, state.groups)}</span>
      {profile ? <span className="run-compact-model" title={`${connection?.name ?? profile.connectionId} · ${profile.model}`}>{profile.model}</span> : null}
      <span className="run-compact-count">{completed}/{run.steps.length}단계{start ? ` · ${elapsedLabel(start, now)}` : ''}</span>
      <div className="run-compact-controls">
        {step && (step.groupId || step.unitIds.length) ? <Button onClick={() => onOpenTarget(step)} variant="ghost" size="sm"><ArrowUpRight size={11} />대상 보기</Button> : null}
        {['running', 'queued'].includes(run.status) ? <Button disabled={busy} aria-label="실행 일시정지" title="실행 일시정지" onClick={() => void mutate(`/runs/${run.id}/pause`)} variant="ghost" size="icon-sm"><CirclePause size={13} /></Button> : null}
        {['paused', 'failed'].includes(run.status) ? <Button disabled={busy || run.steps.some(item => item.status === 'running')} title="이 실행에 저장된 기존 모델·지시문으로 남은 단계를 다시 시작합니다" onClick={() => void mutate(`/runs/${run.id}/resume`)} variant="outline" size="sm"><CirclePlay size={12} />기존 설정으로 {run.status === 'failed' ? '재시도' : '재개'}</Button> : null}
        {active ? <Button aria-label="실행 취소" title="실행 취소" disabled={busy} onClick={() => void mutate(`/runs/${run.id}/cancel`)} variant="ghost" size="icon-sm"><Square size={11} /></Button> : null}
        <Button className=" run-expand-button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)} variant="ghost" size="sm">{run.status === 'failed' ? '오류 상세' : '상세'}<ChevronRight size={11} className={expanded ? 'expanded' : ''} /></Button>
      </div>
    </div>
    <div className="run-progress-track" role="progressbar" aria-label="완료한 작업 단계" aria-valuemin={0} aria-valuemax={run.steps.length || 1} aria-valuenow={completed}><div style={{ width: `${run.steps.length ? completed / run.steps.length * 100 : 0}%` }} /></div>
    {canRetryCurrent ? <details className="run-retry-options"><summary>현재 저장된 설정으로 다시 실행</summary><p>완료한 {completed}단계의 결과는 보존하고 남은 {remaining.length}단계 · 원문 {new Set(remaining.flatMap(item => item.unitIds)).size}개를 새 실행으로 만듭니다. 작업 설정에서 바꾼 모델과 지시문을 적용하려면 먼저 저장하세요.</p><ul>{retryStages.map(stage => <li key={stage}>{STAGE_LABELS[stage]}: {state.connections.find(item => item.id === state.profiles[stage].connectionId)?.name ?? state.profiles[stage].connectionId} · {state.profiles[stage].model} · 추론 {state.profiles[stage].effort || '기본값'} · 지시문 v{state.profiles[stage].promptVersion ?? 1}</li>)}</ul><Button disabled={busy} onClick={() => void mutate(`/runs/${run.id}/retry-current`, {})} variant="default" size="sm"><CirclePlay size={12} />현재 설정으로 남은 작업 실행</Button></details> : null}
    {expanded ? <div id={detailId} className="run-expanded-details"><div className="run-progress-metrics">
      <span>프로젝트 <strong>{state.project.title}</strong></span><span>장면 <strong>{scopeLabel(step, state.groups)}</strong></span>
      <span>실행 <strong>{run.mode === 'demo' ? '모의 실행' : run.mode === 'mixed' ? '혼합 실행' : '실제 모델'}</strong></span>
      <span>완료 단계 <strong>{completed} / {run.steps.length}</strong></span>
      {step?.batchCount && step.batchCount > 1 ? <span>현재 묶음 <strong>{(step.batchIndex ?? 0) + 1} / {step.batchCount}</strong></span> : null}
      <span>{step ? '현재 대상' : '실행 대상'} <strong>원문 {targetCount}개</strong></span>
      {profile ? <span className="run-model">{connection?.name ?? profile.connectionId} <strong>{profile.model}</strong>{profile.effort ? ` · ${profile.effort}` : ''}</span> : null}
      {start ? <span><Clock3 size={11} />{step?.startedAt ? '현재 단계 경과' : '최근 상태 변경 후'} <strong>{elapsedLabel(start, now)}</strong></span> : null}
      {!active ? <span><Clock3 size={11} />전체 경과 <strong>{elapsedLabel(run.createdAt, Date.parse(run.updatedAt))}</strong></span> : null}
    </div>
    {run.error ? <p className="run-progress-error" role={run.status === 'failed' ? 'alert' : undefined}>{run.status === 'failed' ? '오류' : '최근 오류'}: {run.error}</p> : null}
    <div className="run-progress-footer"><span className={disconnected ? 'run-disconnected' : ''}>{disconnected ? '연결 끊김 · 마지막 확인' : '상태 갱신'} {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString('ko-KR', { hour12: false }) : '—'}</span><span>단계 상태를 자동 갱신합니다. 모델의 작성 중 텍스트는 스트리밍되지 않습니다.</span></div></div> : null}
  </section>;
}

const runTitle = (run: Run) => run.kind === 'pipeline' ? '전체 번역 과정' : [...new Set(run.steps.map(step => step.stage))].map(stage => STAGE_LABELS[stage]).join(' · ') || '번역 작업';
const formatDate = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 없음';
const runModeLabel = (run: Run) => run.mode === 'demo' ? '모의 실행' : run.mode === 'mixed' ? '혼합 실행' : '실제 모델';
const stateTone = (status: Run['status'] | JobStep['status']) => status === 'completed' ? 'success' : status === 'failed' ? 'destructive' : status === 'running' ? 'warning' : 'outline';

type ResultCallbacks = { onOpenTarget: (step: JobStep) => void; onInspectUnit?: (unitId: string) => void; onReviewScope?: (unitIds: string[]) => void };
export function RunHistory({ state, onOpenTarget, onInspectUnit, onReviewScope }: { state: WorkspaceState } & ResultCallbacks) {
  const [selectedId, setSelectedId] = useState<string>();
  const selectedIndex = Math.max(0, state.runs.findIndex(run => run.id === selectedId));
  const selectedRun = state.runs[selectedIndex];
  const size = 20, page = Math.floor(selectedIndex / size), pageCount = Math.max(1, Math.ceil(state.runs.length / size));
  const targetsByRun = useMemo(() => new Map(state.runs.map(run => [run.id, new Set(run.steps.flatMap(step => step.unitIds)).size])), [state.runs]);
  const inspect = (id: string) => {
    if (onInspectUnit) onInspectUnit(id);
    else { const target = selectedRun?.steps.find(step => step.unitIds.includes(id)); if (target) onOpenTarget({ ...target, unitIds: [id] }); }
  };
  return <main className="run-results-page">
    <header className="run-results-heading"><h1>실행 결과</h1><span>{state.runs.length}개 실행</span></header>
    {!selectedRun ? <div className="run-results-empty"><Terminal size={30} /><h2>아직 실행 기록이 없습니다.</h2><p>장면에서 작업을 실행하면 저장된 번역과 변경 내용을 이곳에서 확인할 수 있습니다.</p></div> : <div className="run-results-layout">
      <aside className="run-selection" aria-label="실행 목록"><div className="run-selection-scroll">{state.runs.slice(page * size, (page + 1) * size).map(run => <Button key={run.id} className="run-selection-item" aria-current={run.id === selectedRun.id ? 'true' : undefined} onClick={() => setSelectedId(run.id)} variant="ghost">
        <span className="run-selection-date">{formatDate(run.createdAt)}<Badge variant={stateTone(run.status)}>{runLabels[run.status]}</Badge></span>
        <strong>{runTitle(run)}</strong><span className="run-selection-meta">{runModeLabel(run)} · 원문 {targetsByRun.get(run.id)}개</span>
        <span className="run-selection-progress">{run.steps.filter(step => step.status === 'completed').length}/{run.steps.length}단계 완료</span>
      </Button>)}</div>{pageCount > 1 ? <div className="run-results-pagination"><Button disabled={page === 0} onClick={() => setSelectedId(state.runs[(page - 1) * size]?.id)} variant="ghost" size="sm">이전</Button><span>{page + 1} / {pageCount}</span><Button disabled={page + 1 >= pageCount} onClick={() => setSelectedId(state.runs[(page + 1) * size]?.id)} variant="ghost" size="sm">다음</Button></div> : null}</aside>
      <RunResults key={selectedRun.id} state={state} run={selectedRun} onOpenTarget={onOpenTarget} onInspectUnit={inspect} onReviewScope={onReviewScope} />
    </div>}
  </main>;
}

const changeLabels: Record<string, string> = {
  'translation-created': '번역 저장', 'translation-updated': '번역 수정', 'translation-reviewed': '번역 확인',
  'translation-stale': '다시 확인할 번역', 'translation-lock': '번역 보호 변경', 'translation-manual': '번역 직접 수정', 'translation-term-usage': '사용한 용어 후보 연결',
  'term-created': '용어 추가', 'term-updated': '용어 수정', 'knowledge-created': '작품 자료 추가',
  'knowledge-revised': '작품 자료 개정', 'knowledge-archived': '작품 자료 보관',
};
const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textField = (value: unknown, key: string) => { const field = asRecord(value)[key]; return typeof field === 'string' ? field : ''; };
const textExcerpt = (value: string, limit = 140) => value.length > limit ? `${value.slice(0, limit)}…` : value;
function savedStateLabel(value: unknown): string {
  const record = asRecord(value), labels: string[] = [];
  if (record.status === 'checked') labels.push(record.origin === 'demo' ? '모의 확인' : record.origin === 'manual' ? '직접 확인' : 'AI 확인');
  else if (record.status === 'draft') labels.push('초벌 번역');
  else if (record.status === 'untranslated') labels.push('미번역');
  if (record.freshness === 'stale') labels.push('다시 확인 필요');
  if (record.locked === true) labels.push('수정 보호됨');
  if (record.archived === true) labels.push('보관됨');
  if (typeof record.version === 'number') labels.push(`버전 ${record.version}`);
  return labels.join(' · ');
}

/** Read old executions from their own saved versions, never substitute today's translation. */
function legacyRunChanges(state: WorkspaceState, run: Run): ChangeRecord[] {
  const records: ChangeRecord[] = [];
  for (const translation of Object.values(state.translations)) {
    const versions = [...translation.history].sort((left, right) => left.version - right.version);
    versions.forEach((version, index) => {
      if (version.execution?.runId !== run.id) return;
      records.push({ id: `history:${translation.unitId}:${version.version}`, createdAt: version.createdAt, kind: index ? 'translation-updated' : 'translation-created', unitIds: [translation.unitId], groupIds: [], before: versions[index - 1], after: version, runId: run.id, stepId: version.execution.stepId, stage: version.execution.stage, model: version.execution.model, promptVersion: version.execution.promptVersion, snapshotId: version.execution.snapshotId });
    });
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

type ResultTab = 'changes' | 'steps' | 'info';
function RunResults({ state, run, onOpenTarget, onInspectUnit, onReviewScope }: { state: WorkspaceState; run: Run; onInspectUnit: (id: string) => void } & Omit<ResultCallbacks, 'onInspectUnit'>) {
  const result = useMemo(() => runOutcome(state, run.id), [state.translations, state.reviews, state.knowledge, run.id]);
  const sources = useMemo(() => new Map(state.units.map(unit => [unit.id, unit])), [state.units]);
  const groups = useMemo(() => new Map(state.groups.map(group => [group.id, group])), [state.groups]);
  const [tab, setTab] = useState<ResultTab>('changes');
  const [stepId, setStepId] = useState(() => currentRunStep(run)?.id ?? run.steps[0]?.id);
  const [ledger, setLedger] = useState<{ offset: number; total: number; items: ChangeRecord[] }>();
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const pageSize = 40;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void fetch(apiPath(`/changes?runId=${encodeURIComponent(run.id)}&offset=${offset}&limit=${pageSize}`), { signal: controller.signal }).then(async response => {
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(typeof error.error === 'string' ? error.error : '변경 내용을 불러오지 못했습니다.'); }
      return response.json() as Promise<{ total: number; items: ChangeRecord[] }>;
    }).then(value => { if (!controller.signal.aborted) setLedger({ ...value, offset }); }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '변경 내용을 불러오지 못했습니다.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [run.id, run.updatedAt, state.revision, offset, refresh]);
  const legacy = useMemo(() => ledger?.total === 0 ? legacyRunChanges(state, run) : [], [ledger?.total, state.translations, run.id]);
  const isLegacy = ledger?.total === 0 && legacy.length > 0;
  const total = isLegacy ? legacy.length : ledger?.total ?? 0;
  const visibleChanges = isLegacy ? legacy.slice(offset, offset + pageSize) : ledger?.offset === offset ? ledger.items : [];
  const selectedStep = run.steps.find(step => step.id === stepId) ?? run.steps[0];
  const targetIds = [...new Set(run.steps.flatMap(step => step.unitIds))];
  const stages = [...new Set(run.steps.map(step => step.stage))];
  const tabLabels: Record<ResultTab, string> = { changes: '변경된 내용', steps: '실행 단계', info: '실행 정보' };
  return <section className="run-result-detail" aria-label="선택한 실행 결과">
    <div className="run-result-summary"><div className="run-result-title"><div><span className="run-result-date">{formatDate(run.createdAt)} · {runModeLabel(run)}</span><h2>{runTitle(run)}</h2></div><Badge variant={stateTone(run.status)}>{runLabels[run.status]}</Badge></div>
      <div className="run-result-metrics"><span><strong>{result.savedUnitIds.length}</strong>개 번역 저장</span><span><strong>{result.proposedUnitIds.length}</strong>개 수정안</span><span><strong>{result.knowledgeIds.length}</strong>개 작품 자료</span></div>
      {result.reviewUnitIds.length && onReviewScope ? <Button onClick={() => onReviewScope(result.reviewUnitIds)} variant="default" size="sm">미해결 검토 {result.reviewUnitIds.length}개 열기<ArrowUpRight size={13} /></Button> : null}
      {run.error ? <p className="run-result-error" role={run.status === 'failed' ? 'alert' : undefined}>{run.error}</p> : null}
    </div>
    <div className="run-result-tabs" role="group" aria-label="실행 결과 보기">{(['changes', 'steps', 'info'] as const).map(value => <Button key={value} aria-pressed={tab === value} onClick={() => setTab(value)} variant="ghost">{tabLabels[value]}{value === 'steps' ? <span>{run.steps.length}</span> : null}</Button>)}</div>
    <div className="run-result-scroll">
      {tab === 'changes' ? <div className="run-changes-view"><div className="run-result-section-heading"><p>{isLegacy ? '이 실행에 기록된 번역 이력을 표시합니다.' : '실행 당시 저장한 값입니다. 이후 편집한 현재 값과 다를 수 있습니다.'}</p><Button disabled={loading} onClick={() => setRefresh(value => value + 1)} variant="ghost" size="sm">{loading ? <LoaderCircle size={12} className="spinning" /> : null}{loading ? '갱신 중' : '새로고침'}</Button></div>
        {error ? <div className="run-result-error" role="alert"><p>{error}</p><Button onClick={() => setRefresh(value => value + 1)} variant="outline" size="sm">다시 불러오기</Button></div> : null}
        {loading && !ledger ? <p className="run-results-loading" role="status"><LoaderCircle size={16} className="spinning" />저장한 변경 내용을 불러옵니다.</p> : null}
        {visibleChanges.map(change => <RunChangeCard key={change.id} change={change} sources={sources} groups={groups} onInspectUnit={onInspectUnit} />)}
        {ledger && !error && !loading && total === 0 ? <div className="run-results-empty small"><h3>저장된 변경 내용이 없습니다.</h3><p>{result.proposedUnitIds.length ? '번역을 바로 바꾸지 않고 수정안을 만들었습니다. 위의 미해결 검토에서 제안을 확인하세요.' : run.status === 'queued' || run.status === 'running' || run.status === 'paused' ? '작업 결과가 저장되면 여기에 표시됩니다.' : result.knowledgeIds.length ? '작품 자료는 결과로 남아 있지만 이 실행의 상세 변경 기록은 없습니다.' : '변경 없이 확인만 끝났거나, 이 실행에서 상세 결과를 기록하지 않았습니다. 실행 단계에서 처리 여부를 확인하세요.'}</p></div> : null}
        {total > pageSize ? <div className="run-results-pagination"><Button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))} variant="ghost" size="sm">이전 변경</Button><span>{offset + 1}–{Math.min(offset + pageSize, total)} / {total}건</span><Button disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)} variant="ghost" size="sm">다음 변경</Button></div> : null}
      </div> : null}
      {tab === 'steps' ? <div className="run-stage-view"><div className="run-stage-list" aria-label="실행 단계 목록">{run.steps.map((step, index) => <Button key={step.id} aria-current={selectedStep?.id === step.id ? 'true' : undefined} onClick={() => setStepId(step.id)} variant="ghost"><span className="run-stage-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{STAGE_LABELS[step.stage]}</strong><span>{scopeLabel(step, state.groups)} · 원문 {step.unitIds.length}개</span><span>{profileAtRoute(run.profiles[step.stage], step.routeIndex ?? 0).model || '모델 기록 없음'}{step.batchCount && step.batchCount > 1 ? ` · 묶음 ${(step.batchIndex ?? 0) + 1}/${step.batchCount}` : ''}</span></span><Badge variant={stateTone(step.status)}>{step.status === 'queued' && run.status === 'cancelled' ? '취소됨' : stepLabels[step.status]}</Badge></Button>)}</div>
        {selectedStep ? <RunStepDetail key={selectedStep.id} step={selectedStep} run={run} state={state} sources={sources} groups={groups} onOpenTarget={onOpenTarget} onInspectUnit={onInspectUnit} /> : <p className="subtext">실행 단계가 기록되지 않았습니다.</p>}
      </div> : null}
      {tab === 'info' ? <div className="run-info-view"><dl className="run-info-facts"><div><dt>작품</dt><dd>{state.project.title}</dd></div><div><dt>실행 대상</dt><dd>원문 {targetIds.length}개 · {run.steps.length}단계</dd></div><div><dt>시작</dt><dd>{formatDate(run.createdAt)}</dd></div><div><dt>마지막 상태 변경</dt><dd>{formatDate(run.updatedAt)}</dd></div><div><dt>기록된 경과</dt><dd>{elapsedLabel(run.createdAt, Date.parse(run.updatedAt))}</dd></div><div><dt>입력 / 출력 토큰</dt><dd>{run.usage.inputTokens === undefined && run.usage.outputTokens === undefined ? '모델이 사용량을 제공하지 않았습니다.' : `${run.usage.inputTokens?.toLocaleString('ko-KR') ?? '미제공'} / ${run.usage.outputTokens?.toLocaleString('ko-KR') ?? '미제공'}`}</dd></div>{run.usage.costUsd !== undefined ? <div><dt>보고된 비용</dt><dd>${run.usage.costUsd.toFixed(4)}</dd></div> : null}<div><dt>실행 ID</dt><dd className="run-reference">{run.id}</dd></div></dl>
        <h3>이 실행에 저장된 모델 설정</h3><div className="run-model-list">{stages.map(stage => { const profile = run.profiles[stage]; return <div key={stage}><strong>{STAGE_LABELS[stage]}</strong><span>{run.connections.find(connection => connection.id === profile.connectionId)?.name ?? '연결 기록 없음'} · {profile.model || '모델 기록 없음'}</span><span>추론 {profile.effort || '기본값'} · 지시문 v{profile.promptVersion ?? 1} · 대체 {profile.fallbacks?.map(route => route.model).join(' → ') || '없음'} · 최대 응답 {profile.maxOutputTokens.toLocaleString('ko-KR')}토큰</span></div>; })}</div>
        <h3>실행 중 남긴 기록</h3>{run.logs.length ? <ol className="run-info-log">{run.logs.slice(-40).map((entry, index) => <li key={`${index}:${entry}`}>{entry}</li>)}</ol> : <p className="subtext">추가 실행 기록이 없습니다.</p>}{run.logs.length > 40 ? <p className="subtext">이 실행의 마지막 40개 기록을 표시합니다.</p> : null}
      </div> : null}
    </div>
  </section>;
}

function termCandidateSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.candidates)) return textField(value, 'target');
  return record.candidates.map((candidate: Record<string, unknown>, index: number) => {
    const label = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    const state = candidate.enabled === false ? '사용 중지' : candidate.isDefault ? '기본' : '조건별 후보';
    const evidence = Array.isArray(candidate.evidence) && candidate.evidence.length ? ` · 문장 근거 ${candidate.evidence.length}개` : '';
    return `${label}: ${String(candidate.target || '대응 번역 미정')} · ${state}${evidence}${candidate.guidance ? `\n${String(candidate.guidance)}` : ''}`;
  }).join('\n\n');
}

function RunChangeCard({ change, sources, groups, onInspectUnit }: { change: ChangeRecord; sources: Map<string, WorkspaceState['units'][number]>; groups: Map<string, Group>; onInspectUnit: (id: string) => void }) {
  const translation = change.kind.startsWith('translation-'), term = change.kind.startsWith('term-'), knowledge = change.kind.startsWith('knowledge-');
  const field = translation ? 'text' : term ? 'target' : knowledge ? 'content' : '';
  const before = term ? termCandidateSummary(change.before) : field ? textField(change.before, field) : '', after = term ? termCandidateSummary(change.after) : field ? textField(change.after, field) : '';
  const title = term ? textField(change.after, 'source') || textField(change.before, 'source') : knowledge ? textField(change.after, 'title') || textField(change.before, 'title') : '';
  const beforeLabel = savedStateLabel(change.before), afterLabel = savedStateLabel(change.after);
  const descriptionBefore = term ? textField(change.before, 'description') : '', descriptionAfter = term ? textField(change.after, 'description') : '';
  return <article className="run-change-card"><header><div><span className="run-change-kind">{changeLabels[change.kind] ?? '결과 변경'}</span>{title ? <h3>{title}</h3> : null}</div><time dateTime={change.createdAt}>{formatDate(change.createdAt)}</time></header>
    {translation ? <ChangeTargets ids={change.unitIds} sources={sources} groups={groups} onInspectUnit={onInspectUnit} /> : null}
    {field && (before !== after || !before) ? <div className="run-change-comparison"><div><span>{term ? '이전 번역어' : '변경 전'}</span><p className={!before ? 'empty-value' : ''}>{before || '저장된 내용 없음'}</p>{beforeLabel ? <small>{beforeLabel}</small> : null}</div><div><span>{term ? '새 번역어' : '변경 후'}</span><p className={!after ? 'empty-value' : ''}>{after || '빈 내용'}</p>{afterLabel ? <small>{afterLabel}</small> : null}</div></div> : field ? <div className="run-change-unchanged"><span>본문 유지</span><p>{after || '빈 내용'}</p>{beforeLabel !== afterLabel ? <small>{beforeLabel || '이전 상태 기록 없음'} → {afterLabel || '상태 기록 없음'}</small> : <small>{afterLabel || '내용을 바꾸지 않고 확인했습니다.'}</small>}</div> : <p className="subtext">이 종류의 변경에는 표시 가능한 본문이 기록되지 않았습니다.</p>}
    {term && descriptionBefore !== descriptionAfter ? <div className="run-change-comparison secondary"><div><span>이전 설명</span><p>{descriptionBefore || '설명 없음'}</p></div><div><span>새 설명</span><p>{descriptionAfter || '설명 없음'}</p></div></div> : null}
    {!translation ? <ChangeTargets ids={change.unitIds} sources={sources} groups={groups} onInspectUnit={onInspectUnit} /> : null}
    <footer>{change.stage ? <span>{STAGE_LABELS[change.stage]}</span> : null}{change.model ? <span>{change.model}</span> : null}{change.promptVersion ? <span>지시문 v{change.promptVersion}</span> : null}</footer>
  </article>;
}

function RunStepDetail({ step, run, state, sources, groups, onOpenTarget, onInspectUnit }: { step: JobStep; run: Run; state: WorkspaceState; sources: Map<string, WorkspaceState['units'][number]>; groups: Map<string, Group>; onOpenTarget: (step: JobStep) => void; onInspectUnit: (id: string) => void }) {
  const profile = profileAtRoute(run.profiles[step.stage], step.routeIndex ?? 0);
  return <section className="run-stage-detail"><div className="run-result-section-heading"><h3>{STAGE_LABELS[step.stage]}</h3>{step.groupId || step.unitIds.length ? <Button onClick={() => onOpenTarget(step)} variant="outline" size="sm">대상 장면 열기<ArrowUpRight size={12} /></Button> : null}</div><p className="subtext">{scopeLabel(step, state.groups)}</p>
    <dl className="run-info-facts"><div><dt>모델</dt><dd>{run.connections.find(connection => connection.id === profile.connectionId)?.name ?? '연결 기록 없음'} · {profile.model || '모델 기록 없음'}</dd></div><div><dt>추론 · 지시문</dt><dd>{profile.effort || '기본값'} · v{profile.promptVersion ?? 1}</dd></div><div><dt>처리</dt><dd>원문 {step.unitIds.length}개 · 시도 {step.attempts}회</dd></div><div><dt>시작 / 종료</dt><dd>{formatDate(step.startedAt)} / {step.status === 'running' ? '응답 대기 중' : formatDate(step.finishedAt)}</dd></div></dl>
    {step.error ? <p className="run-result-error">{step.error}</p> : null}
    {step.attemptHistory?.length ? <><h4>AI 호출 이력</h4><ol className="model-attempt-list">{step.attemptHistory.map((attempt, index) => <li key={index}>
      <strong>{attempt.routeIndex ? `대체 ${attempt.routeIndex}` : '기본 AI'} · {run.connections.find(item => item.id === attempt.connectionId)?.name ?? attempt.connectionId} · {attempt.model}</strong>
      <p className="subtext">추론 {attempt.effort || '기본값'} · {{ running: '응답 대기', completed: '응답 수신·저장', failed: '실패', cancelled: '취소', interrupted: '실행부 중단' }[attempt.status]} · {formatDate(attempt.startedAt)}</p>
      {attempt.error ? <p className="run-result-error">{attempt.error}</p> : null}
      {attempt.snapshotId ? <SavedTaskSnapshot id={attempt.snapshotId} /> : null}
    </li>)}</ol></> : null}
    <h4>실행 근거</h4>{step.snapshotId ? <SavedTaskSnapshot key={step.snapshotId} id={step.snapshotId} /> : <p className="subtext">이 단계의 입력 기록이 없습니다.</p>}
    <h4>대상 원문</h4><ChangeTargets ids={step.unitIds} sources={sources} groups={groups} onInspectUnit={onInspectUnit} />
  </section>;
}

function ChangeTargets({ ids, sources, groups, onInspectUnit }: { ids: string[]; sources: Map<string, WorkspaceState['units'][number]>; groups: Map<string, Group>; onInspectUnit: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const existing = ids.filter(id => sources.has(id));
  const size = 20, safePage = Math.min(page, Math.max(0, Math.ceil(existing.length / size) - 1));
  return <><div className="run-change-targets">{existing.slice(safePage * size, (safePage + 1) * size).map(id => { const unit = sources.get(id)!; return <Button key={id} onClick={() => onInspectUnit(id)} title={unit.source} variant="ghost"><span><strong>{unit.speaker || '화자 미지정'}</strong><span>{groups.get(unit.groupId)?.title ?? unit.groupId}</span><ArrowUpRight size={12} /></span><span className="run-target-source">{textExcerpt(unit.source)}</span><small>{id}</small></Button>; })}</div>{!ids.length ? <p className="subtext">직접 연결된 원문이 없는 결과입니다.</p> : existing.length < ids.length ? <p className="subtext">현재 작품에 없는 원문 {ids.length - existing.length}개는 이동할 수 없습니다.</p> : null}{existing.length > size ? <div className="run-results-pagination"><Button disabled={!safePage} onClick={() => setPage(safePage - 1)} variant="ghost" size="sm">이전 원문</Button><span>{safePage * size + 1}–{Math.min((safePage + 1) * size, existing.length)} / {existing.length}개</span><Button disabled={(safePage + 1) * size >= existing.length} onClick={() => setPage(safePage + 1)} variant="ghost" size="sm">다음 원문</Button></div> : null}</>;
}
