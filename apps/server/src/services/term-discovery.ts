/**
 * Glossary candidates found by code across the whole script, before any translation (DESIGN 3.1,
 * step 1). People validate the glossary anyway, so this favours not missing a term over precision:
 *
 * - Capitalized phrases ("Freedom Plaza", "Bank of Orwell") and acronyms ("NSA"). A single word
 *   counts as a name only when it is capitalized where a sentence does not start more often than it
 *   appears in lower case ("Thought" in Orwell yes, "Mall" / "mall" no).
 * - Character names and aliases are included, so their Korean form is fixed once.
 * - Placeholders ({CHAR_NINA}, %s) and tags are ignored.
 *
 * Each candidate carries how many lines use it and the first few of them, so the review can sort
 * by frequency and the meaning step can show the term in use.
 */
export interface DiscoveredTerm {
  source: string;
  /** Lines that contain it. */
  lines: number;
  /** "name" for a capitalized phrase or acronym, "character" for a character name or alias. */
  kind: 'name' | 'character';
  /** Keys of the first lines that contain it, in script order. */
  examples: string[];
}

/** Lower-case words that can sit inside a name ("Bank of Orwell", "Children of the Night"). */
const CONNECTORS = new Set(['of', 'de', 'von', 'van', 'la', 'le', 'du', 'del', 'da']);
const STRIP = /\{[^}]*\}|<[^>]*>|%\d*\$?[sdif]|\[[^\]]*\]/g;
const WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g;
/** Capitalized by convention, never terms on their own. */
const COMMON = new Set(['OK', 'Okay', 'Mr', 'Mrs', 'Ms', 'Dr', 'Sir', 'Madam', 'Miss', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

const capitalized = (word: string) => /^[A-Z]/.test(word);
const acronym = (word: string) => /^[A-Z]{2,}s?$/.test(word);
const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const join = (map: Map<string, Set<number>>, phrase: string, line: number) => {
  const lines = map.get(phrase) ?? new Set<number>();
  lines.add(line);
  map.set(phrase, lines);
};

export function discoverTerms(
  units: { key: string; source: string }[],
  characters: { name: string; aliases: string[] }[] = [],
  options: { minLines?: number; maxExamples?: number } = {},
): DiscoveredTerm[] {
  const minLines = options.minLines ?? 2;
  const maxExamples = options.maxExamples ?? 3;
  const midCaps = new Map<string, number>();
  const lower = new Map<string, number>();
  /** Phrase → line indexes. */
  const phrases = new Map<string, Set<number>>();
  /** Single capitalized words that open a sentence: they count only once the word is known to be a name. */
  const openers = new Map<string, Set<number>>();

  units.forEach((unit, line) => {
    const text = unit.source.replace(STRIP, ' ');
    for (const sentence of text.split(/(?<=[.!?…:;"“”])\s+|\n+/)) {
      const words = [...sentence.matchAll(WORD)].map((match) => match[0].replace(/['’]s$/, ''));
      let run: string[] = [];
      let opensSentence = false;
      const flush = () => {
        while (run.length && CONNECTORS.has(run.at(-1)!.toLowerCase())) run.pop();
        if (run.length > 1 && run[0] === 'The') run = run.slice(1);
        if (run.length === 1 && COMMON.has(run[0])) run = [];
        if (run.length === 1 && opensSentence && !acronym(run[0])) join(openers, run[0], line);
        else if (run.length) join(phrases, run.join(' '), line);
        run = [];
      };
      words.forEach((word, index) => {
        // "I" and its contractions are capitalized by grammar and never part of a name ("But I").
        if (/^I(['’]\w+)?$/.test(word)) return flush();
        if (capitalized(word)) {
          if (index > 0) count(midCaps, word);
          if (!run.length) opensSentence = index === 0;
          return void run.push(word);
        }
        count(lower, word.toLowerCase());
        const inName = run.length > 0 && index + 1 < words.length && capitalized(words[index + 1]) && (CONNECTORS.has(word) || (word === 'the' && run.at(-1) === 'of'));
        if (inName) run.push(word);
        else flush();
      });
      flush();
    }
  });

  const ordinary = (word: string) => !acronym(word) && (lower.get(word.toLowerCase()) ?? 0) >= (midCaps.get(word) ?? 0);
  // "But Ralph", "No Alice": an ordinary word opening a sentence before a name is not part of it.
  for (const [phrase, lines] of [...phrases]) {
    const words = phrase.split(' ');
    if (words.length < 2 || !ordinary(words[0]) || CONNECTORS.has(words[1])) continue;
    phrases.delete(phrase);
    for (const line of lines) join(phrases, words.slice(1).join(' '), line);
  }
  // A known name also counts where it opens a sentence.
  for (const [word, lines] of openers) if (phrases.has(word)) for (const line of lines) join(phrases, word, line);
  // "ALICE" shouted and "Alice" are one term, under the spelling used most.
  const byLower = new Map<string, string[]>();
  for (const phrase of phrases.keys()) byLower.set(phrase.toLowerCase(), [...(byLower.get(phrase.toLowerCase()) ?? []), phrase]);
  for (const spellings of byLower.values()) {
    const [main, ...others] = spellings.sort((a, b) => phrases.get(b)!.size - phrases.get(a)!.size);
    for (const other of others) {
      for (const line of phrases.get(other)!) join(phrases, main, line);
      phrases.delete(other);
    }
  }

  const termOf = (source: string, lines: Set<number> | undefined, kind: DiscoveredTerm['kind']): DiscoveredTerm => {
    const sorted = [...(lines ?? [])].sort((a, b) => a - b);
    return { source, lines: sorted.length, kind, examples: sorted.slice(0, maxExamples).map((line) => units[line].key) };
  };
  const names = new Set(characters.flatMap((character) => [character.name, ...character.aliases]).filter((name) => name.trim() && !/^[A-Z0-9_]+$/.test(name)));
  const result: DiscoveredTerm[] = [];
  for (const [phrase, lines] of phrases) {
    if (names.has(phrase)) {
      result.push(termOf(phrase, lines, 'character'));
      continue;
    }
    if (lines.size < minLines) continue;
    const words = phrase.split(' ').filter((word) => !CONNECTORS.has(word) && word !== 'the');
    // Shouted words ("NOT", "WHAT") are ordinary words in capitals.
    if (words.every(acronym) && words.every((word) => lower.has(word.toLowerCase().replace(/s$/, '')))) continue;
    if (words.length === 1 && ordinary(words[0])) continue;
    result.push(termOf(phrase, lines, 'name'));
  }
  // Character names and aliases, found in the text or not (a speaker's name still needs a Korean form).
  const listed = new Set(result.map((term) => term.source.toLowerCase()));
  for (const name of names) if (!listed.has(name.toLowerCase())) result.push(termOf(name, phrases.get(name) ?? openers.get(name), 'character'));
  return result.sort((a, b) => b.lines - a.lines || a.source.localeCompare(b.source));
}
