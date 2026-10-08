import { z } from 'zod';

export interface FormatCheckOptions {
  placeholders: boolean;
  tags: boolean;
  newlines: boolean;
  emptyText: boolean;
}

export interface FormatIssue {
  code: 'empty' | 'placeholder' | 'tag' | 'newline';
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
  return issues;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive match that also works next to Hangul or punctuation. */
export const mentions = (text: string, name: string) =>
  name.trim().length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(text);
