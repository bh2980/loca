import { STAGES, type AIProfile, type Connection, type ModelRoute } from '@workbench/contracts';

export type AIProfileDraft = Omit<AIProfile, 'id' | 'version' | 'createdAt' | 'updatedAt'>;
const FORMAT = 'workbench.ai-profile', VERSION = 1, MAX_FILE = 128 * 1024;
const ROUTE_KEYS = ['connectionId', 'model', 'effort', 'timeoutMs', 'maxOutputTokens', 'maxAttempts'] as const;
const PROFILE_KEYS = [...ROUTE_KEYS, 'name', 'fallbacks', 'prompt', 'promptVersion', 'contextPolicy', 'legacyStage', 'outputFormat', 'toolPolicy'] as const;
const TOOL_NAMES = new Set(['project_overview','search_script','read_script','search_materials','read_material','list_terms','run_progress','change_history','list_characters','read_character','list_relationships','studio_status','read_proposal','draft_proposal','revise_proposal','web_search','web_read_page']);
function fail(message: string): never { throw new Error(`프로필 파일: ${message}`); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('JSON 객체 형식이 필요합니다.');
  if (Object.keys(value).some(key => !keys.includes(key))) fail('허용하지 않는 필드가 있습니다. 연결 설정·인증 정보·실행 기록은 가져올 수 없습니다.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) fail(`${label} 형식이나 길이를 확인하세요.`);
  return value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(`${label} 범위를 확인하세요.`);
  return Number(value);
}
function route(value: unknown, profile = false): ModelRoute {
  const row = object(value, profile ? PROFILE_KEYS : ROUTE_KEYS);
  const connectionId = text(row.connectionId, '연결 참조', 256), model = text(row.model, '모델 ID', 256), effort = text(row.effort, '추론 수준', 64, true);
  if (['__proto__', 'prototype', 'constructor'].includes(connectionId) || /[\r\n]/.test(connectionId + model) || !['', 'default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) fail('연결·모델·추론 수준 값이 잘못되었습니다.');
  return { connectionId, model, effort, timeoutMs: integer(row.timeoutMs, '제한 시간', 1, 3600000), maxOutputTokens: integer(row.maxOutputTokens, '출력 토큰', 1, 1000000), maxAttempts: integer(row.maxAttempts, '시도 횟수', 1, 3) };
}
function draft(value: unknown): AIProfileDraft {
  const row = object(value, PROFILE_KEYS), result: AIProfileDraft = { ...route(row, true), name: text(row.name, '이름', 200) };
  if (row.fallbacks !== undefined) {
    if (!Array.isArray(row.fallbacks) || row.fallbacks.length > 3) fail('대체 AI는 최대 3개입니다.');
    result.fallbacks = row.fallbacks.map(value => route(value));
  }
  if (row.prompt !== undefined) result.prompt = text(row.prompt, '지시문', 30000, true);
  if (row.promptVersion !== undefined) result.promptVersion = integer(row.promptVersion, '지시문 버전', 1, Number.MAX_SAFE_INTEGER);
  if (row.contextPolicy !== undefined) {
    const policy = object(row.contextPolicy, ['terms', 'knowledge', 'previous']); result.contextPolicy = {};
    for (const key of ['terms', 'knowledge', 'previous'] as const) if (policy[key] !== undefined) { if (typeof policy[key] !== 'boolean') fail('맥락 정책은 참/거짓이어야 합니다.'); result.contextPolicy[key] = policy[key]; }
  }
  if (row.legacyStage !== undefined) { if (!STAGES.includes(row.legacyStage as typeof STAGES[number])) fail('작업 단계가 잘못되었습니다.'); result.legacyStage = row.legacyStage as typeof STAGES[number]; }
  if (row.outputFormat !== undefined) { if (row.outputFormat !== 'text' && row.outputFormat !== 'json') fail('출력 형식이 잘못되었습니다.'); result.outputFormat = row.outputFormat; }
  if (row.toolPolicy !== undefined) {
    const policy = object(row.toolPolicy, ['web', 'allowedTools']);
    if (typeof policy.web !== 'boolean' || !Array.isArray(policy.allowedTools) || policy.allowedTools.length > TOOL_NAMES.size || policy.allowedTools.some(name => typeof name !== 'string' || !TOOL_NAMES.has(name)) || new Set(policy.allowedTools).size !== policy.allowedTools.length) fail('도구 권한 목록이 잘못되었습니다.');
    result.toolPolicy = { web: policy.web, allowedTools: policy.allowedTools as string[] };
  }
  return result;
}
/** Explicit projection omits identity, timestamps and any incidental connection/secret fields. */
export function savedProfileDraft(profile: AIProfile): AIProfileDraft {
  return structuredClone(draft(Object.fromEntries(PROFILE_KEYS.filter(key => profile[key] !== undefined).map(key => [key, profile[key]]))));
}
export function exportAIProfile(profile: AIProfile): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, profile: savedProfileDraft(profile) }, null, 2);
}
export function importAIProfile(json: string, connections: Pick<Connection, 'id'>[]): { profile: AIProfileDraft; unresolved: string[] } {
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_FILE) fail('파일은 128 KiB 이하여야 합니다.');
  let parsed: unknown; try { parsed = JSON.parse(json); } catch { fail('올바른 JSON이 아닙니다.'); }
  const envelope = object(parsed, ['format', 'version', 'profile']);
  if (envelope.format !== FORMAT || envelope.version !== VERSION) fail('지원하는 프로필 형식·버전이 아닙니다.');
  const profile = draft(envelope.profile), existing = new Set(connections.map(connection => connection.id)), unresolved: string[] = [];
  for (const [index, item] of [profile, ...(profile.fallbacks ?? [])].entries()) if (!existing.has(item.connectionId)) { unresolved.push(index === 0 ? '기본 AI' : `대체 AI ${index}`); item.connectionId = ''; }
  return { profile, unresolved };
}
export function profileConnectionsResolved(profile: AIProfileDraft, connections: Pick<Connection, 'id'>[]): boolean {
  const ids = new Set(connections.map(connection => connection.id));
  return [profile, ...(profile.fallbacks ?? [])].every(route => !!route.connectionId && ids.has(route.connectionId));
}
