import { tmpdir } from 'node:os';
import { invokeApi, apiUrl } from './api.js';
import { invokeCli, resolveCli } from './cli.js';
import {invokeSystemOne,systemOneUrl} from './systemone.js';
import { runProcess } from './process.js';
import { validateModelProfile } from './models.js';
import { ProviderError, type ConnectionInspection, type ProviderConnection, type ProviderRequest, type ProviderResult } from './types.js';
export * from './types.js';
export * from './chat-types.js';
export { invokeChat, chatCapability } from './chat.js';
export { inspectAuth, startLogin } from './auth.js';
export { listModels, validateModelProfile, validateCatalogProfile } from './models.js';
export { resolveCli } from './cli.js';
export {getSystemOneModels,systemOneUrl} from './systemone.js';

// These are adapter option vocabularies, not a claim that every model supports every option.
export const ADAPTER_EFFORTS: Record<string, string[]> = {
  openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  codex: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  grok: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  antigravity: ['low', 'medium', 'high'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  systemone: [],
};

export function validateRequest(request: ProviderRequest): void {
  const { connection, profile } = request;
  if (!['openai', 'codex', 'grok', 'antigravity', 'claude','systemone'].includes(connection.kind)) throw new ProviderError('unsupported-provider', '실제 모델 연결 종류를 선택하세요. 모의 실행은 작업 엔진이 처리합니다.');
  if (profile.connectionId !== connection.id) throw new ProviderError('profile-connection-mismatch', '실행 프로필의 연결과 선택한 연결이 일치하지 않습니다.');
  if (!profile.model?.trim() || /[\r\n\0]/.test(profile.model)) throw new ProviderError('missing-model', '해당 연결에서 사용할 실제 모델 ID를 입력하세요.');
  if (profile.effort && !ADAPTER_EFFORTS[connection.kind]?.includes(profile.effort)) {
    throw new ProviderError('unsupported-effort', `${connection.kind} 연결은 지정한 effort '${profile.effort}'를 지원하지 않습니다.`);
  }
  if (!Number.isFinite(profile.timeoutMs) || profile.timeoutMs <= 0 || profile.timeoutMs > 3_600_000) throw new ProviderError('invalid-timeout', '호출 제한 시간은 1ms~1시간 범위여야 합니다.');
  if (!Number.isInteger(profile.maxOutputTokens) || profile.maxOutputTokens < 1) throw new ProviderError('invalid-output-limit', '출력 토큰 한도는 양의 정수여야 합니다.');
  if (connection.structuredOutput && !['json-schema', 'json-object', 'text'].includes(connection.structuredOutput)) throw new ProviderError('invalid-output-mode', '지원하지 않는 API 응답 형식입니다.');
  if (connection.tokenLimitField && !['max_completion_tokens', 'max_tokens'].includes(connection.tokenLimitField)) throw new ProviderError('invalid-token-field', '지원하지 않는 API 토큰 한도 필드입니다.');
}

export async function invokeProvider(request: ProviderRequest): Promise<ProviderResult> {
  validateRequest(request);
  if (request.signal?.aborted) throw new ProviderError('cancelled', '작업이 취소되었습니다.');
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, request.profile.timeoutMs);
  try {
    const checkedRequest = { ...request, signal: controller.signal };
    const validation = await validateModelProfile(request.connection, request.profile, request.credential, controller.signal);
    const result = await (request.connection.kind === 'systemone' ? invokeSystemOne(checkedRequest) : request.connection.kind === 'openai' ? invokeApi(checkedRequest) : invokeCli(checkedRequest));
    return { ...result, diagnostics: [validation.detail, result.diagnostics].filter(Boolean).join(' ') };
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError(request.signal?.aborted ? 'cancelled' : 'timeout', request.signal?.aborted ? '작업이 취소되었습니다.' : '모델 조회와 실행의 전체 제한 시간을 초과했습니다.');
    throw error;
  } finally { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); }
}

/** Local capability inspection only: never starts an inference or reads CLI account files. */
export async function inspectConnection(connection: ProviderConnection): Promise<ConnectionInspection> {
  if (connection.kind === 'mock') return { available: true, detail: '모의 실행 연결입니다. 실제 모델 호출은 없습니다.', efforts: [] };
  // A help/version probe cannot establish any model's supported reasoning levels.
  const efforts: string[] = [];
  if (connection.kind === 'openai'||connection.kind==='systemone') {
    try {
      if(connection.kind==='systemone')systemOneUrl(connection,'systemone');else apiUrl(connection);
      if (connection.envKey && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(connection.envKey) || !process.env[connection.envKey])) {
        return { available: false, detail: 'API 키 환경변수가 없거나 이름이 잘못되었습니다. 워커 환경을 확인하세요.', efforts };
      }
      return { available: true, detail: 'URL·환경변수 설정을 확인했습니다. 서버 접속·인증·모델·effort 지원은 실제 호출 전에는 확인되지 않습니다.', efforts };
    } catch (error) {
      return { available: false, detail: error instanceof ProviderError ? error.message : 'API 설정을 확인하지 못했습니다.', efforts };
    }
  }
  try {
    const command = await resolveCli(connection);
    const helpArgs = connection.kind === 'codex' ? ['exec', '--help'] : ['--help'];
    const [version, help] = await Promise.all([
      runProcess({ executable: command.executable, args: [...command.prefixArgs, '--version'], cwd: tmpdir(), timeoutMs: 10_000 }),
      runProcess({ executable: command.executable, args: [...command.prefixArgs, ...helpArgs], cwd: tmpdir(), timeoutMs: 10_000 }),
    ]);
    const flags = connection.kind === 'codex' ? ['--output-schema', '--output-last-message', '--ignore-user-config', '--ephemeral']
      : connection.kind === 'grok' ? ['--prompt-file', '--json-schema', '--reasoning-effort', '--tools']
      : connection.kind === 'claude' ? ['--json-schema', '--print', '--tools', '--no-session-persistence']
      : ['--json-schema', '--print', '--effort', '--sandbox'];
    if (flags.some((flag) => !(help.stdout + help.stderr).includes(flag))) return { available: false, detail: '설치된 CLI에서 필요한 비대화식 실행 옵션을 찾지 못했습니다. 지원 버전을 확인하세요.', efforts };
    return { available: true, version: version.stdout.trim().slice(0, 160),
      detail: 'CLI 실행 파일·필수 옵션을 확인했습니다. 로그인·모델 접근 권한은 실제 호출 전에는 확인되지 않습니다.', efforts };
  } catch (error) {
    return { available: false, detail: error instanceof ProviderError ? error.message : 'CLI 연결을 확인하지 못했습니다.', efforts };
  }
}
