import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { agentToolPermissionOptions, importFileSchema, itemCount, requiredAgentPermissions, TOOL_NAMES, TOOL_SPECS, toolClass, toolRoute, type ToolClass, type ToolName, type ToolRoute, type ToolSpec } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { agentTools, type ToolDef } from './agent-tools.ts';
import { AUTO_MAX_ITEMS, autoReview, proposeChange, undoChanges } from './change-gate.ts';
import { importProject } from './importer.ts';
import { decideProposal } from './proposals.ts';

function setup(mode: 'ask' | 'auto' | 'bypass' = 'auto') {
  const db = openDatabase(':memory:');
  const lines = Array.from({ length: 30 }, (_, index) => ({ key: `l${index}`, group: index < 15 ? 'g1' : 'g2', speaker: 'Alice', source: `Line ${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g1', title: 'One' }, { key: 'g2', title: 'Two' }], units: lines, characters: [{ name: 'Alice' }, { name: 'Bob' }] }));
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  // Deleting is off until a person switches it on; here the mode is what is under test.
  db.update(s.projects).set({ agentSettings: { ...project.agentSettings, terminalPermissionMode: mode, permissions: { script: { delete: true } } } }).where(eq(s.projects.id, projectId)).run();
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: mode }).returning().get();
  const propose = (tool: string, input: Record<string, unknown>, terminal = false) => proposeChange(db, { projectId, sessionId: terminal ? null : chat.id, source: terminal ? 'cli' : 'api', tool, input, terminal });
  const unit = (key: string) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get();
  return { db, projectId, chat, propose, unit };
}

const definitions = () => {
  const { db, projectId } = setup();
  return agentTools(db, projectId, undefined, { unrestricted: true }) as Record<ToolName, ToolDef>;
};

/** The top-level fields of an input schema that are lists, through optional / default / nullable wrappers. */
function listFields(schema: z.ZodType): string[] {
  type Node = { def?: { type?: string; innerType?: Node; in?: Node } };
  const shape = (schema as unknown as { shape?: Record<string, Node> }).shape;
  if (!shape) throw new Error('a tool input must be a Zod object');
  const isList = (field: Node | undefined): boolean => Boolean(field) && (field!.def?.type === 'array' || isList(field!.def?.innerType ?? field!.def?.in));
  return Object.keys(shape).filter((name) => isList(shape[name]));
}

/**
 * Lists in a change tool's input that are NOT how many things the call changes, each with why. A list
 * field of a gated tool is either in its spec's `batch` or here; a new one fails the test until it is
 * put in one of the two.
 */
const NOT_BATCH: Partial<Record<ToolName, Record<string, string>>> = {
  save_character: { aliases: "one character's other names", evidence: 'the lines that show one item' },
  save_relationship: { changes: 'the stages of one relationship', evidence: 'the lines that show one item' },
  save_speech_rule: { evidence: 'the lines that show one item' },
  save_event: { participants: "one event's people", evidence: 'the lines that show one item' },
  save_document: { evidence: 'the lines that show one item' },
  save_status: { scope: 'where one tag may be put' },
  update_tag: { scope: 'where one tag may be put' },
  order_settings: { names: 'one ordering of the statuses or tags' },
  tag_items: { add: 'the tags put on each of `ids`', remove: 'the tags taken off each of `ids`' },
  pull_app_defaults: { sections: 'the settings sections pulled, six at most' },
  // The scope of one run. A run always asks in auto review (class run), whatever its size.
  start_run: Object.fromEntries(['groupIds', 'unitIds', 'tagIds', 'marks', 'termIds', 'statuses', 'speakers', 'listeners', 'kinds'].map((field) => [field, 'the scope of one run'])),
};

/** The class and route every tool derives to. A change here is a change in what asks, so it shows as a diff. */
const DERIVED: Record<ToolName, [ToolClass, ToolRoute]> = {
  project_overview: ['read', 'now'],
  list_scenes: ['read', 'now'],
  read_scene: ['read', 'now'],
  read_line: ['read', 'now'],
  find_lines: ['read', 'now'],
  scenes_with: ['read', 'now'],
  line_context: ['read', 'now'],
  find_reading_route: ['read', 'now'],
  show_graph: ['read', 'now'],
  list_views: ['read', 'now'],
  update_view: ['read', 'now'],
  check_script: ['read', 'now'],
  script_stats: ['read', 'now'],
  list_speakers: ['read', 'now'],
  create_unit: ['change', 'gate'],
  update_unit: ['change', 'gate'],
  delete_lines: ['delete', 'gate'],
  create_group: ['change', 'gate'],
  update_group: ['change', 'gate'],
  delete_group: ['delete', 'gate'],
  propose_translation: ['change', 'gate'],
  decide_suggestion: ['change', 'gate'],
  propose_changes: ['change', 'gate'],
  set_listeners: ['change', 'gate'],
  link_lines: ['change', 'gate'],
  link_in_order: ['change', 'gate'],
  list_characters: ['read', 'now'],
  list_relationships: ['read', 'now'],
  list_speech_rules: ['read', 'now'],
  list_events: ['read', 'now'],
  read_documents: ['read', 'now'],
  save_character: ['change', 'gate'],
  save_relationship: ['change', 'gate'],
  save_speech_rule: ['change', 'gate'],
  save_event: ['change', 'gate'],
  save_document: ['change', 'gate'],
  link_events: ['change', 'gate'],
  save_knowledge: ['change', 'gate'],
  delete_items: ['delete', 'gate'],
  list_terms: ['read', 'now'],
  term_usage: ['read', 'now'],
  save_terms: ['change', 'gate'],
  discover_terms: ['change', 'gate'],
  list_statuses: ['read', 'now'],
  list_tags: ['read', 'now'],
  save_status: ['change', 'gate'],
  update_status: ['change', 'gate'],
  delete_status: ['delete', 'gate'],
  update_tag: ['change', 'gate'],
  delete_tag: ['delete', 'gate'],
  order_settings: ['change', 'gate'],
  tag_items: ['change', 'gate'],
  harness_reference: ['read', 'now'],
  read_workflow: ['read', 'now'],
  read_run: ['read', 'now'],
  plan_run: ['read', 'now'],
  save_workflow: ['change', 'gate'],
  delete_workflow: ['delete', 'gate'],
  edit_workflow_node: ['change', 'editor'],
  start_run: ['run', 'gate'],
  continue_run: ['run', 'gate'],
  read_project_settings: ['read', 'now'],
  update_project_settings: ['change', 'gate'],
  read_app_defaults: ['read', 'now'],
  pull_app_defaults: ['change', 'gate'],
  web_search: ['read', 'now'],
  read_web_page: ['read', 'now'],
};

describe('one definition per agent tool', () => {
  it('every tool derives to the class and route written here', () => {
    expect(Object.fromEntries(TOOL_NAMES.map((name) => [name, [toolClass(name), toolRoute(name)]]))).toEqual(DERIVED);
  });

  it('a tool has one class whichever of its valid calls is made', () => {
    for (const name of TOOL_NAMES) {
      // Without an input, toolClass reads every option at once; that is exact only when the options agree.
      const perOption = new Set(agentToolPermissionOptions(name).map((option) => (option.some((need) => need.action === 'delete') ? 'delete' : option.some((need) => need.action === 'run') ? 'run' : option.every((need) => need.action === 'read') ? 'read' : 'change')));
      expect([...perOption], name).toEqual([toolClass(name)]);
    }
    // The class of a call comes from what that call needs.
    expect(toolClass('save_character', { id: 'x' })).toBe('change');
    expect(requiredAgentPermissions('delete_items', { kind: 'terms' })).toEqual([{ resource: 'terms', action: 'delete' }]);
    expect(toolClass('delete_items', { kind: 'terms', ids: ['a'] })).toBe('delete');
    // A batch with nothing in it needs nothing, and that is not a read.
    expect(toolClass('save_terms', { terms: [] })).toBe('change');
  });

  it('the server catalogue and the specs name the same tools, and only editor tools have no server side', () => {
    const tools = definitions();
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) expect(Boolean(tools[name].execute), name).toBe(toolRoute(name) !== 'editor');
    // What AGENTS.md lets write without the gate: saved graph views.
    expect(TOOL_NAMES.filter((name) => (TOOL_SPECS[name] as ToolSpec).via === 'direct')).toEqual(['show_graph', 'update_view']);
    const { db, projectId } = setup();
    const catalog = agentCatalog(db, projectId, undefined, { unrestricted: true });
    expect(catalog.map((tool) => tool.name)).not.toContain('edit_workflow_node');
    for (const tool of catalog) expect(tool.changes, tool.name).toBe(toolRoute(tool.name) === 'gate');
  });

  it('every list in a change tool\'s input counts as its batch, or is named as not one', () => {
    const tools = definitions();
    for (const name of TOOL_NAMES) {
      const spec: ToolSpec = TOOL_SPECS[name];
      const lists = listFields(tools[name].inputSchema);
      for (const field of spec.batch ?? []) expect(lists, `${name}.batch names ${field}, which is not a list of its input`).toContain(field);
      if (toolRoute(name) !== 'gate') continue;
      const unaccounted = lists.filter((field) => !spec.batch?.includes(field) && !NOT_BATCH[name]?.[field]);
      expect(unaccounted, `${name}: put these list fields in its spec's batch, or in NOT_BATCH with why`).toEqual([]);
    }
    for (const [name, fields] of Object.entries(NOT_BATCH)) {
      for (const field of Object.keys(fields)) expect(listFields(tools[name as ToolName].inputSchema), `NOT_BATCH names ${name}.${field}, which is gone`).toContain(field);
    }
  });

  it('counts a call\'s items from its batch fields', () => {
    expect(itemCount('delete_lines', { keys: ['a', 'b', 'c'] })).toBe(3);
    expect(itemCount('set_listeners', { lines: Array.from({ length: 5_000 }, () => ({})) })).toBe(5_000);
    expect(itemCount('link_in_order', { scenes: ['s1', 's2'], lines: ['a', 'b', 'c'] })).toBe(5);
    expect(itemCount('save_knowledge', { characters: [{}, {}], documents: [{}] })).toBe(3);
    // One relationship with many stages is one item.
    expect(itemCount('save_relationship', { changes: Array.from({ length: 30 }, () => ({})) })).toBe(1);
    expect(itemCount('save_character', {})).toBe(1);
  });

  it('auto review asks for every delete and for batches over the limit, whatever their field is called', async () => {
    expect(autoReview('delete_lines', { keys: ['l0'] }, null)).toMatchObject({ pass: false, reason: expect.stringContaining('삭제') });
    expect(autoReview('delete_group', { groupId: 'g' }, null).pass).toBe(false);
    const many = Array.from({ length: AUTO_MAX_ITEMS + 1 }, (_, index) => `l${index}`);
    expect(autoReview('set_listeners', { lines: many.map((key) => ({ key, listener: 'Bob' })) }, null)).toMatchObject({ pass: false, reason: expect.stringContaining('21개') });
    expect(autoReview('link_in_order', { scenes: [], lines: many }, null)).toMatchObject({ pass: false, reason: expect.stringContaining('21개') });
    expect(autoReview('set_listeners', { lines: [{ key: 'l0', listener: 'Bob' }] }, null).pass).toBe(true);

    // Through the gate, in a conversation and from the terminal alike.
    for (const terminal of [false, true]) {
      const { db, propose, unit } = setup('auto');
      expect(await propose('delete_lines', { keys: ['l0'], bridge: true }, terminal)).toMatchObject({ ok: true, applied: false, status: 'pending', review: expect.stringContaining('삭제') });
      expect(unit('l0')).toBeDefined();
      expect(await propose('set_listeners', { lines: many.map((key) => ({ key, listener: 'Bob', confidence: 1 })) }, terminal)).toMatchObject({ ok: true, applied: false, status: 'pending', review: expect.stringContaining('21개') });
      expect(unit('l0')?.listener).toBeNull();
      expect(await propose('link_in_order', { scenes: [], lines: many }, terminal)).toMatchObject({ ok: true, applied: false, status: 'pending', review: expect.stringContaining('21개') });
      expect(db.select().from(s.graphEdges).all()).toEqual([]);
      // A small one of the same kind applies.
      expect(await propose('set_listeners', { lines: [{ key: 'l1', listener: 'Bob', confidence: 1 }] }, terminal)).toMatchObject({ ok: true, applied: true });
      expect(unit('l1')?.listener).toBe('Bob');
    }
  });

  it('a tool that is not a change never becomes a proposal', async () => {
    const { db, propose } = setup('bypass');
    for (const tool of ['find_lines', 'show_graph', 'update_view', 'edit_workflow_node', 'no_such_tool']) expect(await propose(tool, {})).toMatchObject({ ok: false });
    expect(db.select().from(s.proposals).all()).toEqual([]);
  });

  it('decide_suggestion is offered and permission-checked like the other line changes', async () => {
    const { db, projectId } = setup('ask');
    expect(agentCatalog(db, projectId).map((tool) => tool.name)).toContain('decide_suggestion');
    expect(requiredAgentPermissions('decide_suggestion', {})).toEqual([{ resource: 'script', action: 'update' }]);
  });
});

describe('one tool per operation', () => {
  it('update_group writes a scene description of any length and its undo puts the old one back', async () => {
    const { db, projectId, propose, chat } = setup('bypass');
    const group = db.select().from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.key, 'g1'))).get()!;
    const description = '요약 '.repeat(1_500);
    const changed = await propose('update_group', { groupId: group.id, description });
    expect(changed).toMatchObject({ ok: true, applied: true });
    const now = () => db.select().from(s.groups).where(eq(s.groups.id, group.id)).get()!;
    expect(now()).toMatchObject({ description, title: 'One' });
    expect(await propose('update_group', { groupId: 'gone', description: 'x' })).toMatchObject({ ok: false, error: '없는 장면입니다.' });
    if (!changed.ok) throw new Error(changed.error);
    expect(await undoChanges(db, chat.id, [changed.proposalId])).toMatchObject([{ ok: true }]);
    expect(now().description).toBe(group.description);
  });

  it('create_unit adds at the end of a group or right after a line, never both', async () => {
    const { db, projectId, propose, unit } = setup('bypass');
    const group = db.select().from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.key, 'g1'))).get()!;
    const schema = definitions().create_unit.inputSchema;
    expect(schema.safeParse({ source: 'x' }).success).toBe(false);
    expect(schema.safeParse({ groupId: group.id, after: 'l0', source: 'x' }).success).toBe(false);

    const last = await propose('create_unit', { groupId: group.id, key: 'new.end', source: 'At the end' });
    expect(last).toMatchObject({ ok: true, applied: true, result: { ok: true, key: 'new.end' } });
    const sorts = () => db.select({ key: s.units.key }).from(s.units).where(eq(s.units.groupId, group.id)).orderBy(s.units.sort).all().map((row) => row.key);
    expect(sorts().at(-1)).toBe('new.end');

    const after = await propose('create_unit', { after: 'l0', key: 'new.after', source: 'Right after', speaker: 'Bob', listener: 'Alice' });
    expect(after).toMatchObject({ ok: true, applied: true, result: { ok: true, key: 'new.after' } });
    expect(sorts().slice(0, 3)).toEqual(['l0', 'new.after', 'l1']);
    // Joined into the graph after l0, as made by the AI; the listener it named is the agent's, not a person's.
    const node = db.select().from(s.graphNodes).all().find((row) => row.unitIds.includes(unit('new.after')!.id))!;
    expect(node.origin).toBe('ai');
    expect(db.select().from(s.graphEdges).where(eq(s.graphEdges.toId, node.id)).all()).toHaveLength(1);
    expect(unit('new.after')).toMatchObject({ listener: 'Alice', listenerOrigin: 'ai', listenerConfidence: 1 });
  });

  it('delete_lines deletes only the named lines, keeps the way through and clears them from evidence', async () => {
    const { db, projectId, propose, unit } = setup('bypass');
    const nodeOf = (key: string) => db.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().find((row) => row.unitIds.includes(unit(key)!.id))!;
    // l0 → l1 → l2, and l3 put into l4's node so that node holds two lines.
    const edge = (from: string, to: string) => db.insert(s.graphEdges).values({ projectId, fromId: nodeOf(from).id, toId: nodeOf(to).id, origin: 'human' }).run();
    edge('l0', 'l1');
    edge('l1', 'l2');
    const shared = nodeOf('l4');
    db.delete(s.graphNodes).where(eq(s.graphNodes.id, nodeOf('l3').id)).run();
    db.update(s.graphNodes).set({ unitIds: [unit('l3')!.id, unit('l4')!.id] }).where(eq(s.graphNodes.id, shared.id)).run();
    const event = db.insert(s.storyEvents).values({ projectId, title: 'E', evidence: ['l1', 'l3', 'l5'] }).returning().get();
    const before = { l0: nodeOf('l0').id, l2: nodeOf('l2').id };

    expect(await propose('delete_lines', { keys: ['l1', 'nope'], bridge: true })).toMatchObject({ ok: false, error: expect.stringContaining('없는 대사 키') });
    expect(await propose('delete_lines', { keys: ['l1', 'l3'], bridge: true })).toMatchObject({ ok: true, applied: true, result: { ok: true, deleted: 2, nodes: 1 } });
    expect(unit('l1')).toBeUndefined();
    expect(unit('l3')).toBeUndefined();
    // The node that held l3 and l4 keeps l4.
    expect(db.select().from(s.graphNodes).where(eq(s.graphNodes.id, shared.id)).get()?.unitIds).toEqual([unit('l4')!.id]);
    // l1's node is gone and its way through is kept.
    expect(db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId }).from(s.graphEdges).all()).toEqual([{ fromId: before.l0, toId: before.l2 }]);
    expect(db.select().from(s.storyEvents).where(eq(s.storyEvents.id, event.id)).get()?.evidence).toEqual(['l5']);
  });

  it('a listener in a line batch is a person\'s only when a person decided the batch', async () => {
    const applied = setup('bypass');
    const batch = { changes: [{ key: 'l0', listener: 'Bob' }, { key: 'l1', listener: 'Bob', translation: '안녕' }] };
    applied.db.update(s.units).set({ listener: 'Carol', listenerOrigin: 'human' }).where(eq(s.units.id, applied.unit('l1')!.id)).run();
    const result = await applied.propose('propose_changes', batch, true);
    expect(result).toMatchObject({ ok: true, applied: true, result: { applied: 2, listenerKept: { keys: ['l1'] } } });
    // No person was involved: the agent's listener is recorded as an AI's, and never replaces a person's.
    expect(applied.unit('l0')).toMatchObject({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 1 });
    expect(applied.unit('l1')).toMatchObject({ listener: 'Carol', listenerOrigin: 'human', translation: '안녕' });

    const asked = setup('ask');
    const pending = await asked.propose('propose_changes', batch, true);
    if (!pending.ok) throw new Error(pending.error);
    expect(asked.unit('l0')?.listener).toBeNull();
    await decideProposal(asked.db, pending.proposalId, true, 'person');
    expect(asked.unit('l0')).toMatchObject({ listener: 'Bob', listenerOrigin: 'human', listenerConfidence: null });
  });

  it('update_unit under a permission mode does not replace a listener a person set', async () => {
    const { db, propose, unit } = setup('bypass');
    db.update(s.units).set({ listener: 'Carol', listenerOrigin: 'human' }).where(eq(s.units.id, unit('l1')!.id)).run();
    expect(await propose('update_unit', { unitId: unit('l1')!.id, listener: 'Bob' })).toMatchObject({ ok: true, applied: false, status: 'failed' });
    expect(unit('l1')?.listener).toBe('Carol');
    expect(await propose('update_unit', { unitId: unit('l0')!.id, listener: 'Bob' })).toMatchObject({ ok: true, applied: true });
    expect(unit('l0')).toMatchObject({ listener: 'Bob', listenerOrigin: 'ai' });
  });
});
