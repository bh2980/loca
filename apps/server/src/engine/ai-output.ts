import type { AiNode, IssueKind, JsonField } from '@tw/shared';
import type { FunctionResult } from './functions/index.ts';
import type { PromptLine } from './prompts.ts';

/** A node's result for one line: the exit to take plus what it produced. */
export interface Outcome extends FunctionResult {
  /** Candidate provenance when `candidate` is set. */
  origin?: 'ai' | 'tool';
  model?: string;
  error?: string;
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

/**
 * An AI node's answer read line by line (#49: out of runner.ts, no state of its own). Line-scope
 * outputs give each line its own outcome, or null when the answer left the line out (the runner
 * retries or fails those). A batch-scope json answer describes the whole request: only the first
 * line carries it (batchLeader). `choiceOptions` are the options the choice was asked with.
 */
export function readAiOutput(node: AiNode, raw: unknown, lines: PromptLine[], model: string, choiceOptions: string[] = node.config.choice.values): (Outcome | null)[] {
  const keyOf = new Map(lines.map((line) => [line.id, line.key]));
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
        // A review covers every kind: passing clears them, failing names what it found (기타 when it did not say).
        const kinds = result.categories?.length ? [...new Set(result.categories)] : (['other'] as IssueKind[]);
        return {
          port: result.passed ? 'pass' : 'fail',
          issues: result.passed ? undefined : result.issues,
          output: { passed: result.passed, issues: result.issues, ...(!result.passed && { categories: kinds }) },
          issueTags: result.passed ? { clear: 'all' } : { add: kinds },
        };
      });
    case 'choice':
      return lines.map((line) => {
        const entry = entryOf(line);
        if (!entry) return null;
        const answer = typeof entry.value === 'string' ? entry.value.trim() : '';
        // An answer outside the options counts as no answer.
        const chosen = answer && (!choiceOptions.length || choiceOptions.includes(answer)) ? answer : null;
        const reason = typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined;
        return { port: 'out', output: { value: chosen, confidence: Math.min(1, Math.max(0, Number(entry.confidence) || 0)), ...(reason && { reason }) } };
      });
    case 'json': {
      const fields = node.config.fields;
      if (node.config.scope === 'batch') {
        // One answer for the whole request; to save space in run_items.data (H7) only the first line carries it.
        const found = withLineKeys((raw ?? {}) as Record<string, unknown>, fields, keyOf);
        return lines.map((_, index) => ({ port: 'out', output: index === 0 ? { ...found, batchLeader: true } : { batchLeader: false } }));
      }
      return lines.map((line) => {
        const entry = entryOf(line);
        if (!entry) return null;
        const { id: _id, ...answer } = entry;
        return { port: 'out', output: withLineKeys(answer, fields, keyOf) };
      });
    }
  }
}
