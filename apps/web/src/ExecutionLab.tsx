import { Card } from './components/ui/card';
import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Input } from './components/ui/input';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, FlaskConical, LoaderCircle, Save, Search } from 'lucide-react';
import { STAGE_LABELS, type ExecutionProfile, type Stage, type TaskSnapshot, type TaskTest, type WorkspaceState } from '@workbench/contracts';
import { api } from './api';
import { SavedTaskSnapshot, TaskSnapshotView } from './TaskSnapshotView';
import { activeTest, equalProfile, type RunScopeRequest, type TestScopeRequest } from './workflow-state';

const labels: Record<TaskTest['status'], string> = { queued: '대기', running: '응답 대기', completed: '완료', failed: '실패', cancelled: '취소' };

export function ExecutionLab({ state, profiles, stage, profileControls, testRequest, onProfile, onSave, onSaveTrial, onRunScope, connectionDirty, onSaveConnection, onOpenConnections, dirty, busy }: {
  state: WorkspaceState; profiles: Record<Stage, ExecutionProfile>; stage: Stage; profileControls: ReactNode; testRequest?: TestScopeRequest;
  onProfile: (stage: Stage, patch: Partial<ExecutionProfile>) => void; onSave: () => Promise<boolean>; onSaveTrial: (snapshot: TaskSnapshot) => Promise<boolean>;
  onRunScope?: (scope: RunScopeRequest) => void; connectionDirty: boolean; onSaveConnection: () => Promise<boolean>; onOpenConnections: () => void; dirty: boolean; busy: boolean;
}) {
  const [groupId, setGroupId] = useState(state.groups[0]?.id ?? '');
  const [start, setStart] = useState(1), [count, setCount] = useState(3);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [snapshot, setSnapshot] = useState<TaskSnapshot>();
  const [test, setTest] = useState<TaskTest>();
  const [working, setWorking] = useState(false), [savingTest, setSavingTest] = useState(false);
  const [error, setError] = useState(''), [pollError, setPollError] = useState('');
  const actionLock = useRef(false);
  const profile = profiles[stage], connection = state.connections.find(item => item.id === profile.connectionId);
  const units = state.units.filter(unit => unit.groupId === groupId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ids = selectedIds ?? units.slice(start - 1, start - 1 + count).map(unit => unit.id);
  const groupOrder = new Map(state.groups.map(group => [group.id, group.order]));
  const idSet = new Set(ids), targets = state.units.filter(unit => idSet.has(unit.id)).sort((a,b)=>(groupOrder.get(a.groupId)??0)-(groupOrder.get(b.groupId)??0)||a.order-b.order||a.id.localeCompare(b.id));
  const groupIds = [...new Set(targets.map(unit => unit.groupId))];
  const requestGroupId = groupIds.length === 1 ? groupIds[0] : undefined;
  const validScope = ids.length > 0 && ids.length <= 40 && targets.length === ids.length;
  const key = JSON.stringify({ stage, unitIds: ids, profile, connection });
  const requestKey = useRef(key); requestKey.current = key;
  const liveTests = (state.taskTests ?? []).filter(activeTest);
  const running = liveTests.length > 0 || !!test && activeTest(test);
  const runningTest = liveTests.find(item => item.stage === stage) ?? liveTests[0] ?? (test && activeTest(test) ? test : undefined);
  const history = state.taskTests?.filter(item => item.stage === stage).slice(0, 30) ?? [];
  const matchingSaved = !!test && equalProfile(test.capturedProfile, state.profiles[test.stage]);
  const sourceOptions = units.filter(unit => !query.trim() || `${unit.id} ${unit.speaker ?? ''} ${unit.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 50);

  useEffect(() => { setSnapshot(undefined); }, [key]);
  useEffect(() => {
    if (!testRequest) return;
    setSelectedIds([...new Set(testRequest.unitIds)]); setSnapshot(undefined); setError('');
    const first = state.units.find(unit => testRequest.unitIds.includes(unit.id)); if (first) setGroupId(first.groupId);
    let alive = true;
    if (testRequest.testId) void api<TaskTest>(`/tasks/tests/${encodeURIComponent(testRequest.testId)}`).then(value => { if (alive) setTest(value); }).catch(caught => { if (alive) setError(caught.message); });
    return () => { alive = false; };
  }, [testRequest?.token]);
  useEffect(() => {
    if (state.groups.some(group => group.id === groupId)) return;
    setGroupId(state.groups[0]?.id ?? ''); setSelectedIds(null); setStart(1);
  }, [state.project.id, state.groups, groupId]);
  useEffect(() => {
    if (runningTest && !test) setTest(runningTest);
  }, [runningTest?.id, test?.id, test?.status]);
  useEffect(() => {
    if (!test || !activeTest(test)) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api<TaskTest>(`/tasks/tests/${encodeURIComponent(test.id)}`); if (!alive) return; setTest(next); setPollError(''); if (activeTest(next)) timer = setTimeout(poll, 800); }
      catch (caught) { if (alive) { setPollError((caught as Error).message); timer = setTimeout(poll, 2000); } }
    };
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [test?.id, test?.status]);

  const action = async (kind: 'preview' | 'test') => {
    if (actionLock.current || !validScope || connectionDirty || (kind === 'test' && running)) return;
    actionLock.current = true; setWorking(true); setError(''); const capturedKey = key;
    try {
      const input = { stage, groupId: requestGroupId, unitIds: ids, profile };
      if (kind === 'preview') { const result = await api<TaskSnapshot>('/tasks/preview', input); if (requestKey.current === capturedKey) setSnapshot(result); }
      else setTest(await api<TaskTest>('/tasks/test', input));
    } catch (caught) { if (kind === 'test' || requestKey.current === capturedKey) setError((caught as Error).message); }
    finally { actionLock.current = false; setWorking(false); }
  };
  const saveTest = async () => {
    if (!test || test.status !== 'completed') return;
    setSavingTest(true); setError('');
    try { const input = await api<TaskSnapshot>(`/tasks/snapshots/${encodeURIComponent(test.snapshotId)}`); await onSaveTrial(input); }
    catch (caught) { setError((caught as Error).message); }
    finally { setSavingTest(false); }
  };
  const showTest = (id: string) => { void api<TaskTest>(`/tasks/tests/${encodeURIComponent(id)}`).then(setTest).catch(caught => setError(caught.message)); };
  const pickUnit = (id: string, checked: boolean) => setSelectedIds(current => {
    const before = current ?? ids; return checked ? [...new Set([...before, id])] : before.filter(value => value !== id);
  });
  const invalidProfile = !connection || (connection.kind !== 'mock' && !profile.model.trim());
  return <div className="execution-lab">
    {runningTest ? <div className="workflow-active-test" role="status"><LoaderCircle size={14} className="spinning" /><span>{STAGE_LABELS[runningTest.stage]} 시험 진행 중 · {runningTest.unitIds.length}개 원문 · {runningTest.requestedModel}</span><Button onClick={() => showTest(runningTest.id)} variant="ghost" size="sm">진행 시험 보기</Button></div> : null}
    <div className="lab-columns"><Card asChild><section className="settings-card task-editor"><div className="page-heading"><h2>{STAGE_LABELS[stage]} 작업</h2><Button disabled={busy || !dirty} onClick={() => void onSave()} variant="default" size="sm"><Save size={12} />이 작업 저장</Button></div>
      {profileControls}
      <div className="task-instructions-heading"><h3>작업 지시문과 문맥</h3><span className="subtext">저장된 지시문 v{state.profiles[stage].promptVersion ?? 1}</span></div>
      <label className="field">추가 작업 지시문<Textarea rows={9} maxLength={30000} value={profile.prompt ?? ''} onChange={event => onProfile(stage, { prompt: event.target.value })} placeholder="번역 기준·문체 등 추가 지시" /></label>
      <div className="context-options">{([['terms', '용어집'], ['knowledge', '작품 자료'], ['previous', '앞선 대사·번역']] as const).map(([name, label]) => <label key={name}><Checkbox checked={profile.contextPolicy?.[name] !== false} onCheckedChange={event => onProfile(stage, { contextPolicy: { ...profile.contextPolicy, [name]: (event === true) } })} />{label}</label>)}</div>
    </section></Card><Card asChild><section className="settings-card task-trial"><h2>{STAGE_LABELS[stage]} 시험 · 기본 모델</h2>
      <p className="task-trial-profile">저장된 연결: {connection?.name || '연결 미지정'}<br />작업 {dirty ? '초안' : '저장값'}: {profile.model || '모델 미지정'} · 추론 {profile.effort || '기본값'}</p>
      {connectionDirty ? <div className="workflow-warning"><p>이 연결의 고급 설정이 미저장 상태입니다. 연결 변경을 저장한 뒤 입력을 확인하고 시험하세요.</p><Button disabled={busy} onClick={() => void onSaveConnection()} variant="outline" size="sm">연결 변경 저장</Button><Button onClick={onOpenConnections} variant="ghost" size="sm">AI 연결 보기</Button></div> : null}
      <label className="field">대상 장면<NativeSelect value={groupId} onChange={event => { setGroupId(event.target.value); setSelectedIds(null); setStart(1); setQuery(''); }}>{state.groups.map(group => <NativeSelectOption key={group.id} value={group.id}>{group.title}</NativeSelectOption>)}</NativeSelect></label>
      {selectedIds ? <div className="workflow-note"><strong>직접 선택: 원문 {ids.length}개 · 장면 {groupIds.length}개</strong><Button onClick={() => { setSelectedIds(null); setStart(1); }} variant="ghost" size="sm">장면 범위로 선택</Button></div> : <div className="trial-range"><label className="field">시작 원문 순번<Input type="number" min={1} max={Math.max(1, units.length)} value={start} onChange={event => setStart(Math.max(1, Math.min(units.length || 1, Number(event.target.value) || 1)))} /></label><label className="field">가져올 원문 수<Input type="number" min={1} max={40} value={count} onChange={event => setCount(Math.max(1, Math.min(40, Number(event.target.value) || 1)))} /></label></div>}
      <details className="trial-source-picker"><summary>원문 직접 선택 · 최대 40개</summary><label className="field"><span><Search size={12} />현재 장면에서 검색</span><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="대사, 인물 또는 원문 ID" /></label><div className="trial-source-options">{sourceOptions.map(unit => <label key={unit.id}><Checkbox checked={idSet.has(unit.id)} disabled={!idSet.has(unit.id) && ids.length >= 40} onCheckedChange={event => pickUnit(unit.id, (event === true))} /><span><strong>{unit.order} · {unit.speaker || unit.id}</strong>{unit.source}</span></label>)}</div>{units.length > sourceOptions.length ? <p className="subtext">검색 결과는 최대 50개까지 표시합니다.</p> : null}</details>
      {!validScope ? <p className="workflow-warning" role="status">시험 원문을 1~40개 선택하세요. 삭제된 원문이 포함되었다면 범위를 다시 선택하세요.</p> : null}
      <div className="test-units">{targets.map(unit => <p key={unit.id}><strong>{unit.speaker || unit.id}</strong> {unit.source}<small>{unit.branch}</small>{selectedIds ? <Button aria-label={`${unit.id} 시험 대상에서 제외`} onClick={() => pickUnit(unit.id, false)} variant="ghost" size="sm">제외</Button> : null}</p>)}</div>
      {invalidProfile ? <p className="workflow-warning">사용할 연결과 모델을 먼저 선택하세요.</p> : null}
      <div className="actions"><Button disabled={working || busy || !validScope || invalidProfile || connectionDirty} onClick={() => void action('preview')} variant="outline">실제 입력 미리보기</Button><Button disabled={working || busy || running || !validScope || invalidProfile || connectionDirty} onClick={() => void action('test')} variant="default">{working || running ? <LoaderCircle className="spinning" size={13} /> : <FlaskConical size={13} />}{connection?.kind === 'mock' ? '모의 시험 실행' : '모델 시험 실행'}</Button></div>
      {onRunScope ? <div className="workflow-next-step"><Button disabled={busy || dirty || connectionDirty || !validScope || invalidProfile} onClick={() => onRunScope({ unitIds: ids, stage })} variant="outline">이 범위의 실행 계획 열기<ArrowUpRight size={12} /></Button>{dirty ? <small>작업 설정 저장 필요</small> : null}</div> : null}
    </section></Card></div>
    {error ? <p className="notice" role="alert">{error}</p> : null}{pollError ? <p className="notice" role="alert">시험 상태 갱신 실패: {pollError} 연결되면 자동으로 다시 확인합니다.</p> : null}
    {snapshot ? <Card asChild><section className="settings-card"><h2>실제 입력 미리보기</h2><TaskSnapshotView snapshot={snapshot} /></section></Card> : null}
    {test ? <Card asChild><section className="settings-card"><div className="page-heading"><h2>{STAGE_LABELS[test.stage]} 시험 결과 · {labels[test.status]}</h2><div className="actions">{activeTest(test) ? <Button onClick={() => void api<TaskTest>(`/tasks/tests/${test.id}/cancel`, {}).then(setTest).catch(caught => setError(caught.message))} variant="outline" size="sm">시험 취소</Button> : test.status === 'completed' ? <Button disabled={busy || savingTest} onClick={() => void saveTest()} variant="default" size="sm"><Save size={12} />이 시험 구성 저장</Button> : null}</div></div>
      <p className="subtext">{matchingSaved ? '저장 설정과 일치' : '저장 설정과 다름'}</p>
      <div className="test-metrics"><span>요청: {test.requestedModel} / {test.requestedEffort || '기본값'}</span><span>응답 보고: {test.reportedModel ?? '제공되지 않음'} / {test.reportedEffort ?? '제공되지 않음'}</span><span>원문: {test.unitIds.length}개</span><span>시간: {test.durationMs !== undefined ? `${(test.durationMs / 1000).toFixed(2)}초` : '측정 중'}</span><span>토큰: {test.usage?.inputTokens ?? '—'} 입력 / {test.usage?.outputTokens ?? '—'} 출력</span><span>비용: {test.usage?.costUsd !== undefined ? `$${test.usage.costUsd}` : '제공되지 않음'}</span></div>
      {test.error ? <p className="notice" role="alert">{test.error}</p> : null}{test.validation ? <p className={test.validation.ok ? 'subtext' : 'notice'}>{test.validation.ok ? '응답 검사 통과' : '응답 검사 실패'}{test.validation.issues.map((issue, index) => <span className="validation-issue" key={index}>{issue.code}: {issue.message}</span>)}</p> : null}<SavedTaskSnapshot key={test.snapshotId} id={test.snapshotId} />{test.rawResponse !== undefined ? <details open><summary>모델 응답</summary><pre className="json-output">{JSON.stringify(test.rawResponse, null, 2)}</pre></details> : null}
    </section></Card> : null}
    <Card asChild><section className="settings-card"><h2>{STAGE_LABELS[stage]} 이전 시험</h2>{history.length ? <div className="test-history">{history.map(item => <Button key={item.id} onClick={() => showTest(item.id)} variant="ghost"><span>{new Date(item.createdAt).toLocaleString('ko-KR')}</span><span>{item.requestedModel}</span><span>{labels[item.status]}</span></Button>)}</div> : <p className="subtext">이 작업의 저장된 시험 기록이 없습니다.</p>}</section></Card>
  </div>;
}
