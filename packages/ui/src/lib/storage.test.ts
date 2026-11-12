import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readStored, readStoredJson, storedItems, STORAGE_PREFIX, writeStored, writeStoredJson } from "./storage"

const fake = () => {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) }
}
let local: ReturnType<typeof fake>
let session: ReturnType<typeof fake>
beforeEach(() => {
  local = fake()
  session = fake()
  vi.stubGlobal("window", { localStorage: local, sessionStorage: session })
})
afterEach(() => vi.unstubAllGlobals())

describe("what the parts remember", () => {
  it("keeps every key under the one prefix, in the scope asked for", () => {
    writeStored("local", "section.line.history", "closed")
    writeStored("session", "pane-width.inspector", "320")
    expect([...local.data.keys()]).toEqual([`${STORAGE_PREFIX}section.line.history`])
    expect([...session.data.keys()]).toEqual([`${STORAGE_PREFIX}pane-width.inspector`])
    expect(readStored("local", "section.line.history")).toBe("closed")
    expect(readStored("session", "section.line.history")).toBeNull()
    writeStored("local", "section.line.history", null)
    expect(local.data.size).toBe(0)
  })

  it("reads JSON through the part's own reader; absent or broken text is the reader's answer for nothing", () => {
    const widths = (raw: unknown) => (raw && typeof raw === "object" ? (raw as Record<string, number>) : {})
    expect(readStoredJson("local", "table-widths.terms", widths)).toEqual({})
    writeStoredJson("local", "table-widths.terms", { name: 200 })
    expect(readStoredJson("local", "table-widths.terms", widths)).toEqual({ name: 200 })
    local.data.set(`${STORAGE_PREFIX}table-widths.terms`, "{broken")
    expect(readStoredJson("local", "table-widths.terms", widths)).toEqual({})
    writeStoredJson("local", "table-widths.terms", undefined)
    expect(local.data.size).toBe(0)
  })

  it("goes on when storage is missing or throws", () => {
    const failing = { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("quota") }, removeItem: () => { throw new Error("denied") } }
    vi.stubGlobal("window", { localStorage: failing, sessionStorage: failing })
    expect(readStored("local", "a")).toBeNull()
    expect(() => writeStored("local", "a", "1")).not.toThrow()
    expect(() => writeStored("session", "a", null)).not.toThrow()
    vi.unstubAllGlobals()
    // No window at all (a server render, a test).
    expect(readStored("local", "a")).toBeNull()
    expect(() => writeStored("local", "a", "1")).not.toThrow()
  })

  it("hands a library the same storage, prefix and all", () => {
    const items = storedItems("session")
    items.setItem("react-resizable-panels:pane", "[60,40]")
    expect([...session.data.keys()]).toEqual([`${STORAGE_PREFIX}react-resizable-panels:pane`])
    expect(items.getItem("react-resizable-panels:pane")).toBe("[60,40]")
  })
})
