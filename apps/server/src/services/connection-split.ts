import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { eq, isNull } from 'drizzle-orm';
import { remapIds } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { copyConnections, copyKeys, markStepDone, stepDone, type KeyCopy } from './app-defaults.ts';
import type { SecretStore } from './secrets.ts';

const STEP = 'connections-per-project';

/**
 * Connections were the whole app's until 2026-10-27; now each project has its own and the home's
 * are what a new project copies. Once, on data from before: the old connections become the home's,
 * every project gets a copy of each (with its key), and what the project picked (workflow nodes,
 * conversations, editor AI, new-chat model) is moved to its copy. A copy of the database is kept
 * first (`backups/` next to it). Returns how many projects were moved.
 */
export function splitConnections(db: Db, secrets: SecretStore, file?: string): number {
  if (stepDone(db, STEP)) return 0;
  const projects = db.select({ id: s.projects.id, editorAi: s.projects.editorAi, agentSettings: s.projects.agentSettings }).from(s.projects).all();
  const shared = db.select({ id: s.connections.id }).from(s.connections).where(isNull(s.connections.projectId)).all();
  if (projects.length && shared.length && file && file !== ':memory:') {
    const dir = path.join(path.dirname(file), 'backups');
    mkdirSync(dir, { recursive: true });
    db.$client.prepare('vacuum into ?').run(path.join(dir, `workbench-${new Date().toISOString().replace(/[:.]/g, '-')}-before-connections.sqlite`));
  }
  const keys: KeyCopy[] = [];
  db.transaction((tx) => {
    if (shared.length)
      for (const project of projects) {
        const copied = copyConnections(tx, null, project.id);
        keys.push(...copied.keys);
        for (const workflow of tx.select({ id: s.workflows.id, definition: s.workflows.definition }).from(s.workflows).where(eq(s.workflows.projectId, project.id)).all())
          tx.update(s.workflows).set({ definition: remapIds(workflow.definition, copied.ids) }).where(eq(s.workflows.id, workflow.id)).run();
        for (const chat of tx.select({ id: s.chatSessions.id, connectionId: s.chatSessions.connectionId }).from(s.chatSessions).where(eq(s.chatSessions.projectId, project.id)).all())
          if (chat.connectionId && copied.ids.has(chat.connectionId)) tx.update(s.chatSessions).set({ connectionId: copied.ids.get(chat.connectionId)! }).where(eq(s.chatSessions.id, chat.id)).run();
        tx.update(s.projects).set({ editorAi: remapIds(project.editorAi, copied.ids), agentSettings: remapIds(project.agentSettings, copied.ids) }).where(eq(s.projects.id, project.id)).run();
      }
    markStepDone(tx, STEP);
  });
  copyKeys(secrets, keys);
  return shared.length ? projects.length : 0;
}
