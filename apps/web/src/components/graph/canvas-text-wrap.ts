export type TextWidth = (text: string) => number;

/** Wrap by whitespace-delimited words where possible, then by Unicode code point for dense or unbroken text. */
export function wrapTextLines(text: string, maxWidth: number, maxLines: number, measure: TextWidth): string[] {
  if (!text || maxWidth <= 0 || maxLines <= 0) return [];

  const lines: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const line = current.trimEnd();
    if (line) lines.push(line);
    current = '';
  };
  const appendWord = (word: string) => {
    if (current && measure(current + word) <= maxWidth) {
      current += word;
      return;
    }
    if (current) pushCurrent();
    if (measure(word) <= maxWidth) {
      current = word;
      return;
    }
    for (const char of word) {
      if (current && measure(current + char) > maxWidth) {
        if (/^\p{P}$/u.test(char)) {
          const parts = Array.from(current);
          const moved = parts.pop();
          const prefix = parts.join('');
          if (moved && prefix && measure(`${moved}${char}`) <= maxWidth) {
            current = prefix;
            pushCurrent();
            current = `${moved}${char}`;
            continue;
          }
        }
        pushCurrent();
      }
      current += char;
    }
  };

  for (const token of text.match(/\s+|\S+/gu) ?? []) {
    if (/^\s+$/u.test(token)) {
      if (current && measure(current + token) <= maxWidth) current += token;
      continue;
    }
    appendWord(token);
  }
  if (current) pushCurrent();

  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let last = visible[maxLines - 1] ?? '';
  while (last && measure(`${last}…`) > maxWidth) last = Array.from(last).slice(0, -1).join('');
  visible[maxLines - 1] = measure('…') <= maxWidth ? `${last}…` : '';
  return visible;
}
