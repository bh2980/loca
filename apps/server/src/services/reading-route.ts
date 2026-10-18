import { eq } from 'drizzle-orm';
import type { ReadingRouteFork, ReadingRouteForkOption } from '@tw/shared';
export type { ReadingRouteFork, ReadingRouteForkOption };
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { badRequest, found } from '../http-errors.ts';
import { routeGraph } from './route-slice.ts';

export interface ReadingNode { id: string; key: string; kind?: string; unitIds: string[]; label?: string | null }
export interface ReadingEdge { from: string; to: string; label: string | null }
export interface ReadingUnit { id: string; seq: number; source: string; translation?: string | null; speaker?: string | null }
export interface ReadingRouteInput { start?: string; end?: string; picks?: Record<string, string>; via?: string }
export interface ReadingStage { id: string; nodeIds: string[]; unitIds: string[]; parallel: boolean }

function parsePicks(input: ReadingRouteInput, byKey: Map<string, ReadingNode>): Record<string, string> {
  const picks: Record<string, string> = { ...(input.picks ?? {}) };
  if (input.via) {
    const parts = input.via.split(',').map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes(':')) {
        const [nodeRef, targetRef] = part.split(':').map((s) => s.trim());
        const nodeId = byKey.get(nodeRef)?.id ?? nodeRef;
        const targetId = byKey.get(targetRef)?.id ?? targetRef;
        if (nodeId && targetId) picks[nodeId] = targetId;
      } else {
        const targetId = byKey.get(part)?.id ?? part;
        picks[targetId] = targetId;
        picks[`target:${targetId}`] = targetId;
      }
    }
  }
  return picks;
}

function findFirstUnitInBranch(
  startNodeId: string,
  forwardEdges: ReadingEdge[],
  byId: Map<string, ReadingNode>,
  byUnit: Map<string, ReadingUnit>,
  maxHops = 2,
): { unit: ReadingUnit; nodeId: string } | null {
  const startNode = byId.get(startNodeId);
  if (startNode?.unitIds) {
    const uId = startNode.unitIds.find((u) => byUnit.has(u));
    if (uId) return { unit: byUnit.get(uId)!, nodeId: startNodeId };
  }
  if (maxHops <= 0) return null;
  const queue: { nodeId: string; hops: number }[] = [{ nodeId: startNodeId, hops: 0 }];
  const seen = new Set<string>([startNodeId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.hops >= maxHops) continue;
    const outs = forwardEdges.filter((e) => e.from === cur.nodeId).map((e) => e.to);
    for (const nextId of outs) {
      if (!seen.has(nextId)) {
        seen.add(nextId);
        const node = byId.get(nextId);
        if (node?.unitIds) {
          const uId = node.unitIds.find((u) => byUnit.has(u));
          if (uId) return { unit: byUnit.get(uId)!, nodeId: nextId };
        }
        queue.push({ nodeId: nextId, hops: cur.hops + 1 });
      }
    }
  }
  return null;
}

function makeForkOption(
  current: string,
  targetId: string,
  optionIndex: number,
  edgeMap: Map<string, string | null>,
  forwardEdges: ReadingEdge[],
  byId: Map<string, ReadingNode>,
  byUnit: Map<string, ReadingUnit>,
): ReadingRouteForkOption {
  const targetNode = byId.get(targetId);
  const edgeLabel = edgeMap.get(`${current}:${targetId}`)?.trim() ?? '';
  const rawLabel = edgeLabel || targetNode?.label?.trim() || targetNode?.key || targetId;

  const firstUnit = findFirstUnitInBranch(targetId, forwardEdges, byId, byUnit, 2);
  let preview = '';
  if (firstUnit) {
    const u = firstUnit.unit;
    preview = u.speaker ? `${u.speaker}: ${u.source}` : u.source;
  }
  if (!preview) {
    preview = rawLabel;
  }

  let label = rawLabel;
  if (!targetNode?.label?.trim() || targetNode.label.trim().startsWith('Sibling') || rawLabel.startsWith('Sibling')) {
    label = preview && preview !== rawLabel ? preview : `선택지 ${optionIndex + 1}`;
  }

  return { targetId, label, preview };
}

/** A finite story between endpoints: single-line linear story path with branch switching and leaf threading. */
export function readingRoute(nodes: ReadingNode[], edges: ReadingEdge[], units: ReadingUnit[], input: ReadingRouteInput = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const byUnit = new Map(units.map((unit) => [unit.id, unit]));
  const start = input.start ?? null, end = input.end ?? null;
  const empty = (status: 'needs-endpoints' | 'unreachable') => ({
    status,
    start,
    end,
    nodeIds: [] as string[],
    sequence: [] as { unitId: string; nodeId: string }[],
    stages: [] as ReadingStage[],
    untranslatedIds: [] as string[],
    forks: [] as ReadingRouteFork[],
  });

  for (const id of [start, end]) if (id && !byId.has(id)) badRequest('시작과 끝은 이 프로젝트의 대사 노드에서 선택하세요.');
  if (!start || !end) return empty('needs-endpoints');

  // Filter out explicit subroutine return edges (e.g. 'Emerge 0') from normal forward edges
  const forwardEdges = edges.filter((e) => !e.label?.trim().startsWith('Emerge'));

  function endpointHasText(nodeId: string, otherId: string): boolean {
    const node = byId.get(nodeId);
    if (!node) return false;
    if (node.unitIds.some((u) => byUnit.has(u))) return true;
    const candidateEdges = forwardEdges.filter((e) => e.from === nodeId && e.to !== otherId);
    for (const edge of candidateEdges) {
      const q = [edge.to];
      const seen = new Set<string>([edge.to]);
      while (q.length > 0) {
        const cur = q.shift()!;
        if (cur === otherId) continue;
        const child = byId.get(cur);
        if (child?.unitIds.some((u) => byUnit.has(u))) return true;
        for (const e of forwardEdges) {
          if (e.from === cur && !seen.has(e.to)) {
            seen.add(e.to);
            q.push(e.to);
          }
        }
      }
    }
    return false;
  }

  if (!endpointHasText(start, end) || !endpointHasText(end, start)) {
    badRequest('시작과 끝은 이 프로젝트의 대사 노드에서 선택하세요.');
  }

  if (start === end) {
    const startNode = byId.get(start);
    const startUnits = (startNode?.unitIds ?? []).filter((u) => byUnit.has(u));
    const stages: ReadingStage[] = startUnits.length
      ? [{ id: start, nodeIds: [start], unitIds: startUnits, parallel: false }]
      : [];
    const sequence = startUnits.map((unitId) => ({ unitId, nodeId: start }));
    const untranslatedIds = sequence
      .filter(({ unitId }) => !byUnit.get(unitId)?.translation?.trim())
      .map(({ unitId }) => unitId);
    return {
      status: 'found' as const,
      start,
      end,
      nodeIds: [start],
      sequence,
      stages,
      untranslatedIds,
      forks: [] as ReadingRouteFork[],
    };
  }

  const semantics = routeGraph(nodes.map((node) => ({ ...node, kind: node.kind ?? 'script' })), edges, byUnit);

  const out = new Map<string, Set<string>>();
  const edgeMap = new Map<string, string | null>();
  for (const node of nodes) out.set(node.id, new Set<string>());
  for (const edge of forwardEdges) {
    if (out.has(edge.from) && out.has(edge.to)) {
      out.get(edge.from)!.add(edge.to);
      edgeMap.set(`${edge.from}:${edge.to}`, edge.label);
    }
  }

  // Pass A: Unlabeled branches with labeled non-Submerge continuations
  const passAEdges: { from: string; to: string }[] = [];
  for (const p of nodes) {
    const pTargets = [...(out.get(p.id) ?? [])];
    const unlabeled = pTargets.filter((to) => !edgeMap.get(`${p.id}:${to}`)?.trim());
    const labeledNonSub = pTargets.filter((to) => {
      const l = edgeMap.get(`${p.id}:${to}`)?.trim();
      return l && !l.startsWith('Submerge') && l !== 'synthetic';
    });

    if (unlabeled.length > 0 && labeledNonSub.length > 0) {
      const contTargets = labeledNonSub;
      for (const uTo of unlabeled) {
        const visited = new Set<string>();
        const queue = [uTo];
        let loopsBack = false;
        while (queue.length && visited.size <= 60) {
          const cur = queue.shift()!;
          if (visited.has(cur) || cur === p.id) continue;
          visited.add(cur);
          for (const next of out.get(cur) ?? []) {
            if (next === p.id) {
              loopsBack = true;
              break;
            }
            if (!visited.has(next)) queue.push(next);
          }
          if (loopsBack) break;
        }
        if (!loopsBack && visited.size <= 60 && !contTargets.some((t) => visited.has(t))) {
          for (const v of visited) {
            const vOuts = [...(out.get(v) ?? [])];
            if (vOuts.length === 0) {
              for (const t of contTargets) {
                passAEdges.push({ from: v, to: t });
              }
            }
          }
        }
      }
    }
  }
  for (const e of passAEdges) {
    out.get(e.from)!.add(e.to);
    if (!edgeMap.has(`${e.from}:${e.to}`)) edgeMap.set(`${e.from}:${e.to}`, 'synthetic');
  }

  // Pass B: Submerge branches connected to non-Submerge continuation targets
  const passBEdges: { from: string; to: string }[] = [];
  for (const p of nodes) {
    const pTargets = [...(out.get(p.id) ?? [])];
    const submerge = pTargets.filter((to) => edgeMap.get(`${p.id}:${to}`)?.trim().startsWith('Submerge'));
    const nonSub = pTargets.filter(
      (to) => !edgeMap.get(`${p.id}:${to}`)?.trim().startsWith('Submerge') && edgeMap.get(`${p.id}:${to}`) !== 'synthetic',
    );

    if (submerge.length > 0 && nonSub.length > 0) {
      const contTargets = nonSub;
      for (const sTo of submerge) {
        const visited = new Set<string>();
        const queue = [sTo];
        let loopsBack = false;
        while (queue.length && visited.size <= 100) {
          const cur = queue.shift()!;
          if (visited.has(cur) || cur === p.id) continue;
          visited.add(cur);
          for (const next of out.get(cur) ?? []) {
            if (next === p.id) {
              loopsBack = true;
              break;
            }
            if (!visited.has(next)) queue.push(next);
          }
          if (loopsBack) break;
        }
        if (!loopsBack && visited.size <= 100) {
          for (const v of visited) {
            const vOuts = [...(out.get(v) ?? [])];
            if (vOuts.length === 0) {
              for (const t of contTargets) {
                passBEdges.push({ from: v, to: t });
              }
            }
          }
        }
      }
    }
  }
  for (const e of passBEdges) {
    out.get(e.from)!.add(e.to);
    if (!edgeMap.has(`${e.from}:${e.to}`)) edgeMap.set(`${e.from}:${e.to}`, 'synthetic');
  }

  // Pass C: General bounded leaf text subgraphs
  const hasText = (nodeId: string) =>
    (byId.get(nodeId)?.unitIds ?? []).some((u) => byUnit.has(u));

  const passCEdges: { from: string; to: string }[] = [];
  for (const p of nodes) {
    const targets = [...(out.get(p.id) ?? [])];
    if (targets.length < 2) continue;

    for (const t of targets) {
      if (t === p.id) continue;
      const visited = new Set<string>();
      const queue = [t];
      let otherTargetsReached = false;
      let loopsBack = false;

      while (queue.length && visited.size <= 45) {
        const cur = queue.shift()!;
        if (visited.has(cur) || cur === p.id) continue;
        visited.add(cur);
        for (const next of out.get(cur) ?? []) {
          if (next === p.id) {
            loopsBack = true;
            break;
          }
          if (targets.some((ot) => ot !== t && ot === next)) {
            otherTargetsReached = true;
            break;
          }
          if (!visited.has(next)) queue.push(next);
        }
        if (loopsBack || otherTargetsReached) break;
      }

      if (!loopsBack && !otherTargetsReached && visited.size <= 45) {
        const containsText = [...visited].some((id) => hasText(id));
        if (!containsText) continue;

        const leaves: string[] = [];
        for (const v of visited) {
          const vOuts = [...(out.get(v) ?? [])];
          if (vOuts.length === 0) leaves.push(v);
        }

        if (leaves.length > 0) {
          const continuationTargets = targets.filter((ot) => {
            if (ot === t || ot === p.id) return false;
            const checkQ = [ot];
            const checkSeen = new Set<string>([ot]);
            while (checkQ.length && checkSeen.size <= 50) {
              const c = checkQ.shift()!;
              if (c === p.id) return false;
              for (const n of out.get(c) ?? []) {
                if (n === p.id) return false;
                if (!checkSeen.has(n)) {
                  checkSeen.add(n);
                  checkQ.push(n);
                }
              }
            }
            return true;
          });

          for (const leaf of leaves) {
            for (const cont of continuationTargets) {
              passCEdges.push({ from: leaf, to: cont });
            }
          }
        }
      }
    }
  }
  for (const e of passCEdges) {
    out.get(e.from)!.add(e.to);
    if (!edgeMap.has(`${e.from}:${e.to}`)) edgeMap.set(`${e.from}:${e.to}`, 'synthetic');
  }

  // Build incoming adjacency (before)
  const before = new Map<string, string[]>();
  for (const node of nodes) before.set(node.id, []);
  for (const [from, targets] of out) {
    for (const to of targets) {
      before.get(to)!.push(from);
    }
  }
  for (const incoming of before.values()) incoming.sort(semantics.bySeq);

  // Step 2: Backward BFS reachability (distToEnd)
  const computeDistTo = (target: string): Map<string, number> => {
    const dist = new Map<string, number>([[target, 0]]);
    const q = [target];
    for (let i = 0; i < q.length; i++) {
      const cur = q[i]!;
      const d = dist.get(cur)!;
      for (const parent of before.get(cur) ?? []) {
        if (!dist.has(parent)) {
          dist.set(parent, d + 1);
          q.push(parent);
        }
      }
    }
    return dist;
  };

  let distToEnd = computeDistTo(end);
  let pathStart = start;
  let pathEnd = end;

  // Lifting start / end if disconnected
  if (!distToEnd.has(start)) {
    const getAncestors = (nodeId: string, maxHops = 2): { id: string; hops: number }[] => {
      const res: { id: string; hops: number }[] = [{ id: nodeId, hops: 0 }];
      const q = [{ id: nodeId, hops: 0 }];
      const seen = new Set<string>([nodeId]);
      while (q.length > 0) {
        const { id, hops } = q.shift()!;
        if (hops < maxHops) {
          const parents = forwardEdges.filter((e) => e.to === id).map((e) => e.from);
          for (const p of parents) {
            if (!seen.has(p)) {
              seen.add(p);
              res.push({ id: p, hops: hops + 1 });
              q.push({ id: p, hops: hops + 1 });
            }
          }
        }
      }
      return res;
    };

    const startAncestors = getAncestors(start, 2);
    const endAncestors = getAncestors(end, 2);

    interface CandidatePair { s: string; e: string; totalHops: number }
    const pairs: CandidatePair[] = [];
    for (const sCand of startAncestors) {
      for (const eCand of endAncestors) {
        if (sCand.id === start && eCand.id === end) continue;
        if (sCand.id === eCand.id || sCand.id === end || eCand.id === start) continue;
        pairs.push({ s: sCand.id, e: eCand.id, totalHops: sCand.hops + eCand.hops });
      }
    }
    pairs.sort((a, b) => a.totalHops - b.totalHops);

    for (const pair of pairs) {
      const d = computeDistTo(pair.e);
      if (d.has(pair.s)) {
        pathStart = pair.s;
        pathEnd = pair.e;
        distToEnd = d;
        break;
      }
    }
  }

  if (!distToEnd.has(pathStart)) return empty('unreachable');

  // Step 3: Walk single linear path from pathStart to pathEnd with forks and attached leaf text
  const picks = parsePicks(input, byKey);
  const path: string[] = [pathStart];
  const pathSet = new Set<string>([pathStart]);
  const forks: ReadingRouteFork[] = [];
  let current = pathStart;

  while (current !== pathEnd) {
    const viable = [...(out.get(current) ?? [])].filter(
      (to) => distToEnd.has(to) && !pathSet.has(to),
    );

    if (viable.length === 0) break;

    let chosenTarget: string;

    if (viable.length > 1) {
      const explicitPick = viable.find(
        (t) =>
          picks[current] === t ||
          picks[`target:${t}`] === t ||
          picks[t] === t ||
          (byId.get(t)?.key && picks[byId.get(t)!.key] === t) ||
          (byId.get(t)?.key && picks[`target:${byId.get(t)!.key}`] === byId.get(t)!.key),
      );

      const sorted = [...viable].sort(
        (a, b) => distToEnd.get(a)! - distToEnd.get(b)! || semantics.bySeq(a, b),
      );

      chosenTarget = explicitPick ?? sorted[0]!;

      const options: ReadingRouteForkOption[] = viable.map((targetId, idx) =>
        makeForkOption(current, targetId, idx, edgeMap, forwardEdges, byId, byUnit),
      );

      forks.push({
        nodeId: current,
        label: byId.get(current)?.label ?? null,
        selectedId: chosenTarget,
        options,
      });
    } else {
      chosenTarget = viable[0]!;
    }

    path.push(chosenTarget);
    pathSet.add(chosenTarget);
    current = chosenTarget;
  }

  if (current !== pathEnd) return empty('unreachable');

  const stages: ReadingStage[] = [];
  const nodeIds: string[] = [];
  const sequence: { unitId: string; nodeId: string }[] = [];
  const seenUnits = new Set<string>();

  const appendNode = (nodeId: string) => {
    nodeIds.push(nodeId);
    const n = byId.get(nodeId);
    if (!n) return;
    const unitIds = n.unitIds.filter((u) => byUnit.has(u) && !seenUnits.has(u));
    if (unitIds.length > 0) {
      for (const unitId of unitIds) {
        seenUnits.add(unitId);
        sequence.push({ unitId, nodeId });
      }
      stages.push({
        id: nodeId,
        nodeIds: [nodeId],
        unitIds,
        parallel: false,
      });
    }
  };

  const branchContains = (rootId: string, targetId: string | null | undefined): boolean => {
    if (!targetId) return false;
    if (rootId === targetId) return true;
    const q = [rootId];
    const seen = new Set<string>([rootId]);
    while (q.length > 0) {
      const cur = q.shift()!;
      if (cur === targetId) return true;
      for (const e of forwardEdges) {
        if (e.from === cur && !seen.has(e.to)) {
          seen.add(e.to);
          q.push(e.to);
        }
      }
    }
    return false;
  };

  const leadsToPathSet = (startId: string): boolean => {
    const q = [startId];
    const seen = new Set<string>([startId]);
    while (q.length > 0) {
      const cur = q.shift()!;
      if (pathSet.has(cur)) return true;
      for (const e of forwardEdges) {
        if (e.from === cur && !seen.has(e.to)) {
          seen.add(e.to);
          q.push(e.to);
        }
      }
    }
    return false;
  };

  const deadEndSeen = new Set<string>();

  const traverseDeadEnd = (curr: string) => {
    if (deadEndSeen.has(curr)) return;
    deadEndSeen.add(curr);
    appendNode(curr);
    const outs = [...new Set(forwardEdges.filter((e) => e.from === curr && !pathSet.has(e.to) && !leadsToPathSet(e.to)).map((e) => e.to))];
    if (outs.length === 0) return;
    if (outs.length === 1) {
      traverseDeadEnd(outs[0]!);
      return;
    }
    const explicitPick = outs.find(
      (t) =>
        picks[curr] === t ||
        picks[`target:${t}`] === t ||
        picks[t] === t ||
        (byId.get(t)?.key && picks[byId.get(t)!.key] === t) ||
        (byId.get(t)?.key && picks[`target:${byId.get(t)!.key}`] === byId.get(t)!.key),
    );
    const targetWithEndpoint = outs.find((t) => branchContains(t, start) || branchContains(t, end));
    const sorted = [...outs].sort(semantics.bySeq);
    const chosen = explicitPick ?? targetWithEndpoint ?? sorted[0]!;

    if (!forks.some((f) => f.nodeId === curr)) {
      forks.push({
        nodeId: curr,
        label: byId.get(curr)?.label ?? null,
        selectedId: chosen,
        options: outs.map((t, idx) => makeForkOption(curr, t, idx, edgeMap, forwardEdges, byId, byUnit)),
      });
    }
    traverseDeadEnd(chosen);
  };

  const collectAttachedLeafText = (parentNodeId: string, nextPathNode?: string) => {
    const rawEdges = forwardEdges.filter(
      (e) => e.from === parentNodeId && (nextPathNode === undefined || e.to !== nextPathNode) && !pathSet.has(e.to),
    );
    const deadEndTargets = [...new Set(rawEdges.filter((e) => !leadsToPathSet(e.to)).map((e) => e.to))];
    if (deadEndTargets.length === 0) return;

    if (deadEndTargets.length > 1) {
      const explicitPick = deadEndTargets.find(
        (t) =>
          picks[parentNodeId] === t ||
          picks[`target:${t}`] === t ||
          picks[t] === t ||
          (byId.get(t)?.key && picks[byId.get(t)!.key] === t) ||
          (byId.get(t)?.key && picks[`target:${byId.get(t)!.key}`] === byId.get(t)!.key),
      );
      const targetWithEndpoint = deadEndTargets.find((t) => branchContains(t, start) || branchContains(t, end));
      const sorted = [...deadEndTargets].sort(semantics.bySeq);
      const chosen = explicitPick ?? targetWithEndpoint ?? sorted[0]!;

      if (!forks.some((f) => f.nodeId === parentNodeId)) {
        forks.push({
          nodeId: parentNodeId,
          label: byId.get(parentNodeId)?.label ?? null,
          selectedId: chosen,
          options: deadEndTargets.map((t, idx) => makeForkOption(parentNodeId, t, idx, edgeMap, forwardEdges, byId, byUnit)),
        });
      }
      traverseDeadEnd(chosen);
    } else {
      traverseDeadEnd(deadEndTargets[0]!);
    }
  };

  for (let i = 0; i < path.length; i++) {
    const stepNode = path[i]!;
    appendNode(stepNode);
    if (i < path.length - 1 || (byId.get(stepNode)?.unitIds.length ?? 0) === 0 || (stepNode === pathEnd && pathEnd !== end)) {
      collectAttachedLeafText(stepNode, path[i + 1]);
    }
  }

  if (stages.length === 0 && path.length > 0) {
    for (const nodeId of path) {
      stages.push({
        id: nodeId,
        nodeIds: [nodeId],
        unitIds: [],
        parallel: false,
      });
    }
  }

  const untranslatedIds = sequence
    .filter(({ unitId }) => !byUnit.get(unitId)?.translation?.trim())
    .map(({ unitId }) => unitId);

  return {
    status: 'found' as const,
    start,
    end,
    nodeIds,
    sequence,
    stages,
    untranslatedIds,
    forks,
  };
}

export function projectReadingRoute(db: Db, projectId: string, input: ReadingRouteInput) {
  found(db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');
  const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key, kind: s.graphNodes.kind, label: s.graphNodes.label, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ from: s.graphEdges.fromId, to: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const units = db.select({ id: s.units.id, seq: s.units.seq, source: s.units.source, translation: s.units.translation, speaker: s.units.speaker }).from(s.units).where(eq(s.units.projectId, projectId)).all();
  return readingRoute(nodes, edges, units, input);
}
