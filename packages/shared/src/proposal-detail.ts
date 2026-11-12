import type { AutoMark } from './marks.ts';

/**
 * What a proposal's card says the change does, in the few shapes a card can draw. The server's definition of each
 * tool makes them from the proposal's input and the project's own data (its `preview`, services/agent-tools.ts):
 * names instead of ids, what an item holds now beside what it gets. The card draws each kind one way and never
 * looks at the tool's name, so a new tool needs no card of its own.
 */
export type ProposalDetail =
  /** Label → value rows. `code`: the value is shown as written (JSON, a script). */
  | { kind: 'fields'; rows: { label: string; value: string; code?: true }[] }
  /** The items a change saves, each with what it was and what it becomes, field by field (no `before`: a new value). */
  | { kind: 'changes'; items: { title: string; changes: { field: string; before?: string; after: string }[] }[] }
  /** Short entries under an optional title; `more`: how many are not listed. */
  | { kind: 'list'; title?: string; items: string[]; more?: number }
  /** Longer text: markdown (a profile, a note's body) or as written. */
  | { kind: 'text'; format: 'markdown' | 'plain'; text: string }
  /** Automatic marks, shown as their chips. */
  | { kind: 'marks'; label: string; marks: AutoMark[] }
  /** A batch of line changes: how many of each, and the first of them (`change`: status and tags, in words). */
  | { kind: 'lines'; total: number; translations: number; statuses: number; tagged: number; shown: { key: string; translation?: string; change?: string }[] }
  /** A remark on what accepting does. `whilePending`: said only while the proposal waits for a decision. */
  | { kind: 'note'; tone: 'muted' | 'danger'; text: string; whilePending?: true };

export type ProposalDetailKind = ProposalDetail['kind'];
