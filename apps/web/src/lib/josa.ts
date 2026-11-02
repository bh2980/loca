/**
 * The particle a word's last sound takes: 받침 → `withFinal` (번역이), none → `withoutFinal`
 * (노트가). A word that does not end in Hangul (REEVE, 3) has no sure reading, so both forms stay.
 */
export function particle(word: string, withFinal: string, withoutFinal: string): string {
  const trimmed = word.trimEnd();
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withFinal : withoutFinal;
  return `${withFinal}(${withoutFinal})`;
}
