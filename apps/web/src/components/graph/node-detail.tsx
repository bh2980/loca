import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CornerDownRight, FileText, Network, PencilLine } from 'lucide-react';
import { PaneHeader, DetailPane, Button, Skeleton } from '@loca/ui';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { KIND_LABEL } from './shapes';
import { cn } from '@/lib/utils';
import { TokenText } from '@/components/editor/source-text';
import { tokenPatternOf } from '@/lib/line-context';

/** Scene-graph node. Scene links are derived from the dialogue graph, which the panel says plainly. */
export function SceneNodeDetail({ projectId, groupId, onClose }: { projectId: string; groupId: string; onClose: () => void }) {
  const group = useQuery(q.group(groupId));
  useReportView('graph-node', [group.data && { kind: '장면', id: group.data.id, label: group.data.title }]);
  if (!group.data) return <Skeleton className="m-4 h-24" />;
  return (
    <div className="flex h-full flex-col">
      <PaneHeader kicker="장면" title={group.data.title} subtitle={<span className="font-mono">{group.data.key}</span>} onClose={onClose} />
      <div className="space-y-3 p-4">
        {group.data.description && <p className="text-sm">{group.data.description}</p>}
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: groupId }}>
              <FileText /> 장면 열기
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: groupId }}>
              <Network /> 대사 그래프에서 보기
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">장면 사이 연결은 대사 그래프에서 파생한 것입니다. 원본에 장면 순서가 기록된 것은 아닙니다.</p>
      </div>
    </div>
  );
}

/** The flow pane's speaker column width, once dragged (localStorage, per browser); undefined = fit the names. */
function useSpeakerWidth() {
  const [width, setWidth] = useState<number | undefined>(() => {
    try {
      return Number(localStorage.getItem('tw.graph.speakerWidth')) || undefined;
    } catch {
      return undefined;
    }
  });
  const set = (next: number | undefined) => {
    setWidth(next);
    try {
      if (next) localStorage.setItem('tw.graph.speakerWidth', String(Math.round(next)));
      else localStorage.removeItem('tw.graph.speakerWidth');
    } catch {
      /* private mode */
    }
  };
  return [width, set] as const;
}

/**
 * A dialogue-graph selection read like a script: one node or a folded run, its lines in order.
 * The speaker shows where it changes, each line's translation sits under it, a player's choice is
 * its own row. Node types, keys and raw metadata are left out: the flow of the lines is what this
 * pane is for. Clicking a line (a pen shows on hover) opens it in the card beside the graph node
 * for translating; Enter on the canvas opens the first untranslated one.
 */
export function FlowPane({ projectId, nodeIds, title, way, extra, marked, editing, onEdit, onClose }: {
  projectId: string;
  nodeIds: string[];
  title: string;
  /** The choices and conditions on the way in (nearest last); `merged` when several ways arrive. */
  way?: { labels: { text: string; choice: boolean }[]; merged: boolean };
  /** Sections above the lines (the path view's other choices and loops). */
  extra?: ReactNode;
  /** A node inside the run that was asked for (from a line): its rows are marked and scrolled to. */
  marked?: string;
  /** The line open in the translation card: its row is marked and kept in view. */
  editing?: string;
  onEdit: (unitId: string) => void;
  onClose: () => void;
}) {
  const [speakerWidth, setSpeakerWidth] = useSpeakerWidth();
  // Format tokens read as numbered chips, as in the script.
  const project = useQuery(q.project(projectId));
  const tokens = tokenPatternOf(project.data?.formatRules ?? undefined);
  const list = useRef<HTMLDivElement>(null);
  const results = useQueries({ queries: nodeIds.map((id) => q.graphNode(id)) });
  const nodes = results.flatMap((result) => (result.data ? [result.data] : []));
  const loading = results.some((result) => result.isPending);
  const first = nodes.find((node) => node.units.length);
  const lineCount = nodes.reduce((sum, node) => sum + (node.kind === 'choice' ? 0 : node.units.length), 0);
  const translated = nodes.reduce((sum, node) => sum + (node.kind === 'choice' ? 0 : node.units.filter((unit) => unit.translation).length), 0);
  // Scrolled to once, when the lines of the asked-for node have arrived.
  const ready = !results.some((result) => result.isPending);
  useEffect(() => {
    if (ready && marked) list.current?.querySelector('[data-marked]')?.scrollIntoView({ block: 'center' });
  }, [ready, marked]);
  useEffect(() => {
    if (ready && editing) list.current?.querySelector('[data-editing]')?.scrollIntoView({ block: 'nearest' });
  }, [ready, editing]);
  useReportView('graph-node', [nodes[0] && { kind: '그래프', id: nodeIds.join(','), label: title }]);

  // A table: who | what, one row per line; a choice and a condition are rows of their own. The
  // speaker column fits the longest name until someone drags its edge (then that width is kept).
  const speakers = nodes.flatMap((node) => node.units.map((unit) => unit.speaker ?? '지문·문구'));
  const fitted = Math.min(180, Math.max(56, ...speakers.map((name) => name.length * 7 + 8)));
  const width = speakerWidth ?? fitted;
  const row = (key: string, who: ReactNode, what: ReactNode, options: { className?: string; scrollTo?: boolean; unitId?: string } = {}) => (
    <li
      key={key}
      data-marked={options.scrollTo || undefined}
      data-editing={(options.unitId && options.unitId === editing) || undefined}
      title={options.unitId ? '눌러서 번역 (노드 옆 카드)' : undefined}
      className={cn('group relative grid gap-3 px-3 py-2', options.unitId && 'cursor-pointer hover:bg-muted/50', options.unitId && options.unitId === editing && 'bg-primary/5 shadow-[inset_2px_0_0_var(--primary)]', options.className)}
      style={{ gridTemplateColumns: `${width}px minmax(0,1fr)` }}
      onClick={options.unitId ? () => onEdit(options.unitId!) : undefined}
    >
      <span className="truncate pt-px text-xs text-muted-foreground">{who}</span>
      <div className="min-w-0 text-sm">{what}</div>
      {options.unitId && <PencilLine className="absolute top-2.5 right-2 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />}
    </li>
  );
  const lines = nodes.flatMap((node) => {
    const choice = node.units[0];
    if (node.kind === 'choice')
      return [
        row(
          node.id,
          '선택지',
          <>
            <p className="font-medium text-choice">▶ {choice?.source ?? node.label ?? node.key}</p>
            {choice?.translation && <p className="text-muted-foreground">{choice.translation}</p>}
          </>,
          { className: 'bg-choice/5', unitId: choice?.id },
        ),
      ];
    if (!node.units.length) return [row(node.id, KIND_LABEL[node.kind] ?? node.kind, <span className="text-muted-foreground">{node.label ?? node.typeInfo?.label ?? ''}</span>, { className: 'bg-muted/40' })];
    return node.units.map((unit) => {
      const here = node.id === marked;
      return row(
        unit.id,
        unit.speaker ?? '지문·문구',
        <>
          <TokenText text={unit.source} source={unit.source} pattern={tokens} />
          {unit.translation && <TokenText text={unit.translation} source={unit.source} pattern={tokens} className="text-muted-foreground" />}
        </>,
        { className: here ? 'bg-primary/5 shadow-[inset_2px_0_0_var(--primary)]' : undefined, scrollTo: here, unitId: unit.id },
      );
    });
  });

  return (
    <DetailPane
      kicker={first?.group?.title ?? '대사 그래프'}
      title={title}
      subtitle={lineCount ? `대사 ${lineCount}줄 · 번역 ${translated}줄` : undefined}
      onClose={onClose}
      loading={loading && !nodes.length}
      bodyClassName="space-y-0 p-0"
      footer={
        first?.group && (
          <Button variant="outline" asChild>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: first.group.id, line: first.units[0]?.id }}>
              <FileText /> 번역 화면에서 열기
            </Link>
          </Button>
        )
      }
    >
      {extra && <div className="space-y-4 border-b p-4">{extra}</div>}
      {way && way.labels.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground" title="이 대사로 들어오는 길">
          <CornerDownRight className="size-3.5" aria-label="들어오는 길" />
          {way.labels.map((label, index) => (
            <span key={index} className={cn('rounded-full border px-1.5', label.choice ? 'border-choice/30 bg-choice/10 text-choice' : 'bg-background')}>
              {label.choice ? `▶ ${label.text}` : label.text}
            </span>
          ))}
        </p>
      )}
      <div ref={list} className="relative">
        {/* The speaker column's edge: drag to widen or narrow it. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="화자 칸 폭"
          className="absolute top-0 bottom-0 z-10 w-2 cursor-col-resize hover:bg-border/60"
          style={{ left: width + 12 + 2 }}
          onPointerDown={(event) => {
            const start = event.clientX;
            const from = width;
            const move = (next: PointerEvent) => setSpeakerWidth(Math.min(260, Math.max(40, from + next.clientX - start)));
            const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          onDoubleClick={() => setSpeakerWidth(undefined)}
        />
        <ol className="divide-y border-b">{lines}</ol>
      </div>
    </DetailPane>
  );
}

