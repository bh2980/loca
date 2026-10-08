import { STAGES, type Connection, type ExecutionProfile, type Stage, type TaskTest, type WorkspaceState } from '@workbench/contracts';

export interface TestScopeRequest { unitIds: string[]; token: number; stage?: Stage; testId?: string }
export interface RunScopeRequest { unitIds: string[]; stage: Stage }
export type SettingsSnapshot = Pick<WorkspaceState, 'connections' | 'profiles' | 'revision'>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const equalSettings = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function equalProfile(left: ExecutionProfile, right: ExecutionProfile) {
  const normalize = ({ promptVersion: _version, ...profile }: ExecutionProfile) => ({ ...profile, fallbacks: profile.fallbacks ?? [], effort: profile.effort === 'default' ? '' : profile.effort, prompt: profile.prompt ?? '', contextPolicy: { terms: profile.contextPolicy?.terms !== false, knowledge: profile.contextPolicy?.knowledge !== false, previous: profile.contextPolicy?.previous !== false } });
  return equalSettings(normalize(left), normalize(right));
}
/** Merge server changes, retaining only fields edited since the previous server value or save capture. */
function mergeEntity<T extends object>(draft: T, before: T, next: T): T {
  const merged = { ...next };
  for (const key of new Set([...Object.keys(draft), ...Object.keys(before)]) as Set<keyof T>) {
    if (!equalSettings(draft[key], before[key])) merged[key] = draft[key];
  }
  return merged;
}
export function mergeSettingsDrafts(draft: Pick<SettingsSnapshot, 'connections' | 'profiles'>, before: SettingsSnapshot, next: SettingsSnapshot,
  accepted: { connections?: Connection[]; profiles?: Partial<Record<Stage, ExecutionProfile>> } = {}) {
  const profiles = Object.fromEntries(STAGES.map(stage => [stage, mergeEntity(draft.profiles[stage], accepted.profiles?.[stage] ?? before.profiles[stage], next.profiles[stage])])) as Record<Stage, ExecutionProfile>;
  const connections = next.connections.map(connection => {
    const current = draft.connections.find(item => item.id === connection.id);
    const prior = accepted.connections?.find(item => item.id === connection.id) ?? before.connections.find(item => item.id === connection.id);
    return current && prior ? mergeEntity(current, prior, connection) : structuredClone(connection);
  });
  return { connections, profiles };
}
export const activeTest = (test: TaskTest) => test.status === 'queued' || test.status === 'running';

/** Count saved results using their execution provenance, never the truncated recent change feed. */
export function runOutcome(state: Pick<WorkspaceState, 'translations' | 'reviews' | 'knowledge'>, runId: string) {
  const savedUnitIds = Object.values(state.translations).filter(translation => translation.history.some(version => version.execution?.runId === runId)).map(translation => translation.unitId);
  const reviews = state.reviews.filter(review => review.execution?.runId === runId);
  const reviewUnitIds = [...new Set(reviews.filter(review => review.status === 'open').map(review => review.unitId))];
  const knowledgeIds = state.knowledge.filter(item => item.provenance?.runId === runId || item.history?.some(version => version.provenance?.runId === runId)).map(item => item.id);
  return { savedUnitIds, reviewUnitIds, proposedUnitIds: [...new Set(reviews.map(review => review.unitId))], knowledgeIds };
}
