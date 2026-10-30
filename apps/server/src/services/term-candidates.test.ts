import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, withMainTarget, withTargetCandidate } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { saveTerm, upsertAiTerm } from './terms.ts';

// A term keeps every Korean form it had or was offered; `target` is the one used.
function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Terms' }, groups: [{ key: 'g', title: 'Menu' }], units: [{ key: 'u', group: 'g', source: 'Continue', kind: 'ui' }] }));
  const term = () => db.select().from(s.terms).where(eq(s.terms.source, 'Continue')).get()!;
  return { db, projectId, term };
}

describe('a term\'s Korean forms', () => {
  it('moves the former main one to the candidates and never keeps the main one twice', () => {
    expect(withMainTarget({ target: '이어하기', targetCandidates: ['계속'] }, '계속하기')).toEqual({ target: '계속하기', targetCandidates: ['이어하기', '계속'] });
    expect(withMainTarget({ target: '이어하기', targetCandidates: ['계속하기'] }, '계속하기')).toEqual({ target: '계속하기', targetCandidates: ['이어하기'] });
    expect(withTargetCandidate({ target: '이어하기', targetCandidates: [] }, '이어하기')).toEqual([]);
    expect(withTargetCandidate({ target: '이어하기', targetCandidates: [] }, '계속하기')).toEqual(['계속하기']);
  });

  it('an AI form becomes the main one when AI results are confirmed right away, else a candidate; a person\'s main one stays', () => {
    const { db, projectId, term } = setup();
    upsertAiTerm(db, projectId, { source: 'Continue', target: '이어하기' }, { autoConfirm: true });
    upsertAiTerm(db, projectId, { source: 'Continue', target: '계속하기' }, { autoConfirm: true });
    expect([term().target, term().targetCandidates]).toEqual(['계속하기', ['이어하기']]);

    upsertAiTerm(db, projectId, { source: 'Continue', target: '재개' }, { autoConfirm: false });
    expect([term().target, term().targetCandidates]).toEqual(['계속하기', ['재개', '이어하기']]);

    // A person picks a candidate (the pane's 메인으로): the AI may offer, not replace.
    saveTerm(db, projectId, { target: '이어하기' }, { id: term().id });
    expect([term().target, term().targetCandidates, term().statusBy]).toEqual(['이어하기', ['계속하기', '재개'], 'human']);
    upsertAiTerm(db, projectId, { source: 'Continue', target: '계속하기' }, { autoConfirm: true });
    expect([term().target, term().targetCandidates]).toEqual(['이어하기', ['계속하기', '재개']]);
  });
});
