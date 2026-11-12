/**
 * What the parts remember in the browser (a folded section, a table's column widths and order, a pane's width): one
 * place for the key prefix and for storage that is missing or throws (private mode, a full quota, a server render).
 * A part that fails to remember still works; it just starts as new next time.
 *
 * The app has its own registry for its values (apps/web/src/lib/storage.ts); this package cannot import it, and shares
 * only the prefix, so everything loca keeps is told apart from other pages' keys the same way.
 */
export const STORAGE_PREFIX = "loca."

/** `local`: kept across tabs and restarts (a preference). `session`: this tab only (where a pane was dragged to). */
export type StorageScope = "local" | "session"

const area = (scope: StorageScope): Storage | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    return scope === "local" ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}

/** The text kept under `key` (the prefix is added here), or null. */
export function readStored(scope: StorageScope, key: string): string | null {
  try {
    return area(scope)?.getItem(STORAGE_PREFIX + key) ?? null
  } catch {
    return null
  }
}

/** Keeps `value` under `key`; null forgets it. */
export function writeStored(scope: StorageScope, key: string, value: string | null): void {
  try {
    if (value === null) area(scope)?.removeItem(STORAGE_PREFIX + key)
    else area(scope)?.setItem(STORAGE_PREFIX + key, value)
  } catch {
    // Not kept: the part goes on with what it has.
  }
}

/** The JSON kept under `key` as `read` understands it; what is absent or does not parse is `read(undefined)`. */
export function readStoredJson<T>(scope: StorageScope, key: string, read: (raw: unknown) => T): T {
  const text = readStored(scope, key)
  if (text === null) return read(undefined)
  try {
    return read(JSON.parse(text))
  } catch {
    return read(undefined)
  }
}

/** Keeps `value` as JSON; undefined forgets it. */
export const writeStoredJson = (scope: StorageScope, key: string, value: unknown): void => writeStored(scope, key, value === undefined ? null : JSON.stringify(value))

/** The same storage in the shape a library asks for (react-resizable-panels keeps its layouts through one). */
export const storedItems = (scope: StorageScope): Pick<Storage, "getItem" | "setItem"> => ({
  getItem: (key) => readStored(scope, key),
  setItem: (key, value) => writeStored(scope, key, value),
})
