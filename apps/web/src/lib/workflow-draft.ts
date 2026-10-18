/** Whether two workflow edits hold the same visible content; used to ignore no-op draft writes. */
export function sameWorkflowDraft(a: { name: string; definition: unknown }, b: { name: string; definition: unknown }): boolean {
  return a.name === b.name && deepEqual(a.definition, b.definition);
}

/** Normalize a no-op edit only when no save is currently changing the server baseline. */
export function normalizeWorkflowDraft<T extends { baseVersion: number; name: string; definition: unknown }>(next: T, saved: T | null | undefined, inFlight: T | null): T | null {
  return !inFlight && saved && sameWorkflowDraft(next, saved) ? null : next;
}

/** An in-flight save must never erase edits made after its request was sent. */
export function reconcileSavedDraft<T extends { baseVersion: number; name: string; definition: unknown }>(current: T | null, sent: T, version: number): T | null {
  if (!current || sameWorkflowDraft(current, sent)) return null;
  return current.baseVersion === sent.baseVersion ? { ...current, baseVersion: version } : current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}
