import type { LineMark } from '@tw/shared';

type ListenerFacetSearch = { listener?: string; marks?: readonly LineMark[] };
type ListenerFacetPatch = { listener?: string; marks?: LineMark[] };

/** Selecting a named or unknown listener replaces the other choice while keeping unrelated marks. */
export function knownListenerFilter(search: ListenerFacetSearch, name: string, checked: boolean): ListenerFacetPatch {
  const marks: LineMark[] = (search.marks ?? []).filter((mark): boolean => mark !== 'unknownListener');
  return { listener: checked ? name : undefined, marks: marks.length ? marks : undefined };
}

export function unknownListenerFilter(search: ListenerFacetSearch, checked: boolean): ListenerFacetPatch {
  const marks: LineMark[] = (search.marks ?? []).filter((mark): boolean => mark !== 'unknownListener');
  if (checked) marks.push('unknownListener');
  return { listener: undefined, marks: marks.length ? marks : undefined };
}

export function toggleLineMarkFilter(search: ListenerFacetSearch, mark: LineMark, checked: boolean): ListenerFacetPatch {
  const marks = (search.marks ?? []).filter((other) => other !== mark);
  if (checked) marks.push(mark);
  return {
    ...(mark === 'unknownListener' && checked ? { listener: undefined } : {}),
    marks: marks.length ? marks : undefined,
  };
}
