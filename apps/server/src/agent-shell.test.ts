import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { agentShellApp, createApp } from './app.ts';
import type { Deps } from './context.ts';
import { openDatabase } from './db/index.ts';
import * as s from './db/schema.ts';
import { startTurn, stopTurn } from './services/chat-turns.ts';
import { importProject } from './services/importer.ts';

function setup() {
  const db = openDatabase(':memory:');
  const project = (name: string) => importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }), null as never).projectId;
  const projectId = project('A');
  const other = project('B');
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't' }).returning().get();
  const shell = agentShellApp(createApp({ db } as Deps));
  const call = (path: string, token?: string, init: RequestInit = {}) =>
    shell.fetch(new Request(`http://[::1]:5000${path}`, { ...init, headers: { host: '[::1]:5000', 'content-type': 'application/json', ...(token !== undefined ? { 'x-loca-chat': token } : {}), ...init.headers as Record<string, string> } }));
  return { db, projectId, other, chat, call };
}

describe("Codex shell's endpoint (#100 review)", () => {
  it('answers the running turn\'s agent tools and nothing else', async () => {
    const { db, projectId, other, chat, call } = setup();
    const turn = startTurn(projectId, chat.id);
    expect((await call(`/api/projects/${projectId}/tools`, turn.token)).status).toBe(200);
    // `loca` resolves LOCA_PROJECT through the project list: it sees only this one.
    expect(await (await call('/api/cli/projects', turn.token, { headers: { 'accept-encoding': 'gzip' } })).json()).toEqual([{ id: projectId, name: 'A' }]);
    expect((await call('/api/cli/projects')).status).toBe(403);
    const proposed = await call(`/api/projects/${projectId}/tools/save_character`, turn.token, { method: 'POST', body: JSON.stringify({ name: 'Bob' }) });
    expect(await proposed.json()).toMatchObject({ proposed: true });
    // The rest of the API, another project, no token or a stale one: refused before reaching it.
    const unit = db.select().from(s.units).get()!;
    const save = await call(`/api/units/${unit.id}/save`, turn.token, { method: 'POST', body: JSON.stringify({ translation: 'x' }) });
    expect(save.status).toBe(403);
    expect((await call(`/api/projects/${projectId}/units`, turn.token)).status).toBe(403);
    expect((await call(`/api/projects/${other}/tools`, turn.token)).status).toBe(403);
    expect((await call(`/api/projects/${projectId}/tools`)).status).toBe(403);
    expect((await call(`/api/projects/${projectId}/tools/save_character`, undefined, { method: 'POST', body: '{"name":"Eve"}' })).status).toBe(403);
    stopTurn(chat.id);
    expect((await call(`/api/projects/${projectId}/tools`, turn.token)).status).toBe(403);
    expect(db.select().from(s.units).get()!.translation).toBeNull();
  });
});
