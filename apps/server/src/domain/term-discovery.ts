/**
 * Language-agnostic glossary term discovery across the script (DESIGN 3.1).
 *
 * Discovers candidate terms using code before or alongside AI analysis:
 * 1. Bracketed & quoted expressions: 『...』, 「...」, 【...】, 《...》, "...", “...” (high-signal proper nouns in games)
 * 2. Katakana word sequences: [\u30A0-\u30FFー]{2,} (crucial for Japanese games: names, places, skills)
 * 3. Capitalized phrases & acronyms: Unicode \p{Lu} titlecase phrases and all-caps acronyms (English / European games)
 * 4. High-frequency repeated n-grams via standard Intl.Segmenter (works across any language)
 * 5. Registered character names and aliases
 *
 * Filters common stopwords, strips placeholders/tags, and collects script occurrence counts and examples.
 */

export interface DiscoveredTerm {
  source: string;
  lines: number;
  kind: 'bracket' | 'katakana' | 'name' | 'character' | 'frequent';
  aliasOf?: string;
  examples: string[];
}

/** Placeholders ({PLAYER}, %s, <tag>, [bracket]) to strip out before tokenization. */
const STRIP_TAGS = /\{[^}]*\}|<[^>]*>|%\d*\$?[sdif]|\[[^\]]*\]/g;

/** High-signal brackets commonly used for game terms/skills/items/places. */
const BRACKET_PATTERN = /[『「【《〈“"]([^『「【《〈“"”』」】》〉\n\r]{2,40})[』」】》〉”"]/g;

/** Katakana sequences (Japanese proper nouns, foreign words, spell/item names). */
const KATAKANA_PATTERN = /[\u30A0-\u30FF][\u30A0-\u30FFー・]{1,30}/g;

/** Unicode uppercase acronyms (e.g. "EMP", "HUD", "VIP", "DNA"). */
const ACRONYM_PATTERN = /^\p{Lu}{2,8}$/u;

/** Capitalized words in Latin scripts (Unicode aware for accented letters like É, Ö, etc.). */
const LATIN_CAP_WORD = /^\p{Lu}[\p{Ll}'’-]+$/u;
const LATIN_WORD = /^[\p{Script=Latin}'’-]+$/u;
const LATIN_LOWER_WORD = /^[\p{Ll}'’-]+$/u;
const LATIN_CONNECTORS = new Set(['of', 'de', 'von', 'van', 'la', 'le', 'du', 'del', 'da']);

/** Very common words that should not be solitary term candidates. */
const GLOBAL_STOPWORDS = new Set([
  // English articles, pronouns, prepositions, conjunctions, auxiliaries & common conversational words
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves', 'they', 'them', 'their', 'theirs', 'themselves',
  'there', 'here', 'where', 'when', 'how', 'why', 'whether', 'while', 'whilst',
  'for', 'to', 'with', 'from', 'in', 'on', 'at', 'by', 'of', 'as', 'into', 'onto', 'upon',
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'before',
  'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except', 'inside',
  'near', 'off', 'out', 'outside', 'over', 'past', 'since', 'through', 'throughout', 'till',
  'toward', 'towards', 'under', 'underneath', 'until', 'up', 'down', 'without', 'within',
  'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'because', 'although', 'though', 'unless', 'once', 'than',
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'done',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'ought', 'need',
  'get', 'got', 'getting', 'make', 'made', 'go', 'going', 'went', 'gone', 'come', 'came',
  'take', 'took', 'know', 'knew', 'think', 'thought', 'see', 'saw', 'want', 'give', 'use',
  'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call', 'keep', 'let', 'put', 'say', 'said', 'look', 'like',
  'some', 'any', 'all', 'both', 'each', 'every', 'other', 'another', 'such', 'own', 'same',
  'many', 'much', 'more', 'most', 'few', 'less', 'least', 'several', 'enough',
  'one', 'two', 'three', 'four', 'five', 'first', 'second', 'third', 'last', 'next',
  'just', 'only', 'also', 'very', 'too', 'even', 'still', 'already', 'always', 'never',
  'often', 'sometimes', 'again', 'back', 'now', 'then', 'today', 'tomorrow', 'yesterday',
  'soon', 'later', 'away', 'maybe', 'perhaps', 'really', 'actually', 'probably', 'almost', 'quite', 'rather', 'else', 'ever',
  'nothing', 'something', 'anything', 'everything', 'someone', 'anyone', 'everyone', 'nobody', 'somebody', 'anybody', 'everybody',
  'new', 'old', 'good', 'bad', 'great', 'little', 'big', 'long', 'right', 'left', 'high', 'low',
  'yes', 'no', 'not', 'okay', 'ok', 'well', 'sure', 'fine', 'yeah', 'yep', 'nope', 'oh', 'ah', 'uh', 'um', 'hey', 'hi',
  'please', 'thank', 'thanks', 'hello', 'goodbye', 'sorry', 'welcome', 'wait', 'listen', 'stop',
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam', 'tv', 'am', 'pm',
  "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", 'cannot', "couldn't", "shouldn't",
  "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't", "hadn't", "let's",
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
  "he's", "she's", "it's", "we're", "we've", "we'll", "they're", "they've", "they'll",
  "that's", "there's", "what's", "who's", "where's", "how's",
  // Japanese common function words / pronouns
  'これ', 'それ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ',
  'わたし', 'わたくし', 'ぼく', 'おれ', 'あなた', 'あんた', 'かれ', 'かのじょ',
  'なん', 'なに', 'だれ', 'いつ', 'どう', 'なぜ', 'はい', 'いいえ',
  // Korean common pronouns / function words
  '이것', '그것', '저것', '여기', '거기', '저기', '어디',
  '누구', '언제', '무엇', '어떻게', '왜', '네', '아니오', '응', '아니',
]);

export interface DiscoverOptions {
  sourceLanguage?: string;
  minLines?: number;
  maxExamples?: number;
  minKatakanaLength?: number;
}

export function discoverTerms(
  units: { key: string; source: string }[],
  characters: { name: string; aliases: string[] }[] = [],
  options: DiscoverOptions = {},
): DiscoveredTerm[] {
  const minLines = options.minLines ?? 2;
  const maxExamples = options.maxExamples ?? 3;
  const minKatakanaLen = options.minKatakanaLength ?? 2;
  const lang = options.sourceLanguage || undefined;

  // Segmenter for the source language (or default locale)
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  }

  // Term source (normalized lower or exact) -> occurrences
  const occurrences = new Map<
    string,
    { display: string; lines: Set<number>; kind: DiscoveredTerm['kind']; midSentenceCap: boolean }
  >();
  // Track words seen in all-lowercase so common words capitalized at sentence start aren't mistaken for proper nouns
  const lowercaseSeen = new Set<string>();

  const record = (raw: string, lineIndex: number, kind: DiscoveredTerm['kind'], midSentenceCap = true) => {
    const term = raw.trim();
    if (!term || term.length < 2) return;
    if (/^\d+$/.test(term)) return; // purely numeric
    const lower = term.toLowerCase();
    if (GLOBAL_STOPWORDS.has(lower)) return;

    let existing = occurrences.get(lower);
    if (!existing) {
      existing = { display: term, lines: new Set(), kind, midSentenceCap };
      occurrences.set(lower, existing);
    } else {
      // Only adopt capitalized display if the candidate itself is not a lowercase frequent hit
      if (kind !== 'frequent' && term !== existing.display && LATIN_CAP_WORD.test(term)) {
        existing.display = term;
      }
      if (existing.kind === 'frequent' && kind !== 'frequent') {
        existing.kind = kind; // upgrade to more specific kind
      }
      if (midSentenceCap) {
        existing.midSentenceCap = true;
      }
    }
    existing.lines.add(lineIndex);
  };

  // 1. Registered characters and aliases
  const charAliasMap = new Map<string, string>();
  const charNames = new Set<string>();
  for (const char of characters) {
    const canon = char.name.trim();
    if (canon && !/^[A-Z0-9_]+$/.test(canon)) {
      charNames.add(canon.toLowerCase());
      for (const alias of char.aliases) {
        const trimmed = alias.trim();
        if (trimmed && trimmed.toLowerCase() !== canon.toLowerCase()) {
          charAliasMap.set(trimmed.toLowerCase(), canon);
        }
      }
    }
  }

  // 2. Scan each unit line
  units.forEach((unit, lineIndex) => {
    const raw = unit.source.replace(STRIP_TAGS, ' ');

    // 2.1 Pattern: Bracketed and quoted phrases
    for (const match of raw.matchAll(BRACKET_PATTERN)) {
      const phrase = match[1]?.trim();
      if (phrase && phrase.length >= 2 && phrase.length <= 40) {
        record(phrase, lineIndex, 'bracket');
      }
    }

    // 2.2 Pattern: Katakana sequences (for Japanese)
    for (const match of raw.matchAll(KATAKANA_PATTERN)) {
      const katakana = match[0].trim();
      if (katakana.length >= minKatakanaLen) {
        record(katakana, lineIndex, 'katakana');
      }
    }

    // 2.3 Segmenter-based word & N-gram scanning with sentence-boundary awareness
    const rawSegments = [...segmenter.segment(raw)];
    const segments: { word: string; isSentenceStart: boolean }[] = [];
    let atSentenceStart = true;
    for (const seg of rawSegments) {
      if (seg.isWordLike) {
        const w = seg.segment.trim();
        if (w) {
          segments.push({ word: w, isSentenceStart: atSentenceStart });
          atSentenceStart = false;
        }
      } else if (/[.!?…:;|"—–\n\r]/.test(seg.segment)) {
        atSentenceStart = true;
      }
    }

    // Track latin capital phrase runs (e.g. "Harbor Gate", "High Council of Elders")
    let capRun: { word: string; isSentenceStart: boolean }[] = [];
    const flushCapRun = () => {
      while (capRun.length && LATIN_CONNECTORS.has(capRun.at(-1)!.word.toLowerCase())) {
        capRun.pop();
      }
      // Strip leading sentence-initial stopword (e.g. "The Westmere Harbor" -> "Westmere Harbor")
      while (capRun.length > 1 && capRun[0].isSentenceStart && GLOBAL_STOPWORDS.has(capRun[0].word.toLowerCase())) {
        capRun.shift();
      }
      while (capRun.length && LATIN_CONNECTORS.has(capRun[0]!.word.toLowerCase())) {
        capRun.shift();
      }
      if (capRun.length >= 2) {
        record(capRun.map((c) => c.word).join(' '), lineIndex, 'name', true);
      } else if (capRun.length === 1) {
        const only = capRun[0]!;
        if (ACRONYM_PATTERN.test(only.word)) {
          record(only.word, lineIndex, 'name', true);
        } else if (only.word.length >= 3 && !GLOBAL_STOPWORDS.has(only.word.toLowerCase())) {
          record(only.word, lineIndex, 'name', !only.isSentenceStart);
        }
      }
      capRun = [];
    };

    segments.forEach(({ word, isSentenceStart }, idx) => {
      const lower = word.toLowerCase();
      if (LATIN_LOWER_WORD.test(word)) {
        lowercaseSeen.add(lower);
      }

      // If this word is a registered character/alias, always record it regardless of casing rules
      if (charNames.has(lower) || charAliasMap.has(lower)) {
        record(word, lineIndex, 'character', true);
      }

      // Latin Capital check
      if (LATIN_CAP_WORD.test(word) || ACRONYM_PATTERN.test(word)) {
        if (/^I(['’]\w+)?$/u.test(word)) {
          flushCapRun();
        } else if (isSentenceStart && capRun.length > 0) {
          flushCapRun();
          capRun.push({ word, isSentenceStart });
        } else {
          capRun.push({ word, isSentenceStart });
        }
      } else if (
        capRun.length > 0 &&
        LATIN_CONNECTORS.has(lower) &&
        !(capRun.length === 1 && capRun[0].isSentenceStart && GLOBAL_STOPWORDS.has(capRun[0].word.toLowerCase())) &&
        idx + 1 < segments.length
      ) {
        capRun.push({ word: lower, isSentenceStart: false });
      } else {
        flushCapRun();
      }

      // Non-Latin frequent word & 2-gram check (in Latin scripts, lowercase words are regular vocabulary, not terms)
      const isLatin = LATIN_WORD.test(word);
      if (!isLatin && word.length >= 2 && !GLOBAL_STOPWORDS.has(lower)) {
        record(word, lineIndex, 'frequent');
      }

      if (!isLatin && idx + 1 < segments.length) {
        const nextWord = segments[idx + 1]!.word;
        if (!LATIN_WORD.test(nextWord) && !GLOBAL_STOPWORDS.has(lower) && !GLOBAL_STOPWORDS.has(nextWord.toLowerCase())) {
          const bigram = `${word} ${nextWord}`;
          if (bigram.length >= 4) {
            record(bigram, lineIndex, 'frequent');
          }
        }
      }
    });
    flushCapRun();
  });

  // 3. Assemble and filter results
  const results: DiscoveredTerm[] = [];

  for (const entry of occurrences.values()) {
    const lineCount = entry.lines.size;
    const lower = entry.display.toLowerCase();

    // Is it a registered character or alias?
    const isChar = charNames.has(lower) || charAliasMap.has(lower);
    if (isChar) {
      const aliasOf = charAliasMap.get(lower);
      const sortedLines = [...entry.lines].sort((a, b) => a - b);
      results.push({
        source: entry.display,
        lines: lineCount,
        kind: 'character',
        ...(aliasOf && { aliasOf }),
        examples: sortedLines.slice(0, maxExamples).map((i) => units[i].key),
      });
      continue;
    }

    // Bracketed and Katakana terms are high-signal; keep even if count is 1 or minLines
    if (entry.kind === 'bracket' || entry.kind === 'katakana') {
      if (lineCount >= Math.min(minLines, 2)) {
        const sortedLines = [...entry.lines].sort((a, b) => a - b);
        results.push({
          source: entry.display,
          lines: lineCount,
          kind: entry.kind,
          examples: sortedLines.slice(0, maxExamples).map((i) => units[i].key),
        });
      }
      continue;
    }

    // Name phrases / Acronyms
    if (entry.kind === 'name') {
      const isSingleWord = !entry.display.includes(' ');
      const isAcronym = ACRONYM_PATTERN.test(entry.display);
      // Single-word Latin names must have appeared capitalized mid-sentence at least once and never in lowercase
      if (isSingleWord && !isAcronym && (!entry.midSentenceCap || lowercaseSeen.has(lower))) {
        continue;
      }
      if (lineCount >= minLines) {
        const sortedLines = [...entry.lines].sort((a, b) => a - b);
        results.push({
          source: entry.display,
          lines: lineCount,
          kind: 'name',
          examples: sortedLines.slice(0, maxExamples).map((i) => units[i].key),
        });
      }
      continue;
    }

    // Frequent n-grams: require slightly higher threshold (e.g. minLines or >= 3) to prevent common word noise
    if (entry.kind === 'frequent') {
      const threshold = Math.max(minLines, 3);
      if (lineCount >= threshold) {
        const sortedLines = [...entry.lines].sort((a, b) => a - b);
        results.push({
          source: entry.display,
          lines: lineCount,
          kind: 'frequent',
          examples: sortedLines.slice(0, maxExamples).map((i) => units[i].key),
        });
      }
    }
  }

  // 4. Ensure all registered character names are included even if lines = 0
  const includedSet = new Set(results.map((r) => r.source.toLowerCase()));
  for (const char of characters) {
    const canon = char.name.trim();
    if (canon && !includedSet.has(canon.toLowerCase()) && !/^[A-Z0-9_]+$/.test(canon)) {
      results.push({ source: canon, lines: 0, kind: 'character', examples: [] });
      includedSet.add(canon.toLowerCase());
    }
    for (const alias of char.aliases) {
      const trimmed = alias.trim();
      if (trimmed && !includedSet.has(trimmed.toLowerCase())) {
        results.push({ source: trimmed, lines: 0, kind: 'character', aliasOf: canon, examples: [] });
        includedSet.add(trimmed.toLowerCase());
      }
    }
  }

  // Sort by occurrence count descending, then alphabetical
  return results.sort((a, b) => b.lines - a.lines || a.source.localeCompare(b.source));
}
