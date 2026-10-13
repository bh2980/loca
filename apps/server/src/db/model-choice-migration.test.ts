import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from './index.ts';
import * as s from './schema.ts';

const drizzleFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A migrations folder that stops before `tag`, to build a database as it was then. */
function folderBefore(tag: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'loca-mig-'));
  dirs.push(dir);
  cpSync(drizzleFolder, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((entry) => entry.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('model profiles → model choices (0035/0036)', () => {
  it('moves each profile into the places that used it and drops the table', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loca-db-'));
    dirs.push(dir);
    const file = path.join(dir, 'workbench.sqlite');
    openDatabase(file, folderBefore('0035_model_choice')).$client.close();

    const raw = new Database(file);
    raw.exec(`
      insert into projects (id, name, source_language, target_language, created_at, updated_at) values ('p', 'P', 'en', 'ko', 0, 0);
      insert into connections (id, kind, name, created_at) values ('c1', 'openai', 'Main', 0), ('c2', 'codex', 'Backup', 0);
      insert into profiles (id, name, connection_id, model, effort, instructions, temperature, max_output_tokens, timeout_seconds, max_attempts, fallbacks, updated_at)
        values ('fast', 'A fast', 'c1', 'gpt-x', 'low', 'Keep it short.', 0.3, 12000, 120, 3, '[{"connectionId":"c2","model":"gpt-5","effort":"high"}]', 0),
               ('slow', 'B slow', 'c2', 'gpt-5', '', '', null, 8000, 600, 1, '[]', 0);
      insert into chat_sessions (id, project_id, title, profile_id, messages, created_at, updated_at) values ('chat', 'p', 'c', 'slow', '[]', 0, 0);
      insert into ai_calls (id, project_id, kind, ref_id, label, profile_id, connection_kind, model, status, started_at) values ('call', null, 'test', 'fast', 't', 'fast', 'openai', 'gpt-x', 'ok', 0);
    `);
    const node = (id: string, config: Record<string, unknown>) => ({ id, type: 'ai', position: { x: 0, y: 0 }, config: { instructions: 'Translate.', output: 'candidate', ...config } });
    const definition = { nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [] } }, node('a', { profileId: 'fast', extraProfileIds: ['slow'] }), node('b', { profileId: 'gone' })], edges: [] };
    raw.prepare("insert into workflows (id, project_id, name, definition, updated_at) values ('w', 'p', 'W', ?, 0)").run(JSON.stringify(definition));
    const snapshot = { fast: { id: 'fast', name: 'A fast', instructions: 'Keep it short.', temperature: 0.3, maxOutputTokens: 12000, timeoutSeconds: 120, maxAttempts: 3, routes: [{ connectionId: 'c1', kind: 'openai', baseUrl: null, executable: null, model: 'gpt-x', effort: 'low' }] } };
    raw
      .prepare("insert into runs (id, project_id, workflow_name, workflow_version, definition, profiles, scope, status, total, created_at) values ('r', 'p', 'W', 1, ?, ?, '{}', 'paused', 1, 0)")
      .run(JSON.stringify({ ...definition, nodes: definition.nodes.slice(0, 2) }), JSON.stringify(snapshot));
    raw.close();

    const db = openDatabase(file, drizzleFolder);
    const connections = new Map(db.select().from(s.connections).all().map((row) => [row.id, row]));
    expect(connections.get('c1')).toMatchObject({ defaultModel: 'gpt-x', defaultEffort: 'low', timeoutSeconds: 120, maxAttempts: 3, maxOutputTokens: 12000, fallback: { connectionId: 'c2', model: 'gpt-5', effort: 'high' } });
    expect(connections.get('c2')).toMatchObject({ defaultModel: 'gpt-5', defaultEffort: null, timeoutSeconds: 600, maxAttempts: 1, fallback: null });

    const workflow = db.select().from(s.workflows).get()!;
    // Still a valid definition: the app reads it with the same schema.
    const nodes = workflowDefinitionSchema.parse(workflow.definition).nodes;
    expect(nodes.map((n) => n.id)).toEqual(['entry', 'a', 'b']);
    expect(nodes[1]).toMatchObject({ config: { model: { connectionId: 'c1', model: 'gpt-x', effort: 'low' }, extraModels: [{ connectionId: 'c2', model: 'gpt-5' }], temperature: 0.3, instructions: 'Translate.\n\nKeep it short.' } });
    expect((nodes[1]!.config as { extraModels: object[] }).extraModels[0]).not.toHaveProperty('effort');
    expect(nodes[2]).toMatchObject({ config: { model: { connectionId: '', model: '' }, extraModels: [], instructions: 'Translate.' } });
    expect(nodes[2]!.config).not.toHaveProperty('temperature');
    expect(nodes[2]!.config).not.toHaveProperty('profileId');

    const run = db.select().from(s.runs).get()!;
    expect(run.definition.nodes[1]).toMatchObject({ config: { model: { connectionId: 'c1', model: 'gpt-x', effort: 'low' }, temperature: 0.3 } });
    expect(run.models).toEqual({ 'c1|gpt-x|low': { label: 'A fast', maxOutputTokens: 12000, timeoutSeconds: 120, maxAttempts: 3, routes: [{ connectionId: 'c1', name: 'Main', kind: 'openai', baseUrl: null, executable: null, model: 'gpt-x', effort: 'low' }] } });

    expect(db.select().from(s.chatSessions).get()).toMatchObject({ connectionId: 'c2', model: 'gpt-5', effort: null });
    expect(db.select().from(s.aiCalls).get()).toMatchObject({ refId: 'c1', connectionId: 'c1' });
    expect(db.$client.prepare("select name from sqlite_master where name = 'profiles'").get()).toBeUndefined();
  });
});
