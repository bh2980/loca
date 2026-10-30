import { eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../context.ts';
import { appSettingsRoutes } from '../routes/app-settings.ts';
import { DEFAULT_STATUSES, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { pullDefaults, pushDefaults, readAppDefaults, writeAppDefaults } from './app-defaults.ts';
import { splitConnections } from './connection-split.ts';
import { importProject } from './importer.ts';
import { memoryStore } from './secrets.ts';
import { workflowIssues } from './workflow-issues.ts';

const file = (name = 'P') => importFileSchema.parse({ format: 'loca/v1', project: { name }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hello', translation: '안녕', tags: ['보스'] }, { key: 'b', group: 'g', source: 'Bye' }] });

function setup() {
  const db = openDatabase(':memory:');
  const secrets = memoryStore();
  const home = db.insert(s.connections).values({ kind: 'openai', name: 'API', baseUrl: 'http://localhost:1/v1' }).returning().get();
  secrets.set(home.id, 'sk-home');
  return { db, secrets, home };
}
const connectionsOf = (db: ReturnType<typeof setup>['db'], projectId: string) => db.select().from(s.connections).where(eq(s.connections.projectId, projectId)).all();
const statusNames = (db: ReturnType<typeof setup>['db'], projectId: string) => db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().sort((a, b) => a.sort - b.sort).map((row) => row.name);

describe('a new project starts from the 홈 설정', () => {
  it('without home changes: the statuses, tag and five workflows a project starts with', () => {
    const { db } = setup();
    const { projectId } = importProject(db, file());
    expect(statusNames(db, projectId)).toEqual(DEFAULT_STATUSES.map((status) => status.name));
    expect(db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map((row) => row.name)).toEqual(['번역', '검수', '청자 추정', '인물·관계 추출', '사건 추출']);
    const units = db.select({ key: s.units.key, status: s.statuses.name }).from(s.units).innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId)).all();
    expect(Object.fromEntries(units.map((unit) => [unit.key, unit.status]))).toEqual({ a: '번역됨', b: '미번역' });
  });

  it('copies the home connections with their keys, and points its settings at the copies', () => {
    const { db, secrets, home } = setup();
    writeAppDefaults(db, { agentSettings: { ...readAppDefaults(db).agentSettings, chatModel: { connectionId: home.id, model: 'gpt' } } });
    const { projectId } = importProject(db, file(), undefined, secrets);
    const [copy] = connectionsOf(db, projectId);
    expect(copy).toMatchObject({ name: 'API', kind: 'openai', baseUrl: 'http://localhost:1/v1' });
    expect(copy.id).not.toBe(home.id);
    expect(secrets.get(copy.id)).toBe('sk-home');
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    expect(project.agentSettings.chatModel).toEqual({ connectionId: copy.id, model: 'gpt' });
  });

  it('takes the home statuses, tags and workflows; the file\'s tag of the same name is the home\'s tag', () => {
    const { db } = setup();
    writeAppDefaults(db, {
      statuses: [
        { id: 'new', name: '새 줄', color: '#79818c', kind: 'initial', inReview: false },
        { id: 'draft', name: '초벌', color: '#0486d3', kind: 'normal', inReview: false },
        { id: 'done', name: '끝', color: '#2a9754', kind: 'final', inReview: false },
      ],
      tags: [{ id: 't', name: '보스', color: '#0091ad', scope: ['lines'] }],
      workflows: { templates: ['translation'], saved: [] },
    });
    const { projectId } = importProject(db, file());
    expect(statusNames(db, projectId)).toEqual(['새 줄', '초벌', '끝']);
    expect(db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => tag.name).sort()).toEqual(['AI 실패', '보스']);
    const units = db.select({ key: s.units.key, status: s.statuses.name }).from(s.units).innerJoin(s.statuses, eq(s.statuses.id, s.units.statusId)).all();
    expect(Object.fromEntries(units.map((unit) => [unit.key, unit.status]))).toEqual({ a: '초벌', b: '새 줄' });
    expect(db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map((row) => row.name)).toEqual(['번역']);
  });

  it('a later home change leaves the project as it was', () => {
    const { db } = setup();
    const { projectId } = importProject(db, file());
    writeAppDefaults(db, { aiAutoConfirm: false, statuses: [{ id: 'x', name: '시작', color: '#79818c', kind: 'initial', inReview: false }, { id: 'y', name: '끝', color: '#2a9754', kind: 'final', inReview: false }] });
    expect(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!.aiAutoConfirm).toBe(true);
    expect(statusNames(db, projectId)).toEqual(DEFAULT_STATUSES.map((status) => status.name));
  });

  it('a change to one section leaves the others as they were', async () => {
    const { db } = setup();
    writeAppDefaults(db, { statuses: [...readAppDefaults(db).statuses, { id: 'r', name: '재검토', color: '#d24c49', kind: 'normal', inReview: false }] });
    const app = new Hono<Env>().use(async (c, next) => (c.set('deps', { db, secrets: memoryStore() } as never), next())).route('/', appSettingsRoutes);
    const response = await app.request('/app/defaults', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aiAutoConfirm: false }) });
    expect(response.status).toBe(200);
    expect(readAppDefaults(db)).toMatchObject({ aiAutoConfirm: false, statuses: expect.arrayContaining([expect.objectContaining({ name: '재검토' })]) });
  });

  it('refuses home statuses without a start or a final one', () => {
    const { db } = setup();
    expect(() => writeAppDefaults(db, { statuses: [{ id: 'x', name: '시작', color: '#79818c', kind: 'initial', inReview: false }] })).toThrow('완료 상태');
  });
});

describe('홈 기본값 가져오기 and 홈 기본값으로 저장', () => {
  it('pull replaces values, updates a connection of the same name in place and only adds missing statuses', () => {
    const { db, secrets, home } = setup();
    const { projectId } = importProject(db, file(), undefined, secrets);
    const [copy] = connectionsOf(db, projectId);
    db.update(s.connections).set({ baseUrl: 'http://localhost:9/v1' }).where(eq(s.connections.id, home.id)).run();
    secrets.set(home.id, 'sk-new');
    writeAppDefaults(db, { aiAutoConfirm: false, statuses: [...readAppDefaults(db).statuses, { id: 'r', name: '재검토', color: '#d24c49', kind: 'normal', inReview: true }] });
    const report = pullDefaults(db, projectId, ['connections', 'aiAutoConfirm', 'statuses'], secrets);
    expect(report).toMatchObject({ connections: '1개', aiAutoConfirm: '바꿈', statuses: '1개 추가' });
    const [after] = connectionsOf(db, projectId);
    expect(after).toMatchObject({ id: copy.id, baseUrl: 'http://localhost:9/v1' });
    expect(secrets.get(copy.id)).toBe('sk-new');
    expect(statusNames(db, projectId)).toEqual([...DEFAULT_STATUSES.map((status) => status.name), '재검토']);
    expect(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!.aiAutoConfirm).toBe(false);
  });

  it('a pushed workflow comes into another project with that project\'s statuses, tags and connection, by name', () => {
    const { db, secrets } = setup();
    const first = importProject(db, file('A'), undefined, secrets).projectId;
    const [connection] = connectionsOf(db, first);
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, first)).all().find((row) => row.name === '번역')!;
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, model: { connectionId: connection.id, model: 'gpt' } } } : node)) };
    db.update(s.workflows).set({ name: '내 번역', definition }).where(eq(s.workflows.id, workflow.id)).run();
    pushDefaults(db, first, ['workflows'], [workflow.id]);
    expect(readAppDefaults(db).workflows.saved.map((saved) => saved.name)).toEqual(['내 번역']);

    const second = importProject(db, file('B'), undefined, secrets).projectId;
    const copied = db.select().from(s.workflows).where(eq(s.workflows.projectId, second)).all().find((row) => row.name === '내 번역')!;
    const [secondConnection] = connectionsOf(db, second);
    const models = copied.definition.nodes.flatMap((node) => (node.type === 'ai' ? [node.config.model.connectionId] : []));
    expect(new Set(models)).toEqual(new Set([secondConnection.id]));
    expect(JSON.stringify(copied.definition)).not.toContain(connection.id);
    expect(workflowIssues(db, second, copied.definition).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('push merges saved instructions by name (the project\'s win) and keeps the home\'s chat settings otherwise', () => {
    const { db } = setup();
    const { projectId } = importProject(db, file());
    writeAppDefaults(db, { agentSettings: { ...readAppDefaults(db).agentSettings, prompts: [{ name: '요약', text: '홈' }, { name: '검수', text: '홈' }] } });
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    db.update(s.projects).set({ agentSettings: { ...project.agentSettings, defaultPermissionMode: 'auto', prompts: [{ name: '요약', text: '프로젝트' }] } }).where(eq(s.projects.id, projectId)).run();
    pushDefaults(db, projectId, ['prompts']);
    const after = readAppDefaults(db).agentSettings;
    expect(after.prompts).toEqual([{ name: '검수', text: '홈' }, { name: '요약', text: '프로젝트' }]);
    expect(after.defaultPermissionMode).toBe('ask');
  });
});

describe('splitting the connections of data from before', () => {
  it('gives every project its own copies and moves what it picked to them, once', () => {
    const db = openDatabase(':memory:');
    const secrets = memoryStore();
    const { projectId } = importProject(db, file());
    // Data from before: a shared connection the project's workflow and chat use.
    const shared = db.insert(s.connections).values({ kind: 'openai', name: 'API', baseUrl: 'http://localhost:1/v1' }).returning().get();
    secrets.set(shared.id, 'sk');
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all()[0];
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, model: { connectionId: shared.id, model: 'gpt' } } } : node)) };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
    db.insert(s.chatSessions).values({ projectId, title: '대화', connectionId: shared.id, model: 'gpt' }).run();

    expect(splitConnections(db, secrets)).toBe(1);
    const [own] = connectionsOf(db, projectId);
    expect(own.name).toBe('API');
    expect(secrets.get(own.id)).toBe('sk');
    expect(db.select().from(s.chatSessions).get()!.connectionId).toBe(own.id);
    const moved = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!;
    expect(JSON.stringify(moved.definition)).toContain(own.id);
    expect(JSON.stringify(moved.definition)).not.toContain(shared.id);
    expect(db.select().from(s.connections).where(isNull(s.connections.projectId)).all().map((row) => row.id)).toEqual([shared.id]);

    expect(splitConnections(db, secrets)).toBe(0);
    expect(connectionsOf(db, projectId)).toHaveLength(1);
  });
});

describe('credential copies', () => {
  it.each([true, false])('replaces or clears a previous target key on pull and push (source key: %s)', (hasKey) => {
    const { db, secrets, home } = setup();
    const { projectId } = importProject(db, file(), undefined, secrets);
    const [copy] = connectionsOf(db, projectId);
    if (!hasKey) secrets.delete(home.id);
    db.update(s.connections).set({ baseUrl: 'https://new.invalid/v1' }).where(eq(s.connections.id, home.id)).run();
    pullDefaults(db, projectId, ['connections'], secrets);
    expect(secrets.get(copy.id)).toBe(hasKey ? 'sk-home' : null);
    expect(connectionsOf(db, projectId)[0].baseUrl).toBe('https://new.invalid/v1');
    secrets.set(home.id, 'old-home-key');
    pushDefaults(db, projectId, ['connections'], [], secrets);
    expect(secrets.get(home.id)).toBe(hasKey ? 'sk-home' : null);
    db.$client.close();
  });

  it('keeps a failed copy pending and refuses the old key until the keyring recovers', async () => {
    const { connectionRoute } = await import('./routes.ts');
    const { db, secrets, home } = setup();
    const { projectId } = importProject(db, file(), undefined, secrets);
    const [copy] = connectionsOf(db, projectId);
    secrets.delete(home.id);
    db.update(s.connections).set({ baseUrl: 'https://new.invalid/v1' }).where(eq(s.connections.id, home.id)).run();
    const broken = { ...secrets, delete: () => { throw new Error('keyring locked'); } };
    expect(() => pullDefaults(db, projectId, ['connections'], broken)).toThrow('keyring locked');
    expect(db.select().from(s.connectionKeyCopies).all()).toEqual([{ sourceId: home.id, targetId: copy.id }]);
    expect(() => connectionRoute(db, copy.id, broken)).toThrow('keyring locked');
    expect(connectionRoute(db, copy.id, secrets)).toMatchObject({ baseUrl: 'https://new.invalid/v1', apiKey: undefined });
    expect(db.select().from(s.connectionKeyCopies).all()).toEqual([]);
    db.$client.close();
  });

  it('retries a partially failed migration without duplicating connections or marking it done early', () => {
    const { db, secrets } = setup();
    const first = importProject(db, file('A')).projectId;
    const second = importProject(db, file('B')).projectId;
    // Clear seed copies to model a database from before project-owned connections.
    db.delete(s.connections).where(eq(s.connections.projectId, first)).run();
    db.delete(s.connections).where(eq(s.connections.projectId, second)).run();
    let calls = 0;
    expect(() => splitConnections(db, { ...secrets, set: (id, key) => { if (++calls === 2) throw new Error('keyring locked'); secrets.set(id, key); } })).toThrow('keyring locked');
    const ids = [...connectionsOf(db, first), ...connectionsOf(db, second)].map((row) => row.id);
    expect(db.select().from(s.appSettings).get()?.done ?? []).not.toContain('connections-per-project');
    expect(splitConnections(db, secrets)).toBe(2);
    expect([...connectionsOf(db, first), ...connectionsOf(db, second)].map((row) => row.id)).toEqual(ids);
    expect(ids.map((id) => secrets.get(id))).toEqual(['sk-home', 'sk-home']);
    expect(splitConnections(db, secrets)).toBe(0);
    db.$client.close();
  });
});
