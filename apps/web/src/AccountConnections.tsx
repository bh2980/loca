import { Badge } from './components/ui/badge';
import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Input } from './components/ui/input';
import { Dialog as DialogRoot, DialogContent, DialogTitle } from './components/ui/dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Copy, ExternalLink, LoaderCircle, LogIn, Pencil, Plus, RefreshCw, Terminal, Trash2, X } from 'lucide-react';
import { isLocalApiHost, type Connection, type WorkspaceState } from '@workbench/contracts';
import { api } from './api';

type LoginMethod = 'browser' | 'device-code' | 'terminal';
interface AuthStatus {
  connectionId: string;
  state: 'unknown' | 'signed-out' | 'signed-in' | 'pending' | 'failed' | 'unavailable' | 'configured';
  accountLabel?: string;
  detail: string;
  checkedAt: string;
  methods: LoginMethod[];
}
interface LoginAttempt {
  id: string;
  connectionId: string;
  state: 'starting' | 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'finished';
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
  message: string;
}
interface Probe { available: boolean; version?: string; detail: string }
const authLabels: Record<AuthStatus['state'], string> = {
  unknown: '상태 미확인', 'signed-out': '로그인 필요', 'signed-in': '로그인됨', pending: '로그인 중',
  failed: '확인 필요', unavailable: '사용할 수 없음', configured: '키 저장됨',
};
const providerNames: Record<Connection['kind'], string> = { codex: 'Codex', grok: 'Grok', antigravity: 'Antigravity', claude: 'Claude Code', openai: 'OpenAI 호환 API', systemone: 'TypeSafe Jev · 판정 전용', mock: '샘플 응답' };
const isPending = (attempt: LoginAttempt | null) => !!attempt && ['starting', 'waiting'].includes(attempt.state);

function ProviderLogo({ kind }: { kind: Connection['kind'] }) {
  return <span className={`provider-logo ${kind}`} aria-hidden="true">{({ codex: 'C', grok: '𝕏', antigravity: 'A', claude: '✳', openai: '<>', systemone: 'J', mock: 'S' })[kind]}</span>;
}

export function AccountConnections({ connections, busy, onStateChanged }: {
  connections: Connection[];
  busy: boolean;
  onStateChanged: (state: WorkspaceState) => void;
}) {
  const [auth, setAuth] = useState<Record<string, AuthStatus>>({});
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<Connection | null>(null);
  const [apiModal, setApiModal] = useState<Connection | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [attempt, setAttempt] = useState<LoginAttempt | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [addingProvider, setAddingProvider] = useState<Connection['kind']>();
  const [addError, setAddError] = useState('');
  const alive = useRef(true);
  const completedAttempt = useRef('');
  const loginGeneration = useRef(0);
  const connectionKey = JSON.stringify(connections.filter(connection => connection.kind !== 'mock').map(connection => ({ id: connection.id, kind: connection.kind, executable: connection.executable, baseUrl: connection.baseUrl, envKey: connection.envKey })));

  const refreshAuth = useCallback(async (id: string) => {
    const next = await api<AuthStatus>(`/connections/${encodeURIComponent(id)}/auth`);
    if (alive.current) setAuth(previous => ({ ...previous, [id]: next }));
    return next;
  }, []);
  const refreshConnection = useCallback(async (id: string, kind: string) => {
    if (alive.current) setChecking(previous => ({ ...previous, [id]: true }));
    const results = await Promise.allSettled([
      refreshAuth(id),
      kind === 'openai' || kind === 'systemone' ? Promise.resolve<Probe | null>(null) : api<Probe>(`/connections/${encodeURIComponent(id)}/probe`, {}),
    ]);
    if (!alive.current) return;
    if (results[0].status === 'rejected') setAuth(previous => ({ ...previous, [id]: {
      connectionId: id, state: 'unknown', detail: '연결 상태를 확인하지 못했습니다. 다시 확인해 주세요.', checkedAt: '', methods: [],
    } }));
    const probeResult = results[1];
    if (probeResult.status === 'fulfilled' && probeResult.value) {
      const found = probeResult.value;
      setProbes(previous => ({ ...previous, [id]: found }));
    }
    setChecking(previous => ({ ...previous, [id]: false }));
  }, [refreshAuth]);

  useEffect(() => {
    alive.current = true;
    for (const connection of JSON.parse(connectionKey) as { id: string; kind: string }[]) {
      void refreshConnection(connection.id, connection.kind);
    }
    return () => { alive.current = false; };
  }, [connectionKey, refreshConnection, refreshVersion]);

  useEffect(() => {
    if (!modal || !attempt || !isPending(attempt)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<LoginAttempt | null>(`/connections/${encodeURIComponent(modal.id)}/login`);
        if (!stopped && next) setAttempt(next);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : '로그인 진행 상태를 확인하지 못했습니다.');
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [modal?.id, attempt?.id, attempt?.state]);

  useEffect(() => {
    if (!attempt || !modal || isPending(attempt) || completedAttempt.current === attempt.id) return;
    completedAttempt.current = attempt.id;
    void refreshAuth(modal.id).catch(() => undefined);
  }, [attempt, modal, refreshAuth]);

  const startLogin = async (connection: Connection, method?: LoginMethod) => {
    const generation = ++loginGeneration.current;
    const replacePending = method && modal?.id === connection.id && isPending(attempt);
    setModal(connection); setError(''); setStarting(true); setAttempt(null);
    try {
      if (generation !== loginGeneration.current) return;
      if (replacePending) await api(`/connections/${encodeURIComponent(connection.id)}/login/cancel`, {});
      let status = auth[connection.id];
      if (!status || !status.methods.length) status = await refreshAuth(connection.id);
      if (generation !== loginGeneration.current) return;
      if (status.state === 'pending' && !method) {
        const existing = await api<LoginAttempt | null>(`/connections/${encodeURIComponent(connection.id)}/login`);
        if (generation !== loginGeneration.current) return;
        if (existing && isPending(existing)) { setAttempt(existing); return; }
      }
      const selected = method ?? (status.methods.includes('browser') ? 'browser' : status.methods.includes('device-code') ? 'device-code' : status.methods.includes('terminal') ? 'terminal' : undefined);
      if (!selected) { setError(status.detail || '이 연결의 로그인 방법을 확인하지 못했습니다.'); return; }
      const next = await api<LoginAttempt>(`/connections/${encodeURIComponent(connection.id)}/login`, { method: selected });
      if (generation !== loginGeneration.current) {
        await api(`/connections/${encodeURIComponent(connection.id)}/login/cancel`, {});
        return;
      }
      setAttempt(next);
    } catch (caught) { if (generation === loginGeneration.current) setError(caught instanceof Error ? caught.message : '로그인을 시작하지 못했습니다.'); }
    finally { if (generation === loginGeneration.current) setStarting(false); }
  };

  const cancelLogin = async (close = false) => {
    if (!modal) return;
    loginGeneration.current++;
    setStarting(false);
    if (isPending(attempt) || starting) {
      try {
        const next = await api<LoginAttempt>(`/connections/${encodeURIComponent(modal.id)}/login/cancel`, {});
        setAttempt(next);
        void refreshAuth(modal.id).catch(() => undefined);
      } catch (caught) { setError(caught instanceof Error ? caught.message : '로그인 취소에 실패했습니다.'); return; }
    }
    if (close) { setModal(null); setAttempt(null); setError(''); }
  };

  const connected = (status?: AuthStatus) => status?.state === 'signed-in' || status?.state === 'configured';
  const providerOrder: Connection['kind'][] = ['codex', 'claude', 'grok', 'antigravity'];
  const endpoints = connections.filter(connection => connection.kind === 'openai' || connection.kind === 'systemone');
  const addProvider = async (kind: Connection['kind']) => {
    setAddingProvider(kind); setAddError('');
    try {
      const result = await api<{connection:Connection;state: WorkspaceState}>('/connections', { kind, name: providerNames[kind] });
      onStateChanged(result.state); setRefreshVersion(value => value + 1);
      const status = await refreshAuth(result.connection.id);
      if (status.state !== 'signed-in' && status.state !== 'unavailable') await startLogin(result.connection);
    } catch (caught) { setAddError(caught instanceof Error ? caught.message : `${providerNames[kind]} 연결을 추가하지 못했습니다.`); }
    finally { setAddingProvider(undefined); }
  };
  const removeEndpoint = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError('');
    try {
      const result = await api<{ state: WorkspaceState }>(`/connections/${encodeURIComponent(deleteTarget.id)}`, {}, 'DELETE');
      onStateChanged(result.state); setDeleteTarget(null);
    } catch (caught) { setDeleteError(caught instanceof Error ? caught.message : '엔드포인트를 삭제하지 못했습니다.'); }
    finally { setDeleting(false); }
  };
  return <>
    <div className="account-section-heading"><h2>계정 로그인</h2></div>
    {addError ? <p className="login-progress error" role="alert">{addError}</p> : null}
    <div className="accounts-list">
      {providerOrder.flatMap(kind => {
        const registered = connections.filter(connection => connection.kind === kind);
        if (!registered.length) return [<article className="account-row" key={`available-${kind}`}>
          <ProviderLogo kind={kind} /><div className="account-row-main"><div className="account-row-title"><h3>{providerNames[kind]}</h3><Badge variant="outline">연결 전</Badge></div><p>{kind === 'codex' ? 'ChatGPT' : kind === 'antigravity' ? 'Google' : kind === 'claude' ? 'Claude' : 'Grok'} 계정으로 로그인</p><span className="account-install"><Terminal size={10} />CLI 설치 아직 확인 전</span></div>
          <div className="account-row-actions"><Button disabled={busy || !!addingProvider || starting} onClick={() => void addProvider(kind)} variant="default">{addingProvider === kind ? <LoaderCircle size={13} className="spinning" /> : <LogIn size={13} />}연결</Button></div>
        </article>];
        return registered.map(connection => {
        const status = auth[connection.id];
        const checkingThis = checking[connection.id];
        const probe = probes[connection.id];
        return <article className="account-row" key={connection.id}>
          <ProviderLogo kind={connection.kind} />
          <div className="account-row-main">
            <div className="account-row-title"><h3>{connection.kind === 'openai' ? connection.name : providerNames[connection.kind]}</h3>
              <Badge variant={connected(status) ? 'success' : status?.state === 'pending' ? 'warning' : 'outline'} title={status?.detail}>
                {checkingThis ? <><LoaderCircle size={10} className="spinning" />확인 중</> : status ? connection.kind === 'openai' && status.state === 'signed-out' ? '키 연결 필요' : authLabels[status.state] : '연결 전'}
              </Badge>
            </div>
            <p>{status?.accountLabel || (connection.kind === 'codex' ? 'ChatGPT 계정으로 로그인' : connection.kind === 'claude' ? 'Claude 계정으로 로그인' : connection.kind === 'grok' ? 'Grok 계정으로 로그인' : connection.kind === 'antigravity' ? 'Google 계정으로 로그인' : 'API 키로 연결')}</p>
            {connection.kind !== 'openai' ? <span className={`account-install ${probe && !probe.available ? 'missing' : ''}`} title={probe?.detail}>
              {probe?.available ? <Check size={10} /> : <Terminal size={10} />}
              {probe ? probe.available ? 'CLI 설치 확인됨' : 'CLI 설치 확인 필요' : 'CLI 설치 확인 중'}
            </span> : null}
          </div>
          <div className="account-row-actions">
            <Button aria-label={`${providerNames[connection.kind]} 연결 상태 새로고침`} title="상태 다시 확인" disabled={busy || checkingThis} onClick={() => void refreshConnection(connection.id, connection.kind)} variant="ghost" size="icon-sm"><RefreshCw size={13} /></Button>
            <Button className={` ${connected(status) ? '' : ''}`} disabled={busy || starting || checkingThis || status?.state === 'unavailable'} onClick={() => void startLogin(connection)} variant="default">
              <LogIn size={13} />{status?.state === 'pending' ? '계속하기' : connected(status) ? '다시 로그인' : '로그인'}
            </Button>
          </div>
        </article>;
        });
      })}
    </div>
    <section className="api-endpoints-section" aria-label="API 엔드포인트">
      <div className="account-section-heading"><h2>API 엔드포인트 <span className="endpoint-count">{endpoints.length}</span></h2><Button disabled={busy} onClick={() => setApiModal('new')} variant="default" size="sm"><Plus size={13} />API 엔드포인트 추가</Button></div>
      {endpoints.length ? <div className="accounts-list">{endpoints.map(connection => {
        const status = auth[connection.id];
        return <article className="account-row endpoint-row" key={connection.id}>
          <ProviderLogo kind={connection.kind} /><div className="account-row-main"><div className="account-row-title"><h3>{connection.name}</h3>{connection.kind === 'systemone' ? <Badge variant="outline">판정 전용 검수</Badge> : null}<Badge variant={connected(status) ? 'success' : 'outline'} title={status?.detail}>{checking[connection.id] ? '확인 중' : connection.allowUnauthenticated && status?.state === 'configured' ? '키 없는 로컬 연결' : status?.state === 'signed-out' ? '키 연결 필요' : status ? authLabels[status.state] : '상태 미확인'}</Badge></div><p className="endpoint-url">{connection.baseUrl || '주소 미설정'}</p></div>
          <div className="account-row-actions"><Button aria-label={`${connection.name} 편집`} disabled={busy} onClick={() => setApiModal(connection)} variant="ghost" size="sm"><Pencil size={12} />편집</Button><Button aria-label={`${connection.name} 엔드포인트 삭제`} title="엔드포인트 삭제" disabled={busy} onClick={() => { setDeleteTarget(connection); setDeleteError(''); }} variant="ghost" size="icon-sm"><Trash2 size={13} /></Button></div>
        </article>;
      })}</div> : <div className="empty-state" style={{ padding: '28px 20px' }}><p>등록된 API 엔드포인트가 없습니다.</p></div>}
    </section>
    {apiModal ? <ApiEndpointDialog connection={apiModal === 'new' ? undefined : apiModal} configured={apiModal !== 'new' && !apiModal.allowUnauthenticated && auth[apiModal.id]?.state === 'configured'} onDone={next => { onStateChanged(next); setRefreshVersion(value => value + 1); setApiModal(null); }} onClose={() => setApiModal(null)} /> : null}
    {deleteTarget ? <Dialog title="API 엔드포인트 삭제" onClose={() => { if (!deleting) setDeleteTarget(null); }}><div className="dialog-body"><h3 style={{ marginTop: 0, fontSize: 15 }}>{deleteTarget.name}</h3><p className="endpoint-url">{deleteTarget.baseUrl}</p><p className="subtext">이 엔드포인트 연결을 삭제합니다. 작업에 배정되어 있거나 실행 중인 작업이 사용한다면 먼저 해당 작업을 변경해야 합니다.</p>{deleteError ? <p className="login-progress error" role="alert">{deleteError}</p> : null}</div><div className="dialog-footer"><Button disabled={deleting} onClick={() => setDeleteTarget(null)} variant="ghost">취소</Button><Button disabled={deleting} onClick={() => void removeEndpoint()} variant="destructive">{deleting ? <LoaderCircle size={13} className="spinning" /> : <Trash2 size={13} />}삭제</Button></div></Dialog> : null}
    {modal ? <LoginDialog
      connection={modal} attempt={attempt} status={auth[modal.id]} starting={starting} error={error}
      onCancel={() => void cancelLogin()} onClose={() => void cancelLogin(true)}
      onRetry={method => void startLogin(modal, method)}
    /> : null}
  </>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <DialogRoot open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="connection-dialog" showCloseButton={false}>
      <div className="dialog-top"><DialogTitle>{title}</DialogTitle><Button aria-label="연결 창 닫기" onClick={onClose} variant="ghost" size="icon-sm"><X size={15} /></Button></div>{children}
    </DialogContent>
  </DialogRoot>;
}

function LoginDialog({ connection, attempt, status, starting, error, onCancel, onClose, onRetry }: {
  connection: Connection; attempt: LoginAttempt | null; status?: AuthStatus; starting: boolean; error: string;
  onCancel: () => void; onClose: () => void; onRetry: (method?: LoginMethod) => void;
}) {
  const [copied, setCopied] = useState(false);
  const pending = isPending(attempt) || starting;
  const success = attempt?.state === 'succeeded';
  const failed = !!error || attempt?.state === 'failed';
  const rawUrl = attempt?.verificationUrl || attempt?.authUrl;
  let url: string | undefined;
  try { const parsed = new URL(rawUrl || ''); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch { /* No authorization URL yet. */ }
  return <Dialog title={`${providerNames[connection.kind]} 로그인`} onClose={onClose}>
    <div className="dialog-body"><div className="dialog-provider"><ProviderLogo kind={connection.kind} /><h3>{success ? '로그인되었습니다.' : `${providerNames[connection.kind]} 계정 연결`}</h3><p>{success ? status?.accountLabel || '이 계정을 작업별 모델에 배정할 수 있습니다.' : '공식 로그인 창에서 인증을 완료하세요.'}</p></div>
      <div className={`login-progress ${failed ? 'error' : ''}`} role={failed ? 'alert' : 'status'}>
        {pending ? <LoaderCircle size={15} className="spinning" /> : success ? <CheckCircle2 size={15} /> : <Terminal size={15} />}
        <span>{error || (starting ? '로그인 창을 준비하고 있습니다…' : attempt?.message || '로그인 연결을 준비합니다.')}</span>
      </div>
      {attempt?.userCode ? <div className="device-code"><span>로그인 페이지에 아래 코드를 입력하세요.</span><code>{attempt.userCode}</code><div style={{ marginTop: 10 }}><Button onClick={() => void navigator.clipboard.writeText(attempt.userCode!).then(() => setCopied(true))} variant="ghost" size="sm">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? '복사됨' : '코드 복사'}</Button></div></div> : null}
      <div className="login-actions">
        {url && pending ? <Button asChild><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />공식 로그인 페이지 열기</a></Button> : null}
        {failed || attempt?.state === 'cancelled' ? <Button onClick={() => onRetry()} variant="default"><RefreshCw size={13} />다시 시도</Button> : null}
        {status?.methods.includes('device-code') && !attempt?.userCode && !starting && !success ? <Button onClick={() => onRetry('device-code')} variant="ghost">인증 코드로 로그인</Button> : null}
      </div>
    </div>
    <div className="dialog-footer">{pending ? <Button onClick={onCancel} variant="ghost">로그인 취소</Button> : <Button onClick={onClose} variant="default">{success ? '완료' : '닫기'}</Button>}</div>
  </Dialog>;
}

function isLocalEndpoint(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && isLocalApiHost(url.hostname); }
  catch { return false; }
}

function normalizeEndpoint(value: string) {
  try { return new URL(value).href.replace(/\/+$/, ''); }
  catch { return value.trim(); }
}

function ApiEndpointDialog({ connection, configured, onDone, onClose }: {
  connection?: Connection; configured: boolean;
  onDone: (state: WorkspaceState) => void; onClose: () => void;
}) {
  const [kind, setKind] = useState<'openai' | 'systemone'>(connection?.kind === 'systemone' ? 'systemone' : 'openai');
  const [name, setName] = useState(connection?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [key, setKey] = useState('');
  const [apiMode, setApiMode] = useState<'chat' | 'responses'>(connection?.apiMode ?? 'chat');
  const [allowUnauthenticated, setAllowUnauthenticated] = useState(connection?.allowUnauthenticated ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const local = isLocalEndpoint(baseUrl);
  const endpointChanged = !!connection && normalizeEndpoint(baseUrl) !== normalizeEndpoint(connection.baseUrl || '');
  const keyRequired = (!connection || endpointChanged) && !(kind === 'openai' && local && allowUnauthenticated);
  const submit = async () => {
    setPending(true); setError('');
    try {
      const payload = { kind, name: name.trim(), baseUrl: baseUrl.trim(), ...(kind === 'openai' ? {apiMode} : {}), allowUnauthenticated: kind === 'openai' && local && allowUnauthenticated, ...(key.trim() ? { apiKey: key.trim() } : {}) };
      const result = await api<{ connection: Connection; state: WorkspaceState }>(connection ? `/connections/${encodeURIComponent(connection.id)}` : '/connections', payload, connection ? 'PATCH' : 'POST');
      setKey(''); onDone(result.state);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'API 엔드포인트를 저장하지 못했습니다.'); }
    finally { setPending(false); }
  };
  const removeKey = async () => {
    if (!connection) return;
    setPending(true); setError('');
    try {
      await api(`/connections/${encodeURIComponent(connection.id)}/credential`, {}, 'DELETE');
      onDone(await api<WorkspaceState>('/state'));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'API 키를 삭제하지 못했습니다.'); }
    finally { setPending(false); }
  };
  return <Dialog title={connection ? 'API 엔드포인트 편집' : 'API 엔드포인트 추가'} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}><div className="dialog-body"><div className="form-grid">
      <label className="field full">연결 종류<NativeSelect value={kind} disabled={!!connection || pending} onChange={event => {
        const next = event.target.value as 'openai' | 'systemone'; setKind(next); setKey(''); setAllowUnauthenticated(false);
        setName(next === 'systemone' ? 'TypeSafe Jev' : ''); setBaseUrl(next === 'systemone' ? 'https://api.typesafe.ai/v1' : '');
      }}><NativeSelectOption value="openai">OpenAI 호환 · 번역 및 생성</NativeSelectOption><NativeSelectOption value="systemone">TypeSafe Jev / System One · 판정 전용 검수</NativeSelectOption></NativeSelect></label>
      {kind === 'systemone' ? <div className="field full"><small>기존 번역의 의미·용어·맥락·말투를 판정합니다. 번역문은 새로 작성하지 않으며 문맥 검수 단계에만 배정할 수 있습니다. <a href="https://api.typesafe.ai/redoc" target="_blank" rel="noopener noreferrer">TypeSafe 공식 API 문서</a></small></div> : null}
      <label className="field full">이름<Input value={name} onChange={event => setName(event.target.value)} required autoFocus placeholder="예: 번역용 서버, 로컬 모델" /></label>
      <label className="field full">API 주소<Input type="url" value={baseUrl} onChange={event => { setBaseUrl(event.target.value); if (!isLocalEndpoint(event.target.value)) setAllowUnauthenticated(false); }} required placeholder="https://api.example.com/v1" /></label>
      <label className="field full">API 키{!keyRequired ? ' (선택)' : ''}<Input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="new-password" required={keyRequired} placeholder={connection && !endpointChanged ? '비워두면 기존 키 유지' : 'API 키'} />{endpointChanged && !allowUnauthenticated ? <small>주소 변경 시 새 API 키 필요</small> : null}</label>
    </div>{error ? <p className="login-progress error" role="alert">{error}</p> : null}
      <details className="advanced-box"><summary>고급 옵션</summary><div className="advanced-box-body">{kind === 'openai' ? <><label className="field">API 규격<NativeSelect value={apiMode} onChange={event => setApiMode(event.target.value as 'chat' | 'responses')}><NativeSelectOption value="chat">Chat Completions</NativeSelectOption><NativeSelectOption value="responses">Responses</NativeSelectOption></NativeSelect></label>
        <label className="checkbox-field"><Checkbox checked={allowUnauthenticated && local} disabled={!local} onCheckedChange={event => setAllowUnauthenticated((event === true))} />API 키 없이 로컬·사설망 서버 연결</label></> : <p className="subtext">System One의 state/model/questions 규격을 사용합니다. 호환 서버도 HTTPS 주소와 해당 서버의 키로 등록할 수 있습니다.</p>}
        {configured && connection ? <Button type="button" disabled={pending} onClick={() => void removeKey()} variant="ghost" size="sm"><Trash2 size={12} />저장된 키만 삭제</Button> : null}
      </div></details>
    </div><div className="dialog-footer"><Button type="button" disabled={pending} onClick={onClose} variant="ghost">취소</Button><Button type="submit" disabled={pending || (keyRequired && !key.trim()) || !name.trim() || !baseUrl.trim()} variant="default">{pending ? <LoaderCircle size={13} className="spinning" /> : connection ? <Check size={13} /> : <Plus size={13} />}{connection ? '변경 저장' : '엔드포인트 추가'}</Button></div></form>
  </Dialog>;
}
