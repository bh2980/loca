import { cn } from "../lib/utils"
import { paletteColor } from "./palette"

const SIZE = { sm: "size-5 text-2xs", md: "size-6 text-xs", lg: "size-14 text-xl" } as const

/** The person's colour as an avatar: a wash of it behind its letter in full; without one, the accent's. */
export const avatarStyle = (color: string | null | undefined) =>
  color ? { backgroundColor: `color-mix(in oklch, ${paletteColor(color)} 22%, transparent)`, color: paletteColor(color) } : undefined

/**
 * The person (프로필): the first letter of their 표시 이름 in a circle of their colour, the same wherever they appear (the
 * sidebar, a line's 이력, the profile's preview). `mark` is that letter ('사' while there is no name).
 */
export function PersonAvatar({ mark, color, size = "sm" }: { mark: string; color?: string | null; size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden="true" style={avatarStyle(color)} className={cn("flex shrink-0 items-center justify-center rounded-full font-bold", SIZE[size], !color && "bg-accent-soft text-on-accent-soft")}>
      {mark}
    </span>
  )
}
