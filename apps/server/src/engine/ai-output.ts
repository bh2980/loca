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
        return { port: 'out', output: withLineKeys(answer, fields, keyOf) };
      });
    }
  }
}
