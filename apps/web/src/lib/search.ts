import { z } from 'zod';

/**
 * How a route reads its URL search params: each param is declared once, with the helper that says what it may hold,
 * and `searchParams` makes the route's `validateSearch` (and its search type) from the declarations. A value the
 * helper does not accept is dropped, never an error: a URL is typed by hand, kept in bookmarks and written by older
 * links (AGENTS.md "Page state": the URL is the page's state).
 */
const optional = <T>(read: (raw: unknown) => T | undefined) => z.unknown().transform((raw): T | undefined => read(raw));
const isText = (raw: unknown): raw is string => typeof raw === 'string' && raw !== '';

export const param = {
  /** Text (an id, a query, a tab of a pane); empty is absent. */
  text: optional((raw) => (isText(raw) ? raw : undefined)),
  /** One of a fixed set of words. */
  oneOf: <const T extends string>(values: readonly T[]) => optional((raw) => values.find((value) => value === raw)),
  /** One of a fixed set, with the one a URL without it means. */
  oneOfOr: <const T extends string>(values: readonly T[], fallback: NoInfer<T>) => z.unknown().transform((raw): T => values.find((value) => value === raw) ?? fallback),
  /** On or absent: `?review=true`. */
  flag: optional((raw) => (raw === true || raw === 'true' || raw === 1 || raw === '1' ? (true as const) : undefined)),
  /** Yes, no or absent: a filter with both answers. */
  bool: optional((raw) => (raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : undefined)),
  /** A page number or a count above zero. */
  positive: optional((raw) => (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined)),
  /** A list of ids with at least one; an empty list is absent. */
  ids: optional((raw) => (Array.isArray(raw) && raw.length > 0 && raw.every(isText) ? (raw as string[]) : undefined)),
  /** A list of ids where the empty list means something (none), unlike an absent one. */
  list: optional((raw) => (Array.isArray(raw) ? raw.filter(isText) : undefined)),
  /** A param with its own reader (a filter the CLI and the app share in `@loca/shared`). */
  read: optional,
};

type Shape = Record<string, z.ZodType>;
type Reads<S extends Shape> = { [K in keyof S]: z.output<S[K]> };
type OptionalKeys<T> = { [K in keyof T]: undefined extends T[K] ? K : never }[keyof T];
/** The search a set of declarations reads: every param optional unless its helper always answers (`oneOfOr`). */
export type SearchOf<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<Reads<S>>>]: Reads<S>[K] } & { [K in OptionalKeys<Reads<S>>]?: Reads<S>[K] } extends infer Search ? { [K in keyof Search]: Search[K] } : never;

/**
 * A route's `validateSearch` from its declarations: each declared param read on its own (an absent one is its
 * helper's answer for nothing), anything undeclared left out. `settle` sees the whole search for rules between params
 * (one thing picked at a time).
 */
export function searchParams<S extends Shape>(shape: S, settle?: (search: SearchOf<S>) => SearchOf<S>): (raw: Record<string, unknown>) => SearchOf<S> {
  const names = Object.keys(shape);
  return (raw) => {
    const search = Object.fromEntries(names.map((name) => [name, shape[name]!.parse(raw[name])])) as SearchOf<S>;
    return settle ? settle(search) : search;
  };
}
