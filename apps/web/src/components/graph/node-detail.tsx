import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CornerDownRight, FileText, Network } from 'lucide-react';
import { Box, ColumnResizeHandle, FlowRow, Icon, Inline, Inspector, InspectorHeader, Button, Skeleton, Text, Chip, Section } from '@loca/ui';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { KIND_LABEL } from './shapes';
import { TokenText } from '@/components/editor/source-text';
import { tokenPatternOf } from '@/lib/line-context';
import { personStyle, usePersonColors } from '@/lib/person-colors';

/** Scene-graph node. Scene links are derived from the dialogue graph, which the panel says plainly. */
export function SceneNodeDetail({ projectId, groupId, onClose }: { projectId: string; groupId: string; onClose: () => void }) {
  const group = useQuery(q.group(groupId));
  useReportView('graph-node', [group.data && { kind: '장면', id: group.data.id, label: group.data.title }]);
  if (!group.data) return <Skeleton marginTop="comfortable" marginBottom="comfortable" marginLeft="comfortable" marginRight="comfortable" height="placeholder-sm" />;
  return (
    <Inspector
      header={<InspectorHeader kind="장면" name={group.data.title} status={<Text mono variant="caption" breakWords="all" title={group.data.key}>{group.data.key}</Text>} onClose={onClose} />}
      footer={
        <>
          <Button variant="outline" asChild>
            <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: groupId }}>
              <Network /> 대사 그래프에서 보기
            </Link>
          </Button>
          <Button asChild>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: groupId }}>
              <FileText /> 장면 열기
            </Link>
          </Button>
        </>
      }
    >
      <Section>
        {group.data.description ? <Text as="p" variant="body">{group.data.description}</Text> : <Text as="p" variant="body" tone="muted">이 장면에는 설명이 없습니다.</Text>}
      </Section>
    </Inspector>
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
  const colorOf = usePersonColors(projectId);
  const speakers = nodes.flatMap((node) => node.units.map((unit) => unit.speaker ?? '지문·문구'));
  const fitted = Math.min(180, Math.max(56, ...speakers.map((name) => name.length * 7 + 8)));
  const width = speakerWidth ?? fitted;
  const row = (key: string, who: ReactNode, what: ReactNode, options: { tint?: 'choice' | 'muted' | 'here'; scrollTo?: boolean; unitId?: string } = {}) => (
    <FlowRow
      key={key}
      who={who}
      what={what}
      editable={Boolean(options.unitId)}
      editing={Boolean(options.unitId && options.unitId === editing)}
      tint={options.tint}
      data-marked={options.scrollTo || undefined}
      data-editing={(options.unitId && options.unitId === editing) || undefined}
      style={{ gridTemplateColumns: `${width}px minmax(0,1fr)` }}
      tabIndex={options.unitId ? 0 : undefined}
      onClick={options.unitId ? () => onEdit(options.unitId!) : undefined}
      onKeyDown={options.unitId ? (event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onEdit(options.unitId!); } : undefined}
    />
  );
  const lines = nodes.flatMap((node) => {
    const choice = node.units[0];
    if (node.kind === 'choice')
      return [
        row(
          node.id,
          '선택지',
          <>
            <Text as="p" weight="medium" tone="choice">▶ {choice?.source ?? node.label ?? node.key}</Text>
            {choice?.translation && <Text as="p" tone="muted">{choice.translation}</Text>}
          </>,
          { tint: 'choice', unitId: choice?.id },
        ),
      ];
    if (!node.units.length) return [row(node.id, KIND_LABEL[node.kind] ?? node.kind, <Text tone="muted">{node.label ?? node.typeInfo?.label ?? ''}</Text>, { tint: 'muted' })];
    return node.units.map((unit) => {
      const here = node.id === marked;
      return row(
        unit.id,
        unit.speaker ? <span style={personStyle(colorOf(unit.speaker))}>{unit.speaker}</span> : '지문·문구',
        <>
          <TokenText text={unit.source} source={unit.source} pattern={tokens} />
          {unit.translation && <Text asChild tone="muted"><TokenText text={unit.translation} source={unit.source} pattern={tokens} /></Text>}
        </>,
        { tint: here ? 'here' : undefined, scrollTo: here, unitId: unit.id },
      );
    });
  });

  return (
    <Inspector
      header={
        <InspectorHeader
          kind={first?.group?.title ?? '대사 그래프'}
          name={title}
          status={lineCount ? `대사 ${lineCount}줄 · 번역 ${translated}줄` : undefined}
          onClose={onClose}
        />
      }
      loading={loading && !nodes.length}
      flush
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
      {extra}
      {way && way.labels.length > 0 && (
        <Inline as="p" wrap gap="tight" background="sunken" paddingX="comfortable" paddingY="condensed" variant="caption" tone="muted">
          <Icon icon={CornerDownRight} size="sm" aria-label="들어오는 길" />
          {way.labels.map((label, index) => (
            <Chip key={index} variant="pill" tone={label.choice ? 'choice' : undefined}>
              {label.choice ? `▶ ${label.text}` : label.text}
            </Chip>
          ))}
        </Inline>
      )}
      <Box ref={list} position="relative">
        {/* The speaker column's edge: drag to widen or narrow it. */}
        <ColumnResizeHandle
          aria-label="화자 칸 폭"
          style={{ left: width + 16 + 2 }}
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
        <ol>{lines}</ol>
      </Box>
    </Inspector>
  );
}

