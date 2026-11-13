import { cn } from "../../lib/utils"

export type DiffPart = { text: string; mark?: boolean }
export type DiffRow = { type: "same" | "added" | "removed"; parts: DiffPart[] } | { type: "folded"; count: number }

/** Line-by-line and inline-word diff block for proposal change previews. */
export function DiffText({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="max-h-scroll overflow-y-auto rounded-md border border-subtle bg-sunken/40 text-sm whitespace-pre-wrap break-words">
      {rows.map((row, index) => {
        if (row.type === "folded") {
          return (
            <div key={index} className="bg-sunken/60 px-2 py-0.5 text-center text-xs text-muted select-none">
              변경 없는 {row.count.toLocaleString()}줄
            </div>
          )
        }
        const gutter = row.type === "added" ? "+" : row.type === "removed" ? "−" : " "
        return (
          <div
            key={index}
            className={cn(
              "flex items-start px-2 py-0.5",
              row.type === "added" && "bg-success/10 text-default",
              row.type === "removed" && "bg-danger/10 text-default",
              row.type === "same" && "text-muted",
            )}
          >
            <span
              className={cn(
                "w-4 shrink-0 font-mono text-sm select-none",
                row.type === "added" ? "text-success" : row.type === "removed" ? "text-danger" : "text-subtle",
              )}
            >
              {gutter}
            </span>
            <span className="min-w-0 flex-1">
              {row.parts.map((part, partIndex) =>
                part.mark ? (
                  <span
                    key={partIndex}
                    className={cn(
                      "rounded-xs",
                      row.type === "added" && "bg-success/25 font-medium",
                      row.type === "removed" && "bg-danger/25 line-through",
                    )}
                  >
                    {part.text}
                  </span>
                ) : (
                  <span key={partIndex}>{part.text}</span>
                ),
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
