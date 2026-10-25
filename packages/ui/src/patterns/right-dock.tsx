import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PanelRight } from 'lucide-react';
import { usePanelRef } from 'react-resizable-panels';
import { Button } from '../controls/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../controls/resizable';
import { Tooltip, TooltipContent, TooltipTrigger } from '../controls/tooltip';
import { SegmentedControl } from '../controls/segmented-control';
import { cn } from '../lib/utils';
import { usePanelWidth } from '../lib/use-panel-width';

type Entry = { id: string; depth: number };
interface DockContextValue {
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  register: (entry: Entry) => () => void;
  active?: string;
  hasContent: boolean;
  activate?: () => void;
  revealDock?: () => void;
}
const DockContext = createContext<DockContextValue | null>(null);
const DockDepth = createContext(0);

/** Portals keep each inspector in its route's React context, but share one physical dock. */
export function DockProvider({ children, onActivate, onContentChange }: { children: ReactNode; onActivate?: () => void; onContentChange?: (present: boolean) => void }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const register = useCallback((entry: Entry) => {
    setEntries((previous) => [...previous.filter((item) => item.id !== entry.id), entry]);
    return () => setEntries((previous) => previous.filter((item) => item.id !== entry.id));
  }, []);
  const active = entries.reduce<Entry | undefined>((best, item) => !best || item.depth >= best.depth ? item : best, undefined)?.id;
  const hasContent = Boolean(active);
  useEffect(() => { onContentChange?.(hasContent); }, [hasContent, onContentChange]);
  const revealDock = useCallback(() => {
    if (hasContent) onActivate?.();
  }, [hasContent, onActivate]);
  const context = useMemo(() => ({ target, setTarget, register, active, hasContent, activate: onActivate, revealDock }), [target, register, active, hasContent, onActivate, revealDock]);
  return <DockContext.Provider value={context}>{children}</DockContext.Provider>;
}

export function useHasDock() { return useContext(DockContext) !== null; }
export function useRevealDock() { return useContext(DockContext)?.revealDock; }

export function DockContent({ children, selectionKey, autoActivate = true }: { children: ReactNode; selectionKey?: string; autoActivate?: boolean }) {
  const dock = useContext(DockContext);
  const depth = useContext(DockDepth);
  const id = useId();
  const register = dock?.register;
  const present = Boolean(children);
  const activate = dock?.activate;
  useEffect(() => present && register ? register({ id, depth }) : undefined, [register, id, depth, present]);
  // A new selection reveals its inspector, but query refreshes and drafts never reopen it.
  useEffect(() => { if (present && autoActivate) activate?.(); }, [activate, present, selectionKey, autoActivate]);
  return dock?.target && present ? createPortal(
    <div className={cn('h-full min-h-0', dock.active !== id && 'hidden')} aria-hidden={dock.active !== id || undefined}>{children}</div>, dock.target,
  ) : null;
}

export function DockLevel({ children }: { children: ReactNode }) {
  const depth = useContext(DockDepth);
  return <DockDepth.Provider value={depth + 1}>{children}</DockDepth.Provider>;
}

export function DockInspector({ empty }: { empty?: ReactNode }) {
  const dock = useContext(DockContext);
  // Register after commit: publishing a DOM ref during commit can re-enter a loading route.
  const target = useRef<HTMLDivElement>(null);
  const setTarget = dock?.setTarget;
  useEffect(() => { setTarget?.(target.current); return () => setTarget?.(null); }, [setTarget]);
  return <div className="relative min-h-0 flex-1">
    <div ref={target} className="h-full min-h-0" />
    {!dock?.active && <div className="absolute inset-0 overflow-auto p-5 text-sm text-muted">{empty ?? '선택 없음'}</div>}
  </div>;
}

export function DockHeader({ mode, onMode, unread, tools, onToggle, open = true, hasProperties = true }: {
  mode: 'properties' | 'agent'; onMode: (mode: 'properties' | 'agent') => void;
  unread?: boolean; tools?: ReactNode; onToggle: () => void; open?: boolean;
  hasProperties?: boolean;
}) {
  if (!open) {
    return <div className="flex items-center gap-1">{tools}
      <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="오른쪽 패널 열기" onClick={onToggle}><PanelRight /></Button></TooltipTrigger><TooltipContent>오른쪽 패널 열기</TooltipContent></Tooltip>
    </div>;
  }
  return <div className="flex h-12 shrink-0 items-center gap-1 border-b border-default px-4">
    {hasProperties ? (
      <SegmentedControl
        ariaLabel="오른쪽 패널"
        value={mode}
        onChange={(val) => onMode(val as 'properties' | 'agent')}
        items={[
          { value: 'properties', label: '속성' },
          {
            value: 'agent',
            label: (
              <>
                에이전트
                {unread && <span className="size-1.5 rounded-full bg-accent" aria-label="새 소식" />}
              </>
            ),
          },
        ]}
      />
    ) : (
      <span className="inline-flex items-center gap-1.5 px-1.5 text-xs font-medium text-default">
        에이전트
        {unread && <span className="size-1.5 rounded-full bg-accent" aria-label="새 소식" />}
      </span>
    )}
    <div className="ml-auto flex items-center gap-1">{tools}
      <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="오른쪽 패널 접기" onClick={onToggle}><PanelRight /></Button></TooltipTrigger><TooltipContent>오른쪽 패널 접기</TooltipContent></Tooltip>
    </div>
  </div>;
}

/** A single resizable trailing pane; collapsing never unmounts editors or an active chat. */
export function WorkspaceShell({ children, dock, open, onOpenChange }: { children: ReactNode; dock: ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) {
  const panel = usePanelRef();
  const { getPixelWidth, ...width } = usePanelWidth('workspace-dock', 360);
  useEffect(() => { if (open) panel.current?.resize(`${getPixelWidth()}px`); else panel.current?.collapse(); }, [open, panel, getPixelWidth]);
  return <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
    <ResizablePanel id="workspace" minSize="320px" className="flex min-w-0 flex-col">{children}</ResizablePanel>
    <ResizableHandle className={cn(!open && 'hidden')} />
    <ResizablePanel id="dock" panelRef={panel} {...width} minSize="280px" maxSize="50%" collapsible collapsedSize={0} onResize={(size, id, previous) => { width.onResize(size, id, previous); if (size.asPercentage === 0 && open) onOpenChange(false); }} className="flex min-w-0 flex-col bg-panel">
      <div className={cn("flex h-full min-h-0 flex-col", !open && "hidden")} inert={!open} aria-hidden={!open || undefined}>{dock}</div>
    </ResizablePanel>
  </ResizablePanelGroup>;
}
