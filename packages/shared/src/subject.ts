/**
 * What a workflow takes in and a run's items are: script lines, or glossary terms. The one type for it; how the two
 * differ is INPUT_TYPES (workflow.ts) for the editor, validation and the CLI, and the server's subject adapters
 * (apps/server/src/engine/subjects.ts) for a run. Nothing else asks "is it terms?": a third subject is then a
 * compile error in those two places, not a silent fall into the lines branch.
 */
export const SUBJECTS = ['lines', 'terms'] as const;
export type Subject = (typeof SUBJECTS)[number];
export const isSubject = (value: unknown): value is Subject => (SUBJECTS as readonly unknown[]).includes(value);
