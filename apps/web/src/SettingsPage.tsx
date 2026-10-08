import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Input } from './components/ui/input';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, RefreshCw, Save, Settings2, Undo2 } from 'lucide-react';
import { STAGES, STAGE_LABELS, type Connection, type ExecutionProfile, type ModelRoute, type Stage, type TaskSnapshot, type WorkspaceState } from '@workbench/contracts';
import { AccountConnections } from './AccountConnections';
import { api } from './api';
import type { Mutate } from './App';
import { ExecutionLab } from './ExecutionLab';
import {AIProfiles} from './AIProfiles';
import {ToolConnectionsPage} from './ToolConnectionsPage';
import { equalProfile, equalSettings, mergeSettingsDrafts, type RunScopeRequest, type SettingsSnapshot, type TestScopeRequest } from './workflow-state';
import './workflow-ux.css';
export type { TestScopeRequest, RunScopeRequest } from './workflow-state';

interface AvailableModel { id: string; name: string; efforts: string[]; effortSupport?: 'known' | 'unsupported' | 'unknown' }
interface ModelCatalog { models: AvailableModel[]; detail?: string; source?: string; checkedAt?: string; cliVersion?: string; modelListStatus?: string; complete?: boolean }
const settingsOf = (state: WorkspaceState): SettingsSnapshot => ({ revision: state.revision, connections: state.connections, profiles: state.profiles });

export function SettingsPage({ state, busy, testRequest, onDirtyChange, onRunScope, onSettingsSaved, profileRequest }: {
  state: WorkspaceState; mutate: Mutate; busy: boolean; testRequest?: TestScopeRequest;
  onDirtyChange?: (dirty: boolean) => void; onRunScope?: (scope: RunScopeRequest) => void;
  onSettingsSaved?: (next: WorkspaceState) => void;
  profileRequest?:number;
}) {
  const tabKey=`workbench.settings.tab:${new URLSearchParams(location.search).get('workspace')??'main'}:${state.project.id}`;
  const [tab, setTab] = useState<'accounts' | 'tasks' | 'profiles' | 'tools'>(()=>{try{const saved=sessionStorage.getItem(tabKey);return saved==='tasks'||saved==='profiles'||saved==='tools'?saved:'accounts';}catch{return 'accounts';}});
  useEffect(()=>{try{sessionStorage.setItem(tabKey,tab);}catch{/* Tab remains usable without browser storage. */}},[tabKey,tab]);
  const [profileDirty,setProfileDirty]=useState(false);
  const [toolDirty,setToolDirty]=useState(false);
  const [stage, setStage] = useState<Stage>('translate');
  const [drafts, setDrafts] = useState(() => structuredClone(settingsOf(state)));
  const [savedSettings, setSavedSettings] = useState(() => settingsOf(state));
  const savedRef = useRef(savedSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, ModelCatalog>>({});
  const [modelLoading, setModelLoading] = useState<Record<string, boolean>>({});
  const [manualModels, setManualModels] = useState<Partial<Record<Stage, boolean>>>({});
  const [modelRefresh, setModelRefresh] = useState(0);
  const modelCache = useRef<Record<string, string>>({});
  const modelMounted = useRef(true);
  const { connections, profiles } = drafts;
  const changedStages = STAGES.filter(item => !equalProfile(profiles[item], savedSettings.profiles[item]));
  const connectionDirty = !equalSettings(connections, savedSettings.connections);
  const dirty = changedStages.length > 0 || connectionDirty;
  const selectedConnectionKey = JSON.stringify(savedSettings.connections.filter(connection => [profiles[stage].connectionId, ...(profiles[stage].fallbacks ?? []).map(route => route.connectionId)].includes(connection.id)));
  const savedConnection = savedSettings.connections.find(item => item.id === profiles[stage].connectionId);
  const draftConnection = connections.find(item => item.id === profiles[stage].connectionId);
  const selectedConnectionDirty = !equalSettings(savedConnection, draftConnection);
  const busyNow = busy || saving;

  const acceptSavedState = useCallback((nextState: WorkspaceState, accepted: Parameters<typeof mergeSettingsDrafts>[3] = {}) => {
    const next = settingsOf(nextState), before = savedRef.current;
    if (next.revision < before.revision) return;
    setDrafts(current => ({ ...mergeSettingsDrafts(current, before, next, accepted), revision: next.revision }));
    savedRef.current = next; setSavedSettings(next);
  }, []);
  useEffect(() => { acceptSavedState(state); }, [state, acceptSavedState]);
  useEffect(() => { onDirtyChange?.(dirty||profileDirty||toolDirty); }, [dirty, profileDirty, toolDirty, onDirtyChange]);
  useEffect(()=>{if(profileRequest)setTab('profiles');},[profileRequest]);
  useEffect(() => { if (testRequest) { setTab('tasks'); setStage(testRequest.stage ?? 'translate'); } }, [testRequest?.token]);
  useEffect(() => { modelMounted.current = true; return () => { modelMounted.current = false; }; }, []);
  useEffect(() => {
    if (tab !== 'tasks') return;
    const descriptors = JSON.parse(selectedConnectionKey) as Connection[];
    for (const connection of descriptors) {
      if (connection.kind === 'mock') continue;
      const fingerprint = JSON.stringify(connection);
      if (modelCache.current[connection.id] === fingerprint) continue;
      modelCache.current[connection.id] = fingerprint;
      setModelLoading(previous => ({ ...previous, [connection.id]: true }));
      void api<ModelCatalog>(`/connections/${encodeURIComponent(connection.id)}/models`).then(result => {
        if (modelMounted.current && modelCache.current[connection.id] === fingerprint) setModelCatalogs(previous => ({ ...previous, [connection.id]: result }));
      }).catch(() => {
        if (modelMounted.current && modelCache.current[connection.id] === fingerprint) setModelCatalogs(previous => ({ ...previous, [connection.id]: { models: [], modelListStatus: 'unavailable', detail: '모델 목록을 확인하지 못했습니다. AI 연결에서 인증과 주소를 확인한 뒤 다시 조회하세요.' } }));
      }).finally(() => {
        if (modelMounted.current && modelCache.current[connection.id] === fingerprint) setModelLoading(previous => ({ ...previous, [connection.id]: false }));
      });
    }
  }, [tab, selectedConnectionKey, modelRefresh]);

  const patchConnection = (id: string, patch: Partial<Connection>) => {
    setDrafts(previous => ({ ...previous, connections: previous.connections.map(connection => connection.id === id ? { ...connection, ...patch } : connection) })); setMessage(''); setError('');
  };
  const patchProfile = (target: Stage, patch: Partial<ExecutionProfile>) => {
    setDrafts(previous => ({ ...previous, profiles: { ...previous.profiles, [target]: { ...previous.profiles[target], ...patch } } })); setMessage(''); setError('');
  };
  const saveConnections = async () => {
    const captured = structuredClone(connections);
    setSaving(true); setError('');
    try {
      const next = await api<WorkspaceState>('/settings', { connections: captured, profiles: savedRef.current.profiles }, 'PUT');
      acceptSavedState(next, { connections: captured }); onSettingsSaved?.(next); modelCache.current = {}; setModelRefresh(value => value + 1); setMessage('연결 설정을 저장했습니다. 작업 초안은 유지됩니다.'); return true;
    } catch (caught) { setError((caught as Error).message); return false; }
    finally { setSaving(false); }
  };
  const saveStage = async (target: Stage, input = profiles[target]) => {
    const captured = structuredClone({ ...input, effort: input.effort === 'default' ? '' : input.effort });
    setSaving(true); setError('');
    try {
      const next = await api<WorkspaceState>(`/profiles/${target}`, { profile: captured }, 'PATCH');
      acceptSavedState(next, { profiles: { [target]: captured } }); onSettingsSaved?.(next); setMessage(`${STAGE_LABELS[target]} 설정을 저장했습니다. 다음 실행부터 적용됩니다.`); return true;
    } catch (caught) { setError((caught as Error).message); return false; }
    finally { setSaving(false); }
  };
  const saveTrial = async (snapshot: TaskSnapshot) => {
    const current = savedRef.current.connections.find(item => item.id === snapshot.connection.id);
    if (!equalSettings(current, snapshot.connection)) { setError('시험 이후 연결 설정이 변경되었습니다. 현재 연결로 다시 시험한 뒤 구성을 저장하세요.'); return false; }
    setStage(snapshot.stage); patchProfile(snapshot.stage, snapshot.capturedProfile);
    return saveStage(snapshot.stage, snapshot.capturedProfile);
  };
  const syncConnectionState = (next: WorkspaceState) => { acceptSavedState(next); onSettingsSaved?.(next); modelCache.current = {}; setModelRefresh(value => value + 1); setMessage('AI 연결 정보를 갱신했습니다. 작업 초안은 유지됩니다.'); };
  const refreshModels = (connectionId = profiles[stage].connectionId) => { delete modelCache.current[connectionId]; setModelRefresh(value => value + 1); };
  const taskState = { ...state, connections: savedSettings.connections, profiles: savedSettings.profiles };

  return <main className="content-page account-settings">
    <div className="settings-heading"><div><h1>AI 설정</h1></div>{dirty ? <Badge variant="warning">미저장 변경 있음</Badge> : message ? <Badge variant="success"><Check size={11} />저장됨</Badge> : null}</div>
    {message ? <p className="workflow-note" role="status">{message}</p> : null}{error ? <p className="notice" role="alert">{error}</p> : null}
    <nav className="settings-subnav" aria-label="AI 설정 메뉴"><Button className={tab === 'accounts' ? 'active' : ''} aria-current={tab === 'accounts' ? 'page' : undefined} onClick={() => setTab('accounts')} variant="ghost">AI 연결{connectionDirty ? ' · 미저장' : ''}</Button><Button className={tab==='profiles'?'active':''} aria-current={tab==='profiles'?'page':undefined} onClick={()=>setTab('profiles')} variant="ghost">프로필{profileDirty?' · 미저장':''}</Button><Button className={tab === 'tasks' ? 'active' : ''} aria-current={tab === 'tasks' ? 'page' : undefined} onClick={() => setTab('tasks')} variant="ghost">단계별 작업{changedStages.length ? ` · 미저장 ${changedStages.length}` : ''}</Button><Button className={tab==='tools'?'active':''} aria-current={tab==='tools'?'page':undefined} onClick={()=>setTab('tools')} variant="ghost">도구 연결{toolDirty?' · 미저장':''}</Button></nav>
    <div hidden={tab!=='tools'}><ToolConnectionsPage state={state} onDirtyChange={setToolDirty}/></div>
    <div hidden={tab!=='profiles'}><AIProfiles state={state} onDirtyChange={setProfileDirty}/></div>
    <div hidden={tab !== 'accounts'}>
      <AccountConnections connections={savedSettings.connections} busy={busyNow} onStateChanged={syncConnectionState} />
      <details className="advanced-box"><summary><Settings2 size={14} />고급 연결 설정{connectionDirty ? ' · 미저장' : ''}</summary><div className="advanced-box-body">
        <div className="connection-grid">{connections.filter(connection => connection.kind !== 'mock').map(connection => <AdvancedConnection key={connection.id} connection={connection} onChange={patchConnection} />)}</div>
        <div className="actions workflow-save-actions"><Button disabled={busyNow || !connectionDirty} onClick={() => void saveConnections()} variant="default"><Save size={12} />연결 변경 저장</Button><Button disabled={busyNow || !connectionDirty} onClick={() => setDrafts(previous => ({ ...previous, connections: structuredClone(savedRef.current.connections) }))} variant="ghost"><Undo2 size={12} />연결 변경 되돌리기</Button></div>
      </div></details>
    </div>
    <div hidden={tab !== 'tasks'}>
      <nav className="task-stage-navigation" aria-label="작업 선택">{STAGES.map(item => <Button key={item} className={stage === item ? 'active' : ''} aria-pressed={stage === item} onClick={() => setStage(item)} variant="ghost">{STAGE_LABELS[item]}{changedStages.includes(item) ? <span className="draft-dot" title="미저장 변경">●</span> : null}</Button>)}</nav>
      <ExecutionLab state={taskState} profiles={profiles} stage={stage} testRequest={testRequest} onProfile={patchProfile} onSave={() => saveStage(stage)} onSaveTrial={saveTrial} onRunScope={onRunScope}
        connectionDirty={selectedConnectionDirty} onSaveConnection={saveConnections} onOpenConnections={() => setTab('accounts')} dirty={changedStages.includes(stage)} busy={busyNow}
        profileControls={<><TaskProfileFields stage={stage} profile={profiles[stage]} connections={savedSettings.connections} catalog={modelCatalogs[profiles[stage].connectionId]} loading={!!modelLoading[profiles[stage].connectionId]} manual={!!manualModels[stage]} busy={busyNow} onRefresh={() => refreshModels()} onManual={manual => setManualModels(previous => ({ ...previous, [stage]: manual }))} onChange={patch => patchProfile(stage, patch)} />
          <FallbackProfiles stage={stage} profile={profiles[stage]} connections={savedSettings.connections} catalogs={modelCatalogs} loading={modelLoading} busy={busyNow} onRefresh={refreshModels} onChange={fallbacks => patchProfile(stage, { fallbacks })} />
          {changedStages.includes(stage) ? <Button disabled={busyNow} onClick={() => setDrafts(previous => ({ ...previous, profiles: { ...previous.profiles, [stage]: structuredClone(savedRef.current.profiles[stage]) } }))} variant="ghost" size="sm"><Undo2 size={12} />이 작업 변경 되돌리기</Button> : null}</>} />
    </div>
  </main>;
}

function TaskProfileFields({ stage, title = '사용할 AI', labelPrefix = STAGE_LABELS[stage], profile, connections, catalog, loading, manual: manuallySelected, busy, onRefresh, onManual, onChange }: {
  stage: Stage; title?: string; labelPrefix?: string; profile: ExecutionProfile; connections: Connection[]; catalog?: ModelCatalog; loading: boolean; manual: boolean; busy: boolean;
  onRefresh: () => void; onManual: (manual: boolean) => void; onChange: (patch: Partial<ExecutionProfile>) => void;
}) {
  const connection = connections.find(item => item.id === profile.connectionId);
  const models = catalog?.models ?? [];
  const selectedModel = models.find(model => model.id === profile.model);
  const effortSupport = selectedModel?.effortSupport ?? (connection?.kind === 'mock' || connection?.kind === 'systemone' ? 'unsupported' : 'unknown');
  const supportedEfforts = (effortSupport === 'known' ? selectedModel?.efforts ?? [] : []).filter(value => value !== 'default');
  const effortValue = profile.effort === 'default' ? '' : profile.effort;
  const efforts = [...new Set(['', ...supportedEfforts, effortValue])];
  const manual = manuallySelected || (!!profile.model && !selectedModel);
  const checkedAt = catalog?.checkedAt && Number.isFinite(Date.parse(catalog.checkedAt)) ? new Date(catalog.checkedAt).toLocaleString('ko-KR') : undefined;
  return <div className="task-profile-controls">
    <div className="task-profile-heading"><h3>{title}</h3>{connection?.kind !== 'mock' ? <Button disabled={busy || loading || !connection} onClick={onRefresh} variant="ghost" size="sm">{loading ? <LoaderCircle size={12} className="spinning" /> : <RefreshCw size={12} />}모델 목록 새로고침</Button> : null}</div>
    <div className="task-profile-grid">
      <label className="field task-connection-field">연결<NativeSelect aria-label={`${labelPrefix} 연결`} value={profile.connectionId} onChange={event => {
        const next = connections.find(item => item.id === event.target.value);
        onChange({ connectionId: event.target.value, model: next?.kind === 'mock' ? 'fixture-v1' : '', effort: '' }); onManual(false);
      }}>{connections.filter(item => item.kind !== 'systemone' || stage === 'review').map(item => <NativeSelectOption key={item.id} value={item.id}>{item.kind === 'mock' ? '샘플 응답 (테스트)' : item.kind === 'systemone' ? `${item.name} (판정 전용)` : item.name}</NativeSelectOption>)}</NativeSelect></label>
      <div className="field task-model-field"><span>모델</span>{models.length ? <NativeSelect aria-label={`${labelPrefix} 모델 선택`} value={manual ? '__custom__' : profile.model} onChange={event => {
        if (event.target.value === '__custom__') { onManual(true); return; }
        const nextModel = models.find(model => model.id === event.target.value); onManual(false);
        onChange({ model: event.target.value, effort: effortValue && nextModel?.efforts.includes(effortValue) ? effortValue : '' });
      }}><NativeSelectOption value="">모델 선택</NativeSelectOption>{models.map(model => <NativeSelectOption key={model.id} value={model.id}>{model.name || model.id}</NativeSelectOption>)}<NativeSelectOption value="__custom__">직접 입력…</NativeSelectOption></NativeSelect> : null}
        {!models.length || manual ? <Input aria-label={`${labelPrefix} 모델 ID`} value={profile.model} placeholder="모델 ID 입력" onChange={event => onChange({ model: event.target.value })} /> : null}
        {loading ? <small className="subtext" role="status">모델 목록 확인 중…</small> : null}
      </div>
      <label className="field task-effort-field">추론 수준<NativeSelect aria-label={`${labelPrefix} effort`} value={effortValue} onChange={event => onChange({ effort: event.target.value })}>{efforts.map(effort => <NativeSelectOption key={effort} value={effort} disabled={!!effort && !supportedEfforts.includes(effort)}>{effort === '' ? '기본값' : !supportedEfforts.includes(effort) ? `${effort} (확인 필요)` : effort}</NativeSelectOption>)}</NativeSelect>{effortSupport !== 'known' ? <small className="effort-info">{effortSupport === 'unsupported' ? '미지원' : '지원값 미확인'}</small> : null}</label>
    </div>
    {catalog?.modelListStatus === 'unavailable' ? <p className="workflow-note warning" role="status">모델 목록 확인 실패: {catalog.detail}</p> : catalog?.modelListStatus === 'unsupported' ? <p className="workflow-note">모델 목록 조회 미지원</p> : null}
    {catalog ? <details className="model-catalog-details"><summary>모델 조회 정보{checkedAt ? ` · ${checkedAt}` : ''}</summary><p>{catalog.detail || '이 연결의 모델별 기능 정보를 조회했습니다.'}</p><p>출처: {catalog.source === 'cli' ? 'CLI 모델 목록' : catalog.source === 'api' ? 'API 모델 목록' : '직접 입력'}{catalog.cliVersion ? ` · CLI ${catalog.cliVersion}` : ''}</p></details> : null}
    <details className="task-limits"><summary><ChevronDown size={13} />실행 한도<span>{profile.timeoutMs / 1000}초 · 최대 {profile.maxAttempts}회</span></summary>
      <div className="task-limits-grid">
        <label className="field">시간 제한 (초)<Input type="number" min="5" max="1800" aria-label={`${labelPrefix} 시간 제한`} value={profile.timeoutMs / 1000} onChange={event => onChange({ timeoutMs: Number(event.target.value) * 1000 })} /></label>
        <label className="field">출력 한도 (API)<Input type="number" min="256" max="100000" disabled={connection?.kind === 'systemone'} aria-label={`${labelPrefix} 최대 출력 토큰`} value={profile.maxOutputTokens} onChange={event => onChange({ maxOutputTokens: Number(event.target.value) })} /></label>
        <label className="field">최대 시도<Input type="number" min="1" max="3" aria-label={`${labelPrefix} 최대 시도`} value={profile.maxAttempts} onChange={event => onChange({ maxAttempts: Number(event.target.value) })} /></label>
      </div>
    </details>
  </div>;
}

function FallbackProfiles({ stage, profile, connections, catalogs, loading, busy, onRefresh, onChange }: {
  stage: Stage; profile: ExecutionProfile; connections: Connection[]; catalogs: Record<string, ModelCatalog>;
  loading: Record<string, boolean>; busy: boolean; onRefresh: (id: string) => void; onChange: (routes: ModelRoute[]) => void;
}) {
  const [manual, setManual] = useState<Record<number, boolean>>({});
  const routes = profile.fallbacks ?? [];
  const eligible = connections.filter(item => item.kind !== 'mock' && (item.kind !== 'systemone' || stage === 'review'));
  const primary = connections.find(item => item.id === profile.connectionId);
  const patch = (index: number, update: Partial<ModelRoute>) => onChange(routes.map((route, at) => at === index ? { ...route, ...update } : route));
  const move = (index: number, direction: number) => { const next = [...routes]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setManual({}); onChange(next); };
  return <section className="fallback-settings" aria-label={`${STAGE_LABELS[stage]} 대체 AI`}>
    <div className="fallback-heading"><h3>Fallback</h3><span>{routes.length}/3</span></div>
    {routes.map((route, index) => <div className="fallback-route" key={index}>
      <div className="fallback-route-actions"><strong>대체 {index + 1}</strong><div className="actions">
        <Button type="button" aria-label={`대체 ${index + 1} 위로`} disabled={busy || index === 0} onClick={() => move(index, -1)} variant="ghost" size="sm">위로</Button>
        <Button type="button" aria-label={`대체 ${index + 1} 아래로`} disabled={busy || index === routes.length - 1} onClick={() => move(index, 1)} variant="ghost" size="sm">아래로</Button>
        <Button type="button" aria-label={`대체 ${index + 1} 제거`} disabled={busy} onClick={() => { setManual({}); onChange(routes.filter((_, at) => at !== index)); }} variant="ghost" size="sm">제거</Button>
      </div></div>
      <TaskProfileFields stage={stage} title={`대체 AI ${index + 1}`} labelPrefix={`${STAGE_LABELS[stage]} 대체 ${index + 1}`} profile={route} connections={eligible} catalog={catalogs[route.connectionId]} loading={!!loading[route.connectionId]} manual={!!manual[index]} busy={busy} onRefresh={() => onRefresh(route.connectionId)} onManual={value => setManual(previous => ({ ...previous, [index]: value }))} onChange={update => patch(index, update)} />
    </div>)}
    <Button type="button" disabled={busy || routes.length >= 3 || !eligible.length || primary?.kind === 'mock'} onClick={() => {
      const connectionId = eligible.some(item => item.id === profile.connectionId) ? profile.connectionId : eligible[0].id;
      onChange([...routes, { connectionId, model: '', effort: '', timeoutMs: profile.timeoutMs, maxOutputTokens: profile.maxOutputTokens, maxAttempts: 1 }]);
    }} variant="outline" size="sm">대체 AI 추가</Button>
    {primary?.kind === 'mock' ? <small className="subtext">샘플 응답에서는 미지원</small> : null}
  </section>;
}

function AdvancedConnection({ connection, onChange }: { connection: Connection; onChange: (id: string, patch: Partial<Connection>) => void }) {
  if (connection.kind === 'systemone') return <section className="connection-card"><div className="connection-card-head"><strong>{connection.name}</strong><Badge variant="outline">판정 전용 검수</Badge></div><div className="form-grid"><div className="field full"><span className="endpoint-url">{connection.baseUrl}</span><small>이름·주소·API 키는 엔드포인트 편집에서 변경합니다. 자유문장 생성과 추론 수준 설정은 지원하지 않습니다.</small></div><label className="field full">환경 변수에서 키 읽기 (선택)<Input value={connection.envKey ?? ''} onChange={event => onChange(connection.id, {envKey: event.target.value})} /><small>직접 API 키를 연결한 경우 입력할 필요가 없습니다.</small></label></div></section>;
  return <section className="connection-card"><div className="connection-card-head"><strong>{connection.name}</strong></div><div className="form-grid">
    {connection.kind !== 'openai' ? <label className="field full">연결 이름<Input value={connection.name} onChange={event => onChange(connection.id, { name: event.target.value })} /></label> : null}
    {connection.kind === 'openai' ? <>
      <div className="field full"><span className="endpoint-url">{connection.baseUrl}</span><small>이름·주소·API 키는 위 엔드포인트의 편집 버튼에서 변경합니다.</small></div>
      <label className="field">API 규격<NativeSelect value={connection.apiMode ?? 'chat'} onChange={event => onChange(connection.id, { apiMode: event.target.value as 'chat' | 'responses' })}><NativeSelectOption value="chat">Chat Completions</NativeSelectOption><NativeSelectOption value="responses">Responses</NativeSelectOption></NativeSelect></label>
      <label className="field">응답 형식<NativeSelect value={connection.structuredOutput ?? 'json-schema'} onChange={event => onChange(connection.id, { structuredOutput: event.target.value as 'json-schema' | 'json-object' | 'text' })}><NativeSelectOption value="json-schema">JSON Schema</NativeSelectOption><NativeSelectOption value="json-object">JSON Object</NativeSelectOption><NativeSelectOption value="text">Text</NativeSelectOption></NativeSelect></label>
      {(connection.apiMode ?? 'chat') === 'chat' ? <label className="field">출력 한도 필드<NativeSelect value={connection.tokenLimitField ?? 'max_completion_tokens'} onChange={event => onChange(connection.id, { tokenLimitField: event.target.value as 'max_completion_tokens' | 'max_tokens' })}><NativeSelectOption value="max_completion_tokens">max_completion_tokens</NativeSelectOption><NativeSelectOption value="max_tokens">max_tokens</NativeSelectOption></NativeSelect></label> : null}
      <label className="field full">환경 변수에서 키 읽기 (선택)<Input value={connection.envKey ?? ''} onChange={event => onChange(connection.id, { envKey: event.target.value })} /><small>직접 API 키를 연결한 경우 입력할 필요가 없습니다.</small></label>
    </> : <label className="field full">CLI 실행 파일<Input placeholder={connection.kind === 'antigravity' ? 'agy' : connection.kind} value={connection.executable ?? ''} onChange={event => onChange(connection.id, { executable: event.target.value })} /></label>}
  </div></section>;
}

