import type * as React from "react"
import { clsx } from "clsx"
import { chipStyle, paletteColor } from "../../patterns/palette"

const PILL = "rounded-sm border border-default bg-surface px-1 py-0.5 text-xs leading-4 text-default shadow-2xs"

/** The row laid over a workflow line where the layout left room: the line's label and its fold chip (the page gives `style.transform`). */
export function EdgeLabelRow(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div className="nodrag nopan pointer-events-none absolute flex items-center gap-1" {...props} />
}

/** The text of a workflow line, on a small card: inside an `EdgeLabelRow`, or `floating` on its own over the graph (the page gives `style.transform`). */
export function EdgeLabelPill({ floating, ...props }: Omit<React.ComponentProps<"div">, "className"> & { floating?: boolean }) {
  return floating ? <div className={clsx("pointer-events-none absolute", PILL)} {...props} /> : <span className={PILL} {...(props as React.ComponentProps<"span">)} />
}

/** What a line puts on the lines passing it: a tag it adds (+) or takes off (−), a status it sets (→). */
export interface LineMark {
  nodeId: string
  kind: "tag" | "status"
  sign?: "+" | "−"
  name: string
  /** The stored colour of the tag or status; none for a tag named by a result field. */
  color?: string
}

/**
 * The 태그 붙이기 / 떼기 and 상태 변경 nodes a line passes through, drawn on it as what they do: a tag chip in the tag's
 * colour, a status with its dot. A click opens that node (the page gives `style.transform`).
 */
export function LineMarks({ marks, onOpen, style }: { marks: LineMark[]; onOpen: (nodeId: string) => void; style?: React.CSSProperties }) {
  return (
    <div className="nodrag nopan pointer-events-none absolute flex flex-col items-center gap-0.5" style={style}>
      {marks.map((mark, index) => (
        <button
          key={`${mark.nodeId}-${index}`}
          type="button"
          title={mark.kind === "tag" ? `${mark.sign === "−" ? "떼는" : "붙이는"} 태그 · 눌러서 설정 열기` : "바꾸는 상태 · 눌러서 설정 열기"}
          onClick={(event) => { event.stopPropagation(); onOpen(mark.nodeId) }}
          onDoubleClick={(event) => event.stopPropagation()}
          className={clsx(
            "pointer-events-auto flex max-w-40 items-center gap-0.5 whitespace-nowrap rounded-sm border px-1 text-xs leading-4 font-medium shadow-2xs",
            mark.kind === "status" ? "border-default bg-surface text-default" : "border-transparent",
          )}
          style={mark.kind === "tag" ? (mark.color ? chipStyle(mark.color) : { background: "var(--background-color-sunken)" }) : undefined}
        >
          {mark.kind === "status"
            ? <><span className="size-2 shrink-0 rounded-full" style={{ background: paletteColor(mark.color) }} />→ <span className="truncate">{mark.name}</span></>
            : <><span className={clsx(mark.sign === "−" && "opacity-70")}>{mark.sign}</span><span className="truncate">#{mark.name}</span></>}
        </button>
      ))}
    </div>
  )
}
