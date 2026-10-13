import type { AiOutput } from './workflow.ts';

/** Ready-made AI node configurations. They are ordinary AI nodes; every field stays editable. */
export const AI_PRESETS: Record<string, { label: string; output: AiOutput; instructions: string; include: { candidate: boolean; issues: boolean } }> = {
  translate: {
    label: 'AI 번역',
    output: 'candidate',
    include: { candidate: false, issues: false },
    instructions:
      'Translate each line. Keep every placeholder ({name}, %s), rich-text tag and line break exactly. ' +
      "Match each speaker's voice and relationships. Use glossary targets when the term is used in that sense.",
  },
  review: {
    label: 'AI 검수',
    output: 'verdict',
    include: { candidate: true, issues: false },
    instructions:
      'Review each candidate translation against its source. Pass it only if meaning, nuance, tone, character voice, ' +
      'glossary use and formatting are all acceptable. ' +
      'Also read the lines of the batch together as one scene: forms of address, honorifics, speech level and term choices ' +
      'must stay consistent between lines of the same speaker and relationship. When two lines disagree, fail the line that ' +
      'breaks the established pattern (not every line) and name the line it conflicts with. ' +
      'List concrete problems in issues (in the target language); empty when passed.',
  },
  revise: {
    label: 'AI 수정',
    output: 'candidate',
    include: { candidate: true, issues: true },
    instructions:
      'Revise each candidate translation so it resolves every listed issue while keeping what was already correct. ' +
      'Keep every placeholder, rich-text tag and line break exactly.',
  },
  speechFix: {
    label: 'AI 말투 맞추기',
    output: 'candidate',
    include: { candidate: true, issues: false },
    instructions:
      'Each line has a current translation ("candidate") and, where known, its listener and a confirmed speechRule. ' +
      'Change only the sentence endings, honorifics and forms of address so the line follows its speechRule; keep the meaning, word choice and everything else as it is. ' +
      'If a line already follows its rule, or has no rule, return its candidate unchanged. Keep every placeholder, rich-text tag and line break exactly.',
  },
  knowledge: {
    label: 'AI 자료 변경 찾기',
    output: 'knowledge',
    include: { candidate: false, issues: false },
    instructions:
      'Read these lines as one scene against what is already known (cast, characters, relationships and the speech rules on each line). ' +
      'Report only what the scene adds or changes: people not in the cast, a relationship that starts or changes (with the line where it shows), ' +
      'events that later lines may refer back to, and a point where a speaker starts addressing a listener at a different Korean speech level. ' +
      'Use only what the lines say; return empty lists when nothing is new.',
  },
  listener: {
    label: 'AI 청자 추정',
    output: 'listener',
    include: { candidate: false, issues: false },
    instructions:
      'For each line, decide who the speaker is addressing, so a Korean translator can pick the right speech level. ' +
      'Read the whole batch as a scene: who is present, turn-taking, vocatives, questions and answers. ' +
      'Name the listener as in the cast list (the player character included, even if it never speaks). Someone not in the cast — an extra such as a SWAT officer or a passer-by — is named ' +
      'exactly as they appear as a speaker in the lines (e.g. "SWAT 2"), or as the lines call them when they never speak; never put a cast member in an extra\'s place. Use "group" for several people present, ' +
      '"public" for an unspecified audience (broadcast, announcement, post), "self" for thinking aloud, and null when you cannot tell. Give a confidence from 0 to 1; never guess with high confidence.',
  },
  terms: {
    label: 'AI 용어 추출',
    output: 'terms',
    include: { candidate: true, issues: false },
    instructions:
      'Find proper nouns, coined words and recurring game terms in the source lines that are not already in the glossary. ' +
      'Give the source term, a suggested target-language translation, and a short note on what it refers to. Return an empty list when there are none.',
  },
};
