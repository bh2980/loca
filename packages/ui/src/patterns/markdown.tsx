import { memo, type ComponentProps } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "../lib/utils"

const PLUGINS = [remarkGfm]
const COMPONENTS: ComponentProps<typeof ReactMarkdown>["components"] = {
  // Wikis refuse images linked from other sites by referrer; asking without one usually works.
  img: ({ node: _node, src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noreferrer" className="my-1 block w-fit">
        <img src={src} alt={alt ?? ""} referrerPolicy="no-referrer" loading="lazy" className="max-h-72 max-w-full rounded-md border object-contain" />
      </a>
    ) : null,
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto rounded-md border">
      <table {...props} />
    </div>
  ),
}

/**
 * Markdown text: GitHub-flavoured markdown (tables, task lists, strikethrough), wide tables scroll. Its typography is `.prose-markdown`
 * (patterns/prose.css). `framed` puts it in a scrolling box, as a preview of text an agent proposes to save. Parsed again only when its text changes.
 */
export const Markdown = memo(function Markdown({ children, framed = false }: { children: string; framed?: boolean }) {
  return (
    <div className={cn("prose-markdown", framed && "max-h-64 overflow-auto rounded-md border bg-sunken px-3 py-2")}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
