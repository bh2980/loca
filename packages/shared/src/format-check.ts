import { z } from 'zod';

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
}

export interface FormatIssue {
  code: 'empty' | 'placeholder' | 'tag' | 'newline' | 'number' | 'space' | 'particle';
  message: string;
}

/**
 * Token families games use. A project turns on the ones its strings contain; anything else is
 * added as a custom regular expression. Note [NAME] variables and [b] BBCode look alike.
 */
export const FORMAT_PRESETS = {
  brace: { kind: 'placeholder', label: '중괄호 변수', example: '{name} {0}', pattern: String.raw`\{[^{}\r\n]+\}` },
  doubleBrace: { kind: 'placeholder', label: '이중 중괄호', example: '{{name}}', pattern: String.raw`\{\{[^{}\r\n]+\}\}` },
  printf: { kind: 'placeholder', label: 'printf', example: '%s %d %1$s %.2f', pattern: String.raw`%(?:\d+\$)?[-+0 #]*\d*(?:\.\d+)?[sdifuxX@]` },
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
    const found = [...target.matchAll(new RegExp(`(${patterns.placeholder.source})${PARTICLE.source}`, 'gu'))].map((match) => match[0]);
    if (found.length) issues.push({ code: 'particle', message: `변수 뒤 조사는 값의 받침에 따라 틀릴 수 있습니다 (${[...new Set(found)].join(' ')}). 을(를)처럼 함께 쓰거나 엔진의 조사 문법을 쓰세요.` });
  }
  return issues;
}

/**
 * A particle whose form depends on the final consonant of what precedes it, standing alone (not
 * followed by more Hangul, as in {n}이다… which is left alone, nor by "(", the combined form 을(를)).
 */
const PARTICLE = /(?:을|를|이|가|은|는|와|과|으로|로|이랑|랑|이나|나|이라고|라고|아|야)(?![\p{Script=Hangul}(])/u;

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
