import { z } from 'zod';
import { LINE_TRANSLATE } from './exclusion.ts';
import { EXCLUDED_FILTERS, LINE_MARK_IDS, lineFactsShape, lineMarksSchema, type LineMark } from './marks.ts';

/**
 * The one line filter: what a person, the CLI (loca lines / export / check / runs), the app's lists (as JSON) and the
 * chat's tools write. Names resolve on the server, in one place (resolveLineFilter): a speaker, listener or mention may
 * be a character's name, an alias or the game's speaker key and stands for that person under every spelling; statuses
 * and tags may be names or ids; groups may be keys, ids or titles. A name the project does not have is an error, never
 * a filter that is silently dropped. Unknown fields are refused for the same reason.
 */
/** A list in a filter holds something: an empty one is refused rather than guessed at (no condition, or no line?). */
const EMPTY_LIST = '빈 목록은 쓸 수 없습니다. 조건을 빼거나 값을 넣으세요.';
export const filterList = <T extends z.ZodType>(item: T) => z.array(item).min(1, EMPTY_LIST);
const names = filterList(z.string().min(1));
const marks = lineMarksSchema.min(1, EMPTY_LIST);

export const lineFilterSchema = z
  .object({
    /** Text in source, translation, speaker or key, as written (%, _ and \ are plain characters); the app's list search. */
    q: z.string().trim().min(1).optional(),
    /** Lines spoken by any of these. */
    speakers: names.optional(),
    /** Lines addressed to any of these (name or alias); "-" = 청자 모름 (dialogue said to someone whose listener is unknown or an unsure AI guess). */
    listeners: names.optional(),
    /** Lines whose source mentions any of these characters (by name, alias or {ALIAS} placeholder). */
    mentions: names.optional(),
    groups: names.optional(),
    sections: names.optional(),
    /** Kind of the group a line is in. */
    groupKind: z.enum(['scene', 'document', 'ui']).optional(),
    /** Kind of the line itself. */
    kind: z.enum(['dialogue', 'document', 'ui']).optional(),
    statuses: names.optional(),
    /** Lines carrying every one of these tags, as in the app's list. */
    tags: names.optional(),
    /** Automatic marks (the app's built-in tags) the lines must all have; same rules as the script list. */
    marks: marks.optional(),
    ...lineFactsShape,
    /** 번역 제외 lines: left out (hide) or only them (only); absent = with the rest. */
    excluded: z.enum(EXCLUDED_FILTERS).optional(),
    /** 검토함: only lines whose status is shown in the review inbox. */
    review: z.literal(true).optional(),
    /** Hidden: lines spoken by any of these, in any of these statuses, carrying any of these tags or marks are left out (the app's 숨기기). */
    hideSpeakers: names.optional(),
    hideStatuses: names.optional(),
    hideTags: names.optional(),
    hideMarks: marks.optional(),
    translated: z.boolean().optional(),
    keys: names.optional(),
    /** Lines by id: the ones picked in the script list. */
    ids: names.optional(),
    /** Lines of a saved dialogue graph view (id or label): a part of the graph someone picked out. */
    view: z.string().min(1).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(200),
  })
  .strict();
export type LineFilter = z.infer<typeof lineFilterSchema>;
export type LineFilterInput = z.input<typeof lineFilterSchema>;

/** The filter without its page: which lines, not how many of them at a time (a run's scope, an export, a count). */
export const unpagedLineFilterSchema = lineFilterSchema.omit({ offset: true, limit: true });
export type UnpagedLineFilter = z.infer<typeof unpagedLineFilterSchema>;

/** A list that holds something. A resolved filter has no empty lists: an empty one would read as "no condition" and match every line. */
export type Some<T> = [T, ...T[]];
export const some = <T extends z.ZodType>(item: T) => z.tuple([item], item);
/** The distinct values as a filter's list, or undefined when there are none: the caller says what none means (no condition, an error, nothing). */
export function someOf<T>(values: Iterable<T>): Some<T> | undefined {
  const list = [...new Set(values)];
  return list.length ? (list as Some<T>) : undefined;
}

/**
 * A line filter with its names resolved (the server's resolveLineFilter makes it, lineConditions reads it): ids for
 * statuses, tags, groups and lines, every spelling for people. A field is absent or holds something; a filter that can
 * match no line says so with `nothing` instead of an empty list. What a run stores as its scope.
 */
export const resolvedLineFilterSchema = z
  .object({
    q: z.string().min(1).optional(),
    /** Speaker spellings: the people asked for, under every name the script gives them. */
    speakers: some(z.string()).optional(),
    /** Known listeners by spelling; with `unknownListener`, either holds. */
    listeners: some(z.string()).optional(),
    /** 청자 모름. */
    unknownListener: z.literal(true).optional(),
    mentions: some(z.string()).optional(),
    groupIds: some(z.string()).optional(),
    sections: some(z.string()).optional(),
    groupKind: z.enum(['scene', 'document', 'ui']).optional(),
    kind: z.enum(['dialogue', 'document', 'ui']).optional(),
    statusIds: some(z.string()).optional(),
    tagIds: some(z.string()).optional(),
    marks: some(z.enum(LINE_MARK_IDS as Some<LineMark>)).optional(),
    ...lineFactsShape,
    excluded: z.enum(EXCLUDED_FILTERS).optional(),
    review: z.literal(true).optional(),
    hideSpeakers: some(z.string()).optional(),
    hideStatusIds: some(z.string()).optional(),
    hideTagIds: some(z.string()).optional(),
    hideMarks: some(z.enum(LINE_MARK_IDS as Some<LineMark>)).optional(),
    translated: z.boolean().optional(),
    /** The lines named by key, by id and by a saved view: those in all of the lists given. */
    lineIds: some(z.string()).optional(),
    /** No line can match (a view without lines, keys and ids that share none). */
    nothing: z.literal(true).optional(),
  })
  .strict();
export type ResolvedLineFilter = z.infer<typeof resolvedLineFilterSchema>;

/** Exactly these lines, by id; none of them is no line, not every line. */
export const linesById = (ids: Iterable<string>): ResolvedLineFilter => {
  const lineIds = someOf(ids);
  return lineIds ? { lineIds } : { nothing: true };
};

/** What becomes of the lines in scope whose translation does not go in the file: the source stands in for it, or they stay out. */
export const RESULT_REST = ['source', 'omit'] as const;
export type ResultRest = (typeof RESULT_REST)[number];

/**
 * The finished translation as a file for the game (the app's 번역 결과 내보내기, `loca results`): which lines (a filter, as the
 * script list's), whose translation goes in (statuses by name or id; none given: the final ones), and what becomes of the rest.
 */
export const resultRequestSchema = z.object({
  filter: lineFilterSchema.default({ offset: 0, limit: 200 }),
  statuses: z.array(z.string().min(1)).optional(),
  rest: z.enum(RESULT_REST).default('source'),
});
export type ResultRequest = z.input<typeof resultRequestSchema>;

/** One line of a batch change: from `loca import`, or the chat's propose_changes. */
export const lineChangeSchema = z.object({
  key: z.string().min(1),
  /** The line's rev when it was read (export / find). A different rev now means someone changed it: conflict. */
  rev: z.number().int().optional(),
  translation: z.string().optional(),
  /** Who the line is addressed to (a character name), or null for unknown. */
  listener: z.string().nullable().optional(),
  status: z.string().optional(),
  /** 번역 제외, a person's call: include / exclude whatever the rules say; null hands it back to the rules. */
  translate: z.enum(LINE_TRANSLATE).nullable().optional(),
  /** The line's memo (a note on the line itself, shown beside it); empty clears it. */
  memo: z.string().max(2000).optional(),
  addTags: z.array(z.string()).default([]),
  removeTags: z.array(z.string()).default([]),
  /** A note on the new translation (kept with it in the line's history), not the line's memo. */
  note: z.string().default(''),
});
export type LineChange = z.infer<typeof lineChangeSchema>;
/** Whether a change says nothing to change (after what equals the line as it is was dropped). */
export const lineChangeEmpty = (change: LineChange) =>
  change.translation === undefined && change.listener === undefined && change.translate === undefined && change.memo === undefined && !change.status && !change.addTags.length && !change.removeTags.length;

export const batchChangeSchema = z.object({
  // A whole game: `loca import` sends one file as one proposal.
  changes: z.array(lineChangeSchema).min(1).max(100_000),
  /** Who wrote the translations: shown on the candidates. */
  origin: z.enum(['ai', 'human']).default('ai'),
  model: z.string().optional(),
});
export type BatchChange = z.infer<typeof batchChangeSchema>;

export const CHECK_KINDS = { terms: '용어집 위반', consistency: '번역 불일치', format: '형식 오류', length: '길이 초과' } as const;
export type CheckKind = keyof typeof CHECK_KINDS;
