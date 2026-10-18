import type { AiOutput } from './workflow.ts';
import { ANALYSIS_SECTIONS, type AnalysisSection } from './knowledge.ts';

export const ANALYSIS_WORKFLOW_PRESET_IDS = ['all', 'overview', 'peopleRelations', 'characters', 'relationships', 'events', 'speechRules', 'sceneListeners', 'terms'] as const;
export type AnalysisWorkflowPresetId = (typeof ANALYSIS_WORKFLOW_PRESET_IDS)[number];

/** Shared starting points for analysis workflows and their AI canvas node. */
export const ANALYSIS_WORKFLOW_PRESETS: Record<AnalysisWorkflowPresetId, {
  name: string;
  label: string;
  description: string;
  nodeLabel: string;
  sections: readonly AnalysisSection[];
}> = {
  all: {
    name: '작품 분석',
    label: '전체',
    description: '대본 전체를 읽고 개요·인물·관계·사건·말투 규칙·장면별 청자 초안과 용어 후보를 근거와 함께 만듭니다. 번역과 상태는 바꾸지 않습니다.',
    nodeLabel: 'AI 작품 분석',
    sections: ANALYSIS_SECTIONS,
  },
  overview: {
    name: '작품 개요 분석',
    label: '작품 개요',
    description: '배경·주요 갈등·줄거리를 읽어 작품 개요 문서를 만듭니다.',
    nodeLabel: 'AI 작품 개요 분석',
    sections: ['overview'],
  },
  peopleRelations: {
    name: '인물·관계 추출',
    label: '인물·관계',
    description: '등장인물 프로필, 인물 사이의 관계와 변화, 화자·청자 말투 규칙을 함께 추출합니다.',
    nodeLabel: 'AI 인물·관계 분석',
    sections: ['characters', 'relationships', 'speechRules'],
  },
  characters: {
    name: '인물 분석',
    label: '인물',
    description: '인물 프로필과 말투, 역할을 분석합니다.',
    nodeLabel: 'AI 인물 분석',
    sections: ['characters'],
  },
  relationships: {
    name: '관계 분석',
    label: '관계',
    description: '인물 사이의 관계와 변화 지점을 분석합니다.',
    nodeLabel: 'AI 관계 분석',
    sections: ['relationships'],
  },
  events: {
    name: '사건 추출',
    label: '사건',
    description: '사건의 원인·결과와 관련 인물을 분석합니다.',
    nodeLabel: 'AI 사건 분석',
    sections: ['events'],
  },
  speechRules: {
    name: '말투 규칙 분석',
    label: '말투 규칙',
    description: '화자와 청자 사이의 한국어 말투 규칙을 분석합니다.',
    nodeLabel: 'AI 말투 규칙 분석',
    sections: ['speechRules'],
  },
  sceneListeners: {
    name: '장면별 청자 분석',
    label: '장면별 청자',
    description: '장면마다 화자가 주로 말하는 상대와 예외를 분석합니다.',
    nodeLabel: 'AI 장면별 청자 분석',
    sections: ['sceneListeners'],
  },
  terms: {
    name: '용어 분석',
    label: '용어',
    description: '번역에서 일관되게 써야 할 용어와 번역 제안을 찾습니다.',
    nodeLabel: 'AI 용어 분석',
    sections: ['terms'],
  },
};

export const analysisWorkflowPreset = (id: AnalysisWorkflowPresetId) => ANALYSIS_WORKFLOW_PRESETS[id];

/** Ready-made AI node configurations. They are ordinary AI nodes; every field stays editable. */
export const AI_PRESETS: Record<string, { label: string; output: AiOutput; instructions: string; include: { candidate: boolean; issues: boolean }; sections?: AnalysisSection[]; batch?: { mode: 'unit' | 'group' | 'count' | 'whole'; size: number; maxTokens: number } }> = {
  analysis: {
    label: ANALYSIS_WORKFLOW_PRESETS.all.nodeLabel,
    output: 'analysis',
    include: { candidate: false, issues: false },
    instructions: '',
    sections: [...ANALYSIS_WORKFLOW_PRESETS.all.sections],
    batch: { mode: 'whole', size: 200, maxTokens: 300_000 },
  },
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

/** Core AI presets exposed in the workflow node library palette (excludes redundant speechFix/knowledge). */
export const PALETTE_AI_PRESET_IDS = ['translate', 'review', 'revise', 'listener', 'terms', 'analysis'] as const;
export type PaletteAiPresetId = (typeof PALETTE_AI_PRESET_IDS)[number];

