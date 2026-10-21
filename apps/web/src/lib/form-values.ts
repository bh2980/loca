/**
 * What a number field holds, for react-hook-form's setValueAs. The form hands it the field's text
 * as typed, but also the default value as stored when the field mounts (null for "none"), so an empty
 * value can be '', null or undefined: each is "no number", never 0 (Number(null) is 0, which failed a
 * min() check and kept 입력·출력 토큰 left empty from saving).
 */
export const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? null : String(value).trim();
  if (text === '') return null;
  const number = text === null ? (value as number) : Number(text);
  return Number.isFinite(number) ? number : null;
};

/** As numberOrNull, for a field whose "no number" is left out (undefined) rather than stored as null. */
export const numberOrUndefined = (value: unknown): number | undefined => numberOrNull(value) ?? undefined;
