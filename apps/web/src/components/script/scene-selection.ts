export type SceneSelectionState = boolean | 'indeterminate';

/** The checkbox reflects the whole filtered scene, including lines beyond the current page. */
export function sceneSelectionState(picked: ReadonlySet<string>, matchingIds: readonly string[]): SceneSelectionState {
  if (!matchingIds.length) return false;
  const selected = matchingIds.reduce((count, id) => count + Number(picked.has(id)), 0);
  return selected === 0 ? false : selected === matchingIds.length ? true : 'indeterminate';
}
