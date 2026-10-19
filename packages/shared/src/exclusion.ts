import { z } from 'zod';
import { compileFormatRules, formatPatternError, type FormatRules } from './format-check.ts';

/**
 * 번역 제외: lines an extraction brings in that are not for translation (blank, format tokens only,
 * no letters…). A project's rules decide from the source; a person can override one line either way.
 * Excluded lines leave progress, the remaining lines, the review inbox, runs, exports and checks;
 * their translation is never touched.
 */
export const EXCLUSION_REASONS = ['empty', 'formatOnly', 'noLetters', 'noSourceScript', 'pattern', 'manual'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  empty: '빈 원문',
  formatOnly: '서식만',
  noLetters: '글자 없음',
  noSourceScript: '원문 언어 글자 없음',
  pattern: '제외 패턴',
  manual: '직접 제외',
};

export const exclusionRulesSchema = z.object({
  /** Blank or whitespace only. */
  empty: z.boolean().default(true),
  /** Nothing left once the project's format tokens (placeholders, tags) are taken out. */
  formatOnly: z.boolean().default(true),
  /** No letter at all: numbers, symbols and punctuation only ("...", "100%", "—"). */
  noLetters: z.boolean().default(true),
  /** No letter of the source language's script (an English script line with no Latin letter). Off by default: names in another script need translating too. */
  noSourceScript: z.boolean().default(false),
  /** A person's patterns (e.g. developer keys ^[A-Z0-9_]+$): a source they match is excluded. */
  patterns: z
    .array(
      z.object({
        label: z.string().default(''),
        pattern: z.string().min(1).refine((pattern) => !formatPatternError(pattern), { message: '쓸 수 없는 정규식입니다.' }),
      }),
    )
    .default([]),
});
export type ExclusionRules = z.infer<typeof exclusionRulesSchema>;
export const DEFAULT_EXCLUSION_RULES: ExclusionRules = exclusionRulesSchema.parse({});

/** A person's decision for one line: translate it whatever the rules say, or leave it out. Null = the rules decide. */
export const LINE_TRANSLATE = ['include', 'exclude'] as const;
export type LineTranslate = (typeof LINE_TRANSLATE)[number];

/** The letters each source language is written in (by its primary subtag); a language not listed has no script rule. */
const SCRIPTS: Record<string, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  be: /\p{Script=Cyrillic}/u,
  bg: /\p{Script=Cyrillic}/u,
  sr: /[\p{Script=Cyrillic}\p{Script=Latin}]/u,
  el: /\p{Script=Greek}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  th: /\p{Script=Thai}/u,
  hi: /\p{Script=Devanagari}/u,
};
const LATIN = /\p{Script=Latin}/u;
const LATIN_LANGUAGES = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sv', 'da', 'no', 'nb', 'fi', 'hu', 'ro', 'tr', 'id', 'ms', 'vi', 'ca', 'hr', 'sl', 'et', 'lv', 'lt']);
const scriptOf = (language: string | null | undefined) => {
  const primary = (language ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return SCRIPTS[primary] ?? (LATIN_LANGUAGES.has(primary) ? LATIN : null);
};

const compiled = new Map<string, { tokens: ReturnType<typeof compileFormatRules>; patterns: RegExp[] }>();
function prepare(format: FormatRules | undefined, rules: ExclusionRules) {
  const key = JSON.stringify([format ?? null, rules.patterns]);
  let entry = compiled.get(key);
  if (!entry) {
    // A few rule sets at most (one per project).
    if (compiled.size > 20) compiled.clear();
    entry = { tokens: compileFormatRules(format), patterns: rules.patterns.filter((rule) => !formatPatternError(rule.pattern)).map((rule) => new RegExp(rule.pattern, 'u')) };
    compiled.set(key, entry);
  }
  return entry;
}

/** Why the rules leave this source out, or null when it is for translation. */
export function exclusionReason(source: string, format: FormatRules | undefined, rules: ExclusionRules = DEFAULT_EXCLUSION_RULES, sourceLanguage?: string | null): ExclusionReason | null {
  if (!source.trim()) return rules.empty ? 'empty' : null;
  const { tokens, patterns } = prepare(format, rules);
  let rest = source;
  if (tokens.placeholder) rest = rest.replace(tokens.placeholder, ' ');
  if (tokens.tag) rest = rest.replace(tokens.tag, ' ');
  if (rules.formatOnly && rest !== source && !/[\p{L}\p{N}]/u.test(rest)) return 'formatOnly';
  if (rules.noLetters && !/\p{L}/u.test(rest)) return 'noLetters';
  const script = rules.noSourceScript ? scriptOf(sourceLanguage) : null;
  if (script && /\p{L}/u.test(rest) && !script.test(rest)) return 'noSourceScript';
  if (patterns.some((pattern) => pattern.test(source))) return 'pattern';
  return null;
}

/** The line's exclusion: a person's choice first, then the rules. */
export function lineExclusion(line: { source: string; translate?: LineTranslate | null }, format: FormatRules | undefined, rules: ExclusionRules | undefined, sourceLanguage?: string | null): ExclusionReason | null {
  if (line.translate === 'exclude') return 'manual';
  if (line.translate === 'include') return null;
  return exclusionReason(line.source, format, rules, sourceLanguage);
}
