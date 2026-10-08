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

// {name}, {0}, %s, %1$d — the usual game/string-table placeholder families.
const PLACEHOLDER = /\{[^{}\r\n]+\}|%(?:\d+\$)?[sdif@]/g;
// Rich-text tags such as <b>, </color>, <color=#fff>, <sprite name="x">. "x < 3" is not a tag.
const TAG = /<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>/g;

const sorted = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).sort();
const sameBag = (a: string[], b: string[]) => a.length === b.length && a.every((token, index) => token === b[index]);
const newlines = (text: string) => (text.match(/\r?\n/g) ?? []).length;

/** Mechanical checks only. Word order may differ between languages, so tokens are compared as multisets. */
export function checkFormat(source: string, target: string, options: FormatCheckOptions): FormatIssue[] {
  const issues: FormatIssue[] = [];
  if (options.emptyText && !target.trim()) issues.push({ code: 'empty', message: '번역문이 비어 있습니다.' });
  if (options.placeholders && !sameBag(sorted(source, PLACEHOLDER), sorted(target, PLACEHOLDER)))
    issues.push({ code: 'placeholder', message: '자리표시자의 종류나 개수가 원문과 다릅니다.' });
  if (options.tags && !sameBag(sorted(source, TAG), sorted(target, TAG)))
    issues.push({ code: 'tag', message: '서식 태그가 원문과 다릅니다.' });
  if (options.newlines && newlines(source) !== newlines(target))
    issues.push({ code: 'newline', message: `줄바꿈 수가 다릅니다 (원문 ${newlines(source)}, 번역 ${newlines(target)}).` });
  return issues;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive match that also works next to Hangul or punctuation. */
export const mentions = (text: string, name: string) =>
  name.trim().length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(text);
