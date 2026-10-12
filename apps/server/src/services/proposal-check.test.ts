import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { importProject } from './importer.ts';
import { prepareProposal } from './proposal-check.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  const unit = (key: string) => db.select().from(s.units).where(eq(s.units.key, key)).get()!;
  return { db, projectId, unit };
}

describe('proposal check', () => {
  it('refuses a change to a row that does not exist, before it becomes a proposal', () => {
    const { db, projectId } = setup();
    expect(prepareProposal(db, projectId, 'save_character', { id: 'nope', name: 'X' })).toEqual({ ok: false, error: expect.stringContaining('없는 인물') });
    expect(prepareProposal(db, projectId, 'save_terms', { terms: [{ id: 'gone', source: 'a', target: 'b' }] })).toEqual({ ok: false, error: expect.stringContaining('gone') });
    expect(prepareProposal(db, projectId, 'save_character', { name: 'New' })).toMatchObject({ ok: true, report: null });
  });

  it('keeps the lines of a batch that can change, fills in revs and reports the rest', () => {
    const { db, projectId, unit } = setup();
    const prepared = prepareProposal(db, projectId, 'propose_changes', {
      changes: [
        { key: 'arrival.1', translation: '새 번역' },
        { key: 'missing.1', translation: '없음' },
        { key: 'arrival.2', translation: '규칙', status: '없는 상태' },
      ],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const changes = prepared.input.changes as { key: string; rev?: number }[];
    expect(changes.map((change) => change.key)).toEqual(['arrival.1']);
    expect(changes[0].rev).toBe(unit('arrival.1').updatedAt.getTime());
    expect(prepared.report?.dropped.map((entry) => entry.key).sort()).toEqual(['arrival.2', 'missing.1']);
  });

  it('turns down a batch with nothing it could change', () => {
    const { db, projectId } = setup();
    expect(prepareProposal(db, projectId, 'propose_changes', { changes: [{ key: 'missing.1', translation: 'x' }] })).toEqual({ ok: false, error: expect.stringContaining('missing.1') });
  });

  it('applies the valid lines when accepted and skips the ones changed meanwhile', async () => {
    const { db, projectId, unit } = setup();
    const tool = agentCatalog(db, projectId).find((candidate) => candidate.name === 'propose_changes')!;
    const result = (await tool.run({ changes: [{ key: 'arrival.1', translation: '하나', rev: unit('arrival.1').updatedAt.getTime() }, { key: 'arrival.3', translation: '셋', rev: 1 }] })) as { ok: boolean; applied: number; skipped: { key: string }[] };
    expect(result).toMatchObject({ ok: true, applied: 1, skipped: [{ key: 'arrival.3' }] });
    expect(unit('arrival.1').translation).toBe('하나');
  });

  it('reports a failed update instead of claiming success', async () => {
    const { db, projectId } = setup();
    const tool = agentCatalog(db, projectId).find((candidate) => candidate.name === 'save_document')!;
    expect(await tool.run({ id: 'nope', kind: 'note', title: 't', body: '' })).toEqual({ ok: false, error: expect.stringContaining('없는 문서') });
  });
});
