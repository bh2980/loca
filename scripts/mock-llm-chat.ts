/** Deterministic chat-tool intent used by the mock model, kept pure for coverage. */
export function readingRouteCall(user: string, system: string, tools: ReadonlySet<string>): { name: 'find_reading_route'; args: { start: string; end: string } } | undefined {
  if (!tools.has('find_reading_route') || !/경로|흐름/.test(user)) return undefined;

  const itemId = (kind: string) => new RegExp(`^-\\s*${kind}:.*\\[id=([^\\]]+)\\]`, 'm').exec(system)?.[1];
  let start = itemId('경로 시작');
  let end = itemId('경로 끝');

  // Also support a reproducible prompt without graph selection, e.g. "A1에서 E2까지 경로".
  const explicit = /(?:시작(?:\s*대사)?\s*[:=]\s*([\p{L}\p{N}_.-]+).*?끝(?:\s*대사)?\s*[:=]\s*([\p{L}\p{N}_.-]+)|([\p{L}\p{N}_.-]+)\s*(?:에서|부터|->|→)\s*([\p{L}\p{N}_.-]+)\s*까지)/u.exec(user);
  if (explicit) {
    start = explicit[1] ?? explicit[3];
    end = explicit[2] ?? explicit[4];
  }
  return start && end ? { name: 'find_reading_route', args: { start, end } } : undefined;
}
