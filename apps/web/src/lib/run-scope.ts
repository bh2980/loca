/** What the run dialog can run on. */
export type RunScopeMode = 'all' | 'here' | 'groups' | 'units' | 'tags' | 'kind';

/**
 * The scope the run dialog starts with, worked out again each time it opens (#54: it used to be
 * fixed at the first open, so a second pick of lines did not show '고른 대사'): picked lines, else
 * the open scenes, else the open kind of lines. The whole project is never preselected.
 */
export function initialRunScope(given: { unitIds?: string[]; groupIds?: string[]; kind?: string }): RunScopeMode | undefined {
  return given.unitIds?.length ? 'units' : given.groupIds?.length ? 'here' : given.kind ? 'kind' : undefined;
}
