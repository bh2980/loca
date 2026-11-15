/** Removes the first message whose text is `text` (the same text may be queued twice). */
export function removeOnce<T extends { text: string }>(list: T[], text: string): T[] {
  const at = list.findIndex((item) => item.text === text);
  return at < 0 ? list : list.filter((_, i) => i !== at);
}

/** Texts handed back to the message box go after what is already typed there. */
export function mergeIntoDraft(draft: string, texts: string[]): string {
  return [draft.trim(), ...texts].filter(Boolean).join('\n\n');
}
