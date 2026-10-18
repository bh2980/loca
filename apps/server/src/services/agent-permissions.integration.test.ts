import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { agentSettingsSchema, agentToolAvailable, agentToolPermissionOptions, importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { scriptRoutes } from '../routes/script.ts';
import { importProject } from './importer.ts';
import { gatedTools, proposeChange } from './change-gate.ts';
import { decideProposal } from './proposals.ts';
import { agentCatalog } from './agent-catalog.ts';

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Permission test' },
    groups: [{ key: 'scene', title: 'Scene' }],
    units: [{ key: 'scene.1', group: 'scene', speaker: 'Alice', source: 'Hello' }],
    characters: [{ name: 'Alice' }, { name: 'Bob' }],
  }));
  const chat = db.insert(s.chatSessions).values({ projectId, title: 'permission test', permissionMode: 'ask' }).returning().get();
  return { db, projectId, chat };
}

function settings(db: ReturnType<typeof openDatabase>, projectId: string, patch: unknown) {
  db.update(s.projects).set({ agentSettings: agentSettingsSchema.parse(patch) }).where(eq(s.projects.id, projectId)).run();
}

function character(db: ReturnType<typeof openDatabase>, projectId: string, name: string) {
  return db.select().from(s.characters).where(and(eq(s.characters.projectId, projectId), eq(s.characters.name, name))).get();
}

type RuntimeTool = { run(input: unknown): Promise<unknown> };
function cliTool(db: ReturnType<typeof openDatabase>, projectId: string, name: string) {
  const found = agentCatalog(db, projectId).find((item) => item.name === name);
  if (!found) throw new Error(`Missing catalog tool: ${name}`);
  return found;
}

type ApiTool = { execute(input: unknown, options: unknown): Promise<unknown> };
function apiTool(db: ReturnType<typeof openDatabase>, projectId: string, sessionId: string, name: string) {
  const found = (gatedTools(db, projectId, sessionId, { model: null }) as unknown as Record<string, ApiTool>)[name];
  if (!found) throw new Error(`Missing API tool: ${name}`);
  return found;
}

const countRows = (db: ReturnType<typeof openDatabase>, table: typeof s.terms | typeof s.tags, projectId: string) =>
  db.select().from(table).where(eq(table.projectId, projectId)).all().length;

describe('agent resource permissions', () => {
  it('allows term deletion while denying tag deletion through the shared proposal gate', async () => {
    const { db, projectId, chat } = setup();
    settings(db, projectId, { permissions: { terms: { delete: true }, tags: { delete: false } } });
    const term = db.insert(s.terms).values({ projectId, source: 'Relay', target: '중계' }).returning().get();
    const tag = db.insert(s.tags).values({ projectId, name: 'Custom', color: '#777777', scope: ['terms'] }).returning().get();
    const beforeTags = countRows(db, s.tags, projectId);

    const termProposal = await proposeChange(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'delete_items', input: { kind: 'terms', ids: [term.id] } });
    expect(termProposal).toMatchObject({ ok: true, applied: false, status: 'pending' });
    if (!termProposal.ok) throw new Error(termProposal.error);
    expect((await decideProposal(db, termProposal.proposalId, true)).status).toBe('accepted');
    expect(db.select().from(s.terms).where(eq(s.terms.id, term.id)).get()).toBeUndefined();

    const denied = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'delete_items', input: { kind: 'tags', ids: [tag.id] } });
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('태그 삭제') });
    expect(db.select().from(s.tags).where(eq(s.tags.id, tag.id)).get()).toBeDefined();
    expect(countRows(db, s.tags, projectId)).toBe(beforeTags);
  });

  it('enforces create=false/update=true for single and bulk knowledge tools in chat and CLI', async () => {
    const { db, projectId, chat } = setup();
    settings(db, projectId, { permissions: { characters: { create: false, update: true } } });
    const alice = character(db, projectId, 'Alice')!;

    const single = cliTool(db, projectId, 'save_character') as RuntimeTool;
    const cliDenied = await single.run({ name: 'Cara' }) as { ok: boolean; error: string };
    expect(cliDenied).toMatchObject({ ok: false, error: expect.stringContaining('인물 생성') });
    const apiDenied = await apiTool(db, projectId, chat.id, 'save_character').execute({ name: 'Dana' }, { toolCallId: 'create', messages: [] }) as { ok: boolean; error: string };
    expect(apiDenied.error).toContain(cliDenied.error);
    expect(character(db, projectId, 'Cara')).toBeUndefined();
    expect(character(db, projectId, 'Dana')).toBeUndefined();

    const update = await proposeChange(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'save_character', input: { id: alice.id, name: 'Alicia' } });
    expect(update).toMatchObject({ ok: true, status: 'pending' });
    if (!update.ok) throw new Error(update.error);
    expect((await decideProposal(db, update.proposalId, true)).status).toBe('accepted');
    expect(character(db, projectId, 'Alicia')?.id).toBe(alice.id);

    const allowedBulkUpdate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_knowledge', input: { characters: [{ id: alice.id, name: 'Alicia bulk' }] } });
    expect(allowedBulkUpdate).toMatchObject({ ok: true, status: 'pending' });
    if (!allowedBulkUpdate.ok) throw new Error(allowedBulkUpdate.error);
    expect((await decideProposal(db, allowedBulkUpdate.proposalId, true)).status).toBe('accepted');
    expect(character(db, projectId, 'Alicia bulk')?.id).toBe(alice.id);

    const bulk = cliTool(db, projectId, 'save_knowledge') as RuntimeTool;
    const mixed = await bulk.run({ characters: [{ id: alice.id, name: 'Alicia changed' }, { name: 'Eve' }] }) as { ok: boolean; error: string };
    expect(mixed).toMatchObject({ ok: false, error: expect.stringContaining('인물 생성') });
    expect(character(db, projectId, 'Alicia bulk')?.id).toBe(alice.id);
    expect(character(db, projectId, 'Alicia changed')).toBeUndefined();
    expect(character(db, projectId, 'Eve')).toBeUndefined();

    const apiMixed = await apiTool(db, projectId, chat.id, 'save_knowledge').execute({ characters: [{ id: alice.id, name: 'Alicia changed' }, { name: 'Eve' }] }, { toolCallId: 'bulk', messages: [] }) as { ok: boolean; error: string };
    expect(apiMixed.error).toContain(mixed.error);
    expect(character(db, projectId, 'Alicia bulk')?.id).toBe(alice.id);
    expect(character(db, projectId, 'Eve')).toBeUndefined();
  });

  it('keeps mixed batches all-or-nothing and conservatively maps legacy disabled save_character to bulk', async () => {
    const { db, projectId } = setup();
    const alice = character(db, projectId, 'Alice')!;
    const cachedBulk = cliTool(db, projectId, 'save_knowledge') as RuntimeTool;

    settings(db, projectId, { disabledTools: ['save_character'] });
    const mixed = await cachedBulk.run({ characters: [{ id: alice.id, name: 'Alice edited' }, { name: 'Cara' }] }) as { ok: boolean; error: string };
    expect(mixed).toMatchObject({ ok: false, error: expect.stringContaining('인물') });
    expect(character(db, projectId, 'Alice')?.id).toBe(alice.id);
    expect(character(db, projectId, 'Alice edited')).toBeUndefined();
    expect(character(db, projectId, 'Cara')).toBeUndefined();
    expect(agentCatalog(db, projectId).some((item) => item.name === 'save_character')).toBe(false);
  });

  it('rechecks permissions when a pending proposal is accepted after revocation', async () => {
    const { db, projectId, chat } = setup();
    const proposed = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Cara' } });
    expect(proposed).toMatchObject({ ok: true, status: 'pending' });
    if (!proposed.ok) throw new Error(proposed.error);

    settings(db, projectId, { permissions: { characters: { create: false } } });
    const decided = await decideProposal(db, proposed.proposalId, true);
    expect(decided.status).toBe('failed');
    expect(decided.result).toMatchObject({ ok: false });
    expect(character(db, projectId, 'Cara')).toBeUndefined();
  });

  it('rechecks cached read tools after permission revocation in both chat and CLI catalogs', async () => {
    const { db, projectId, chat } = setup();
    const cachedCli = cliTool(db, projectId, 'list_characters');
    const cachedApi = apiTool(db, projectId, chat.id, 'list_characters');
    settings(db, projectId, { permissions: { characters: { read: false } } });

    const cliResult = await cachedCli.run({}) as { ok: boolean; error: string };
    const apiResult = await cachedApi.execute({}, { toolCallId: 'read', messages: [] }) as { ok: boolean; error: string };
    expect(cliResult).toMatchObject({ ok: false, error: expect.stringContaining('인물 조회') });
    expect(apiResult.error).toContain(cliResult.error);
    expect(agentCatalog(db, projectId).some((item) => item.name === 'list_characters')).toBe(false);
  });

  it('blocks character deletion when the resulting relationship cascade is not permitted', async () => {
    const { db, projectId, chat } = setup();
    settings(db, projectId, { permissions: { characters: { delete: true }, relationships: { delete: false } } });
    const alice = character(db, projectId, 'Alice')!;
    const bob = character(db, projectId, 'Bob')!;
    const relationship = db.insert(s.relationships).values({ projectId, fromId: alice.id, toId: bob.id, kind: '동료' }).returning().get();

    const denied = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'delete_items', input: { kind: 'characters', ids: [alice.id] } });
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('관계 삭제 권한') });
    expect(character(db, projectId, 'Alice')?.id).toBe(alice.id);
    expect(db.select().from(s.relationships).where(eq(s.relationships.id, relationship.id)).get()).toBeDefined();
  });

  it('keeps scene creation separate from script CRUD and translation-candidate updates across CLI and chat', async () => {
    const { db, projectId, chat } = setup();
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;

    settings(db, projectId, { permissions: { scenes: { create: false }, script: { create: false, update: true } } });
    expect(agentCatalog(db, projectId).some((entry) => entry.name === 'create_group')).toBe(false);
    const groupDenied = await proposeChange(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'create_group', input: { kind: 'scene', title: 'New scene' } });
    expect(groupDenied).toMatchObject({ ok: false, error: expect.stringContaining('장면 생성') });

    const candidate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'cli', tool: 'propose_translation', input: { unitId: unit.id, text: '안녕하세요', note: '' } });
    expect(candidate).toMatchObject({ ok: true, status: 'pending' });
    if (!candidate.ok) throw new Error(candidate.error);
    expect((await decideProposal(db, candidate.proposalId, true)).status).toBe('accepted');
    expect(db.select().from(s.candidates).where(eq(s.candidates.unitId, unit.id)).all()).toHaveLength(1);
    expect(db.select().from(s.units).where(eq(s.units.id, unit.id)).get()?.translation).toBeNull();

    settings(db, projectId, { permissions: { script: { create: false, update: false } } });
    const translationDenied = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'propose_translation', input: { unitId: unit.id, text: '다시', note: '' } });
    expect(translationDenied).toMatchObject({ ok: false, error: expect.stringContaining('대사 변경') });
  });

  it('keeps CLI source creates as proposals until accepted', async () => {
    const { db, projectId } = setup();
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const tool = cliTool(db, projectId, 'create_unit');
    expect(tool.changes).toBe(true);

    const app = new Hono<Env>()
      .use(async (c, next) => { c.set('deps', { db } as never); await next(); })
      .route('/', scriptRoutes);
    const response = await app.request(`/projects/${projectId}/tools/create_unit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId: group.id, source: 'New source line' }),
    });
    expect(response.status).toBe(200);
    const proposed = await response.json() as { proposed: boolean; proposalId: string };
    expect(proposed.proposed).toBe(true);
    expect(db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.source, 'New source line'))).get()).toBeUndefined();

    expect((await decideProposal(db, proposed.proposalId, true)).status).toBe('accepted');
    expect(db.select({ undo: s.proposals.undo }).from(s.proposals).where(eq(s.proposals.id, proposed.proposalId)).get()?.undo).toEqual({ none: '이 변경은 되돌릴 수 없습니다' });
    expect(db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.source, 'New source line'))).get()).toBeDefined();
  });

  it('registers the catalog read tools with permissions and exposes them by their actual names', () => {
    const { db, projectId } = setup();
    const catalog = agentCatalog(db, projectId);
    const requiredReadTools = ['term_usage', 'list_tags', 'plan_run', 'list_statuses', 'list_relationships', 'find_reading_route'];
    for (const name of requiredReadTools) {
      expect(catalog.some((entry) => entry.name === name && !entry.changes), name).toBe(true);
      expect(agentToolPermissionOptions(name).length, name).toBeGreaterThan(0);
      expect(agentToolAvailable({}, name), name).toBe(true);
    }
    for (const entry of catalog) {
      expect(agentToolPermissionOptions(entry.name).length, entry.name).toBeGreaterThan(0);
      expect(agentToolAvailable({}, entry.name), entry.name).toBe(true);
    }
    for (const name of ['create_unit', 'update_unit', 'delete_units', 'create_group', 'update_group', 'delete_group', 'update_status', 'delete_status', 'update_tag', 'delete_tag', 'delete_workflow']) {
      expect(catalog.some((entry) => entry.name === name && entry.changes), name).toBe(true);
    }
  });
});
