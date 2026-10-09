import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Agent text: GitHub-flavoured markdown (tables, task lists, strikethrough), wide tables scroll. */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ node: _node, ...props }) => (
          <div className="overflow-x-auto rounded-md border">
            <table {...props} />
          </div>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
