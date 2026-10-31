import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CornerDownRight, FileText, Network, Pencil } from 'lucide-react';
import { useGraphShow } from '@/lib/graph-show';
import { Box, ColumnResizeHandle, FlowDisclosure, FlowLine, FlowRow, type FlowShow, Icon, Inline, Inspector, InspectorHeader, Button, SegmentedControl, Skeleton, Text, Chip, Section } from '@loca/ui';
import { LineDetail } from '@/components/line-detail';
import { CopyButton } from '@/components/copy-button';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { KIND_LABEL } from './shapes';
import { TokenText } from '@/components/editor/source-text';
import { tokenPatternOf } from '@/lib/line-context';
import { personStyle, usePersonColors } from '@/lib/person-colors';
import { useGroup } from '@/lib/groups';

/** Scene-graph node. Scene links are derived from the dialogue graph, which the panel says plainly. */
export function SceneNodeDetail({ projectId, groupId, onClose }: { projectId: string; groupId: string; onClose: () => void }) {
  const group = useGroup(projectId, groupId);
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

/** A way into or out of the selected node: the node it joins, and the choice written on the way. */
export interface NodeConnection {
  dir: 'in' | 'out';
  id: string;
  text: string;
  choice?: string;
}

const PANE_VIEWS = [
  { value: 'node', label: '노드' },
  { value: 'flow', label: '흐름' },
] as const;

/**
 * What the dialogue graph's side pane says of the selection. Two views of one thing:
 * - 흐름: the selection's lines read like a script, with the flow before and after it along the way (to a fork, a merge, an end).
 *   The speaker shows where it changes, each line's translation sits under its source, a player's choice is its own row. Clicking a
 *   line (a pen shows on hover) opens it in the card beside the graph node; Enter on the canvas opens the first untranslated one.
 * - 노드: what the node is (kind, key, scene), its lines as folded rows that open to each line's details, and what it joins.
 * What the cards and the lines show (source, translation, both) is the canvas's setting, not this pane's.
 */
export function FlowPane({ projectId, nodeIds, ownIds = nodeIds, title, way, extra, marked, editing, onEdit, onClose, view, onView, around, onMore, connections = [], onSelectNode }: {
  projectId: string;
  /** The nodes whose lines the flow view lists: the selection's own, and the flow before and after it. */
  nodeIds: string[];
  /** The selection's own nodes (a node, or the nodes of a folded run). */
  ownIds?: string[];
  title: string;
  /** The choices and conditions on the way in (nearest last); `merged` when several ways arrive. */
  way?: { labels: { text: string; choice: boolean }[]; merged: boolean };
  /** Sections above the lines (the path view's other choices and loops). */
  extra?: ReactNode;
  /** A node inside the run that was asked for (from a line), or the selection's nodes when flow is shown around it: their rows are marked and scrolled to. */
  marked?: string | string[];
  /** The line open in the translation card: its row is marked and kept in view. */
  editing?: string;
  onEdit: (unitId: string) => void;
  onClose: () => void;
  view: 'node' | 'flow';
  onView: (next: 'node' | 'flow') => void;
  /** Flow view: where the flow before and after the selection stops (a fork, a merge, an end), and whether it goes on. */
  around?: { before: { stop?: string; more: boolean }; after: { stop?: string; more: boolean } };
  onMore?: (side: 'before' | 'after') => void;
  connections?: NodeConnection[];
  onSelectNode?: (id: string) => void;
}) {
  const [speakerWidth, setSpeakerWidth] = useSpeakerWidth();
  const [show] = useGraphShow();
  // Format tokens read as numbered chips, as in the script.
  const project = useQuery(q.project(projectId));
  const tokens = tokenPatternOf(project.data?.formatRules ?? undefined);
  const list = useRef<HTMLDivElement>(null);
  const results = useQueries({ queries: nodeIds.map((id) => q.graphNode(id)) });
  const nodes = results.flatMap((result) => (result.data ? [result.data] : []));
  const loading = results.some((result) => result.isPending);
  const own = new Set(ownIds);
  const ownNodes = nodes.filter((node) => own.has(node.id));
  const first = ownNodes.find((node) => node.units.length) ?? nodes.find((node) => node.units.length);
  const head = ownNodes[0];
  const lineCount = ownNodes.reduce((sum, node) => sum + (node.kind === 'choice' ? 0 : node.units.length), 0);
  const translated = ownNodes.reduce((sum, node) => sum + (node.kind === 'choice' ? 0 : node.units.filter((unit) => unit.translation).length), 0);
  const markedIds = new Set(Array.isArray(marked) ? marked : marked ? [marked] : []);
  // Scrolled to once, when the lines of the asked-for node have arrived.
  const ready = !results.some((result) => result.isPending);
  useEffect(() => {
    if (ready && view === 'flow' && markedIds.size) list.current?.querySelector('[data-marked]')?.scrollIntoView({ block: 'center' });
  }, [ready, view, [...markedIds].join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ready && editing) list.current?.querySelector('[data-editing]')?.scrollIntoView({ block: 'nearest' });
  }, [ready, editing]);
  useReportView('graph-node', [nodes[0] && { kind: '그래프', id: ownIds.join(','), label: title }]);

  // A table: who | what, one row per line; a choice and a condition are rows of their own. The
  // speaker column fits the longest name until someone drags its edge (then that width is kept).
  const colorOf = usePersonColors(projectId);
  const speakers = nodes.flatMap((node) => node.units.map((unit) => unit.speaker ?? '지문·문구'));
  const fitted = Math.min(180, Math.max(56, ...speakers.map((name) => name.length * 7 + 8)));
  const width = speakerWidth ?? fitted;
  const columns = { gridTemplateColumns: `${width}px minmax(0,1fr)` };
  const who = (speaker: string | null | undefined) => (speaker ? <span style={personStyle(colorOf(speaker))}>{speaker}</span> : '지문·문구');
  const lineText = (unit: { source: string; translation: string | null }, clamp = false) => (
    <FlowLine
      show={show}
      clamp={clamp}
      source={<TokenText text={unit.source} source={unit.source} pattern={tokens} />}
      translation={unit.translation ? <TokenText text={unit.translation} source={unit.source} pattern={tokens} /> : null}
    />
  );
  const row = (key: string, whoCell: ReactNode, what: ReactNode, options: { tint?: 'choice' | 'muted' | 'here'; scrollTo?: boolean; unitId?: string } = {}) => (
    <FlowRow
      key={key}
      who={whoCell}
      what={what}
      editable={Boolean(options.unitId)}
      editing={Boolean(options.unitId && options.unitId === editing)}
      tint={options.tint}
      data-marked={options.scrollTo || undefined}
      data-editing={(options.unitId && options.unitId === editing) || undefined}
      style={columns}
      tabIndex={options.unitId ? 0 : undefined}
      onClick={options.unitId ? () => onEdit(options.unitId!) : undefined}
      onKeyDown={options.unitId ? (event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onEdit(options.unitId!); } : undefined}
    />
  );
  const lines = nodes.flatMap((node) => {
    const choice = node.units[0];
    // The selection's own rows are marked only where there is flow around them to tell them from.
    const here = markedIds.has(node.id) && !editing;
    if (node.kind === 'choice')
      return [
        row(
          node.id,
          '선택지',
          <>
            <Text as="p" weight="medium" tone="choice">▶ {choice?.source ?? node.label ?? node.key}</Text>
            {choice?.translation && <Text as="p" tone="muted">{choice.translation}</Text>}
          </>,
          { tint: here ? 'here' : 'choice', scrollTo: here, unitId: choice?.id },
        ),
      ];
    if (!node.units.length) return [row(node.id, KIND_LABEL[node.kind] ?? node.kind, <Text tone="muted">{node.label ?? node.typeInfo?.label ?? ''}</Text>, { tint: 'muted' })];
    return node.units.map((unit) => row(unit.id, who(unit.speaker), lineText(unit), { tint: here ? 'here' : undefined, scrollTo: here, unitId: unit.id }));
  });

  const note = (text: string) => <Text as="p" variant="caption" tone="muted" paddingX="comfortable" paddingY="condensed" background="sunken">{text}</Text>;
  const more = (side: 'before' | 'after') => (
    <Box paddingX="comfortable" paddingY="condensed">
      <Button variant="ghost" onClick={() => onMore?.(side)}>{side === 'before' ? '앞 대사 더 보기' : '뒤 대사 더 보기'}</Button>
    </Box>
  );

  return (
    <Inspector
      header={
        <InspectorHeader
          kind={head ? (
            <Inline as="span" gap="tight" minWidth={0}>
              <Text minWidth={0} truncate title={head.typeInfo?.label ?? undefined}>
                {KIND_LABEL[head.kind] ?? head.kind} · <Text mono>{head.key}</Text>{ownNodes.length > 1 ? ` 외 ${ownNodes.length - 1}개` : ''}
              </Text>
              <CopyButton value={head.key} label="노드 키 복사" tip={head.key} />
            </Inline>
          ) : '대사 그래프'}
          name={title}
          status={first?.group || lineCount > 1 ? [first?.group?.title, lineCount > 1 && `대사 ${lineCount}줄 · 번역 ${translated}줄`].filter(Boolean).join(' · ') : undefined}
          actions={<>
            {/* The script screen is one icon away; the pane keeps its height for the lines. */}
            {first?.group && (
              <Button variant="ghost" size="icon-sm" asChild aria-label="번역 화면에서 열기" title="번역 화면에서 열기">
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: first.group.id, line: first.units[0]?.id }}>
                  <FileText />
                </Link>
              </Button>
            )}
            <SegmentedControl ariaLabel="패널 보기" value={view} onChange={(next) => onView(next as 'node' | 'flow')} items={PANE_VIEWS.map((item) => ({ ...item }))} />
          </>}
          onClose={onClose}
        />
      }
      loading={loading && !nodes.length}
      flush
    >
      {view === 'node' ? (
        <NodeView projectId={projectId} nodes={ownNodes} columns={columns} who={who} lineText={lineText} connections={connections} onSelectNode={onSelectNode} onEdit={onEdit} />
      ) : (
        <>
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
          {around?.before.more && more('before')}
          {around?.before.stop && note(around.before.stop)}
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
          {around?.after.stop && note(around.after.stop)}
          {around?.after.more && more('after')}
        </>
      )}
    </Inspector>
  );
}

/**
 * The node view (what the node is and its key are in the header): the nodes it joins as one row of chips, then its line, open
 * at once with the line's own sections, or its lines as folded rows when there are several.
 */
function NodeView({ projectId, nodes, columns, who, lineText, connections, onSelectNode, onEdit }: {
  projectId: string;
  nodes: { id: string; key: string; kind: string; label: string | null; group?: { title: string } | null; typeInfo?: { label?: string | null } | null; units: { id: string; speaker: string | null; source: string; translation: string | null }[] }[];
  columns: React.CSSProperties;
  who: (speaker: string | null | undefined) => ReactNode;
  lineText: (unit: { source: string; translation: string | null }, clamp?: boolean) => ReactNode;
  connections: NodeConnection[];
  onSelectNode?: (id: string) => void;
  onEdit: (unitId: string) => void;
}) {
  const [aiNode, setAiNode] = useState<string>();
  const units = nodes.filter((node) => node.kind !== 'choice').flatMap((node) => node.units);
  if (!nodes[0]) return null;
  const fix = (unitId: string) => (
    <Button variant="outline" onClick={() => onEdit(unitId)}>
      <Pencil /> 이 줄 고치기
    </Button>
  );
  const only = units.length === 1 ? units[0] : undefined;
  return (
    <>
      {connections.length > 0 && (
        <Inline as="ul" wrap gap="tight" paddingX="comfortable" paddingY="condensed" border="bottom" aria-label="이어진 노드">
          {connections.map((connection, index) => (
            <li key={`${connection.dir}:${connection.id}:${index}`}>
              <Button variant="ghost" size="row" onClick={() => onSelectNode?.(connection.id)}>
                <Chip variant="pill">{connection.dir === 'in' ? '앞' : '뒤'}</Chip>
                {connection.choice && <Chip variant="pill" tone="choice">▶ {connection.choice}</Chip>}
                <Text minWidth={0} truncate>{connection.text}</Text>
              </Button>
            </li>
          ))}
        </Inline>
      )}
      {only ? (
        <>
          <Box paddingX="comfortable" paddingY="condensed" spaceY="condensed">
            {lineText(only)}
            {fix(only.id)}
          </Box>
          <LineDetail bare projectId={projectId} unitId={only.id} aiNode={aiNode} onAiNode={setAiNode} />
        </>
      ) : units.length > 0 && (
        <Box>
          <Text as="h3" variant="label" paddingX="comfortable" paddingY="condensed">대사 {units.length}줄</Text>
          <ol>
            {units.map((unit) => (
              <li key={unit.id}>
                <FlowDisclosure who={who(unit.speaker)} what={lineText(unit, true)} columns={columns}>
                  <Box paddingX="comfortable" paddingY="condensed">{fix(unit.id)}</Box>
                  <LineDetail bare projectId={projectId} unitId={unit.id} aiNode={aiNode} onAiNode={setAiNode} />
                </FlowDisclosure>
              </li>
            ))}
          </ol>
        </Box>
      )}
    </>
  );
}
