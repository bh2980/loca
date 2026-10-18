export type ToolbarDirection = "left" | "right" | "home" | "end"

/** Returns the next enabled item index, clamping at either end unless wrap is requested. */
export function nextToolbarIndex(
  enabled: readonly boolean[],
  currentIndex: number,
  direction: ToolbarDirection,
  wrap = false,
): number {
  const candidates = enabled.flatMap((isEnabled, index) => isEnabled ? [index] : [])
  if (candidates.length === 0) return -1
  if (direction === "home") return candidates[0]
  if (direction === "end") return candidates[candidates.length - 1]

  const step = direction === "right" ? 1 : -1
  let index = currentIndex + step
  while (index >= 0 && index < enabled.length) {
    if (enabled[index]) return index
    index += step
  }
  if (!wrap) return currentIndex
  return direction === "right" ? candidates[0] : candidates[candidates.length - 1]
}
