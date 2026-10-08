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
  terms: {
    label: 'AI 용어 추출',
    output: 'terms',
    include: { candidate: true, issues: false },
    instructions:
      'Find proper nouns, coined words and recurring game terms in the source lines that are not already in the glossary. ' +
      'Give the source term, a suggested target-language translation, and a short note on what it refers to. Return an empty list when there are none.',
  },
};
