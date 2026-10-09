import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { contextConfigSchema, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { buildContext } from './context.ts';
import { importProject } from './importer.ts';

// The sample has a choice (panel / logbook) that joins before the tower, and a loop back into it.
function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  const rows = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.sort)).all();
  const unit = (key: string) => rows.find((row) => row.key === key)!;
  return { db, projectId, unit, rows };
}

const config = (patch: Partial<ReturnType<typeof contextConfigSchema.parse>> = {}) => ({ ...contextConfigSchema.parse({}), ...patch });
const keys = (lines: { key: string }[]) => lines.map((line) => line.key);

describe('context builder', () => {
  it('follows one path back while there is one', () => {
    const { db, projectId, unit } = setup();
    const context = buildContext(db, projectId, [unit('panel.2')], config({ precedingLines: 3 }));
    expect(keys(context.preceding[unit('panel.2').id].lines)).toEqual(['arrival.2', 'arrival.3', 'panel.1']);
    expect(context.preceding[unit('panel.2').id].branches).toEqual([]);
  });

  it('keeps joining paths apart instead of mixing them into one conversation', () => {
    const { db, projectId, unit } = setup();
    const context = buildContext(db, projectId, [unit('tower.1')], config({ precedingLines: 4 }));
    const preceding = context.preceding[unit('tower.1').id];
    expect(preceding.lines).toEqual([]);
    const byPath = Object.fromEntries(preceding.branches.map((branch) => [branch.label, keys(branch.lines)]));
    expect(byPath).toEqual({
      repeat: ['tower.2', 'tower.3'],
      panel: ['arrival.2', 'arrival.3', 'panel.1', 'panel.2'],
      logbook: ['arrival.3', 'logbook.1', 'logbook.2', 'logbook.3'],
    });
    expect(context.items.find((item) => item.kind === 'preceding')?.reason).toContain('갈래별로 나눔');
  });

  it('shows outside lines once per batch and never lines that are in the batch', () => {
    const { db, projectId, unit } = setup();
    const batch = ['panel.1', 'panel.2'].map(unit);
    const context = buildContext(db, projectId, batch, config({ precedingLines: 3 }));
    expect(keys(context.preceding[unit('panel.1').id].lines)).toEqual(['arrival.1', 'arrival.2', 'arrival.3']);
    expect(context.preceding[unit('panel.2').id]).toBeUndefined();
  });

  it('can leave out existing translations of preceding lines', () => {
    const { db, projectId, unit } = setup();
    db.update(s.units).set({ translation: '정답' }).where(eq(s.units.id, unit('panel.1').id)).run();
    const shown = buildContext(db, projectId, [unit('panel.2')], config()).preceding[unit('panel.2').id].lines;
    const hidden = buildContext(db, projectId, [unit('panel.2')], config({ precedingTranslations: false })).preceding[unit('panel.2').id].lines;
    expect(shown.find((line) => line.key === 'panel.1')?.translation).toBe('정답');
    expect(hidden.every((line) => !('translation' in line))).toBe(true);
  });

  it('fills in priority order and records what the cap dropped', () => {
    const { db, projectId, unit } = setup();
    db.insert(s.documents).values({ projectId, kind: 'world', title: '긴 설정집', body: '설정 '.repeat(3000), alwaysInclude: true }).run();
    const full = buildContext(db, projectId, [unit('ending.2')], config({ maxTokens: 200_000 }));
    expect(full.documents.map((doc) => doc.title)).toContain('긴 설정집');
    const big = full.items.find((item) => item.label === '긴 설정집')!;
    const rest = full.items.filter((item) => item !== big).reduce((sum, item) => sum + item.tokens, 0);
    const tight = buildContext(db, projectId, [unit('ending.2')], config({ maxTokens: Math.max(500, rest) }));
    expect(tight.terms.map((term) => term.source)).toEqual(['Directorate']);
    expect(tight.characters.length).toBe(full.characters.length);
    expect(tight.documents.map((doc) => doc.title)).not.toContain('긴 설정집');
    expect(tight.items.find((item) => item.label === '긴 설정집')?.included).toBe(false);
    expect(tight.budget.used).toBeLessThanOrEqual(tight.budget.limit);
    expect(tight.items.map((item) => item.kind)).toEqual(full.items.map((item) => item.kind));
  });
});
