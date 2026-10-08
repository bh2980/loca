import { resolveCli, type ExecutableCommand } from './cli.js';
import { AuthProcess, untilAbort } from './auth-process.js';
import { object } from './output.js';
import { runProcess } from './process.js';
import { tmpdir } from 'node:os';
import { ProviderError, type AuthAttempt, type AuthMethod, type AuthState, type LoginOptions, type ModelCatalog, type ProviderConnection } from './types.js';
export type { ModelCatalog } from './types.js';

const methodsFor = (connection: ProviderConnection): AuthMethod[] => connection.kind === 'codex' || connection.kind === 'grok'
  ? ['browser', 'device-code'] : connection.kind === 'claude' ? ['browser'] : connection.kind === 'antigravity' ? ['terminal'] : [];
const stateFor = (connection: ProviderConnection, state: AuthState['state'], detail: string, accountLabel?: string): AuthState => ({
  connectionId: connection.id, state, detail, accountLabel, checkedAt: new Date().toISOString(), methods: methodsFor(connection),
});

/** Only provider-owned HTTPS authentication destinations can leave the protocol boundary. */
export function safeAuthUrl(raw: unknown, kind: ProviderConnection['kind']): string | undefined {
  if (typeof raw !== 'string' || raw.length > 8192) return undefined;
  try {
    const url = new URL(raw);
    const domains = kind === 'codex' ? ['openai.com', 'chatgpt.com'] : kind === 'grok' ? ['x.ai', 'grok.com'] : kind === 'claude' ? ['claude.ai', 'anthropic.com'] : [];
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return undefined;
    if (!domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))) return undefined;
    if (['access_token', 'refresh_token', 'id_token', 'api_key', 'password'].some((key) => url.searchParams.has(key))) return undefined;
    return url.href;
  } catch { return undefined; }
}

class CodexAuthClient {
  private counter = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: NodeJS.Timeout }>();
  private readonly completed: Record<string, unknown>[] = [];
  private readonly completionListeners = new Set<() => void>();
  constructor(readonly process: AuthProcess) {
    process.onLine((line, stream) => {
      if (stream !== 'stdout') return;
      let payload: Record<string, unknown> | undefined;
      try { payload = object(JSON.parse(line)); } catch { return; }
      if (!payload) return;
      if (typeof payload.id === 'number') {
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        clearTimeout(pending.timer);
        if (payload.error) pending.reject(new ProviderError('auth-rpc-failed', 'Codex 로그인 요청이 실패했습니다. CLI 설정과 계정 상태를 확인하세요.'));
        else pending.resolve(payload.result);
      } else if (payload.method === 'account/login/completed') {
        const params = object(payload.params);
        if (params) {
          this.completed.push(params);
          if (this.completed.length > 20) this.completed.shift();
          for (const listener of this.completionListeners) listener();
        }
      }
    });
    void process.exited.then(() => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new ProviderError('auth-process-closed', 'Codex 로그인 연결이 종료되었습니다.'));
      }
      this.pending.clear();
      for (const listener of this.completionListeners) listener();
    });
  }
  request(method: string, params?: unknown, timeoutMs = 15_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProviderError('auth-timeout', 'Codex 로그인 응답 제한 시간을 초과했습니다.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.process.send({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', { clientInfo: { name: 'translation_workbench', title: 'Translation Workbench', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    this.process.send({ method: 'initialized' });
    return result;
  }
  async waitForLogin(loginId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const find = () => this.completed.find((event) => event.loginId === loginId);
    const prior = find();
    if (prior) return prior;
    let listener: () => void = () => {};
    const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
      listener = () => { const event = find(); if (event) resolve(event); };
      this.completionListeners.add(listener);
      void this.process.exited.then(() => reject(new ProviderError('auth-process-closed', '로그인 완료 전에 Codex 연결이 종료되었습니다.')));
      listener();
    });
    try { return await untilAbort(pending, signal); }
    finally { this.completionListeners.delete(listener); }
  }
}

function codexState(connection: ProviderConnection, raw: unknown): AuthState {
  const account = object(object(raw)?.account);
  if (!account) return stateFor(connection, 'signed-out', 'Codex에 연결된 계정이 없습니다.');
  if (account.type === 'apiKey') return stateFor(connection, 'signed-in', 'Codex CLI에 API 키 인증이 설정되어 있습니다.', 'API 키');
  if (account.type === 'chatgpt') {
    const label = typeof account.email === 'string' && account.email.length < 320 && !/[\r\n\0]/.test(account.email) ? account.email : 'ChatGPT';
    return stateFor(connection, 'signed-in', 'Codex CLI 계정 연결을 확인했습니다.', label);
  }
  return stateFor(connection, 'unknown', 'Codex에 다른 인증 방식이 설정되어 있습니다. 이 화면에서 로그인 상태를 확인할 수 없습니다.');
}

export async function inspectAuth(connection: ProviderConnection, signal?: AbortSignal): Promise<AuthState> {
  if (!methodsFor(connection).length) return stateFor(connection, 'unavailable', '이 연결은 CLI 계정 로그인을 사용하지 않습니다.');
  if (connection.kind === 'grok') {
    try {
      const metadata = await readGrokModels(connection, signal);
      return metadata.signedIn
        ? stateFor(connection, 'signed-in', 'Grok CLI의 모델 조회에서 계정 연결을 확인했습니다.', 'Grok')
        : stateFor(connection, 'unknown', 'Grok CLI가 로그인 확인 정보를 반환하지 않았습니다. 로그인 상태를 다시 확인하세요.');
    } catch {
      return stateFor(connection, 'unknown', 'Grok 계정 상태 조회를 완료하지 못했습니다. 로그인 상태와 연결을 다시 확인하세요.');
    }
  }
  let child: AuthProcess | undefined;
  try {
    const command = await resolveCli(connection);
    if (connection.kind === 'claude') {
      const result = await runProcess({ executable: command.executable, args: [...command.prefixArgs, 'auth', 'status'], cwd: tmpdir(), timeoutMs: 8000, maxOutputBytes: 64 * 1024, acceptedExitCodes: [0, 1], signal });
      let raw: unknown; try { raw = JSON.parse(result.stdout); } catch { return stateFor(connection, 'unknown', 'Claude 로그인 상태의 JSON 형식을 확인하지 못했습니다.'); }
      return claudeAuthState(connection, raw, result.exitCode);
    }
    if (connection.kind !== 'codex') {
      await runProcess({ executable: command.executable, args: [...command.prefixArgs, '--version'], cwd: tmpdir(), timeoutMs: 10_000 });
      return stateFor(connection, 'unknown', 'Antigravity 로그인은 별도 터미널에서 진행합니다. CLI가 로그인 상태 조회 명령을 제공하지 않아 여기서는 계정 연결을 확인할 수 없습니다.');
    }
    child = new AuthProcess(command, ['app-server', '--stdio']);
    const client = new CodexAuthClient(child);
    await client.initialize();
    return codexState(connection, await client.request('account/read', { refreshToken: false }));
  } catch {
    return stateFor(connection, 'unavailable', 'CLI 계정 상태를 확인하지 못했습니다. 실행 파일과 설치 상태를 확인하세요.');
  } finally { await child?.close(); }
}

/** CLI-owned status is reduced to explicit authentication metadata; secrets/config paths never leave here. */
export function claudeAuthState(connection: ProviderConnection, raw: unknown, exitCode: number): AuthState {
  const data = object(raw), method = data?.authMethod;
  if (exitCode === 1 && (method === 'none' || data?.loggedIn === false)) return stateFor(connection, 'signed-out', 'Claude Code에 연결된 계정이 없습니다.');
  if (exitCode === 0 && typeof method === 'string' && ['claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party'].includes(method) && data?.loggedIn !== false) {
    const label = typeof data?.email === 'string' && data.email.length < 320 && !/[\r\n\0]/.test(data.email) ? data.email : method === 'claude.ai' ? 'Claude' : 'Claude CLI 인증';
    return stateFor(connection, 'signed-in', 'Claude Code CLI가 로그인 상태를 확인했습니다.', label);
  }
  return stateFor(connection, 'unknown', 'Claude Code 인증 상태를 확정할 수 없습니다. CLI의 로그인 상태를 다시 확인하세요.');
}

/** Parse only the documented models view; never expose arbitrary CLI diagnostic lines. */
export function parseGrokModelsOutput(stdout: string): { signedIn: boolean; models: ModelCatalog['models']; complete: boolean } {
  const clean = stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
  const lines = clean.split(/\r?\n/);
  const signedIn = lines.some(line => line.trim() === 'You are logged in with grok.com.');
  const models: ModelCatalog['models'] = [];
  const seen = new Set<string>();
  const section = lines.findIndex(line => line.trim() === 'Available models:');
  let complete = section >= 0;
  if (section >= 0) {
    for (const line of lines.slice(section + 1)) {
      if (!line.trim()) continue;
      const match = /^\s+[*-]\s+(grok-[A-Za-z0-9][A-Za-z0-9._-]{0,119})(?:\s+\(default\))?\s*$/.exec(line);
      if (!match) { complete = false; break; }
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({ id, name: id, efforts: [], effortSupport: 'unknown' });
      if (models.length >= 100) { complete = false; break; }
    }
  }
  return { signedIn, models, complete };
}

async function readGrokModels(connection: ProviderConnection, signal?: AbortSignal) {
  const command = await resolveCli(connection);
  const output = await runProcess({
    executable: command.executable, args: [...command.prefixArgs, 'models'], cwd: tmpdir(), signal,
    timeoutMs: Math.max(1, Math.min(connection.timeoutMs ?? 8000, 8000)), maxOutputBytes: 64 * 1024,
  });
  return parseGrokModelsOutput(output.stdout);
}

/** Read a minimal non-secret auth configuration projection; never return raw config. */
export function selectCodexAuthOverrides(raw: unknown): string[] {
  const config = object(raw);
  if (!config) throw new ProviderError('invalid-auth-config', 'Codex 인증 설정을 확인하지 못했습니다.');
  const overrides: string[] = [];
  const add = (key: string, value: unknown) => overrides.push('-c', `${key}=${JSON.stringify(value)}`);
  const store = config.cli_auth_credentials_store;
  if (store !== undefined && store !== null) {
    if (!['file', 'keyring', 'auto', 'ephemeral'].includes(String(store))) throw new ProviderError('invalid-auth-config', 'Codex 인증 저장소 설정을 확인하세요.');
    if (store === 'ephemeral') throw new ProviderError('ephemeral-auth', 'Codex의 ephemeral 인증 저장소는 별도 CLI 번역 프로세스와 로그인 세션을 공유할 수 없습니다. 영구 CLI 인증 저장소를 설정하세요.');
    add('cli_auth_credentials_store', store);
  }
  const base = config.chatgpt_base_url;
  if (base !== undefined && base !== null) {
    if (typeof base !== 'string' || base.length > 2048) throw new ProviderError('invalid-auth-config', 'Codex 인증 서비스 주소를 확인하세요.');
    let url: URL;
    try { url = new URL(base); } catch { throw new ProviderError('invalid-auth-config', 'Codex 인증 서비스 주소를 확인하세요.'); }
    if (url.username || url.password || url.search || url.hash || !(['https:'].includes(url.protocol) || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new ProviderError('invalid-auth-config', 'Codex 인증 서비스 주소에는 비밀정보·쿼리·원격 HTTP를 사용할 수 없습니다.');
    add('chatgpt_base_url', base);
  }
  const method = config.forced_login_method;
  if (method !== undefined && method !== null) {
    if (!['chatgpt', 'api'].includes(String(method))) throw new ProviderError('invalid-auth-config', 'Codex 로그인 방식 제한 설정을 확인하세요.');
    add('forced_login_method', method);
  }
  const workspaces = config.forced_chatgpt_workspace_id;
  if (workspaces !== undefined && workspaces !== null) {
    const ids = Array.isArray(workspaces) ? workspaces : [workspaces];
    if (ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new ProviderError('invalid-auth-config', 'Codex 워크스페이스 제한 설정을 확인하세요.');
    add('forced_chatgpt_workspace_id', workspaces);
  }
  return overrides;
}

export async function readCodexAuthOverrides(command: ExecutableCommand, cwd: string, signal?: AbortSignal, timeoutMs = 15_000): Promise<string[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, Math.min(timeoutMs, 15_000));
  let child: AuthProcess | undefined;
  try {
    if (controller.signal.aborted) throw new ProviderError('auth-cancelled', '작업을 취소했습니다.');
    child = new AuthProcess(command, ['app-server', '--stdio']);
    const client = new CodexAuthClient(child);
    await untilAbort(client.initialize(), controller.signal);
    const result = object(await untilAbort(client.request('config/read', { includeLayers: false, cwd }), controller.signal));
    return selectCodexAuthOverrides(result?.config);
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError(signal?.aborted ? 'cancelled' : 'timeout', signal?.aborted ? '작업을 취소했습니다.' : 'Codex 인증 설정 확인 시간이 초과되었습니다.');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('auth-config-unavailable', 'Codex 인증 설정을 확인하지 못해 번역 호출을 시작하지 않았습니다.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await child?.close();
  }
}

/** Model metadata only. No conversation or inference request is started. */
export async function readCliModels(connection: ProviderConnection, signal?: AbortSignal): Promise<ModelCatalog> {
  const base = { source: 'cli' as const, checkedAt: new Date().toISOString() };
  const version = async () => {
    try {
      const command = await resolveCli(connection);
      const output = await runProcess({ executable: command.executable, args: [...command.prefixArgs, '--version'], cwd: tmpdir(), signal, timeoutMs: Math.min(connection.timeoutMs ?? 2500, 2500), maxOutputBytes: 4096 });
      // Project only a version number, never a CLI diagnostic line.
      return /\b\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*\b/.exec(output.stdout)?.[0];
    } catch { return undefined; }
  };
  const unavailable = (detail: string): ModelCatalog => ({ ...base, models: [], modelListStatus: 'unavailable', complete: false, detail });
  if (connection.kind === 'grok') {
    try {
      const metadata = await readGrokModels(connection, signal);
      return {
        models: metadata.models,
        cliVersion: await version(),
        ...base, modelListStatus: metadata.models.length ? 'available' : 'unavailable', complete: metadata.models.length > 0 && metadata.complete,
        detail: metadata.models.length
          ? 'Grok CLI가 제공한 모델 목록입니다. 모델별 추론 수준은 제공되지 않아 기본값을 사용합니다.'
          : 'Grok CLI에서 모델 목록을 확인하지 못했습니다. 로그인 상태를 확인하거나 모델 ID를 직접 입력하세요.',
      };
    } catch {
      return unavailable('Grok 모델 목록 조회를 완료하지 못했습니다. 로그인 상태와 연결을 다시 확인하세요.');
    }
  }
  if (connection.kind !== 'codex') return { ...base, models: [], modelListStatus: 'unsupported', complete: false, detail: '이 CLI의 모델별 기능 자동 조회를 지원하지 않습니다. 실제 모델 ID를 직접 입력하고 기본 추론 수준을 사용하세요.' };
  let child: AuthProcess | undefined;
  try {
    const command = await resolveCli(connection);
    child = new AuthProcess(command, ['app-server', '--stdio']);
    const client = new CodexAuthClient(child);
    const initialized = object(await untilAbort(client.initialize(), signal));
    const versionMatch = typeof initialized?.userAgent === 'string' ? /(?:codex[^/ ]*[/ ]+)(\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*)/i.exec(initialized.userAgent) : null;
    const cliVersion = versionMatch?.[1] ?? await version();
    const models: ModelCatalog['models'] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = object(await untilAbort(client.request('model/list', { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) }), signal));
      if (!Array.isArray(result?.data)) throw new ProviderError('invalid-model-list', 'Codex 모델 목록 형식이 올바르지 않습니다.');
      for (const raw of result.data) {
        const item = object(raw);
        if (!item || item.hidden === true) continue;
        // `id` may be a picker identity; `model` is the identifier accepted by inference.
        const id = typeof item.model === 'string' ? item.model : typeof item.id === 'string' ? item.id : undefined;
        if (!id || id.length > 300 || /[\r\n\0]/.test(id) || seen.has(id)) continue;
        seen.add(id);
        const efforts = Array.isArray(item.supportedReasoningEfforts) ? item.supportedReasoningEfforts
          .map((entry) => object(entry)?.reasoningEffort).filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
        models.push({ id, name: typeof item.displayName === 'string' ? item.displayName : id, efforts: [...new Set(efforts)], effortSupport: Array.isArray(item.supportedReasoningEfforts) ? efforts.length ? 'known' : 'unsupported' : 'unknown' });
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) return { ...base, models, cliVersion, modelListStatus: 'available', complete: true, detail: '현재 Codex CLI가 제공한 모델과 effort 목록입니다. 모델별 사용 가능 여부는 계정·서비스 상태에 따라 달라질 수 있습니다.' };
    }
    return { ...base, models, cliVersion, modelListStatus: 'available', complete: false, detail: 'Codex 모델 목록 일부를 표시합니다. 조회 페이지 제한에 도달했습니다.' };
  } catch {
    return unavailable('Codex 모델 목록을 가져오지 못했습니다. CLI 설치와 로그인 상태를 확인하세요.');
  } finally { await child?.close(); }
}

/** Extract only UI-safe login URLs/codes; never propagate CLI diagnostic lines. */
export function grokAuthProgress(line: string, method: 'browser' | 'device-code'): Pick<AuthAttempt, 'authUrl' | 'verificationUrl' | 'userCode'> {
  const clean = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
  const urls = clean.match(/https:\/\/[^\s<>"'`\u001b]+/g) ?? [];
  const url = urls.map((candidate) => safeAuthUrl(candidate.replace(/[),.;]+$/, ''), 'grok')).find(Boolean);
  const result: Pick<AuthAttempt, 'authUrl' | 'verificationUrl' | 'userCode'> = {};
  if (url) result[method === 'browser' ? 'authUrl' : 'verificationUrl'] = url;
  if (method === 'device-code') {
    const labelled = /(?:user[ _-]?code|verification[ _-]?code|device[ _-]?code|enter(?:\s+this)?\s+code|code)\s*[=:]?\s*["']?([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/i.exec(clean);
    const alone = /^\s*([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\s*$/.exec(clean);
    const code = labelled?.[1] ?? alone?.[1];
    if (code) result.userCode = code.toUpperCase();
  }
  return result;
}

export async function startLogin(connection: ProviderConnection, options: LoginOptions): Promise<AuthState> {
  let attempt: AuthAttempt = { id: options.attemptId, connectionId: connection.id, state: 'starting', message: '로그인 창을 준비하고 있습니다.' };
  const update = (patch: Partial<AuthAttempt>) => { attempt = { ...attempt, ...patch }; options.onUpdate({ ...attempt }); };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10 * 60_000);
  let child: AuthProcess | undefined;
  let client: CodexAuthClient | undefined;
  let loginId: string | undefined;
  try {
    update({});
    if (!methodsFor(connection).includes(options.method)) throw new ProviderError('unsupported-auth-method', '이 CLI는 선택한 로그인 방식을 지원하지 않습니다.');
    if (controller.signal.aborted) throw new ProviderError('auth-cancelled', '로그인을 취소했습니다.');
    const command = await resolveCli(connection);
    if (connection.kind === 'codex') {
      child = new AuthProcess(command, ['app-server', '--stdio']);
      client = new CodexAuthClient(child);
      await untilAbort(client.initialize(), controller.signal);
      const result = object(await untilAbort(client.request('account/login/start', { type: options.method === 'device-code' ? 'chatgptDeviceCode' : 'chatgpt' }, 60_000), controller.signal));
      if (typeof result?.loginId !== 'string') throw new ProviderError('invalid-auth-response', 'Codex가 올바른 로그인 정보를 반환하지 않았습니다.');
      loginId = result.loginId;
      if (options.method === 'browser') {
        const authUrl = safeAuthUrl(result.authUrl, 'codex');
        if (!authUrl) throw new ProviderError('invalid-auth-url', 'Codex 로그인 주소를 확인하지 못했습니다.');
        update({ state: 'waiting', authUrl, message: '브라우저에서 ChatGPT 로그인을 완료하세요.' });
      } else {
        const verificationUrl = safeAuthUrl(result.verificationUrl, 'codex');
        if (!verificationUrl || typeof result.userCode !== 'string' || !/^[A-Z0-9-]{4,24}$/i.test(result.userCode)) throw new ProviderError('invalid-auth-response', 'Codex의 인증 주소·코드를 확인하지 못했습니다.');
        update({ state: 'waiting', verificationUrl, userCode: result.userCode, message: '인증 페이지에 코드를 입력하고 로그인을 완료하세요.' });
      }
      const completed = await client.waitForLogin(loginId, controller.signal);
      if (completed.success !== true) throw new ProviderError('auth-failed', 'Codex 로그인이 완료되지 않았습니다. 다시 시도하세요.');
      const auth = codexState(connection, await untilAbort(client.request('account/read', { refreshToken: false }), controller.signal));
      if (auth.state !== 'signed-in') throw new ProviderError('auth-unverified', '로그인 완료 후 Codex 계정 연결을 확인하지 못했습니다.');
      update({ state: 'succeeded', authUrl: undefined, verificationUrl: undefined, userCode: undefined, message: 'ChatGPT 계정을 연결했습니다.' });
      return auth;
    }
    if (connection.kind === 'claude') {
      child = new AuthProcess(command, ['auth', 'login']);
      child.onLine((line) => {
        const urls = line.match(/https:\/\/[^\s<>"'`\u001b]+/g) ?? [];
        const authUrl = urls.map(url => safeAuthUrl(url.replace(/[),.;]+$/, ''), 'claude')).find(Boolean);
        if (authUrl) update({ state: 'waiting', authUrl, message: '공식 브라우저에서 Claude 로그인을 완료하세요.' });
      });
      update({ state: 'waiting', message: 'Claude Code가 여는 공식 브라우저에서 로그인을 완료하세요.' });
      const ended = await untilAbort(child.exited, controller.signal);
      if (ended.failedToStart || ended.code !== 0) throw new ProviderError('auth-failed', 'Claude Code 로그인이 완료되지 않았습니다. CLI 설치와 로그인 상태를 확인하세요.');
      const auth = await inspectAuth(connection, controller.signal);
      if (controller.signal.aborted) throw new ProviderError('auth-cancelled', '로그인을 취소했습니다.');
      if (auth.state !== 'signed-in') throw new ProviderError('auth-unverified', '로그인 절차가 끝났지만 Claude Code 계정 연결을 확인하지 못했습니다.');
      update({ state: 'succeeded', authUrl: undefined, message: 'Claude Code 계정 연결을 확인했습니다.' });
      return auth;
    }
    child = new AuthProcess(command, ['login', ...(options.method === 'device-code' ? ['--device-auth'] : [])]);
    child.onLine((line) => {
      const progress = grokAuthProgress(line, options.method);
      if (Object.keys(progress).length) update({ state: 'waiting', ...progress, message: options.method === 'device-code' ? '인증 페이지와 코드로 Grok 로그인을 완료하세요.' : '열린 브라우저에서 Grok 로그인을 완료하세요.' });
    });
    update({ state: 'waiting', message: options.method === 'device-code' ? 'Grok 인증 페이지와 코드를 기다리고 있습니다.' : 'Grok이 여는 브라우저에서 로그인을 완료하세요.' });
    const ended = await untilAbort(child.exited, controller.signal);
    if (ended.failedToStart || ended.code !== 0) throw new ProviderError('auth-failed', 'Grok 로그인이 완료되지 않았습니다. CLI 설치와 로그인 상태를 확인하세요.');
    const auth = await inspectAuth(connection, controller.signal);
    if (controller.signal.aborted) throw new ProviderError('auth-cancelled', '로그인을 취소했습니다.');
    if (auth.state !== 'signed-in') {
      const message = 'Grok 로그인 절차가 끝났지만 계정 연결을 확인하지 못했습니다. 연결 상태를 다시 확인하세요.';
      update({ state: 'failed', authUrl: undefined, verificationUrl: undefined, userCode: undefined, message });
      return stateFor(connection, 'unknown', message);
    }
    update({ state: 'succeeded', authUrl: undefined, verificationUrl: undefined, userCode: undefined, message: 'Grok 계정 연결을 확인했습니다.' });
    return auth;
  } catch (error) {
    if (client && loginId) await client.request('account/login/cancel', { loginId }, 2000).catch(() => undefined);
    const cancelled = controller.signal.aborted && !timedOut;
    const message = cancelled ? '로그인을 취소했습니다. 기존 CLI 계정은 로그아웃하지 않았습니다.'
      : timedOut ? '로그인 대기 시간이 만료되었습니다. 다시 시도하세요.'
      : error instanceof ProviderError ? error.message : '로그인 연결을 시작하지 못했습니다.';
    update({ state: cancelled ? 'cancelled' : 'failed', authUrl: undefined, verificationUrl: undefined, userCode: undefined, message });
    return stateFor(connection, cancelled ? 'unknown' : 'failed', message);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    await child?.close();
  }
}
