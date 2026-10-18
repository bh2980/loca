/** What the run dialog can run on. */
export type RunScopeMode = 'all' | 'here' | 'groups' | 'units' | 'tags' | 'kind';
export type RunScopeKind = 'scene' | 'ui' | 'document';

/**
 * The scope the run dialog starts with, worked out again each time it opens (#54: it used to be
 * fixed at the first open, so a second pick of lines did not show '고른 대사'): picked lines, else
 * the open scenes, else the open kind of lines. The whole project is never preselected.
 */
export function initialRunScope(given: { unitIds?: string[]; groupIds?: string[]; kind?: string }): RunScopeMode | undefined {
  return given.unitIds?.length ? 'units' : given.groupIds?.length ? 'here' : given.kind ? 'kind' : undefined;
}

/** Capture one opening's scope; later selection/route updates cannot widen this run. */
export function snapshotRunScope(given: { unitIds?: string[]; groupIds?: string[]; kind?: RunScopeKind }) {
  const unitIds = given.unitIds?.slice();
  const groupIds = given.groupIds?.slice();
  // Dialogue is nearly the whole project, so like the whole project it is never preselected.
  const kind = given.kind !== 'scene' ? given.kind : undefined;
  return { unitIds, groupIds, kind, mode: initialRunScope({ unitIds, groupIds, kind }) };
}
