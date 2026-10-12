import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const journal = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle/meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };

describe('migration journal', () => {
  // Drizzle applies only migrations newer than the last applied one: a "when" out of order makes
  // every later migration silently skip on databases that already ran the out-of-order one.
  it('has strictly increasing timestamps in index order', () => {
    const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
    for (let index = 1; index < entries.length; index++) expect(entries[index].when, `${entries[index].tag} must be newer than ${entries[index - 1].tag}`).toBeGreaterThan(entries[index - 1].when);
  });

  it('is not dated in the future', () => {
    for (const entry of journal.entries) expect(entry.when, entry.tag).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
