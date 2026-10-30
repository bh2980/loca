import { z } from 'zod';

export const customFormatRuleSchema = z.object({
  label: z.string().default(''),
  kind: z.enum(['forbidden', 'preserve', 'targetRequired']).default('forbidden'),
  pattern: z.string().min(1),
});
export type CustomFormatRule = z.infer<typeof customFormatRuleSchema>;

/**
 * Default Korean particle regex whose form depends on the final consonant of what precedes it,
 * standing alone (not followed by more Hangul or "(" as in 을(를)).
 */
export const DEFAULT_PARTICLE_PATTERN = String.raw`(?:을|를|이|가|은|는|와|과|으로|로|이랑|랑|이나|나|이라고|라고|아|야)(?![\p{Script=Hangul}(])`;

export interface FormatCheckOptions {
  placeholders: boolean;
  tags: boolean;
  newlines: boolean;
  emptyText: boolean;
  /** Numbers (2038, 08:29, 1.5) outside format tokens must all come through (extra ones are fine). */
  numbers?: boolean;
  /** Doubled spaces, and spaces at either end, that the source does not have. */
  spaces?: boolean;
  /**
   * Korean targets: a particle right after a variable (`{name}을`) is right for some values and
   * wrong for others (을/를 follows a final consonant or not). Combined forms (을(를)) pass.
   */
  particles?: boolean;
  /** Optional custom regex source overriding DEFAULT_PARTICLE_PATTERN when `particles` is true. */
  particlesPattern?: string;
  /** Most characters (code points) in the translation; 0 or unset = off. */
  maxChars?: number;
  /** Most UTF-8 bytes in the translation; 0 or unset = off. */
  maxBytes?: number;
  /** Most characters on one line of the translation (split on newlines); 0 or unset = off. */
  maxLineChars?: number;
  /** Most lines in the translation; 0 or unset = off. */
  maxLines?: number;
  /** Most translation length as a multiple of the source length (1.5 = at most 1.5×); 0 or unset = off. */
  maxLengthRatio?: number;
  /** Words the translation must not contain, comma-separated (plain text, not regex). */
  forbiddenWords?: string;
  /** User-defined regex validation rules on this formatCheck node. */
  customRules?: CustomFormatRule[];
}

export interface FormatIssue {
  code: 'empty' | 'placeholder' | 'tag' | 'newline' | 'number' | 'space' | 'particle' | 'length' | 'forbiddenWord' | 'custom';
  message: string;
}

/**
 * Token families games use. A project turns on the ones its strings contain; anything else is
 * added as a custom regular expression. Note [NAME] variables and [b] BBCode look alike.
 */
export const FORMAT_PRESETS = {
  brace: { kind: 'placeholder', label: '중괄호 변수', example: '{name} {0}', pattern: String.raw`\{[^{}\r\n]+\}` },
  doubleBrace: { kind: 'placeholder', label: '이중 중괄호', example: '{{name}}', pattern: String.raw`\{\{[^{}\r\n]+\}\}` },
  printf: { kind: 'placeholder', label: 'printf', example: '%s %d %1$s %.2f', pattern: String.raw`%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?[sdifuxX@]` }, // no space flag: "50% interest" is prose, not % i
  dollar: { kind: 'placeholder', label: '달러 변수', example: '$name$ ${name}', pattern: String.raw`\$\{[^}\r\n]+\}|\$[A-Za-z_]\w*\$` },
  square: { kind: 'placeholder', label: '대괄호 변수', example: '[PLAYER] [name]', pattern: String.raw`\[[A-Za-z_][\w.]*\]` },
  rpgmaker: { kind: 'placeholder', label: 'RPG Maker 제어 문자', example: String.raw`\N[1] \C[2] \V[3] \G`, pattern: String.raw`\\[A-Za-z]+\[[^\]\r\n]*\]|\\[A-Za-z{}$.|!><^]` },
  escapes: { kind: 'placeholder', label: '이스케이프 문자', example: String.raw`\n \t`, pattern: String.raw`\\[nrt]` },
  angleTag: { kind: 'tag', label: '꺾쇠 태그', example: '<b> </color> <color=#fff>', pattern: String.raw`<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>` },
  bbcode: { kind: 'tag', label: 'BBCode', example: '[b] [/b] [color=red]', pattern: String.raw`\[\/?[a-z]+(?:=[^\]\r\n]*)?\]` },
} as const;
export type FormatPreset = keyof typeof FORMAT_PRESETS;
export const FORMAT_PRESET_IDS = Object.keys(FORMAT_PRESETS) as FormatPreset[];

/** Returns an error message when a custom pattern cannot be used. */
export function formatPatternError(pattern: string): string | null {
  try {
    const regex = new RegExp(pattern, 'gu');
    if (regex.test('')) return '빈 문자열과 일치하는 패턴은 쓸 수 없습니다.';
    return null;
  } catch (error) {
    return `정규식 오류: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export const formatRulesSchema = z.object({
  presets: z.array(z.enum(FORMAT_PRESET_IDS as [FormatPreset, ...FormatPreset[]])).default(['brace', 'printf', 'angleTag']),
  custom: z
    .array(
      z.object({
        label: z.string().default(''),
        kind: z.enum(['placeholder', 'tag']).default('placeholder'),
        pattern: z.string().min(1).refine((pattern) => !formatPatternError(pattern), { message: '쓸 수 없는 정규식입니다.' }),
      }),
    )
    .default([]),
});
export type FormatRules = z.infer<typeof formatRulesSchema>;
export const DEFAULT_FORMAT_RULES: FormatRules = { presets: ['brace', 'printf', 'angleTag'], custom: [] };

/** One global regex per token kind, or null when the project has none of that kind. */
export function compileFormatRules(rules: FormatRules = DEFAULT_FORMAT_RULES) {
  const of = (kind: 'placeholder' | 'tag') => {
    const patterns = [
      ...rules.presets.filter((id) => FORMAT_PRESETS[id]?.kind === kind).map((id) => FORMAT_PRESETS[id].pattern),
      ...rules.custom.filter((rule) => rule.kind === kind && !formatPatternError(rule.pattern)).map((rule) => rule.pattern),
    ];
    return patterns.length ? new RegExp(patterns.map((pattern) => `(?:${pattern})`).join('|'), 'gu') : null;
  };
  return { placeholder: of('placeholder'), tag: of('tag') };
}

export const matchTokens = (text: string, pattern: RegExp | null) => (pattern ? (text.match(pattern) ?? []) : []);

const compiledByRules = new Map<string, ReturnType<typeof compileFormatRules>>();
/**
 * Whether a text says something once the project's format tokens (placeholders and tags, as set in
 * 설정 › 서식) are taken out: a letter or a digit is left. `<b></b>`, `{0}` or `%s` alone do not.
 */
export function hasText(text: string, rules: FormatRules = DEFAULT_FORMAT_RULES) {
  const key = JSON.stringify(rules);
  let compiled = compiledByRules.get(key);
  if (!compiled) {
    // A few rule sets at most (one per project), each compiled once.
    if (compiledByRules.size > 20) compiledByRules.clear();
    compiled = compileFormatRules(rules);
    compiledByRules.set(key, compiled);
  }
  let rest = text;
  if (compiled.placeholder) rest = rest.replace(compiled.placeholder, ' ');
  if (compiled.tag) rest = rest.replace(compiled.tag, ' ');
  return /[\p{L}\p{N}]/u.test(rest);
}

/**
 * A translation's leading and trailing whitespace (spaces, newlines) is the source's, never the
 * translator's or a model's: the body is the text without its edges, and the source's edges go
 * around it. The body's line breaks are the source's kind too (models and editors write \n where a
 * source has \r\n). Whitespace a model escaped (&#13; &#9; &nbsp;) is whitespace again. Every writer of
 * a line's translation stores this, and the editor shows only the body.
 * An empty body stays empty (no translation), and a source that is all whitespace leaves the text as is.
 */
export function withSourceWhitespace(source: string, text: string): string {
  const body = withoutEscapedWhitespace(source, text).trim();
  if (!body || !source.trim()) return body ? text : '';
  return `${source.match(/^\s*/u)![0]}${withSourceBreaks(source.trim(), body)}${source.match(/\s*$/u)![0]}`;
}

const LINE_BREAK = /\r\n|\r|\n/gu;
const CHARACTER_REFERENCE = /&(?:#(\d+)|#x([0-9a-f]+)|(nbsp|Tab|NewLine|ensp|emsp|thinsp));/giu;
const NAMED_WHITESPACE: Record<string, string> = { nbsp: ' ', tab: '\t', newline: '\n', ensp: ' ', emsp: ' ', thinsp: ' ' };

/**
 * Whitespace written as a character reference (&#13; &#x9; &nbsp;) that the source does not have is
 * whitespace a model escaped: it becomes the character it stands for. A carriage return right before
 * a real line break is dropped (the break is there already).
 */
function withoutEscapedWhitespace(source: string, text: string): string {
  const kept = new Set(Array.from(source.matchAll(CHARACTER_REFERENCE), (match) => match[0].toLowerCase()));
  return text.replace(CHARACTER_REFERENCE, (reference, decimal: string | undefined, hex: string | undefined, name: string | undefined, offset: number) => {
    const code = decimal ? Number(decimal) : hex ? parseInt(hex, 16) : undefined;
    const char = code !== undefined ? (code <= 0x10ffff ? String.fromCodePoint(code) : '') : NAMED_WHITESPACE[name!.toLowerCase()]!;
    if (!/^\s$/u.test(char) || kept.has(reference.toLowerCase())) return reference;
    return char === '\r' && /^\r?\n/u.test(text.slice(offset + reference.length)) ? '' : char;
  });
}

/**
 * The body's line breaks as the source body's: one for one when there are as many, else the
 * source's kind when it uses only one. A source mixing kinds, with a different count, leaves them.
 */
function withSourceBreaks(source: string, body: string): string {
  const breaks = source.match(LINE_BREAK) ?? [];
  if (!breaks.length) return body;
  if ((body.match(LINE_BREAK) ?? []).length === breaks.length) {
    let index = 0;
    return body.replace(LINE_BREAK, () => breaks[index++]!);
  }
  return new Set(breaks).size === 1 ? body.replace(LINE_BREAK, breaks[0]!) : body;
}

/** Tokens in `a` that `b` lacks, as a multiset difference. */
function missing(a: string[], b: string[]) {
  const rest = [...b];
  return a.filter((token) => {
    const index = rest.indexOf(token);
    if (index === -1) return true;
    rest.splice(index, 1);
    return false;
  });
}
const newlines = (text: string) => (text.match(/\r?\n/g) ?? []).length;
const describe = (onlySource: string[], onlyTarget: string[]) =>
  [onlySource.length && `번역에 없음: ${onlySource.join(' ')}`, onlyTarget.length && `원문에 없음: ${onlyTarget.join(' ')}`].filter(Boolean).join(' · ');

const chars = (text: string) => [...text].length;
function lengthIssues(source: string, target: string, options: FormatCheckOptions): FormatIssue[] {
  if (!target) return [];
  const issues: FormatIssue[] = [];
  const add = (message: string) => issues.push({ code: 'length', message });
  const length = chars(target);
  if (options.maxChars && length > options.maxChars) add(`글자 수 초과 (${length}/${options.maxChars}자).`);
  if (options.maxBytes) {
    const bytes = new TextEncoder().encode(target).length;
    if (bytes > options.maxBytes) add(`바이트 수 초과 (${bytes}/${options.maxBytes}바이트).`);
  }
  const lines = target.split(/\r?\n/);
  if (options.maxLines && lines.length > options.maxLines) add(`줄 수 초과 (${lines.length}/${options.maxLines}줄).`);
  if (options.maxLineChars) {
    const longest = Math.max(...lines.map(chars));
    if (longest > options.maxLineChars) add(`한 줄 글자 수 초과 (${longest}/${options.maxLineChars}자).`);
  }
  const sourceLength = chars(source.trim());
  if (options.maxLengthRatio && sourceLength) {
    const ratio = length / sourceLength;
    if (ratio > options.maxLengthRatio) add(`원문 대비 길이 초과 (${ratio.toFixed(2)}배 > ${options.maxLengthRatio}배).`);
  }
  return issues;
}

/** Mechanical checks only. Word order may differ between languages, so tokens are compared as multisets. */
export function checkFormat(source: string, target: string, options: FormatCheckOptions, rules: FormatRules = DEFAULT_FORMAT_RULES): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const patterns = compileFormatRules(rules);
  if (options.emptyText && !target.trim()) issues.push({ code: 'empty', message: '번역문이 비어 있습니다.' });
  for (const kind of ['placeholder', 'tag'] as const) {
    if (!(kind === 'placeholder' ? options.placeholders : options.tags)) continue;
    const a = matchTokens(source, patterns[kind]);
    const b = matchTokens(target, patterns[kind]);
    const onlySource = missing(a, b);
    const onlyTarget = missing(b, a);
    if (onlySource.length || onlyTarget.length)
      issues.push({ code: kind, message: `${kind === 'placeholder' ? '자리표시자' : '서식 태그'}가 원문과 다릅니다 (${describe(onlySource, onlyTarget)}).` });
  }
  if (options.newlines && newlines(source) !== newlines(target))
    issues.push({ code: 'newline', message: `줄바꿈 수가 다릅니다 (원문 ${newlines(source)}, 번역 ${newlines(target)}).` });
  if (options.numbers && target.trim()) {
    const strip = (text: string) => [patterns.placeholder, patterns.tag].reduce((rest, pattern) => (pattern ? rest.replace(pattern, ' ') : rest), text);
    const numbers = (text: string) => strip(text).match(/\d+(?:[.,:]\d+)*/g) ?? [];
    // Only numbers that went missing: a translation may add some (AUG → 8월).
    const onlySource = missing(numbers(source), numbers(target));
    if (onlySource.length) issues.push({ code: 'number', message: `원문의 숫자가 번역에 없습니다 (${onlySource.join(' ')}).` });
  }
  if (options.spaces && target.trim()) {
    const problems = [
      / {2,}/.test(target) && !/ {2,}/.test(source) && '이중 공백',
      /^\s/.test(target) !== /^\s/.test(source) && '앞 공백',
      /\s$/.test(target) !== /\s$/.test(source) && '뒤 공백',
    ].filter(Boolean);
    if (problems.length) issues.push({ code: 'space', message: `공백이 원문과 다릅니다 (${problems.join(' · ')}).` });
  }
  if (options.particles && patterns.placeholder) {
    const particleSource = options.particlesPattern?.trim() ? options.particlesPattern.trim() : DEFAULT_PARTICLE_PATTERN;
    try {
      const particleRe = new RegExp(`(${patterns.placeholder.source})(?:${particleSource})`, 'gu');
      const found = [...target.matchAll(particleRe)].map((match) => match[0]);
      if (found.length) issues.push({ code: 'particle', message: `변수 뒤 조사는 값의 받침에 따라 틀릴 수 있습니다 (${[...new Set(found)].join(' ')}). 을(를)처럼 함께 쓰거나 엔진의 조사 문법을 쓰세요.` });
    } catch {
      // Ignore invalid custom particle regex at runtime
    }
  }
  issues.push(...lengthIssues(source, target, options));
  const forbidden = (options.forbiddenWords ?? '').split(',').map((word) => word.trim()).filter(Boolean);
  const hit = forbidden.filter((word) => target.includes(word));
  if (hit.length) issues.push({ code: 'forbiddenWord', message: `금칙어가 있습니다 (${[...new Set(hit)].join(', ')}).` });
  if (options.customRules?.length) {
    for (const rule of options.customRules) {
      const pat = rule.pattern.trim();
      if (!pat || formatPatternError(pat)) continue;
      let re: RegExp;
      try {
        re = new RegExp(pat, 'gu');
      } catch {
        continue;
      }
      const name = rule.label.trim() || pat;
      if (rule.kind === 'forbidden') {
        const hits = matchTokens(target, re);
        if (hits.length) {
          issues.push({ code: 'custom', message: `금지 규칙 위반 (${name}): ${[...new Set(hits)].join(' ')}` });
        }
      } else if (rule.kind === 'preserve') {
        const a = matchTokens(source, re);
        const b = matchTokens(target, re);
        const onlySource = missing(a, b);
        const onlyTarget = missing(b, a);
        if (onlySource.length || onlyTarget.length) {
          issues.push({ code: 'custom', message: `${name} 보존 불일치 (${describe(onlySource, onlyTarget)}).` });
        }
      } else if (rule.kind === 'targetRequired') {
        if (source.trim() && target.trim() && matchTokens(target, re).length === 0) {
          issues.push({ code: 'custom', message: `필수 규칙 미충족 (${name}).` });
        }
      }
    }
  }
  return issues;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRegExp = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'iu');
const compiled = new Map<string, RegExp>();
const compiledFor = (name: string) => {
  let re = compiled.get(name);
  if (!re) {
    if (compiled.size > 5000) compiled.clear();
    compiled.set(name, (re = wordRegExp(name)));
  }
  return re;
};
/** Whole-word, case-insensitive match that also works next to Hangul or punctuation. */
export const mentions = (text: string, name: string) => name.trim().length > 0 && compiledFor(name.trim()).test(text);

/** A non-ASCII character that case-folds or case-maps: lowercasing is then not a safe stand-in for the `iu` regex. */
const EXOTIC_CASE = /(?![\x00-\x7f])[\p{Changes_When_Casemapped}\p{Changes_When_Casefolded}]/u;

export interface TermMatcher<T> {
  /** The items with a name mentioned in the text (same rules as `mentions`), in their original order. */
  find(text: string): T[];
  has(text: string): boolean;
}

/**
 * Compiles names once for many texts. Each name keeps one lazily built regex (exactly `mentions`)
 * behind a cheap lowercase `includes` prefilter, which is skipped for texts or names with exotic
 * case folding so it can never hide a match.
 */
export function termMatcher<T>(items: readonly T[], namesOf: (item: T) => string | readonly string[]): TermMatcher<T> {
  const entries = items.map((item) => {
    const raw = namesOf(item);
    const names = (typeof raw === 'string' ? [raw] : raw).map((name) => name.trim()).filter(Boolean);
    return {
      item,
      names: names.map((name) => ({ name, needle: EXOTIC_CASE.test(name) ? null : name.toLowerCase(), re: null as RegExp | null })),
    };
  });
  const hit = (text: string, lower: string | null, entry: (typeof entries)[number]) =>
    entry.names.some((candidate) => {
      if (lower !== null && candidate.needle !== null && !lower.includes(candidate.needle)) return false;
      return (candidate.re ??= wordRegExp(candidate.name)).test(text);
    });
  const lowered = (text: string) => (EXOTIC_CASE.test(text) ? null : text.toLowerCase());
  return {
    find(text) {
      const lower = lowered(text);
      return entries.filter((entry) => hit(text, lower, entry)).map((entry) => entry.item);
    },
    has(text) {
      const lower = lowered(text);
      return entries.some((entry) => hit(text, lower, entry));
    },
  };
}

/** Where a glossary term applies: every line, UI lines only (a button's "Help"), or the rest (dialogue, documents). */
export const TERM_SCOPES = { all: '모든 줄', ui: 'UI 줄만', dialogue: '대사·문서만' } as const;
export type TermScope = keyof typeof TERM_SCOPES;
export const TERM_SCOPE_IDS = Object.keys(TERM_SCOPES) as TermScope[];

/** Whether a term applies to a line of this kind; without a kind (a text alone) every term does. */
export const termApplies = (term: { scope?: TermScope | null }, kind?: string | null) =>
  !term.scope || term.scope === 'all' || !kind || (term.scope === 'ui' ? kind === 'ui' : kind !== 'ui');

/**
 * The glossary's matcher: `termMatcher` on the source (whole word, any case), narrowed by each
 * term's scope (the line's kind) and, for a term with `matchCase`, by its exact case. Usage counts,
 * the glossary check, import warnings and the terms an AI node is given all match this way.
 */
export function glossaryMatcher<T extends { source: string; scope?: TermScope | null; matchCase?: boolean | null }>(terms: readonly T[]) {
  const words = termMatcher(terms, (term) => term.source);
  const cased = new Map<T, RegExp>();
  const exact = (term: T, text: string) => {
    if (!term.matchCase) return true;
    let re = cased.get(term);
    if (!re) cased.set(term, (re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term.source.trim())}(?![\\p{L}\\p{N}])`, 'u')));
    return re.test(text);
  };
  return {
    find: (text: string, kind?: string | null) => words.find(text).filter((term) => termApplies(term, kind) && exact(term, text)),
    has: (text: string, kind?: string | null) => words.find(text).some((term) => termApplies(term, kind) && exact(term, text)),
  };
}

export interface DetectedFormatPreset {
  id: FormatPreset;
  count: number;
  examples: string[];
}

export interface DetectedCustomFormatRule {
  label: string;
  kind: 'placeholder' | 'tag';
  pattern: string;
  count: number;
  examples: string[];
}

const EXTRA_TOKEN_FAMILIES: { label: string; kind: 'placeholder' | 'tag'; pattern: string }[] = [
  { label: '@변수@', kind: 'placeholder', pattern: String.raw`@[A-Za-z_][\w.]*@` },
  { label: '%변수%', kind: 'placeholder', pattern: String.raw`%[A-Za-z_][\w.]*%` },
  { label: '#변수#', kind: 'placeholder', pattern: String.raw`#[A-Za-z_][\w.]*#` },
  { label: '전각 괄호 태그', kind: 'tag', pattern: String.raw`【[^】\r\n]{1,24}】` },
];

/**
 * Scans script source lines without AI to detect which token presets and custom patterns appear in
 * the project, how many lines use each, and sample tokens from the script.
 */
export function detectFormatRules(texts: Iterable<string>): {
  presets: DetectedFormatPreset[];
  customCandidates: DetectedCustomFormatRule[];
  recommendedPresets: FormatPreset[];
} {
  const presetRegexes = FORMAT_PRESET_IDS.map((id) => ({
    id,
    re: new RegExp(FORMAT_PRESETS[id].pattern, 'gu'),
    count: 0,
    examples: new Set<string>(),
  }));
  const bbcodeRe = new RegExp(`^(?:${FORMAT_PRESETS.bbcode.pattern})$`, 'u');
  const doubleBraceInnerRe = new RegExp(FORMAT_PRESETS.doubleBrace.pattern, 'gu');
  const extraRegexes = EXTRA_TOKEN_FAMILIES.map((item) => ({
    ...item,
    re: new RegExp(item.pattern, 'gu'),
    count: 0,
    examples: new Set<string>(),
  }));

  for (const text of texts) {
    if (!text) continue;
    for (const entry of presetRegexes) {
      // Avoid counting {{name}} twice as single {name}, or [b] BBCode as [square] placeholder.
      const source = entry.id === 'brace' ? text.replace(doubleBraceInnerRe, ' ') : text;
      const matches = source.match(entry.re);
      if (!matches?.length) continue;
      const valid = entry.id === 'square' ? matches.filter((m) => !bbcodeRe.test(m)) : matches;
      if (!valid.length) continue;
      entry.count += 1;
      for (const token of valid) {
        if (entry.examples.size < 4) entry.examples.add(token);
      }
    }
    for (const extra of extraRegexes) {
      const matches = text.match(extra.re);
      if (!matches?.length) continue;
      extra.count += 1;
      for (const token of matches) {
        if (extra.examples.size < 4) extra.examples.add(token);
      }
    }
  }

  const presets: DetectedFormatPreset[] = presetRegexes.map((entry) => ({
    id: entry.id,
    count: entry.count,
    examples: [...entry.examples],
  }));
  const recommendedPresets = presets.filter((p) => p.count > 0).map((p) => p.id);
  const customCandidates: DetectedCustomFormatRule[] = extraRegexes
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      label: entry.label,
      kind: entry.kind,
      pattern: entry.pattern,
      count: entry.count,
      examples: [...entry.examples],
    }));

  return { presets, customCandidates, recommendedPresets };
}

