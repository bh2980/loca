import { diffLines, diffWordsWithSpace } from 'diff';
import type { DiffPart, DiffRow } from '@loca/ui';

/** Unchanged text this long around a change is cut down to its ends: a one-word edit in a long paragraph shows where it is, not the paragraph. */
const KEEP = 60;
function clip(parts: DiffPart[]): DiffPart[] {
  if (!parts.some((part) => part.mark)) return parts;
  return parts.map((part, index) => {
    if (part.mark || part.text.length <= KEEP * 2 + 20) return part;
    const first = index === 0;
    const last = index === parts.length - 1;
    if (first) return { text: `…${part.text.slice(-KEEP)}` };
    if (last) return { text: `${part.text.slice(0, KEEP)}…` };
    return { text: `${part.text.slice(0, KEEP)} … ${part.text.slice(-KEEP)}` };
  });
}

/** The parts of one side of a word diff, split into its lines. */
function sideLines(changes: ReturnType<typeof diffWordsWithSpace>, side: 'removed' | 'added'): DiffPart[][] {
  const lines: DiffPart[][] = [[]];
  for (const change of changes) {
    if (side === 'removed' ? change.added : change.removed) continue;
    const mark = side === 'removed' ? change.removed : change.added;
    change.value.split('\n').forEach((text, index) => {
      if (index > 0) lines.push([]);
      if (text) lines.at(-1)!.push(mark ? { text, mark: true } : { text });
    });
  }
  return lines;
}

/** A changed block as its old lines then its new lines, the changed words marked (the line counts may differ). */
function wordBlock(before: string, after: string): DiffRow[] {
  const changes = diffWordsWithSpace(before, after);
  return [
    ...sideLines(changes, 'removed').map((parts): DiffRow => ({ type: 'removed', parts: clip(parts) })),
    ...sideLines(changes, 'added').map((parts): DiffRow => ({ type: 'added', parts: clip(parts) })),
  ];
}

const linesOf = (value: string) => (value.endsWith('\n') ? value.slice(0, -1) : value).split('\n');

export function diffRows(before: string, after: string): DiffRow[] {
  if (!before.includes('\n') && !after.includes('\n')) {
    if (before === after) return [{ type: 'same', parts: [{ text: after }] }];
    return wordBlock(before, after);
  }
  const chunks = diffLines(before, after);
  const raw: DiffRow[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (chunk.removed && chunks[i + 1]?.added) {
      raw.push(...wordBlock(linesOf(chunk.value).join('\n'), linesOf(chunks[i + 1]!.value).join('\n')));
      i++;
      continue;
    }
    const type = chunk.added ? 'added' : chunk.removed ? 'removed' : 'same';
    for (const line of linesOf(chunk.value)) {
      raw.push({ type, parts: [{ text: line }] });
    }
  }

  if (raw.every((row) => row.type === 'same')) return raw;

  const out: DiffRow[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i]!.type !== 'same') {
      out.push(raw[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < raw.length && raw[j]!.type === 'same') j++;
    const len = j - i;
    if (len > 4) {
      if (i === 0) {
        out.push({ type: 'folded', count: len - 2 }, ...raw.slice(j - 2, j));
      } else if (j === raw.length) {
        out.push(...raw.slice(i, i + 2), { type: 'folded', count: len - 2 });
      } else {
        out.push(...raw.slice(i, i + 2), { type: 'folded', count: len - 4 }, ...raw.slice(j - 2, j));
      }
    } else {
      out.push(...raw.slice(i, j));
    }
    i = j;
  }
  return out;
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  if (!before.includes('\n') && !after.includes('\n')) {
    return before === after ? { added: 0, removed: 0 } : { added: 1, removed: 1 };
  }
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const count = part.count ?? linesOf(part.value).length;
    if (part.added) added += count;
    else if (part.removed) removed += count;
  }
  return { added, removed };
}
