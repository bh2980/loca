import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Agent text: GitHub-flavoured markdown (tables, task lists, strikethrough), wide tables scroll. */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Wikis refuse images linked from other sites by referrer; asking without one usually works.
        img: ({ node: _node, src, alt }) =>
          typeof src === 'string' ? (
            <a href={src} target="_blank" rel="noreferrer" className="my-1 block w-fit">
              <img src={src} alt={alt ?? ''} referrerPolicy="no-referrer" loading="lazy" className="max-h-72 max-w-full rounded-md border object-contain" />
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
  );
}
