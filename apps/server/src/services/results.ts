import { eq } from 'drizzle-orm';
import { checkFormat, resultRequestSchema } from '@loca/shared';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { allLines, lookups } from './script-query.ts';

type Request = z.output<typeof resultRequestSchema>;

/** How many lines go by between handing the event loop back while checking: a check over a whole game holds nothing up. */
const CHECK_STEP = 2_000;
/** How many lines the file's preview and a check's list show. */
const SAMPLE = 3;
const LISTED = 50;

/**
 * The finished translation as a file for the game. A line's translation goes in when the line is meant to be translated, is
 * in a chosen status and has a translation; every other line in scope is "the rest", and the request says whether the source
 * stands in for it (the file then has every key) or it stays out.
 */
function read(db: Db, projectId: string, { filter, statuses: chosen }: Pick<Request, 'filter' | 'statuses'>) {
  const { statuses } = lookups(db, projectId);
  const matching = (value: string) => statuses.filter((status) => status.id === value || status.name === value);
  const wanted = new Set(chosen ? chosen.flatMap((value) => matching(value).map((status) => status.id)) : statuses.filter((status) => status.kind === 'final').map((status) => status.id));
  const facts = new Map(db.select({ id: s.units.id, statusId: s.units.statusId, meta: s.units.meta }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((row) => [row.id, row]));
  const lines = allLines(db, projectId, filter).map((line) => {
    const fact = facts.get(line.id);
    const statusId = fact?.statusId ?? '';
    return { ...line, statusId, meta: fact?.meta ?? null, goesIn: !line.excluded && wanted.has(statusId) && Boolean(line.translation) };
  });
  return { lines, wanted, unknownStatuses: (chosen ?? []).filter((value) => !matching(value).length) };
}

type ReadLine = ReturnType<typeof read>['lines'][number];

const unitOf = (line: ReadLine) => ({
  key: line.key,
  source: line.source,
  translation: line.goesIn ? line.translation! : line.source,
  status: line.status,
  ...(!line.goesIn && { fromSource: true as const }),
  ...(line.meta && { meta: line.meta }),
});

/** What the file would hold: lines per status in scope, how many go in and why the rest do not, its first lines, and any chosen status that does not exist (a misspelt name in the CLI). */
export function resultPlan(db: Db, projectId: string, request: Request) {
  const { lines, wanted, unknownStatuses } = read(db, projectId, request);
  const statuses: Record<string, number> = {};
  const rest = { total: 0, excluded: 0, empty: 0, statuses: {} as Record<string, number> };
  let translated = 0;
  for (const line of lines) {
    if (!line.excluded) statuses[line.statusId] = (statuses[line.statusId] ?? 0) + 1;
    if (line.goesIn) {
      translated += 1;
      continue;
    }
    rest.total += 1;
    if (line.excluded) rest.excluded += 1;
    else if (wanted.has(line.statusId)) rest.empty += 1;
    else rest.statuses[line.statusId] = (rest.statuses[line.statusId] ?? 0) + 1;
  }
  const kept = request.rest === 'source' ? lines : lines.filter((line) => line.goesIn);
  return { total: lines.length, statuses, translated, rest, inFile: kept.length, sample: kept.slice(0, SAMPLE).map(unitOf), unknownStatuses };
}

/** The file itself; undefined without the project. */
export function resultFile(db: Db, projectId: string, request: Request) {
  const project = db.select({ name: s.projects.name, targetLanguage: s.projects.targetLanguage }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return undefined;
  const { lines } = read(db, projectId, request);
  const kept = request.rest === 'source' ? lines : lines.filter((line) => line.goesIn);
  return { format: 'translation-workbench/translations-v1' as const, project: project.name, targetLanguage: project.targetLanguage, units: kept.map(unitOf) };
}

/** The lines whose translation goes in and breaks the source's placeholders, tags or line breaks: the first few by name, and how many. */
export async function resultCheck(db: Db, projectId: string, request: Request) {
  const rules = db.select({ rules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.rules;
  const { lines } = read(db, projectId, request);
  const rows: { id: string; key: string; issue: string }[] = [];
  let total = 0;
  for (let at = 0; at < lines.length; at += CHECK_STEP) {
    for (const line of lines.slice(at, at + CHECK_STEP)) {
      if (!line.goesIn) continue;
      const issues = checkFormat(line.source, line.translation!, { placeholders: true, tags: true, newlines: true, emptyText: true }, rules);
      if (!issues.length) continue;
      total += 1;
      if (rows.length < LISTED) rows.push({ id: line.id, key: line.key, issue: issues[0]!.message });
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { total, rows };
}
