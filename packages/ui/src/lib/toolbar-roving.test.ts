import { describe, expect, it } from "vitest"
import { nextToolbarIndex } from "./toolbar-roving"

describe("nextToolbarIndex", () => {
  it("moves left and right", () => {
    expect(nextToolbarIndex([true, true, true], 1, "left")).toBe(0)
    expect(nextToolbarIndex([true, true, true], 1, "right")).toBe(2)
  })

  it("jumps to the first and last enabled item", () => {
    expect(nextToolbarIndex([false, true, true, false], 2, "home")).toBe(1)
    expect(nextToolbarIndex([false, true, true, false], 1, "end")).toBe(2)
  })

  it("skips disabled items", () => {
    expect(nextToolbarIndex([true, false, false, true], 0, "right")).toBe(3)
    expect(nextToolbarIndex([true, false, false, true], 3, "left")).toBe(0)
  })

  it("clamps at the ends by default", () => {
    expect(nextToolbarIndex([true, true], 1, "right")).toBe(1)
    expect(nextToolbarIndex([true, true], 0, "left")).toBe(0)
  })

  it("returns -1 for an empty or fully disabled list", () => {
    expect(nextToolbarIndex([], 0, "right")).toBe(-1)
    expect(nextToolbarIndex([false, false], 0, "home")).toBe(-1)
  })
})
