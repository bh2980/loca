/**
 * An edge label from the source data is either text a person reads (an option's words, a branch
 * name) or an identifier the exporter left there (a divert target, a condition such as
 * `rules-whotaughtyou=0`). Identifiers are not worth drawing on a path.
 */
export function isIdentifierLabel(label: string, nodeKeys?: ReadonlySet<string>): boolean {
  const text = label.trim();
  if (!text) return true;
  if (nodeKeys?.has(text)) return true;
  return !/\s/.test(text) && /[-_=.]/.test(text);
}
