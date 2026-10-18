import { eq } from 'drizzle-orm';
import { findReadingRouteOutputSchema, type FindReadingRouteInput, type FindReadingRouteOutput } from '@tw/shared';
import { HTTPException } from 'hono/http-exception';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { projectReadingRoute } from './reading-route.ts';

type UnitRef = { id: string; key: string; seq: number; source: string; translation: string | null; speaker: string | null };
type Endpoint = { nodeId: string; key: string; source: string; speaker?: string };

/** Read-only chat adapter: resolve human-facing endpoint refs, then use the browser's route service. */
export function findReadingRoute(db: Db, projectId: string, input: FindReadingRouteInput): FindReadingRouteOutput {
  const units = db.select({ id: s.units.id, key: s.units.key, seq: s.units.seq, source: s.units.source, translation: s.units.translation, speaker: s.units.speaker })
    .from(s.units).where(eq(s.units.projectId, projectId)).all().sort((a, b) => a.seq - b.seq);
  const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key, label: s.graphNodes.label, unitIds: s.graphNodes.unitIds })
    .from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId })
    .from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const findAttachedChildUnit = (startNodeId: string, boundary: 'start' | 'end'): UnitRef | null => {
    const q = [startNodeId];
    const seen = new Set<string>([startNodeId]);
    const foundUnits: UnitRef[] = [];
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const e of edges) {
        if (e.fromId === cur && !seen.has(e.toId)) {
          seen.add(e.toId);
          const childNode = nodesById.get(e.toId);
          if (childNode) {
            for (const uId of childNode.unitIds) {
              const u = unitsById.get(uId);
              if (u) foundUnits.push(u);
            }
            q.push(e.toId);
          }
        }
      }
    }
    if (foundUnits.length === 0) return null;
    foundUnits.sort((a, b) => a.seq - b.seq);
    return boundary === 'start' ? foundUnits[0]! : foundUnits.at(-1)!;
  };

  const resolve = (reference: string, boundary: 'start' | 'end'): { nodeId: string; unit: UnitRef } | { error: string } => {
    const matchedUnits = units.filter((unit) => unit.id === reference || unit.key === reference);
    const matchedNodes = nodes.filter((node) => node.id === reference || node.key === reference);

    if (matchedUnits.length === 0 && matchedNodes.length === 0) {
      const refLower = reference.trim().toLowerCase();
      if (!refLower) return { error: '검색어를 입력하세요.' };

      const subUnits = units.filter(
        (u) =>
          u.source.toLowerCase().includes(refLower) ||
          (u.translation && u.translation.toLowerCase().includes(refLower)),
      );
      const subNodes = nodes.filter(
        (n) => n.label && n.label.toLowerCase().includes(refLower),
      );

      if (subUnits.length === 0 && subNodes.length === 0) {
        return { error: `프로젝트에서 “${reference}”에 해당하는 대사 노드를 찾지 못했습니다. find_lines 또는 line_context로 먼저 확인하세요.` };
      }

      type MatchCandidate = { nodeId: string; seq: number; unit?: UnitRef };
      const candidates: MatchCandidate[] = [];

      for (const u of subUnits) {
        for (const n of nodes) {
          if (n.unitIds.includes(u.id)) {
            candidates.push({ nodeId: n.id, seq: u.seq, unit: u });
          }
        }
      }
      for (const n of subNodes) {
        const u = n.unitIds.map((id) => unitsById.get(id)).filter(Boolean)[0] ?? findAttachedChildUnit(n.id, boundary);
        candidates.push({ nodeId: n.id, seq: u?.seq ?? 0, unit: u ?? undefined });
      }

      if (candidates.length === 0) {
        return { error: `프로젝트에서 “${reference}”에 해당하는 대사 노드를 찾지 못했습니다. find_lines 또는 line_context로 먼저 확인하세요.` };
      }

      candidates.sort((a, b) => a.seq - b.seq);
      const picked = boundary === 'start' ? candidates[0]! : candidates.at(-1)!;
      const node = nodesById.get(picked.nodeId)!;
      const unit = picked.unit ?? { id: node.id, key: node.key, seq: 0, source: node.label ?? node.key, translation: null, speaker: null };
      return { nodeId: picked.nodeId, unit };
    }

    const nodeIds = new Set<string>();
    for (const node of matchedNodes) nodeIds.add(node.id);
    for (const unit of matchedUnits) {
      for (const node of nodes) {
        if (node.unitIds.includes(unit.id)) nodeIds.add(node.id);
      }
    }

    if (nodeIds.size > 1 || matchedUnits.length > 1) {
      return { error: `“${reference}”가 여러 대사 노드에 해당합니다. find_lines 또는 line_context로 대사 키를 확인하세요.` };
    }
    const nodeId = [...nodeIds][0];
    if (!nodeId) return { error: `프로젝트에서 “${reference}”에 해당하는 대사 노드를 찾지 못했습니다. find_lines 또는 line_context로 먼저 확인하세요.` };

    const node = nodesById.get(nodeId)!;
    const nodeUnits = node.unitIds.map((id) => unitsById.get(id)).filter((unit): unit is UnitRef => Boolean(unit));
    const unit: UnitRef = (boundary === 'start' ? nodeUnits[0] : nodeUnits.at(-1))
      ?? findAttachedChildUnit(node.id, boundary)
      ?? {
        id: node.id,
        key: node.key,
        seq: 0,
        source: node.label ?? node.key,
        translation: null,
        speaker: null,
      };

    return { nodeId, unit };
  };

  const start = resolve(input.start, 'start');
  if ('error' in start) return { ok: false, error: start.error };
  const end = resolve(input.end, 'end');
  if ('error' in end) return { ok: false, error: end.error };
  let route: ReturnType<typeof projectReadingRoute>;
  try {
    route = projectReadingRoute(db, projectId, { start: start.nodeId, end: end.nodeId });
  } catch (error) {
    if (error instanceof HTTPException) return { ok: false, error: error.message };
    throw error;
  }
  if (route.status !== 'found') return { ok: false, error: '선택한 구간을 하나의 이야기로 연결할 수 없습니다. 연결이 없거나 함께 실행되는 갈래가 끝 대사에 합류하지 않습니다.' };

  const endpoint = (nodeId: string, unit: UnitRef): Endpoint => ({ nodeId, key: unit.key, source: unit.source, ...(unit.speaker && { speaker: unit.speaker }) });
  return findReadingRouteOutputSchema.parse({
    ok: true,
    label: '선택한 구간 · 단일 경로',
    start: endpoint(start.nodeId, start.unit),
    end: endpoint(end.nodeId, end.unit),
    lineCount: route.sequence.length,
    stageCount: route.stages.length,
    parallelStageCount: route.stages.filter((stage) => stage.parallel).length,
    open: {
      to: '/p/$projectId/graph',
      search: { scope: 'dialogue', routeStart: start.nodeId, routeEnd: end.nodeId },
    },
  });
}
