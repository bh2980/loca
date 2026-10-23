/** Removes the first message equal to `text` (the same text may be queued twice). */
export function removeOnce(list: string[], text: string): string[] {
  const at = list.indexOf(text);
  return at < 0 ? list : list.filter((_, i) => i !== at);
}

/** Texts handed back to the message box go after what is already typed there. */
export function mergeIntoDraft(draft: string, texts: string[]): string {
  return [draft.trim(), ...texts].filter(Boolean).join('\n\n');
}
