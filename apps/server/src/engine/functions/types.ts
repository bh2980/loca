import type * as s from '../../db/schema.ts';

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
  /** Why the line leaves through "error" (with that port). */
  error?: string;
}

interface Common {
  item: Item;
  /** The item's tags (lines: unit tags; terms: knowledge tags). */
  tagIds: string[];
  projectId: string;
  runId: string;
  /** The previous step's result on the item's way here (scripts and HTTP templates see it as `previous`). */
  previous?: Record<string, unknown>;
}
/** What a function gets for one item: a line, or a term (the run's subject). */
export type FunctionInput = (Common & { subject: 'lines'; unit: Unit; term?: undefined }) | (Common & { subject: 'terms'; term: Term; unit?: undefined });

/** One answer per kind of item, each given its own input. A kind left out does not compile. */
export function byInput<R>(input: FunctionInput, cases: { [S in FunctionInput['subject']]: (input: Extract<FunctionInput, { subject: S }>) => R }): R {
  return (cases[input.subject] as (input: FunctionInput) => R)(input);
}

/** The line of a line-only function's input (the runner sends other items past these nodes through "error"). */
export const lineOf = (input: FunctionInput): Unit =>
  byInput(input, {
    lines: ({ unit }) => unit,
    terms: () => {
      throw new Error('이 노드는 대사 워크플로에서만 쓸 수 있습니다.');
    },
  });

/** The term of a term-only function's input. */
export const termOf = (input: FunctionInput): Term =>
  byInput(input, {
    lines: () => {
      throw new Error('이 노드는 용어 워크플로에서만 쓸 수 있습니다.');
    },
    terms: ({ term }) => term,
  });

