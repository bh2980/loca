import { z } from 'zod';
import { LINE_TRANSLATE } from './exclusion.ts';
import { EXCLUDED_FILTERS, lineFactsShape, lineMarksSchema } from './marks.ts';

/**
 * One filter for every way of reading the script: the CLI (loca lines / export / check), the
 * chat's find_lines tool and the server routes behind them. Names resolve server-side: a speaker
 * or mention may be a stored character's name, an alias or the game's speaker key; statuses and
 * tags may be names or ids; groups may be keys, ids or titles.
 */
export const lineFilterSchema = z.object({
  /** Text in source, translation, speaker or key, as written (%, _ and \ are plain characters); the app's list search. */
  q: z.string().trim().min(1).optional(),
  /** Lines spoken by any of these. */
  speakers: z.array(z.string().min(1)).optional(),
  /** Lines addressed to any of these (name or alias); "-" = 청자 모름 (dialogue said to someone whose listener is unknown or an unsure AI guess). */
  listeners: z.array(z.string().min(1)).optional(),
  /** Lines whose source mentions any of these characters (by name, alias or {ALIAS} placeholder). */
  mentions: z.array(z.string().min(1)).optional(),
  groups: z.array(z.string().min(1)).optional(),
  sections: z.array(z.string().min(1)).optional(),
  groupKind: z.enum(['scene', 'document', 'ui']).optional(),
  kind: z.enum(['dialogue', 'document', 'ui']).optional(),
  statuses: z.array(z.string().min(1)).optional(),
  /** Lines carrying every one of these tags, as in the app's list. */
  tags: z.array(z.string().min(1)).optional(),
  /** Automatic marks (the app's built-in tags) the lines must all have; same rules as the script list. */
  marks: lineMarksSchema.optional(),
  ...lineFactsShape,
  /** 번역 제외 lines: left out (hide) or only them (only); absent = with the rest. */
  excluded: z.enum(EXCLUDED_FILTERS).optional(),
  /** Hidden: lines spoken by any of these, in any of these statuses, carrying any of these tags or marks are left out (the app's 숨기기). */
  hideSpeakers: z.array(z.string().min(1)).optional(),
  hideStatuses: z.array(z.string().min(1)).optional(),
  hideTags: z.array(z.string().min(1)).optional(),
  hideMarks: lineMarksSchema.optional(),
  translated: z.boolean().optional(),
  keys: z.array(z.string().min(1)).optional(),
  /** Lines of a saved dialogue graph view (id or label): a part of the graph someone picked out. */
  view: z.string().min(1).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type LineFilter = z.infer<typeof lineFilterSchema>;
export type LineFilterInput = z.input<typeof lineFilterSchema>;

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
  addTags: z.array(z.string()).default([]),
  removeTags: z.array(z.string()).default([]),
  note: z.string().default(''),
});
export type LineChange = z.infer<typeof lineChangeSchema>;

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
