import { Hono } from 'hono';
import { readingRouteQuery } from '../services/reading-route-query.ts';
import { projectReadingRoute } from '../services/reading-route.ts';
import { and, asc, eq, inArray, ne, notLike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createGroupSchema, updateGroupSchema, createUnitSchema, updateUnitSchema, lineFilterSchema, LINE_TRANSLATE, unpagedLineFilterSchema, viewRouteSchema, type NodeType } from '@tw/shared';
import { createGroup, updateGroup, updateUnit } from '../services/source-mutations.ts';
import { createLine, deleteGroup, deleteLines, deleteNodes, duplicateNodes, edgeDetail, linkInOrder, linkNodes, unlinkEdges } from '../services/graph-edit.ts';
import { undoRecorded } from '../services/undo-records.ts';
import { patchLineById, patchLines, pickedLines, sameSourceLines, saveLineById, saveSameSource } from '../services/line-save.ts';
import { declineSuggestion } from '../services/candidates.ts';
import { found, validate, type Env } from '../context.ts';
import type { Db } from '../db/index.ts';
import { inChunks, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { computeLayouts, LAYOUT_VERSION } from '../services/layout.ts';
import type { LayoutDirection } from '../services/layout-types.ts';
import { changeView, createView, deleteView, listViews, missingNodes, readView, sectionWithMost, viewSection } from '../services/graph-views.ts';
import { lineMatches } from '../services/line-matches.ts';
import { lineMatchRows, linePage } from '../services/line-filter.ts';
import { completeLine } from '../services/editor-complete.ts';
import { assistLine } from '../services/editor-assist.ts';
import { speechRuleIndex } from '../services/speech.ts';
import { lineSurroundings } from '../services/line-surroundings.ts';
import { groupRows } from '../services/group-rows.ts';

/** A line's text, candidate and status: one save (services/line-save.ts). */
const lineSave = z.object({
  /** New text from a person: selected as the line's text (an existing candidate with the same text is reused). */
  text: z.string().optional(),
  candidateId: z.string().optional(),
  statusId: z.string().optional(),
  /** The line's rev (its updatedAt in ms) as the browser holds it; a save over a line changed since is refused (409). */
  rev: z.number().int().optional(),
  /** The person chose 내 수정 유지 over a change made meanwhile: the line's history says so. */
  keepMine: z.boolean().optional(),
})
  .strict()
  .refine((save) => !(save.text !== undefined && save.candidateId), '번역 글과 후보 중 하나만 보내세요.');

/** What else a person sets on lines (text and status with a text go through POST /units/:unitId/save). */
const linePatch = {
  /** A person's choice of listener (null = unknown); it replaces any AI or imported listener. Narration keeps none. */
  listener: z.string().trim().min(1).nullable().optional(),
  /** 번역 제외, a person's call: include / exclude whatever the rules say; null hands it back to the rules. */
  translate: z.enum(LINE_TRANSLATE).nullable().optional(),
};

/** Sections laid out on their own (see layout.ts), in script order, with the scenes in each for jumping from the scene graph. */
function graphSections(db: Db, projectId: string, direction: LayoutDirection) {
  const stored = db
    .select({ name: s.graphLayouts.section, nodes: sql<number>`json_array_length(${s.graphLayouts.data}, '$.nodes')` })
    .from(s.graphLayouts)
    .where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, 'dialogue'), eq(s.graphLayouts.direction, direction), ne(s.graphLayouts.section, ''), notLike(s.graphLayouts.section, 'view:%'), eq(s.graphLayouts.status, 'ready')))
    .all();
  const scenesBySection = Map.groupBy(
    db.select({ id: s.groups.id, section: s.groups.section }).from(s.groups).where(eq(s.groups.projectId, projectId)).orderBy(asc(s.groups.sort)).all(),
    (group) => group.section ?? '',
  );
  const order = [...scenesBySection.keys()];
  const sections = stored
    .map((row) => ({ name: row.name, nodes: row.nodes ?? 0, groupIds: (scenesBySection.get(row.name) ?? []).map((group) => group.id) }))
    .sort((a, b) => (order.indexOf(a.name) === -1 ? Infinity : order.indexOf(a.name)) - (order.indexOf(b.name) === -1 ? Infinity : order.indexOf(b.name)));
  return sections;
}

/**
 * The nodes a stored layout draws: its own, and those shown through its blocks (a straight run) and edges (a choice); null for the
 * whole graph (every node). Portals are stand-ins, not nodes.
 */
function layoutNodeIds(raw: string, section: string): string[] | null {
  const parsed = section && raw !== 'null' ? (JSON.parse(raw) as s.LayoutData) : null;
  return parsed ? [...parsed.nodes.map((node) => node.id).filter((id) => !id.startsWith('portal:')), ...(parsed.chains ?? []).flatMap((chain) => chain.nodeIds), ...parsed.edges.flatMap((edge) => (edge.via ? [edge.via] : []))] : null;
}

export const sourceRoutes = new Hono<Env>()
  .post('/projects/:projectId/groups', validate('json', createGroupSchema), (c) => c.json(createGroup(c.var.deps.db, c.req.param('projectId'), c.req.valid('json')), 201))
  .patch('/projects/:projectId/groups/:groupId', validate('json', updateGroupSchema), (c) => c.json(updateGroup(c.var.deps.db, c.req.param('projectId'), c.req.param('groupId'), c.req.valid('json'))))
  .delete('/projects/:projectId/groups/:groupId', (c) => c.json(deleteGroup(c.var.deps.db, c.req.param('projectId'), c.req.param('groupId'))))
  .post('/projects/:projectId/units', validate('json', createUnitSchema), (c) => {
    const { groupId, ...line } = c.req.valid('json');
    return c.json(createLine(c.var.deps.db, c.req.param('projectId'), { groupId }, line).unit, 201);
  })
  .patch('/projects/:projectId/units/:unitId/source', validate('json', updateUnitSchema), (c) => c.json(updateUnit(c.var.deps.db, c.req.param('projectId'), c.req.param('unitId'), c.req.valid('json'))))
  .delete('/projects/:projectId/units/:unitId', (c) => c.json(deleteLines(c.var.deps.db, c.req.param('projectId'), [c.req.param('unitId')])))
  .get('/projects/:projectId/groups', validate('query', z.object({ kind: z.enum(['scene', 'document', 'ui']).optional(), q: z.string().trim().optional() })), (c) => {
    const { kind, q } = c.req.valid('query');
    const needle = q?.toLowerCase();
    return c.json(groupRows(c.var.deps.db, c.req.param('projectId')).filter((group) => (!kind || group.kind === kind) && (!needle || group.title.toLowerCase().includes(needle) || group.key.toLowerCase().includes(needle))));
  })
  .get('/groups/:groupId', (c) => {
    const { db } = c.var.deps;
    return c.json(found(db.select().from(s.groups).where(eq(s.groups.id, c.req.param('groupId'))).get(), '장면'));
  })
  /** Every line a filter matches, in script order (services/line-filter.ts lineMatchRows). The filter is the one LineFilter, as JSON. */
  .post('/projects/:projectId/units/matches', validate('json', z.object({ filter: unpagedLineFilterSchema })), (c) => c.json({ rows: lineMatchRows(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').filter) }))
  /** One page of a filter as ids, with its total and the lines per scene on the page (services/line-filter.ts linePage). */
  .post('/projects/:projectId/units/ids', validate('json', z.object({ filter: lineFilterSchema.extend({ limit: z.number().int().min(1).max(500).default(100) }), focus: z.string().optional() })), (c) => {
    const { filter, focus } = c.req.valid('json');
    return c.json(linePage(c.var.deps.db, c.req.param('projectId'), filter, focus));
  })
  /** Lines by key, in script order, as ids: evidence cited by knowledge drafts, where a speech rule starts. */
  .post('/projects/:projectId/units/by-keys', validate('json', z.object({ keys: z.array(z.string()).max(500) })), (c) => {
    const keys = c.req.valid('json').keys;
    // Ids in script order: the lines themselves come from the browser's units collection.
    const ids = keys.length ? c.var.deps.db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, c.req.param('projectId')), inArray(s.units.key, keys))).orderBy(asc(s.units.seq)).all().map((row) => row.id) : [];
    return c.json({ ids });
  })
  /** What the bulk bar says about picked lines the browser does not hold (services/line-save.ts pickedLines): ids and counts, no rows. */
  .post('/projects/:projectId/units/picked', validate('json', z.object({ ids: z.array(z.string()).max(20_000) })), (c) => c.json(pickedLines(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids)))
  .patch(
    '/projects/:projectId/units',
    validate(
      'json',
      z.object({
        unitIds: z.array(z.string()).min(1),
        statusId: z.string().optional(),
        /** 확인함: a person looked at the lines; their statuses stay, but a person now holds them (no ✦). */
        checked: z.literal(true).optional(),
        addTagIds: z.array(z.string()).default([]),
        removeTagIds: z.array(z.string()).default([]),
        /** Each picked line's rev as the browser holds it (line id → rev): a line changed since is skipped and counted, not written over. */
        revs: z.record(z.string(), z.number().int()).optional(),
        /** For the picked lines the browser does not hold: the newest rev among them when it last asked (units/picked). */
        asOf: z.number().int().optional(),
        ...linePatch,
      }),
    ),
    (c) => {
      const { unitIds, revs, asOf, ...patch } = c.req.valid('json');
      // changed / skipped: how many lines took the change, and how many had changed since they were seen.
      return c.json({ ok: true, ...patchLines(c.var.deps.db, c.req.param('projectId'), unitIds, patch, { revs, asOf }) });
    },
  )
  /** A line's surroundings (services/line-surroundings.ts): its neighbours by id, graph nodes, speech rule and the names around it. */
  .get('/units/:unitId/surroundings', (c) => c.json(found(lineSurroundings(c.var.deps.db, undefined, [c.req.param('unitId')])[0], '대사')))
  /** The same for a page of lines: the list asks before a line is picked, so the detail draws whole at once. */
  .post('/projects/:projectId/units/surroundings', validate('json', z.object({ ids: z.array(z.string()).max(200) })), (c) => c.json({ rows: lineSurroundings(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids) }))
  /** The editor's AI continuation of a line: the whole line, starting with `prefix`. Cancelled with the request. */
  .post('/units/:unitId/complete', validate('json', z.object({ prefix: z.string().max(4000).default('') })), async (c) => {
    const { db, secrets } = c.var.deps;
    return c.json(await completeLine(db, secrets, c.req.param('unitId'), c.req.valid('json').prefix, c.req.raw.signal));
  })
  /** The editor's 'AI 번역' / '다듬기' of a line: a new AI candidate. Cancelled with the request. */
  .post('/units/:unitId/assist', validate('json', z.object({ mode: z.enum(['translate', 'refine']), draft: z.string().max(8000).default(''), suggest: z.boolean().default(false) })), async (c) => {
    const { db, secrets } = c.var.deps;
    return c.json(await assistLine(db, secrets, c.req.param('unitId'), c.req.valid('json'), c.req.raw.signal));
  })
  /** Other lines with the same source (case and end punctuation aside), translated or not: what a confirmed translation may be applied to. */
  .get('/units/:unitId/same', (c) => c.json(sameSourceLines(c.var.deps.db, c.req.param('unitId'))))
  /**
   * One translation for other lines with the same source, in one request and one transaction (the
   * editor's '모두 이 번역으로'). Only lines that really share the source in the same project are
   * written; one changed since it was shown (its rev) is skipped and counted.
   */
  .post('/units/:unitId/same-source', validate('json', z.object({ text: z.string().trim().min(1), lines: z.array(z.object({ unitId: z.string(), rev: z.number().int() })).min(1).max(200) })), (c) => {
    const { text, lines } = c.req.valid('json');
    return c.json({ ok: true, ...saveSameSource(c.var.deps.db, c.req.param('unitId'), text, lines) });
  })
  /** Already translated lines of the project with the same or a similar source (the editor's suggestions). */
  .get('/units/:unitId/matches', (c) => {
    const { db } = c.var.deps;
    const unit = found(db.select({ id: s.units.id, projectId: s.units.projectId, source: s.units.source }).from(s.units).where(eq(s.units.id, c.req.param('unitId'))).get(), '대사');
    const rules = db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, unit.projectId)).get()?.rules;
    return c.json(lineMatches(db, unit, rules));
  })
  /** A line's text, candidate and status, written together (services/line-save.ts). */
  .post('/units/:unitId/save', validate('json', lineSave), (c) => c.json({ ok: true, ...saveLineById(c.var.deps.db, c.req.param('unitId'), c.req.valid('json')) }))
  /** 거절: a person turns down a waiting AI 제안; it stays in the line's history. Taking one is a save with its candidateId. */
  .post('/units/:unitId/candidates/:candidateId/decline', (c) => {
    if (!declineSuggestion(c.var.deps.db, c.req.param('unitId'), c.req.param('candidateId'))) return c.json({ error: '기다리는 AI 제안이 아닙니다.' }, 409);
    return c.json({ ok: true });
  })
  /** One line's tags (whole), listener, memo and 번역 제외. A text or status sent here is refused: they have the one save path above. */
  .patch('/units/:unitId', validate('json', z.object({ tagIds: z.array(z.string()).optional(), note: z.string().max(2000).optional(), ...linePatch }).strict()), (c) => {
    // rev: the line after this write, which the next write made from the same view sends back.
    return c.json({ ok: true, ...patchLineById(c.var.deps.db, c.req.param('unitId'), c.req.valid('json')) });
  })

  // ── graphs ─────────────────────────────────────────────────────────
  .get('/projects/:projectId/reading-route', validate('query', readingRouteQuery), (c) => c.json(projectReadingRoute(c.var.deps.db, c.req.param('projectId'), c.req.valid('query'))))
  /** The dialogue graph's sections alone: the graph page needs them before it knows which layout to load. */
  // The translation of each node's first line, apart from the graph itself: it changes with every save, the layout does not.
  // (The web keys it under 'units', so a translation change refreshes it and the layout is not fetched again.)
  .get('/projects/:projectId/graph/sections', validate('query', z.object({ direction: z.enum(['vertical', 'horizontal']).default('vertical') })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const { direction } = c.req.valid('query');
    const exists = db.select({ status: s.graphLayouts.status }).from(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, 'dialogue'), eq(s.graphLayouts.direction, direction), eq(s.graphLayouts.section, ''))).get();
    if (direction === 'horizontal' && !exists) void computeLayouts(db, projectId, { direction });
    return c.json(graphSections(db, projectId, direction));
  })
  .get('/projects/:projectId/graph/:scope{dialogue|scene}', validate('query', z.object({ section: z.string().optional(), direction: z.enum(['vertical', 'horizontal']).default('vertical') })), (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const scope = c.req.param('scope') as 'dialogue' | 'scene';
    const { direction } = c.req.valid('query');
    const section = scope === 'dialogue' ? (c.req.valid('query').section ?? '') : '';
    const where = and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, scope), eq(s.graphLayouts.section, section), eq(s.graphLayouts.direction, direction));
    let layout = db.select({ status: s.graphLayouts.status, error: s.graphLayouts.error, version: sql<number>`coalesce(json_extract(${s.graphLayouts.data}, '$.version'), 0)` }).from(s.graphLayouts).where(where).get();
    const viewId = scope === 'dialogue' && section.startsWith('view:') ? section.slice('view:'.length) : undefined;
    let base = direction === 'horizontal' && scope === 'dialogue'
      ? db.select({ status: s.graphLayouts.status }).from(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, scope), eq(s.graphLayouts.direction, direction), eq(s.graphLayouts.section, ''))).get()
      : undefined;
    if (viewId && readView(db, projectId, viewId) && (!layout || (layout.status === 'ready' && layout.version < LAYOUT_VERSION))) {
      void viewSection(db, projectId, viewId, direction);
      layout = db.select({ status: s.graphLayouts.status, error: s.graphLayouts.error, version: sql<number>`coalesce(json_extract(${s.graphLayouts.data}, '$.version'), 0)` }).from(s.graphLayouts).where(where).get();
    } else if (direction === 'horizontal' && !layout) {
      if (!base) void computeLayouts(db, projectId, { direction });
      layout = db.select({ status: s.graphLayouts.status, error: s.graphLayouts.error, version: sql<number>`coalesce(json_extract(${s.graphLayouts.data}, '$.version'), 0)` }).from(s.graphLayouts).where(where).get();
      if (!base && scope === 'dialogue') base = db.select({ status: s.graphLayouts.status }).from(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.scope, scope), eq(s.graphLayouts.direction, direction), eq(s.graphLayouts.section, ''))).get();
    }
    const layoutStatus = layout?.status ?? (base?.status === 'pending' ? 'pending' : 'missing');
    if (scope === 'scene') {
      const nodes = db
        .select({ id: s.groups.id, label: s.groups.title, key: s.groups.key, total: sql<number>`(select count(*) from units u where u.group_id = "groups"."id")` })
        .from(s.groups)
        .where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene')))
        .all();
      return c.json({
        status: layoutStatus,
        error: layout?.error ?? null,
        layout: db.select({ data: s.graphLayouts.data }).from(s.graphLayouts).where(where).get()?.data ?? null,
        nodes: nodes.map((node) => ({ ...node, type: null as string | null, kind: 'scene', groupId: node.id, preview: `${node.total}개 대사`, speaker: null as string | null, text: null as string | null, unitId: null as string | null })),
        nodeTypes: {} as Record<string, NodeType>,
        sections: [] as { name: string; nodes: number; groupIds: string[] }[],
      });
    }
    const sections = graphSections(db, projectId, direction);
    // The stored layout goes out as the JSON text it is stored as: parsing and re-serializing a
    // 50k-node layout (15 MB) held the server for a quarter of a second. A section's layout is
    // small, so its node ids are read from it to send only that section's nodes.
    const raw = db.select({ data: sql<string | null>`${s.graphLayouts.data}` }).from(s.graphLayouts).where(where).get()?.data ?? 'null';
    const only = layoutNodeIds(raw, section);
    // One preview line per node keeps the payload small; details load on selection.
    const nodes = db
      .select({
        id: s.graphNodes.id,
        key: s.graphNodes.key,
        type: s.graphNodes.type,
        kind: s.graphNodes.kind,
        label: s.graphNodes.label,
        groupId: s.graphNodes.groupId,
        total: sql<number>`json_array_length(${s.graphNodes.unitIds})`,
        /** The node's first line, for the line menu on its card. */
        unitId: sql<string | null>`json_extract(${s.graphNodes.unitIds}, '$[0]')`,
        preview: sql<string | null>`(select coalesce(u.speaker || ': ', '') || substr(u.source, 1, 90) from units u where u.id = json_extract("graph_nodes"."unit_ids", '$[0]'))`,
        // The first line apart, so a card can lead with who speaks.
        speaker: sql<string | null>`(select u.speaker from units u where u.id = json_extract("graph_nodes"."unit_ids", '$[0]'))`,
        text: sql<string | null>`(select substr(u.source, 1, 120) from units u where u.id = json_extract("graph_nodes"."unit_ids", '$[0]'))`,
      })
      .from(s.graphNodes)
      .where(and(eq(s.graphNodes.projectId, projectId), only ? inList(s.graphNodes.id, only) : undefined))
      .all();
    const nodeTypes = db.select({ nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.nodeTypes ?? {};
    const head = JSON.stringify({ status: layoutStatus, error: layout?.error ?? null, nodes, nodeTypes, sections });
    return c.body(`${head.slice(0, -1)},"layout":${raw}}`, 200, { 'content-type': 'application/json; charset=UTF-8' }) as unknown as ReturnType<
      typeof c.json<{ status: string; error: string | null; layout: s.LayoutData | null; nodes: typeof nodes; nodeTypes: typeof nodeTypes; sections: typeof sections }>
    >;
  })
  // Editing the dialogue graph (services/graph-edit.ts): each answers with a token ⌘/Ctrl+Z undoes it with.
  .post('/projects/:projectId/graph/edges', validate('json', z.object({ fromId: z.string().min(1), toId: z.string().min(1), label: z.string().nullable().optional() })), (c) =>
    c.json(linkNodes(c.var.deps.db, c.req.param('projectId'), { ...c.req.valid('json'), origin: 'human' }), 201),
  )
  .get('/projects/:projectId/graph/edges/:edgeId', (c) => c.json(edgeDetail(c.var.deps.db, c.req.param('projectId'), c.req.param('edgeId'))))
  .post('/projects/:projectId/graph/edges/delete', validate('json', z.object({ ids: z.array(z.string().min(1)).min(1) })), (c) => c.json(unlinkEdges(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids)))
  .post('/projects/:projectId/graph/link-in-order', validate('json', z.object({ groupIds: z.array(z.string().min(1)).max(5000).optional(), nodeIds: z.array(z.string().min(1)).max(20000).optional() }).refine((v) => v.groupIds?.length || v.nodeIds?.length, '장면이나 노드를 하나 이상 고르세요.')), (c) =>
    c.json(linkInOrder(c.var.deps.db, c.req.param('projectId'), { ...c.req.valid('json'), origin: 'human' })),
  )
  .post('/projects/:projectId/graph/nodes/:nodeId/after', validate('json', createUnitSchema.omit({ groupId: true })), (c) => {
    const { unitId, nodeId, token } = createLine(c.var.deps.db, c.req.param('projectId'), { afterNodeId: c.req.param('nodeId') }, c.req.valid('json'));
    return c.json({ unitId, nodeId, token }, 201);
  })
  .post('/projects/:projectId/graph/nodes/delete', validate('json', z.object({ ids: z.array(z.string().min(1)).min(1), bridge: z.boolean().default(true) })), (c) => {
    const { ids, bridge } = c.req.valid('json');
    return c.json(deleteNodes(c.var.deps.db, c.req.param('projectId'), ids, bridge));
  })
  .post('/projects/:projectId/graph/nodes/duplicate', validate('json', z.object({ ids: z.array(z.string().min(1)).min(1) })), (c) => c.json(duplicateNodes(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').ids)))
  /**
   * Puts back what one edit did, by the token it answered with (an undo record's id, services/undo-records.ts): a delete of
   * lines, nodes, scenes or knowledge items with everything that went with them, an edit of the graph. ⌘/Ctrl+Z on every screen.
   */
  .post('/projects/:projectId/undo', validate('json', z.object({ token: z.string().min(1) })), (c) => c.json(undoRecorded(c.var.deps.db, c.req.param('projectId'), c.req.valid('json').token)))
  /** The project's stored views of the dialogue graph (see graph-views.ts), newest change first. */
  .get('/projects/:projectId/graph/views', (c) => c.json(listViews(c.var.deps.db, c.req.param('projectId'))))
  /** A view made by a person: from nodes picked in the graph, or from one reading route (it holds that route's nodes). */
  .post(
    '/projects/:projectId/graph/views',
    validate('json', z.object({ label: z.string().trim().min(1).max(80), nodeIds: z.array(z.string().min(1)).max(5000).default([]), route: viewRouteSchema.optional() }).refine((value) => value.nodeIds.length > 0 || value.route, '노드를 고르거나 경로를 주세요.')),
    (c) => c.json({ id: createView(c.var.deps.db, c.req.param('projectId'), c.req.valid('json')) }, 201),
  )
  /** A stored view: what it holds, how it was made, and the section showing most of it. */
  .get('/projects/:projectId/graph/views/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const view = found(readView(db, projectId, c.req.param('id')), '보기');
    return c.json({
      id: view.id,
      label: view.label,
      origin: view.origin,
      request: view.request,
      reasons: view.reasons,
      route: view.route,
      nodeIds: view.nodeIds,
      missing: missingNodes(db, projectId, view.nodeIds),
      updatedAt: view.updatedAt,
      section: sectionWithMost(db, projectId, view.nodeIds),
    });
  })
  /** Rename a view, add / leave out nodes (by id, or by line or node key), or take another branch at a route view's fork (`via`, or `branches` by key); its layout is made again. */
  .patch('/projects/:projectId/graph/views/:id', validate('json', z.object({ label: z.string().trim().min(1).max(80).optional(), add: z.array(z.string().min(1)).max(5000).default([]), remove: z.array(z.string().min(1)).max(5000).default([]), addKeys: z.array(z.string().min(1)).max(5000).default([]), removeKeys: z.array(z.string().min(1)).max(5000).default([]), via: z.string().max(20_000).optional(), branches: z.array(z.object({ at: z.string().min(1), to: z.string().min(1) })).max(200).default([]) })), (c) => {
    const view = changeView(c.var.deps.db, c.req.param('projectId'), c.req.param('id'), c.req.valid('json'));
    return c.json({ id: view.id, label: view.label, nodes: view.nodeIds.length, route: view.route });
  })
  .delete('/projects/:projectId/graph/views/:id', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    found(readView(db, projectId, c.req.param('id')), '보기');
    deleteView(db, projectId, c.req.param('id'));
    return c.json({ ok: true });
  })
  /** Recompute stored layouts, e.g. after the layout options changed. The source graph itself is untouched. */
  .post('/projects/:projectId/graph/relayout', (c) => {
    const { db } = c.var.deps;
    const projectId = c.req.param('projectId');
    const directions = new Set(db.selectDistinct({ direction: s.graphLayouts.direction }).from(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.section, ''))).all().map((row) => row.direction));
    directions.add('vertical');
    for (const direction of directions) void computeLayouts(db, projectId, { direction });
    return c.json({ ok: true }, 202);
  })
  .get('/graph-nodes/:nodeId', validate('query', z.object({ projectId: z.string().min(1).optional() })), (c) => {
    const { db } = c.var.deps;
    const { projectId } = c.req.valid('query');
    const nodeWhere = projectId
      ? and(eq(s.graphNodes.id, c.req.param('nodeId')), eq(s.graphNodes.projectId, projectId))
      : eq(s.graphNodes.id, c.req.param('nodeId'));
    const node = found(db.select().from(s.graphNodes).where(nodeWhere).get(), '노드');
    const lines = node.unitIds.length ? db.select({ id: s.units.id, key: s.units.key, speaker: s.units.speaker, listener: s.units.listener, listenerOrigin: s.units.listenerOrigin, listenerConfidence: s.units.listenerConfidence }).from(s.units).where(inArray(s.units.id, node.unitIds)).all() : [];
    const order = new Map(node.unitIds.map((id, index) => [id, index]));
    const neighbour = (direction: 'in' | 'out') =>
      db
        .select({ id: s.graphNodes.id, key: s.graphNodes.key, kind: s.graphNodes.kind, label: s.graphNodes.label, edgeLabel: s.graphEdges.label })
        .from(s.graphEdges)
        .innerJoin(s.graphNodes, eq(s.graphNodes.id, direction === 'in' ? s.graphEdges.fromId : s.graphEdges.toId))
        .where(eq(direction === 'in' ? s.graphEdges.toId : s.graphEdges.fromId, node.id))
        .all();
    const project = db.select({ nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, node.projectId)).get();
    const typeInfo = node.type ? (project?.nodeTypes[node.type] ?? null) : null;
    const group = node.groupId ? db.select({ id: s.groups.id, title: s.groups.title }).from(s.groups).where(eq(s.groups.id, node.groupId)).get() : null;
    return c.json({
      ...node,
      typeInfo,
      group,
      // The node's lines in order, by id (the lines themselves are the browser's rows), each with the speech level its rule asks for.
      lines: (() => {
        const resolved = speechRuleIndex(db, node.projectId).resolve(lines);
        return lines
          .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
          .map((line) => ({ id: line.id, level: resolved.get(line.key)?.rule.level ?? null }));
      })(),
      incoming: neighbour('in'),
      outgoing: neighbour('out'),
    });
  });
