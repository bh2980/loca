import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { HeaderActions, Page } from '@/components/page';
import { ReadingRouteGraph } from '@/components/graph/reading-route-graph';
import { RouteList } from '@/components/graph/route-list';
import { RunDialog } from '@/components/workflow/run-dialog';
import { Button, CanvasDirectionControl, GraphEndpointBar, GraphScriptSplit, Inline, Spinner, Stack, Text } from '@loca/ui';
import type { GraphEndpointStep } from '@loca/ui';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

/** Route translation view: single-line route graph on the left, linear script editor on the right. */
export function PathMode({ projectId, toggle, start, end, via: externalVia, onViaChange, direction, onDirectionChange, edit, onBeginPicking, onClear, onEdit }: {
  projectId: string;
  toggle: ReactNode;
  start?: string;
  end?: string;
  via?: string;
  onViaChange?: (via: string) => void;
  direction: 'vertical' | 'horizontal';
  onDirectionChange: (direction: 'vertical' | 'horizontal') => void;
  edit?: string;
  onBeginPicking: (step: GraphEndpointStep) => void;
  onClear: () => void;
  onEdit: (unitId: string | undefined) => void;
}) {
  const selectedIds = [...new Set([start, end].filter((id): id is string => Boolean(id)))];
  const selectedDetails = useQueries({ queries: selectedIds.map((id) => q.graphNode(id, projectId)) });
  const detailById = useMemo(() => new Map(selectedIds.map((id, index) => {
    const detail = selectedDetails[index]?.data;
    return [id, detail?.projectId === projectId ? detail : undefined] as const;
  })), [selectedIds.join('|'), selectedDetails, projectId]);

  const endpointValue = (id?: string, role: GraphEndpointStep = 'start') => {
    if (!id) return undefined;
    const detail = detailById.get(id);
    if (!detail) return undefined;
    if (detail.units.length === 0) {
      const label = detail.label ?? detail.key;
      return { id, label };
    }
    const unit = role === 'start' ? detail.units[0] : detail.units[detail.units.length - 1];
    const source = unit?.source ?? detail.label ?? detail.key;
    const text = source.replace(/\s+/g, ' ').trim();
    const label = `${unit?.speaker?.trim() ? `${unit.speaker.trim()}: ` : ''}${text}${detail.units.length > 1 ? ` · ${detail.units.length}줄` : ''}`;
    return { id, label };
  };

  const startValue = endpointValue(start, 'start');
  const endValue = endpointValue(end, 'end');
  const reportEndpoint = (value: { id: string; label: string } | undefined, role: GraphEndpointStep) =>
    value && ({ kind: role === 'start' ? '경로 시작' : '경로 끝', id: value.id, label: value.label, detail: JSON.stringify({ nodeId: value.id }) });
  useReportView('reading-route', [reportEndpoint(startValue, 'start'), reportEndpoint(endValue, 'end')]);

  const viaStorageKey = start && end ? `tw.route.via.${projectId}.${start}:${end}` : null;
  const [internalVia, setInternalVia] = useState<string>(() => (viaStorageKey ? sessionStorage.getItem(viaStorageKey) ?? '' : ''));

  useEffect(() => {
    if (viaStorageKey) {
      setInternalVia(sessionStorage.getItem(viaStorageKey) ?? '');
    } else {
      setInternalVia('');
    }
  }, [viaStorageKey]);

  const activeVia = externalVia !== undefined ? externalVia : internalVia;

  const handlePickFork = (forkNodeId: string, targetId: string) => {
    const parts = (activeVia || '').split(',').map((p) => p.trim()).filter(Boolean);
    let replaced = false;
    const nextParts = parts.map((part) => {
      if (part.startsWith(`${forkNodeId}:`)) {
        replaced = true;
        return `${forkNodeId}:${targetId}`;
      }
      return part;
    });
    if (!replaced) {
      nextParts.push(`${forkNodeId}:${targetId}`);
    }
    const nextVia = nextParts.join(',');
    if (viaStorageKey) {
      try {
        sessionStorage.setItem(viaStorageKey, nextVia);
      } catch {
        // ignore unavailable storage
      }
    }
    setInternalVia(nextVia);
    onViaChange?.(nextVia);
  };

  const handleClear = () => {
    if (viaStorageKey) {
      try {
        sessionStorage.removeItem(viaStorageKey);
      } catch {
        // ignore unavailable storage
      }
    }
    setInternalVia('');
    onClear();
  };

  const route = useQuery({ ...q.readingRoute(projectId, { start, end, via: activeVia || undefined }), enabled: Boolean(start && end) });
  const data = route.data;
  const found = data?.status === 'found' && data.start === start && data.end === end;

  return (
    <Page title="경로 대본" flush>
      <HeaderActions>
        {toggle}
        <CanvasDirectionControl direction={direction} onDirectionChange={onDirectionChange} />
        {found && data.sequence.length > 0 && <RunDialog projectId={projectId} unitIds={data.sequence.map((line) => line.unitId)} unitsLabel="경로 대사" />}
      </HeaderActions>
      <Stack height="full" minHeight={0} grow overflow="hidden">
        <GraphEndpointBar
          start={startValue}
          end={endValue}
          step="start"
          picking={false}
          canFind={true}
          busy={route.isFetching}
          status={route.isError ? <Text variant="caption" tone="danger" role="status">경로 확인 실패</Text> : data?.status === 'unreachable' ? <Text variant="caption" tone="muted" role="status">연결되지 않은 구간</Text> : undefined}
          onBeginPicking={onBeginPicking}
          onClear={handleClear}
        />
        {route.isError && (
          <Inline shrink={false} gap="condensed" border="bottom" borderColor="border" background="destructiveFaint" paddingX="normal" paddingY="condensed" variant="body" tone="danger" role="alert">
            <Text minWidth={0} grow truncate>경로를 확인하지 못했습니다.</Text>
            <Button variant="outline" onClick={() => void route.refetch()}>다시 시도</Button>
          </Inline>
        )}
        {found && data.sequence.length > 0 ? (
          <Stack direction="row" height="full" minHeight={0} grow overflow="hidden" data-testid="reading-route" data-route-nodes={data.nodeIds.length}>
            <GraphScriptSplit
              id="reading-route"
              graph={
                <ReadingRouteGraph
                  key={`${start}:${end}:${activeVia}`}
                  projectId={projectId}
                  stages={data.stages}
                  direction={direction}
                  onDirectionChange={onDirectionChange}
                  routeKey={`${start}:${end}`}
                  edit={edit}
                  onEdit={onEdit}
                />
              }
            >
              <RouteList
                key={`${start}:${end}:${activeVia}`}
                projectId={projectId}
                sequence={data.sequence}
                stages={data.stages}
                routeKey={`${start}:${end}`}
                untranslatedIds={data.untranslatedIds}
                edit={edit}
                onEdit={onEdit}
                forks={data.forks}
                onPickFork={handlePickFork}
              />
            </GraphScriptSplit>
          </Stack>
        ) : route.isFetching ? (
          <Inline height="full" justify="center" gap="condensed" variant="body" tone="muted">
            <Spinner /> 경로를 확인하는 중…
          </Inline>
        ) : null}
      </Stack>
    </Page>
  );
}
