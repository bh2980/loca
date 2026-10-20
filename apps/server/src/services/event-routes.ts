import { and, eq, inArray, ne } from 'drizzle-orm';
import type { EventLinkKind, KNOWLEDGE_ORIGINS } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import type { GraphOrder } from './graph-order.ts';
import { graphOrder } from './speech.ts';
import { withTags } from './knowledge-tags.ts';
import { events } from '../events.ts';

/** The nearest choice or condition upstream of a line, which of its ways leads to the line, its label, and whether it is a player's choice (not a condition). */
export type Fork = { point: string; arm: string; label: string | null; choice: boolean } | null;

/**
 * Events as a flow for the 사건 흐름 graph. An event leads to another when the player can go from
 * the first one's line to the second one's in the dialogue graph; only direct steps are kept (if A
 * leads to B and B to C, there is no A → C). One event leads to several only where they part at a
 * single choice or condition (a branch); a choice's ways carry its labels. Anything else — scenes a
 * state opens side by side, events that do not reach each other — gets no line and keeps script
 * order: lines are only drawn from the dialogue graph, never guessed.
 */
export function eventFlow<T extends { id: string; at: { seq: number; key: string } | null }>(order: Pick<GraphOrder, 'leadsTo'>, forkOf: (key: string) => Fork, events: T[]) {
  const placed = events.filter((event) => event.at).sort((a, b) => a.at!.seq - b.at!.seq);
  // Steps in one direction only: lines that reach each other both ways (a loop) are not an order.
  const leads = (a: T, b: T) => a.id !== b.id && order.leadsTo(a.at!.key, b.at!.key) && !order.leadsTo(b.at!.key, a.at!.key);
  const next = new Map<string, { id: string; label: string | null }[]>();
  for (const from of placed) {
    const reached = placed.filter((to) => leads(from, to));
    // Direct steps: reached events no other reached event leads to.
    const direct = reached.filter((to) => !reached.some((via) => via !== to && leads(via, to)));
    // Several ways out are a branch only when they part at one choice or condition. Scenes a
    // state node opens side by side (or that merely all come later) are not: no lines then.
    const forksOut = direct.map((to) => forkOf(to.at!.key));
    const branch = direct.length > 1 && forksOut.every((fork) => fork && fork.point === forksOut[0]!.point) && new Set(forksOut.map((fork) => fork!.arm)).size > 1;
    const steps = direct.length === 1 ? [{ id: direct[0].id, label: null }] : branch ? direct.map((to, i) => ({ id: to.id, label: forksOut[i]!.choice ? forksOut[i]!.label : null })) : [];
    if (steps.length) next.set(from.id, steps);
  }
  return events.map((event) => ({ ...event, next: next.get(event.id) ?? [] }));
}

/**
 * forkOf for a project's dialogue graph: walking back from a line's node, the first node that
 * splits the way (a condition, or a line whose ways out are labelled choices) and the node right
 * after it on the way back. Nodes are looked up by line key.
 */
export function forks(nodes: { id: string; kind: string; unitIds: string[] }[], edges: { fromId: string; toId: string; label: string | null }[], keyOf: Map<string, string>) {
  const outs = new Map<string, { to: string; label: string | null }[]>();
  const ins = new Map<string, string[]>();
  for (const edge of edges) {
    (outs.get(edge.fromId) ?? outs.set(edge.fromId, []).get(edge.fromId)!).push({ to: edge.toId, label: edge.label });
    (ins.get(edge.toId) ?? ins.set(edge.toId, []).get(edge.toId)!).push(edge.fromId);
  }
  const kind = new Map(nodes.map((node) => [node.id, node.kind]));
  const splits = (id: string) => {
    const ways = outs.get(id) ?? [];
    if (new Set(ways.map((way) => way.to)).size < 2) return false;
    return kind.get(id) === 'condition' || ((kind.get(id) === 'script' || kind.get(id) === 'choice') && ways.every((way) => way.label?.trim()));
  };
  const nodeOfKey = new Map<string, string>();
  for (const node of nodes) for (const unitId of node.unitIds) {
    const key = keyOf.get(unitId);
    if (key && !nodeOfKey.has(key)) nodeOfKey.set(key, node.id);
  }
  const cache = new Map<string, Fork>();
  return (key: string): Fork => {
    const start = nodeOfKey.get(key);
    if (!start) return null;
    if (cache.has(start)) return cache.get(start)!;
    let found: Fork = null;
    const seen = new Set([start]);
    let frontier = [start];
    while (frontier.length && !found) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const parent of ins.get(id) ?? []) {
          if (splits(parent)) {
            found = { point: parent, arm: id, label: outs.get(parent)!.find((way) => way.to === id)?.label?.trim() || null, choice: kind.get(parent) !== 'condition' };
            break;
          }
          if (!seen.has(parent)) (seen.add(parent), next.push(parent));
        }
        if (found) break;
      }
      frontier = next;
    }
    cache.set(start, found);
    return found;
  };
}

/** One way out of an event in the flow: derived from the dialogue graph, or drawn by hand (or by the AI) as a correction. */
export type FlowStep = { id: string; label: string | null; source: 'graph' } | { id: string; label: null; source: 'added'; origin: (typeof KNOWLEDGE_ORIGINS)[number] };

/**
 * The derived flow with the corrections people made: a hidden pair loses its derived line, an added
 * pair gets one (once, beside any derived ones). Links to events not in the list are left out.
 */
export function withLinks<T extends { id: string; next: { id: string; label: string | null }[] }>(flow: T[], links: { fromId: string; toId: string; kind: EventLinkKind; origin: (typeof KNOWLEDGE_ORIGINS)[number] }[]) {
  const known = new Set(flow.map((event) => event.id));
  const hidden = new Set(links.filter((link) => link.kind === 'hidden').map((link) => `${link.fromId}>${link.toId}`));
  return flow.map((event): Omit<T, 'next'> & { next: FlowStep[] } => {
    const derived: FlowStep[] = event.next.filter((step) => !hidden.has(`${event.id}>${step.id}`)).map((step) => ({ ...step, source: 'graph' as const }));
    const added: FlowStep[] = links
      .filter((link) => link.kind === 'added' && link.fromId === event.id && known.has(link.toId) && !derived.some((step) => step.id === link.toId))
      .map((link) => ({ id: link.toId, label: null, source: 'added' as const, origin: link.origin }));
    return { ...event, next: [...derived, ...added] };
  });
}

/** A project's 사건 흐름: events (not rejected) with where they happen and where they lead, corrections included. */
export function projectEventFlow(db: Db, projectId: string) {
  const rows = withTags(db, 'events', db.select().from(s.storyEvents).where(and(eq(s.storyEvents.projectId, projectId), ne(s.storyEvents.status, 'rejected'))).all());
  const keys = [...new Set(rows.flatMap((event) => event.evidence))];
  const lines = new Map(
    inChunks(keys, (slice) =>
      db.select({ key: s.units.key, seq: s.units.seq, kind: s.units.kind, section: s.groups.section, scene: s.groups.title }).from(s.units).innerJoin(s.groups, eq(s.groups.id, s.units.groupId)).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice))).all(),
    ).map((line) => [line.key, line]),
  );
  const placed = rows.map((event) => {
    // Where the event happens: its earliest spoken evidence line; UI and document text (menus, event
    // banners) only when it has no dialogue evidence, since such text often sits far from the scene.
    const cited = event.evidence.flatMap((key) => lines.get(key) ?? []);
    const spoken = cited.filter((line) => line.kind === 'dialogue');
    const first = (spoken.length ? spoken : cited).sort((a, b) => a.seq - b.seq)[0];
    return { ...event, at: first ? { seq: first.seq, section: first.section, scene: first.scene, key: first.key } : null };
  });
  const graphNodes = db.select({ id: s.graphNodes.id, kind: s.graphNodes.kind, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const graphEdges = db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const keyOf = new Map(db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit.key]));
  const links = db.select().from(s.eventLinks).where(eq(s.eventLinks.projectId, projectId)).all();
  return withLinks(eventFlow(graphOrder(db, projectId), forks(graphNodes, graphEdges, keyOf), placed), links);
}

/** Saves the correction for one pair of the project's events (replacing the pair's earlier one); null when either is not the project's or they are the same. */
export function saveEventLink(db: Db, projectId: string, link: { fromId: string; toId: string; kind: EventLinkKind; origin: (typeof KNOWLEDGE_ORIGINS)[number] }) {
  if (link.fromId === link.toId) return null;
  const owned = db.select({ id: s.storyEvents.id }).from(s.storyEvents).where(and(eq(s.storyEvents.projectId, projectId), inArray(s.storyEvents.id, [link.fromId, link.toId]))).all();
  if (owned.length !== 2) return null;
  const row = db
    .insert(s.eventLinks)
    .values({ projectId, ...link })
    .onConflictDoUpdate({ target: [s.eventLinks.fromId, s.eventLinks.toId], set: { kind: link.kind, origin: link.origin, updatedAt: new Date() } })
    .returning()
    .get();
  events.changed(projectId, 'knowledge');
  return row;
}

/** What one pair of events has as a correction: a drawn line, a dropped derived one, or nothing. */
export type PairLink = EventLinkKind | null;
const pairLink = (db: Db, projectId: string, fromId: string, toId: string) =>
  db.select().from(s.eventLinks).where(and(eq(s.eventLinks.projectId, projectId), eq(s.eventLinks.fromId, fromId), eq(s.eventLinks.toId, toId))).get();

/** Sets a pair's correction outright (⌘/Ctrl+Z puts back what was there); false when the events are not the project's. */
export function setEventLink(db: Db, projectId: string, link: { fromId: string; toId: string; kind: PairLink; origin: (typeof KNOWLEDGE_ORIGINS)[number] }) {
  if (link.kind) return Boolean(saveEventLink(db, projectId, { ...link, kind: link.kind }));
  db.delete(s.eventLinks).where(and(eq(s.eventLinks.projectId, projectId), eq(s.eventLinks.fromId, link.fromId), eq(s.eventLinks.toId, link.toId))).run();
  events.changed(projectId, 'knowledge');
  return true;
}

/**
 * link_events and the flow's own drawing: "link" draws a line where the flow shows none (or brings
 * back a dropped derived one), "unlink" takes one away (a drawn one is removed, a derived one is
 * dropped for good). Says what the pair had before and has now, so the app can undo it.
 */
export function linkEvents(db: Db, projectId: string, { fromId, toId, action, origin }: { fromId: string; toId: string; action: 'link' | 'unlink'; origin: (typeof KNOWLEDGE_ORIGINS)[number] }) {
  const previous: PairLink = pairLink(db, projectId, fromId, toId)?.kind ?? null;
  const done = (now: PairLink, result: string) => {
    if (now !== previous && !setEventLink(db, projectId, { fromId, toId, kind: now, origin })) throw new Error('같은 프로젝트의 서로 다른 두 사건만 이을 수 있습니다 (list_events의 id).');
    return { ok: true as const, result, previous, now };
  };
  if (fromId === toId) throw new Error('같은 프로젝트의 서로 다른 두 사건만 이을 수 있습니다 (list_events의 id).');
  if (action === 'link' && previous === 'hidden') return done(null, '대사 그래프의 선을 다시 보입니다.');
  if (action === 'unlink' && previous === 'added') return done(null, '직접 이은 선을 지웠습니다.');
  const derived = projectEventFlow(db, projectId).find((event) => event.id === fromId)?.next.some((step) => step.id === toId && step.source === 'graph');
  if (action === 'link') return derived || previous === 'added' ? done(previous, '이미 이어져 있습니다.') : done('added', '선을 이었습니다.');
  return derived ? done('hidden', '대사 그래프의 선을 숨겼습니다.') : done(previous, '이어진 선이 없습니다.');
}
