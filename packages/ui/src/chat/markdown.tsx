import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "../lib/utils"

/**
 * Agent text: GitHub-flavoured markdown (tables, task lists, strikethrough), wide tables scroll. Its typography is `.prose-chat`
 * (chat/prose.css). `framed` puts it in a scrolling box, as a preview of text an agent proposes to save.
 */
export function ChatMarkdown({ children, framed = false }: { children: string; framed?: boolean }) {
  return (
    <div className={cn("prose-chat", framed && "max-h-64 overflow-auto rounded-md border bg-muted px-3 py-2")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
