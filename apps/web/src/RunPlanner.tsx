import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { useMemo, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { STAGES, STAGE_LABELS, type Stage, type WorkspaceState } from '@workbench/contracts';
import type { Mutate } from './App';
import './run-planner.css';

type TargetMode = 'all' | 'scenes' | 'units';
type TargetFilter = 'all' | 'untranslated' | 'stale';
export type RunScope = { unitIds?: string[]; groupId?: string; stage?: Stage; pipeline?: boolean; filter?: TargetFilter; targetMode?: TargetMode; groupIds?: string[] };
export function RunPlanner({ state, scope, mutate, busy, hasDrafts, onClose, onSettings }: { state: WorkspaceState; scope: RunScope; mutate: Mutate; busy: boolean; hasDrafts: boolean; onClose: () => void; onSettings: (scope: RunScope) => void }) {
  const [operation, setOperation] = useState<string>(scope.pipeline ? 'pipeline' : scope.stage ?? 'translate');
  const [filter, setFilter] = useState<TargetFilter>(scope.filter ?? (scope.stage === 'recheck' ? 'stale' : 'all'));
  const initialIds = scope.unitIds ? new Set(scope.unitIds) : null;
  const initialUnits = state.units.filter(unit => (!initialIds || initialIds.has(unit.id)) && (!scope.groupId || unit.groupId === scope.groupId));
  const wholeScene = !!scope.groupId && initialUnits.length === state.units.filter(unit => unit.groupId === scope.groupId).length;
  const [targetMode, setTargetMode] = useState<TargetMode>(scope.targetMode ?? (scope.groupId && wholeScene ? 'scenes' : scope.unitIds ? 'units' : scope.groupId ? 'scenes' : 'all'));
  const [selectedGroups, setSelectedGroups] = useState(() => new Set(scope.groupIds ?? (scope.groupId ? [scope.groupId] : initialUnits.map(unit => unit.groupId))));
  const [selectedUnits, setSelectedUnits] = useState(() => new Set(initialUnits.map(unit => unit.id)));
  const [search, setSearch] = useState('');
  const [sceneSearch, setSceneSearch] = useState('');
  const [sceneFilter, setSceneFilter] = useState('');
  const [page, setPage] = useState(0);
  const groups = useMemo(() => [...state.groups].sort((a,b) => a.order-b.order), [state.groups]);
  const groupNames = useMemo(() => new Map(groups.map(group => [group.id, group.title])), [groups]);
  const counts = useMemo(() => { const map = new Map<string, number>(); for (const unit of state.units) map.set(unit.groupId, (map.get(unit.groupId) ?? 0)+1); return map; }, [state.units]);
  const base = state.units.filter(unit => targetMode === 'all' || (targetMode === 'scenes' ? selectedGroups.has(unit.groupId) : selectedUnits.has(unit.id)));
  const effectiveFilter = operation === 'recheck' ? 'stale' : filter;
  const targets = base.filter(unit => effectiveFilter === 'stale' ? state.translations[unit.id]?.freshness === 'stale' : effectiveFilter === 'untranslated' ? !state.translations[unit.id]?.text : true);
  const stages = operation === 'pipeline' ? STAGES.filter(stage => stage !== 'recheck') : [operation as Stage];
  const scenes = new Set(targets.map(unit => unit.groupId));
  const mode = new Set(stages.map(stage => state.connections.find(connection => connection.id === state.profiles[stage].connectionId)?.kind === 'mock' ? '모의' : '실제 AI'));
  const query = search.trim().toLowerCase();
  const visibleGroups = groups.filter(group => `${group.title} ${group.id} ${group.description}`.toLowerCase().includes(sceneSearch.trim().toLowerCase()));
  const previewUnits = targetMode === 'units' ? state.units : base;
  const visibleUnits = previewUnits.filter(unit => (!sceneFilter || unit.groupId === sceneFilter) && `${unit.id} ${unit.speaker ?? ''} ${unit.source} ${groupNames.get(unit.groupId) ?? ''}`.toLowerCase().includes(query));
  const pageCount = Math.max(1, Math.ceil(visibleUnits.length/50)), safePage = Math.min(page,pageCount-1);
  const pageUnits = visibleUnits.slice(safePage*50,(safePage+1)*50);
  const toggleGroup = (id: string) => setSelectedGroups(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleUnit = (id: string) => setSelectedUnits(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const changeMode = (next: TargetMode) => { if (next === targetMode) return; if (next === 'scenes') setSelectedGroups(new Set(base.map(unit => unit.groupId))); if (next === 'units') setSelectedUnits(new Set(base.map(unit => unit.id))); setTargetMode(next); setSearch(''); setSceneFilter(''); setPage(0); };
  const plan = (): RunScope => ({ targetMode, groupIds: [...selectedGroups], unitIds: base.map(unit => unit.id), pipeline: operation === 'pipeline', stage: operation === 'pipeline' ? undefined : operation as Stage, filter: effectiveFilter });
  const start = async () => {
    if (!targets.length) return;
    const body = { kind: operation === 'pipeline' ? 'pipeline' : operation === 'recheck' ? 'recheck' : 'translate', ...(operation === 'pipeline' ? {} : { stage: operation }), unitIds: targets.map(unit => unit.id) };
    if (await mutate('/runs', body, 'POST', `${targets.length}개 원문 작업을 시작했습니다. 진행 버튼에서 위치와 결과를 확인하세요.`)) onClose();
  };
  return <main className="run-planner-page">
    <div className="run-planner-heading"><div><h1>작업 준비</h1><p>실행할 원문과 작업을 고른 뒤 오른쪽에서 실행합니다.</p></div></div>
    <div className="run-planner-columns">
      <section className="run-planner-targets" aria-label="대상 범위">
        <h2>대상 범위</h2><div className="run-target-modes" role="radiogroup" aria-label="실행 범위 선택">{([['all','작품 전체'],['scenes','장면 선택'],['units','원문 선택']] as const).map(([value,label]) => <Button key={value} role="radio" aria-checked={targetMode === value} onClick={() => changeMode(value)} variant="ghost">{label}</Button>)}</div>
        <p className="run-target-explanation">{targetMode === 'all' ? `작품의 모든 장면 · ${state.units.length}개 원문` : targetMode === 'scenes' ? '아래에서 실행할 장면을 체크하세요.' : '가운데 목록에서 실행할 원문을 체크하세요.'}</p>
        <label className="run-search-box"><Search size={14}/><Input aria-label="실행 장면 검색" placeholder="장면 검색" value={sceneSearch} onChange={event => setSceneSearch(event.target.value)}/></label>
        {targetMode === 'scenes' ? <div className="run-target-tools"><Button onClick={() => setSelectedGroups(previous => new Set([...previous,...visibleGroups.map(group => group.id)]))} variant="ghost" size="sm">검색된 장면 선택</Button><Button onClick={() => setSelectedGroups(new Set())} variant="ghost" size="sm">모두 해제</Button></div> : null}
        <div className="run-scene-list">{visibleGroups.map(group => targetMode === 'scenes' ? <label className="run-scene-row" key={group.id}><Checkbox checked={selectedGroups.has(group.id)} onCheckedChange={() => toggleGroup(group.id)}/><span><strong>{group.title}</strong><small>{counts.get(group.id) ?? 0}개 원문</small></span></label> : <Button className={`run-scene-row ${sceneFilter === group.id ? 'active' : ''}`} key={group.id} onClick={() => { setSceneFilter(sceneFilter === group.id ? '' : group.id); setPage(0); }} variant="ghost"><span><strong>{group.title}</strong><small>{counts.get(group.id) ?? 0}개 원문 · 목록 보기</small></span></Button>)}{!visibleGroups.length ? <p className="subtext">검색된 장면이 없습니다.</p> : null}</div>
      </section>
      <section className="run-planner-sources" aria-label="원문 선택과 미리보기">
        <div className="run-pane-heading"><h2>{targetMode === 'units' ? '원문 선택' : '대상 원문'}</h2><span>{base.length}개 범위 · {targets.length}개 실행</span></div>
        <div className="run-target-search"><label className="run-search-box"><Search size={14}/><Input aria-label="실행 원문 검색" placeholder="원문 ID, 화자, 내용 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }}/></label><NativeSelect aria-label="원문 목록 장면 필터" value={sceneFilter} onChange={event => { setSceneFilter(event.target.value); setPage(0); }}><NativeSelectOption value="">모든 장면</NativeSelectOption>{groups.map(group => <NativeSelectOption key={group.id} value={group.id}>{group.title}</NativeSelectOption>)}</NativeSelect></div>
        <div className="run-target-tools"><span>{targetMode === 'units' ? `${selectedUnits.size}개 원문 선택` : '현재 범위의 원문 미리보기'}</span>{targetMode === 'units' ? <><Button disabled={!pageUnits.length} onClick={() => setSelectedUnits(previous => new Set([...previous,...pageUnits.map(unit => unit.id)]))} variant="ghost" size="sm">이 페이지 모두 선택</Button><Button onClick={() => setSelectedUnits(new Set())} variant="ghost" size="sm">선택 모두 해제</Button></> : <Button onClick={() => changeMode('units')} variant="ghost" size="sm">원문별로 선택하기</Button>}</div>
        <div className="run-source-list">{pageUnits.map(unit => <label className={`run-target-row ${targetMode !== 'units' ? 'preview' : ''}`} key={unit.id}>{targetMode === 'units' ? <Checkbox checked={selectedUnits.has(unit.id)} onCheckedChange={() => toggleUnit(unit.id)}/> : null}<span><strong>{unit.speaker || '화자 미지정'} <small>{unit.id}</small></strong><span className="run-target-source">{unit.source}</span><small>{groupNames.get(unit.groupId)} · {state.translations[unit.id]?.freshness === 'stale' ? '재검토 필요' : state.translations[unit.id]?.text ? '번역 있음' : '미번역'}</small></span></label>)}{!pageUnits.length ? <p className="subtext">표시할 원문이 없습니다. 장면 범위 또는 검색 조건을 바꾸세요.</p> : null}</div>
        <div className="run-target-paging"><Button disabled={safePage === 0} onClick={() => setPage(safePage-1)} variant="ghost" size="sm">이전</Button><span>{safePage+1} / {pageCount}페이지 · 표시 결과 {visibleUnits.length}개</span><Button disabled={safePage+1 >= pageCount} onClick={() => setPage(safePage+1)} variant="ghost" size="sm">다음</Button></div>
      </section>
      <section className="run-planner-setup" aria-label="작업과 실행">
        <div className="run-planner-settings">
        <h2>수행할 작업</h2><label className="field">작업<NativeSelect value={operation} onChange={event => setOperation(event.target.value)}><NativeSelectOption value="pipeline">전체 과정</NativeSelectOption>{STAGES.map(stage => <NativeSelectOption key={stage} value={stage}>{STAGE_LABELS[stage]}</NativeSelectOption>)}</NativeSelect></label>
        <label className="field">번역 상태 필터<NativeSelect value={effectiveFilter} disabled={operation === 'recheck'} onChange={event => setFilter(event.target.value as TargetFilter)}><NativeSelectOption value="all">이 범위의 모든 원문</NativeSelectOption><NativeSelectOption value="untranslated">이 범위에서 미번역만</NativeSelectOption><NativeSelectOption value="stale">이 범위에서 재검토 필요만</NativeSelectOption></NativeSelect></label>
        <div className="run-profile-summary">{stages.map(stage => { const profile=state.profiles[stage],connection=state.connections.find(item => item.id === profile.connectionId); return <div key={stage}><strong>{STAGE_LABELS[stage]}</strong><span>{connection?.name} · {profile.model || '모델 미지정'}{profile.effort ? ` · ${profile.effort}` : ''}<br/>프롬프트 v{profile.promptVersion ?? 1}{profile.fallbacks?.length ? <><br/>대체: {profile.fallbacks.map(route => route.model).join(' → ')}</> : null}</span></div>; })}</div>
        <Button onClick={() => onSettings(plan())} variant="ghost">AI 설정 확인</Button>
        <div className="run-planner-summary" role="status"><strong>{scenes.size}개 장면 · {targets.length}개 원문 실행</strong><span>{[...mode].join(' + ')} · 보호된 번역 {targets.filter(unit => state.translations[unit.id]?.locked).length}개</span><p>보호된 번역은 유지하고 수정안은 검토함에 저장합니다.</p></div>
        {!targets.length ? <p className="notice">실행할 원문이 없습니다. 범위 또는 상태 필터를 바꾸세요.</p> : null}
        {hasDrafts ? <p className="notice">저장하지 않은 편집이 있습니다. 저장된 번역·자료·설정으로 실행합니다.</p> : null}
        </div>
        <Button className=" run-planner-start" disabled={busy || !targets.length} onClick={() => void start()} variant="default"><Play size={14}/>{targets.length}개 원문 실행</Button>
      </section>
    </div>
  </main>;
}


