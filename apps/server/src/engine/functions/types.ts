import type * as s from '../../db/schema.ts';
import type { IssueTagChange } from '../../services/issue-tags.ts';

type Unit = typeof s.units.$inferSelect;
type Term = typeof s.terms.$inferSelect;
type Item = typeof s.runItems.$inferSelect;

/** What a function hands back to the runner, which records it and routes the line. */
export interface FunctionResult {
  port: string;
  /** A new candidate text for the line (stored as a "tool" candidate). */
  candidate?: string;
  /** Stored as outputs[<node id>] for later nodes and conditions. */
  output?: Record<string, unknown>;
  /** Problems to hand to a later revise step. */
  issues?: string[];
  /** Problem-type tags this check puts on the line or takes off (services/issue-tags.ts). */
  issueTags?: IssueTagChange;
  /** Why the line leaves through "error" (with that port). */
  error?: string;
}

interface Common {
  item: Item;
  /** The item's tags (lines: unit tags; terms: knowledge tags). */
  tagIds: string[];
  projectId: string;
  runId: string;
}
/** What a function gets for one item: a line, or a term (the run's subject). */
export type FunctionInput = (Common & { subject: 'lines'; unit: Unit; term?: undefined }) | (Common & { subject: 'terms'; term: Term; unit?: undefined });

/** The line of a line-only function's input (validation keeps these nodes out of term workflows). */
export function lineOf(input: FunctionInput): Unit {
  if (input.subject !== 'lines') throw new Error('이 노드는 대사 워크플로에서만 쓸 수 있습니다.');
  return input.unit;
}

