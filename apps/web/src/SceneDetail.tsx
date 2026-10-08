import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Group, SourceUnit, WorkspaceState } from '@workbench/contracts';
import { DialogueCard, type Draft } from './DialogueCard';
import { branchName, RecordedConditions, UnitInspector, useGraphEvidence } from './UnitInspector';
import type { Mutate } from './App';
import { SceneActions, SceneChrome, SceneInfo } from './SceneChrome';
import './ux-navigation.css';

export const SOURCE_PAGE_SIZE = 100;
interface ScenePreferences { branch: string; filterPage: number; checked: string[]; runScope: 'scene' | 'filtered' | 'selected' }
export interface SceneDetailProps {
  state: WorkspaceState; group?: Group; groups: Group[]; units: SourceUnit[]; sourcePage: number;
  onSourcePage: (page: number) => void; focusId: string; drafts: Record<string, Draft>;
  onDraft: (id: string, draft?: Draft) => void; mutate: Mutate; busy: boolean; activeRun: boolean;
  targetUnitIds: Set<string>; activityLabel?: string; activityState: 'failed' | 'running' | 'waiting';
  onTerm: (id: string) => void; onNavigateUnit: (id: string) => void; onBack: () => void;
  onFlow: (groupId: string, unitId?: string) => void; onSelectGroup: (groupId: string) => void;
  onInspectUnit?: (id: string) => void; onSelectUnit?: (id: string) => void;
  onReviewScope?: (groupId: string) => void; onRunScope?: (groupId: string, unitIds: string[]) => void;
  onTestScope?: (groupId: string, unitIds: string[]) => void;
  onChatScope?: (unitIds: string[]) => void;
}

export function SceneDetail(props: SceneDetailProps) {
  const saved = useRef(new Map<string, ScenePreferences>()), cacheKey = `${props.state.project.id}:${props.group?.id ?? 'empty'}`;
  const onPreferences = useCallback((preferences: ScenePreferences) => { saved.current.set(cacheKey, preferences); }, [cacheKey]);
  return <SceneContent key={cacheKey} {...props} initialPreferences={saved.current.get(cacheKey)} onPreferences={onPreferences} />;
}

function SceneContent({ state, group, groups, units, sourcePage, onSourcePage, focusId, drafts, onDraft, mutate, busy, activeRun, targetUnitIds, activityLabel, activityState, onTerm, onNavigateUnit, onBack, onFlow, onSelectGroup, onInspectUnit, onSelectUnit, onReviewScope, onRunScope, onTestScope, onChatScope, initialPreferences, onPreferences }: SceneDetailProps & { initialPreferences?: ScenePreferences; onPreferences: (preferences: ScenePreferences) => void }) {
  const [branch, setBranch] = useState(() => { const value = initialPreferences?.branch ?? '', target = units.find(unit => unit.id === focusId); return value && target && target.branch !== value && !(value !== 'unknown' && target.branch === 'common') ? '' : value; }), [filterPage, setFilterPage] = useState(initialPreferences?.filterPage ?? 0);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialPreferences?.checked ?? [])), [runScope, setRunScope] = useState<'scene' | 'filtered' | 'selected'>(initialPreferences?.runScope ?? 'scene');
  const [localInspector, setLocalInspector] = useState('');
  const previousFocus = useRef(focusId);
  useEffect(() => { onPreferences({ branch, filterPage, checked: [...checked], runScope }); }, [branch, filterPage, checked, runScope, onPreferences]);
  const branches = useMemo(() => [...new Set(units.map(unit => unit.branch))], [units]);
  const filtered = useMemo(() => units.filter(unit => branch === '' || unit.branch === branch || branch !== 'unknown' && unit.branch === 'common'), [units, branch]);
  const pages = Math.max(1, Math.ceil(filtered.length / SOURCE_PAGE_SIZE)), page = Math.min(branch === '' ? sourcePage : filterPage, pages - 1);
  const visibleUnits = filtered.slice(page * SOURCE_PAGE_SIZE, (page + 1) * SOURCE_PAGE_SIZE);
  const indexById = useMemo(() => new Map(units.map((unit, index) => [unit.id, index])), [units]);
  const selectedUnits = runScope === 'scene' ? units : runScope === 'filtered' ? filtered : units.filter(unit => checked.has(unit.id));
  const unitIds = new Set(units.map(unit => unit.id)), openReviews = state.reviews.filter(review => review.status === 'open' && unitIds.has(review.unitId)).length;
  const completed = units.filter(unit => state.translations[unit.id]?.status === 'checked' && state.translations[unit.id]?.freshness === 'current').length;
  const confirmationKinds = [...new Set(units.flatMap(unit => { const translation = state.translations[unit.id]; return translation?.status === 'checked' && translation.freshness === 'current' ? [translation.origin === 'demo' || translation.execution?.demo ? '모의' : translation.origin === 'manual' ? '직접' : 'AI'] : []; }))];
  const { graph, loading, error } = useGraphEvidence(group ? { groupId: group.id, offset: page * SOURCE_PAGE_SIZE, limit: 120 } : undefined);
  const inspect = (id: string) => { onSelectUnit?.(id); if (onInspectUnit) onInspectUnit(id); else setLocalInspector(id); };
  const changePage = (value: number) => { if (branch === '') onSourcePage(value); else setFilterPage(value); };
  useEffect(() => { if (previousFocus.current === focusId) return; previousFocus.current = focusId; if (focusId && !filtered.some(unit => unit.id === focusId) && units.some(unit => unit.id === focusId)) { setBranch(''); setFilterPage(0); } }, [focusId, filtered, units]);
  const run = () => {
    if (!group || !selectedUnits.length) return;
    if (onRunScope) onRunScope(group.id, selectedUnits.map(unit => unit.id));
    else void mutate('/runs', { kind: 'translate', groupId: group.id, unitIds: selectedUnits.map(unit => unit.id) }, 'POST', '선택한 범위의 번역을 시작했습니다.');
  };
  return <section className="scene-detail-page ux-scene-page">
    <SceneChrome groupId={group?.id ?? ''} groups={groups} view="read" onBack={onBack} onSelectGroup={onSelectGroup} onView={view => { if (view === 'flow' && group) onFlow(group.id); }} actions={group ? <SceneActions options={[{ value:'scene', label:'장면 전체', count:units.length }, { value:'filtered', label:'읽는 분기', count:filtered.length }, { value:'selected', label:'체크한 원문', count:units.filter(unit => checked.has(unit.id)).length }]} value={runScope} onChange={value => setRunScope(value as typeof runScope)} disabled={busy} onTest={onTestScope ? () => onTestScope(group.id, selectedUnits.map(unit => unit.id)) : undefined} onRun={activeRun ? undefined : run}><Button disabled={!filtered.length} onClick={() => { setChecked(new Set(filtered.map(unit => unit.id))); setRunScope('selected'); }} variant="ghost" size="sm">읽는 분기 모두 체크</Button>{onChatScope ? <Button disabled={!selectedUnits.length} onClick={() => onChatScope(selectedUnits.map(unit => unit.id))} variant="ghost" size="sm">원문 {selectedUnits.length}개 채팅에 첨부</Button> : null}{checked.size ? <Button onClick={() => setChecked(new Set())} variant="ghost" size="sm">체크 해제</Button> : null}{selectedUnits.some(unit => state.translations[unit.id]?.locked) ? <span>보호된 번역 포함</span> : null}</SceneActions> : undefined} />
    {group ? <>
      <div className="scene-detail-body"><main className="scene-detail-editor"><div className="scene-reading-controls"><label>분기<NativeSelect aria-label="읽을 분기" value={branch} onChange={event => { setBranch(event.target.value); setFilterPage(0); setRunScope(event.target.value === '' ? 'scene' : 'filtered'); }}>{['', ...branches].map(value => <NativeSelectOption key={value} value={value}>{value === '' ? '모든 분기' : `${branchName(value)}${value !== 'common' && value !== 'unknown' ? ' + 공통' : ''}`}</NativeSelectOption>)}</NativeSelect></label><span className="scene-reading-count">{filtered.length}개 원문 · {completed ? `${confirmationKinds.join('·')} 확인 ${completed}/${units.length}` : '확인 전'}</span>{openReviews ? <Button className="ux-text-action" disabled={!onReviewScope} onClick={() => onReviewScope?.(group.id)} variant="ghost">검토 대기 {openReviews}개</Button> : null}{group.description ? <SceneInfo description={group.description} /> : null}</div><div className="scene-editor-hint"><ShieldCheck size={12} />직접 저장한 번역은 자동 수정으로부터 보호됩니다.<span>원문 번호는 장면 내 추출 순서</span></div>
        {loading ? <p className="ux-graph-evidence" role="status">이 범위의 원본 분기 조건 확인 중…</p> : error ? <p className="ux-graph-evidence" role="alert">{error} · 대사 상세에서 다시 확인할 수 있습니다.</p> : graph && (graph.omittedNodes > 0 || graph.omittedEdges > 0) ? <p className="ux-graph-evidence">원본 연결 일부를 표시합니다. 대사별 문맥에서 해당 노드의 조건을 확인할 수 있습니다.</p> : null}
        {pages > 1 ? <SourcePagination page={page} pages={pages} total={filtered.length} onChange={changePage} /> : null}<div className="dialogue-list">{visibleUnits.map((unit, index) => { const previous = filtered[page * SOURCE_PAGE_SIZE + index - 1], boundary = !previous || previous.branch !== unit.branch || index === 0; return <Fragment key={unit.id}>{boundary ? <div className="ux-branch-heading"><strong>{branchName(unit.branch)}</strong><span>{index === 0 && previous?.branch === unit.branch ? '앞 페이지에서 이어지는 구간' : unit.branch === 'unknown' ? '추출 조건을 실행 경로별로 분류하지 않은 구간' : '추출된 분기 구간'}</span></div> : null}<DialogueCard unit={unit} translation={state.translations[unit.id]} index={indexById.get(unit.id) ?? index} terms={state.terms} selected={unit.id === focusId} draft={drafts[unit.id]} onDraft={onDraft} mutate={mutate} busy={busy} activity={targetUnitIds.has(unit.id) ? activityLabel : undefined} activityState={activityState} checked={checked.has(unit.id)} onChecked={value => { setChecked(current => { const next = new Set(current); if (value) next.add(unit.id); else next.delete(unit.id); return next; }); setRunScope('selected'); }} onSelect={() => onSelectUnit?.(unit.id)} onInspect={() => inspect(unit.id)} /><RecordedConditions unit={unit} graph={graph} empty={false} /></Fragment>; })}</div>{!filtered.length ? <p className="ux-muted">이 분기에 원문이 없습니다.</p> : null}{pages > 1 ? <SourcePagination page={page} pages={pages} total={filtered.length} onChange={changePage} /> : null}
      </main></div>
    </> : <div className="empty-state">프로젝트에 장면이 없습니다.</div>}
    {localInspector ? <UnitInspector state={state} unitId={localInspector} onClose={() => setLocalInspector('')} onNavigateUnit={onNavigateUnit} onOpenTerm={onTerm} onFlow={onFlow} onChatScope={onChatScope} /> : null}
  </section>;
}

function SourcePagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return <nav className="source-pagination" aria-label="원문 페이지"><span>{page * SOURCE_PAGE_SIZE + 1}–{Math.min((page + 1) * SOURCE_PAGE_SIZE, total)} / {total}개 원문</span><div className="actions"><Button disabled={page === 0} onClick={() => onChange(page - 1)} variant="ghost" size="sm">이전</Button><label>페이지 <NativeSelect aria-label="원문 페이지 선택" value={page} onChange={event => onChange(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <NativeSelectOption key={index} value={index}>{index + 1} / {pages}</NativeSelectOption>)}</NativeSelect></label><Button disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} variant="ghost" size="sm">다음</Button></div></nav>;
}



