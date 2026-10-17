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
const LATIN_CAP_WORD = /^\p{Lu}[\p{Ll}'’-]*$/u;
const LATIN_CONNECTORS = new Set(['of', 'de', 'von', 'van', 'la', 'le', 'du', 'del', 'da', 'the', 'and', 'for', 'in', 'on', 'at', 'to']);

/** Very common words that should not be solitary term candidates. */
const GLOBAL_STOPWORDS = new Set([
  // English common words
  'the', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'there', 'their', 'they', 'them', 'here', 'where', 'when', 'how', 'why',
  'yes', 'no', 'not', 'okay', 'well', 'sure', 'fine', 'yeah', 'yep', 'nope',
  'please', 'thank', 'thanks', 'hello', 'goodbye', 'sorry',
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam',
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
  const occurrences = new Map<string, { display: string; lines: Set<number>; kind: DiscoveredTerm['kind'] }>();

  const record = (raw: string, lineIndex: number, kind: DiscoveredTerm['kind']) => {
    const term = raw.trim();
    if (!term || term.length < 2) return;
    if (/^\d+$/.test(term)) return; // purely numeric
    const lower = term.toLowerCase();
    if (GLOBAL_STOPWORDS.has(lower)) return;

    let existing = occurrences.get(lower);
    if (!existing) {
      existing = { display: term, lines: new Set(), kind };
      occurrences.set(lower, existing);
    } else {
      // Prefer capitalized/original casing with higher frequency or title case
      if (term !== existing.display && LATIN_CAP_WORD.test(term)) {
        existing.display = term;
      }
      if (existing.kind === 'frequent' && kind !== 'frequent') {
        existing.kind = kind; // upgrade to more specific kind
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

    // 2.3 Segmenter-based word & N-gram scanning
    const segments = [...segmenter.segment(raw)].filter((s) => s.isWordLike).map((s) => s.segment.trim()).filter(Boolean);

    // Track latin capital phrase runs (e.g. "Harbor Gate", "High Council of Elders")
    let capRun: string[] = [];
    const flushCapRun = () => {
      while (capRun.length && LATIN_CONNECTORS.has(capRun.at(-1)!.toLowerCase())) {
        capRun.pop();
      }
      if (capRun.length > 1 && capRun[0] === 'The') {
        capRun = capRun.slice(1);
      }
      if (capRun.length >= 2) {
        record(capRun.join(' '), lineIndex, 'name');
      } else if (capRun.length === 1 && (ACRONYM_PATTERN.test(capRun[0]) || capRun[0].length >= 3)) {
        record(capRun[0], lineIndex, 'name');
      }
      capRun = [];
    };

    segments.forEach((word, idx) => {
      // Latin Capital check
      if (LATIN_CAP_WORD.test(word) || ACRONYM_PATTERN.test(word)) {
        if (/^I(['’]\w+)?$/.test(word)) {
          flushCapRun();
        } else {
          capRun.push(word);
        }
      } else if (capRun.length > 0 && LATIN_CONNECTORS.has(word.toLowerCase()) && idx + 1 < segments.length) {
        capRun.push(word.toLowerCase());
      } else {
        flushCapRun();
      }

      // Check single words (if length >= 2 and not stopword)
      if (word.length >= 2 && !GLOBAL_STOPWORDS.has(word.toLowerCase())) {
        record(word, lineIndex, 'frequent');
      }

      // 2-gram check
      if (idx + 1 < segments.length) {
        const nextWord = segments[idx + 1];
        if (!GLOBAL_STOPWORDS.has(word.toLowerCase()) && !GLOBAL_STOPWORDS.has(nextWord.toLowerCase())) {
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
