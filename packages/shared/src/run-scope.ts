import { z } from 'zod';
import { KNOWLEDGE_STATUSES } from './knowledge.ts';
import { DECIDED_BY, TERM_MARK_IDS, type AutoMark } from './marks.ts';
import { filterList, resolvedLineFilterSchema, some, unpagedLineFilterSchema, type Some } from './script.ts';

/*
 * What a workflow run takes and how far it may go: its scope (as asked in names, and as stored resolved) and its caps.
 * The run dialog, the chat's plan_run / start_run, `loca runs plan / start` and the runner all read these.
 */

const termMark = z.enum(TERM_MARK_IDS as Some<AutoMark>);

/** Which terms a run of a terms workflow takes, as asked: terms by id or source, statuses by label or id, tags by name or id. */
export const runTermsInputSchema = z
  .object({
    terms: filterList(z.string().min(1)).optional(),
    /** 후보 / 확정 / 버림 (or candidate / confirmed / rejected). None: every term not rejected. */
    statuses: filterList(z.string().min(1)).optional(),
    /** Term marks the terms must all have. */
    marks: filterList(termMark).optional(),
    /** Tags the terms must all carry. */
    tags: filterList(z.string().min(1)).optional(),
    /** Who decided the term (정한 쪽). */
    decidedBy: z.enum(DECIDED_BY).optional(),
    /** Terms with no Korean form (true) or with one (false). */
    emptyTarget: z.boolean().optional(),
  })
  .strict();
export type RunTermsInput = z.infer<typeof runTermsInputSchema>;

/** The same with its names resolved; like a resolved line filter, a list is absent or holds something. */
export const runTermsSchema = z
  .object({
    ids: some(z.string()).optional(),
    statuses: some(z.enum(KNOWLEDGE_STATUSES)).optional(),
    marks: some(termMark).optional(),
    tagIds: some(z.string()).optional(),
    decidedBy: z.enum(DECIDED_BY).optional(),
    emptyTarget: z.boolean().optional(),
    /** No term can match. */
    nothing: z.literal(true).optional(),
  })
  .strict();
export type RunTerms = z.infer<typeof runTermsSchema>;

/**
 * What a run is asked to run on, in names: the run dialog, the chat's plan_run / start_run and `loca runs plan / start`
 * all send this. A lines workflow takes `filter` (the line filter, as the script list and `loca lines` take it), a terms
 * workflow `terms`; the other one is refused. The server resolves it (resolveRunScope) into the scope the run stores.
 */
export const runScopeInputSchema = z
  .object({
    filter: unpagedLineFilterSchema.optional(),
    terms: runTermsInputSchema.optional(),
    /**
     * Also change what a person decided: a status a person set and tags a person put on (the line's history says who
     * did it last). Off: the run leaves them and says so in its detail.
     */
    changeHuman: z.boolean().optional(),
  })
  .strict();
export type RunScopeInput = z.infer<typeof runScopeInputSchema>;

/** A run's scope as it is stored and run (runs.scope, a run card): the resolved filter of a lines run, or the terms of a terms run. Neither: every line (or term). */
export const runScopeSchema = z
  .object({
    filter: resolvedLineFilterSchema.optional(),
    terms: runTermsSchema.optional(),
    changeHuman: z.boolean().optional(),
  })
  .strict();
export type RunScope = z.infer<typeof runScopeSchema>;

/**
 * A run's caps as they are asked for, wherever a run is started, resumed or continued (the app, the chat, the
 * CLI): a number sets one, null runs without it, left out keeps what there is (for a new run: the suggested cap).
 */
export const runCapsSchema = z.object({ maxCalls: z.number().int().min(1).nullable().optional(), maxInputTokens: z.number().int().min(1).nullable().optional() });
export type RunCaps = z.infer<typeof runCapsSchema>;

/** A run's caps as it keeps them (runs.limits); the run pauses when one is reached. */
export const runLimitsSchema = z.object({
  maxCalls: z.number().int().min(1).optional(),
  /** All input tokens, cached included, as the connections reported them. */
  maxInputTokens: z.number().int().min(1).optional(),
  /** Set while the run is paused by a cap, naming it; cleared on resume. */
  hit: z.enum(['calls', 'input']).optional(),
});
export type RunLimits = z.infer<typeof runLimitsSchema>;
