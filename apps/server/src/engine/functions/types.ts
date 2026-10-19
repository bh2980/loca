import type * as s from '../../db/schema.ts';
import type { IssueTagChange } from '../../services/issue-tags.ts';

type Unit = typeof s.units.$inferSelect;
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
}

export interface FunctionInput {
  unit: Unit;
  item: Item;
  tagIds: string[];
  projectId: string;
  runId: string;
}

