export interface DiffPart {
  text: string;
  /** Only in the old text (removed), only in the new one (added), or in both. */
  change?: 'removed' | 'added';
}

/** Words with the spaces after them, so joining the parts gives the text back. */
const words = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];

/**
 * A word-level diff of two translations (longest common subsequence over words), for showing what
 * a later candidate changed. Neighbouring parts of the same kind are merged.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = words(before), b = words(after);
  const same = (x: string, y: string) => x.trim() === y.trim();
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = same(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const parts: DiffPart[] = [];
  const push = (text: string, change?: DiffPart['change']) => {
    const last = parts[parts.length - 1];
    if (last && last.change === change) last.text += text;
    else parts.push({ text, ...(change && { change }) });
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i], b[j])) (push(b[j]), i++, j++);
    // Removed words before the ones that replace them.
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) push(a[i++], 'removed');
    else push(b[j++], 'added');
  }
  return parts;
}
