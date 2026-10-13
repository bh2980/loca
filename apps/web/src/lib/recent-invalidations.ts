/** Topics a write's own answer (x-changed) just refetched; the event stream repeating them moments later is skipped. */
const SKIP_MS = 1500;
const recent = new Map<string, number>();

export function noteInvalidated(topics: string[]) {
  const now = Date.now();
  for (const topic of topics) recent.set(topic, now);
}

export function wasJustInvalidated(topic: string) {
  const at = recent.get(topic);
  return at !== undefined && Date.now() - at < SKIP_MS;
}
