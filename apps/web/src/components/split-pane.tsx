import type { CSSProperties, ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

/**
 * A page's content with its right-hand detail pane: the pane opens when `pane` is given and its
 * width is dragged by the handle and remembered per page (`id`), like the chat dock.
 */
export function SplitPane({ id, pane, children, defaultWidth = '420px', className, style }: { id: string; pane: ReactNode; children: ReactNode; defaultWidth?: string; className?: string; style?: CSSProperties }) {
  const open = Boolean(pane);
  const layout = useDefaultLayout({ id: `tw-pane-${id}`, panelIds: open ? ['content', 'pane'] : ['content'], storage: localStorage });
  return (
    <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className={cn('min-h-0', className)} style={style}>
      <ResizablePanel id="content" minSize="320px" className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
      {open && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="pane" defaultSize={defaultWidth} minSize="280px" maxSize="70%" className="min-w-0">
            {pane}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
