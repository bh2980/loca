import { OTHERS_LISTENER, type AiNode, type IssueKind, type ItemErrorKind, type JsonField } from '@tw/shared';
import type { FunctionResult } from './functions/index.ts';
import { answerSchema, type PromptLine } from './prompts.ts';

/** A node's result for one line: the exit to take plus what it produced. */
export interface Outcome extends FunctionResult {
  /** Candidate provenance when `candidate` is set. */
  origin?: 'ai' | 'tool';
  model?: string;
  error?: string;
  /** The failure kind an error exit carries (default: other). */
  errorKind?: ItemErrorKind;
}

/**
 * Evidence ids ("lines" fields, at any depth) turned from the prompt's line ids into line keys, so
 * the answer outlives the prompt. Ids that are not lines of the request are dropped.
 */
function withLineKeys(value: Record<string, unknown>, fields: JsonField[], keyOf: Map<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  for (const field of fields) {
    const entry = result[field.name];
    if (field.type === 'lines' && Array.isArray(entry)) result[field.name] = entry.flatMap((id) => (typeof id === 'string' && keyOf.has(id.trim()) ? [keyOf.get(id.trim())!] : []));
    else if (field.type === 'list' && Array.isArray(entry) && field.fields) result[field.name] = entry.map((item) => (item && typeof item === 'object' ? withLineKeys(item as Record<string, unknown>, field.fields!, keyOf) : item));
  }
  return result;
}

/** The line keys that the "lines" fields of the previous step's results hold (at any depth): the ids a combining request may cite. */
function partKeys(value: unknown, fields: JsonField[]): Set<string> {
  const keys = new Set<string>();
  const names = new Set<string>();
  const collect = (list: JsonField[]) => list.forEach((field) => (field.type === 'lines' ? names.add(field.name) : collect(field.fields ?? [])));
  collect(fields);
  const walk = (entry: unknown) => {
    if (Array.isArray(entry)) return entry.forEach(walk);
    if (!entry || typeof entry !== 'object') return;
    for (const [name, child] of Object.entries(entry)) {
      if (names.has(name) && Array.isArray(child)) child.forEach((key) => typeof key === 'string' && key && keys.add(key));
      else walk(child);
    }
  };
  walk(value);
  return keys;
}

const nameKey = (name: unknown) => (typeof name === 'string' ? name.trim().toLowerCase() : '');

/** Whether the fields ask for pairs of people with a view per direction (a `relationships` list with `between` and `views`). */
const asksRelationshipViews = (fields: JsonField[]) => fields.some((field) => field.name === 'relationships' && field.type === 'list' && field.fields?.some((sub) => sub.name === 'views') && field.fields?.some((sub) => sub.name === 'between'));

/**
 * What is wrong with the relationships of an answer, or null: each pair names two different people
 * ("between") and has one or two views, each a direction of the pair (from → to or to → from), no
 * direction twice. Names are
 * compared as the script spells them; whether a person exists is for the save to find out.
 */
export function relationshipViewsProblem(answer: unknown): string | null {
  const list = (answer as { relationships?: unknown } | null)?.relationships;
  if (!Array.isArray(list)) return null;
  for (const [index, pair] of list.entries()) {
    const { between, views } = (pair ?? {}) as { between?: unknown; views?: unknown };
    const names = Array.isArray(between) ? between.map((name) => String(name).trim()) : [];
    const label = `relationships[${index}]${names.length ? ` (${names.join(' ↔ ')})` : ''}`;
    if (names.length !== 2 || !names[0] || !names[1] || nameKey(names[0]) === nameKey(names[1])) return `${label}: "between" must name two different people.`;
    const directions = (Array.isArray(views) ? views : []).map((view) => `${nameKey((view as { from?: unknown })?.from)}>${nameKey((view as { to?: unknown })?.to)}`);
    const wanted = [`${nameKey(names[0])}>${nameKey(names[1])}`, `${nameKey(names[1])}>${nameKey(names[0])}`];
    if (!directions.length || directions.length > 2 || !directions.every((direction) => wanted.includes(direction)) || new Set(directions).size !== directions.length)
      return `${label}: "views" must be one or two, each ${names[0]} → ${names[1]} or ${names[1]} → ${names[0]}, no direction twice (got ${directions.length}).`;
  }
  return null;
}

/**
 * An AI node's answer read line by line (#49: out of runner.ts, no state of its own). Line-scope
 * outputs give each line its own outcome, or null when the answer left the line out (the runner
 * retries or fails those). A batch-scope json answer describes the whole request: only the first
 * line carries it (batchLeader). `choiceOptions` are the options the choice was asked with.
 */
export function readAiOutput(node: AiNode, raw: unknown, lines: PromptLine[], model: string, choiceOptions: string[] = node.config.choice.values): (Outcome | null)[] {
  const keyOf = new Map(lines.map((line) => [line.id, line.key]));
  // A request without lines (parts to combine) cites the line keys its parts carry; only those are kept.
  if (!node.config.input.lines) for (const key of partKeys(lines.map((line) => line.previous), node.config.fields)) keyOf.set(key, key);
  const value = raw as { results?: ({ id: string } & Record<string, unknown>)[] };
  const entryOf = (line: PromptLine) => value.results?.find((entry) => entry.id === line.id);
  switch (node.config.output) {
    case 'text':
      return lines.map((line) => {
        const text = entryOf(line)?.text;
        return typeof text !== 'string' || !text.trim() ? null : { port: 'out', candidate: text, origin: 'ai', model, output: { text } };
      });
    case 'verdict':
      return lines.map((line) => {
        const result = entryOf(line) as ({ passed: boolean; issues: string[]; categories?: IssueKind[] } & { id: string }) | undefined;
        if (!result) return null;
        // Failing names what it found (기타 when it did not say); a 태그 붙이기 node after it turns that into tags.
        const kinds = result.categories?.length ? [...new Set(result.categories)] : (['other'] as IssueKind[]);
        return {
          port: result.passed ? 'pass' : 'fail',
          issues: result.passed ? undefined : result.issues,
          output: { passed: result.passed, issues: result.issues, ...(!result.passed && { categories: kinds }) },
        };
      });
    case 'choice':
      return lines.map((line) => {
        const entry = entryOf(line);
        if (!entry) return null;
        const answer = typeof entry.value === 'string' ? entry.value.trim() : '';
        const given = typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined;
        const confidence = Math.min(1, Math.max(0, Number(entry.confidence) || 0));
        // No answer at all is an explicit "none of these" (해당 없음): value null.
        if (!answer) return { port: 'out', output: { value: null, confidence, ...(given && { reason: given }) } };
        if (!choiceOptions.length || choiceOptions.includes(answer)) return { port: 'out', output: { value: answer, confidence, ...(given && { reason: given }) } };
        // An answer outside the options: a name the cast does not have is someone without a profile (그 밖의 인물),
        // the AI's own words kept as the reason; for any other list the line leaves through the error exit.
        if (node.config.choice.source === 'characters') {
          const reason = `AI가 적은 청자: ${answer}${given ? ` · ${given}` : ''}`;
          return { port: 'out', output: { value: OTHERS_LISTENER, confidence, reason } };
        }
        return { port: 'error', error: `선택지에 없는 답: ${answer}`, errorKind: 'invalid-output' };
      });
    case 'json': {
      const fields = node.config.fields;
      const strict = answerSchema(fields);
      if (node.config.scope === 'batch') {
        // An answer that breaks a field's limits counts as none: every line is asked again.
        if (!strict.safeParse(raw ?? {}).success) return lines.map(() => null);
        // Pairs whose views are not one or two distinct directions of the pair fail the request, so a 재요청 node can send it again.
        const problem = asksRelationshipViews(fields) ? relationshipViewsProblem(raw) : null;
        if (problem) return lines.map(() => ({ port: 'error', error: `관계 형식이 맞지 않습니다: ${problem}`, errorKind: 'invalid-output' as const }));
        // One answer for the whole request; to save space in run_items.data (H7) only the first line carries it.
        const found = withLineKeys((raw ?? {}) as Record<string, unknown>, fields, keyOf);
        return lines.map((_, index) => ({ port: 'out', output: index === 0 ? { ...found, batchLeader: true } : { batchLeader: false } }));
      }
      return lines.map((line) => {
        const entry = entryOf(line);
        if (!entry) return null;
        const { id: _id, ...answer } = entry;
        // A line whose answer breaks a field's limits (empty required, number out of bounds) is asked again.
        if (!strict.safeParse(answer).success) return null;
        const problem = asksRelationshipViews(fields) ? relationshipViewsProblem(answer) : null;
        if (problem) return { port: 'error', error: `관계 형식이 맞지 않습니다: ${problem}`, errorKind: 'invalid-output' };
        return { port: 'out', output: withLineKeys(answer, fields, keyOf) };
      });
    }
  }
}
