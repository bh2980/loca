import { apiUrl } from './api.js';
import { readCliModels } from './auth.js';
import { getSystemOneModels } from './systemone.js';
import { object, parseJson } from './output.js';
import { ProviderError, type ModelCatalog, type ModelProfileValidation, type ProviderConnection, type ProviderProfile } from './types.js';

export function emptyCatalog(source: ModelCatalog['source'], detail: string, modelListStatus: ModelCatalog['modelListStatus'] = 'unsupported'): ModelCatalog {
  return { models: [], source, checkedAt: new Date().toISOString(), modelListStatus, complete: false, detail };
}

/** The compatible /models protocol advertises model IDs, not reasoning capabilities. */
async function readApiModels(connection: ProviderConnection, signal?: AbortSignal, credential?: string): Promise<ModelCatalog> {
  const base = apiUrl(connection);
  base.pathname = base.pathname.replace(/\/(chat\/completions|responses)$/, '/models');
  const key = credential ?? (connection.envKey ? process.env[connection.envKey] : undefined);
  if (connection.envKey && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(connection.envKey)) throw new ProviderError('invalid-env-key', 'API 키 환경변수 이름이 올바르지 않습니다.');
  if (credential === undefined && connection.envKey && !key) throw new ProviderError('missing-key', 'API 키 환경변수를 확인하세요.');
  if (key !== undefined && (!key.trim() || /[\r\n\0]/.test(key))) throw new ProviderError('invalid-key', 'API 키 형식이 올바르지 않습니다.');
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, Math.min(connection.timeoutMs ?? 8000, 8000));
  try {
    const response = await fetch(base, { method: 'GET', headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: controller.signal, redirect: 'error' });
    if (response.status === 404 || response.status === 405) return emptyCatalog('api', '이 API는 모델 목록 조회를 지원하지 않습니다. 모델 ID를 직접 입력하고 기본 추론 수준을 사용하세요.');
    if (!response.ok) throw new ProviderError('model-list-http-error', `모델 목록 조회가 HTTP ${response.status}로 실패했습니다.`);
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('invalid-model-list', '모델 목록 응답이 비어 있습니다.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1024 * 1024) { await reader.cancel(); throw new ProviderError('model-list-too-large', '모델 목록 크기 제한을 초과했습니다.'); }
      chunks.push(chunk.value);
    }
    const raw = object(parseJson(Buffer.concat(chunks).toString('utf8')));
    if (!Array.isArray(raw?.data) || raw.data.length > 1000) throw new ProviderError('invalid-model-list', 'API 모델 목록 형식을 확인하지 못했습니다.');
    const models: ModelCatalog['models'] = []; const seen = new Set<string>();
    for (const value of raw.data) {
      const row = object(value), id = row?.id;
      if (typeof id !== 'string' || !id.trim() || id.length > 300 || /[\r\n\0]/.test(id)) throw new ProviderError('invalid-model-list', 'API 모델 목록에 잘못된 ID가 있습니다.');
      if (!seen.has(id)) models.push({ id, name: id, efforts: [], effortSupport: 'unknown' });
      seen.add(id);
    }
    return { models, source: 'api', checkedAt: new Date().toISOString(), modelListStatus: 'available', complete: raw.has_more !== true,
      detail: 'API가 반환한 모델 ID입니다. OpenAI 호환 모델 목록은 모델별 추론 수준을 제공하지 않아 기본값만 확인 없이 사용할 수 있습니다.' };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Read-only metadata; never starts an inference or reads account files. */
export async function listModels(connection: ProviderConnection, signal?: AbortSignal, credential?: string): Promise<ModelCatalog> {
  if (signal?.aborted) return emptyCatalog(connection.kind === 'openai' || connection.kind === 'systemone' ? 'api' : 'cli', '모델 목록 조회를 취소했습니다.', 'unavailable');
  if (connection.kind === 'openai' || connection.kind === 'systemone') {
    try { return connection.kind === 'openai' ? await readApiModels(connection, signal, credential) : await getSystemOneModels(connection, credential, signal); }
    catch (error) { return emptyCatalog('api', error instanceof ProviderError ? error.message : '모델 목록을 조회하지 못했습니다. 주소·인증·네트워크를 확인하세요.', 'unavailable'); }
  }
  return readCliModels(connection, signal);
}

/** Pure half of validation, shared by tests and actual invocation. Client hints never override evidence. */
export function validateCatalogProfile(connection: ProviderConnection, profile: ProviderProfile, catalog: ModelCatalog): ModelProfileValidation {
  if (profile.connectionId !== connection.id) throw new ProviderError('profile-connection-mismatch', '실행 프로필의 연결과 선택한 연결이 일치하지 않습니다.');
  const model = catalog.models.find(item => item.id === profile.model);
  if (!model && catalog.modelListStatus === 'available' && catalog.complete) throw new ProviderError('model-not-listed', '선택한 모델 ID가 현재 연결의 모델 목록에 없습니다. 목록을 새로고침하고 모델을 직접 선택하세요.');
  const support = connection.kind === 'systemone' ? 'unsupported' : model?.effortSupport ?? 'unknown';
  if (profile.effort) {
    if (support === 'unsupported') throw new ProviderError('unsupported-effort', '선택한 모델은 추론 수준 설정을 지원하지 않습니다. 기본값을 사용하세요.');
    if (support === 'unknown') throw new ProviderError('unverified-effort', '선택한 모델의 추론 수준 지원을 확인하지 못했습니다. 기본값을 사용하거나 모델 목록을 다시 확인하세요.');
    if (!model?.efforts.includes(profile.effort)) throw new ProviderError('unsupported-effort', '선택한 추론 수준이 이 모델의 현재 지원 목록에 없습니다.');
  }
  return model ? { status: 'verified', detail: support === 'unknown' ? '모델 ID를 확인했습니다. 추론 수준 지원은 미확인이며 CLI/API 기본값을 사용합니다.' : '현재 연결의 모델 및 추론 수준 메타데이터를 확인했습니다.' }
    : { status: 'unverified', detail: '모델 목록을 확인할 수 없어 직접 입력한 모델과 기본 추론 수준으로 실행합니다. 모델 접근 권한·해석된 실제 모델은 미확인입니다.' };
}

export async function validateModelProfile(connection: ProviderConnection, profile: ProviderProfile, credential?: string, signal?: AbortSignal): Promise<ModelProfileValidation> {
  if (profile.connectionId !== connection.id) throw new ProviderError('profile-connection-mismatch', '실행 프로필의 연결과 선택한 연결이 일치하지 않습니다.');
  const catalog = await listModels(connection, signal, credential);
  if (signal?.aborted) throw new ProviderError('cancelled', '작업이 취소되었습니다.');
  return validateCatalogProfile(connection, profile, catalog);
}
