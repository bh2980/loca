import { APPLY_TARGETS, type ApplyFunctionName, type JsonField } from './functions.ts';
import { AI_PRESETS, presetConfig, type AiPresetId } from './presets.ts';
import type { DraftModelChoice } from './model-choice.ts';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from './workflow.ts';

export type StatusKind = 'initial' | 'normal' | 'final';

/**
 * The colour palette for statuses, tags and automatic marks: twelve hues, one meaning each, all at the
 * same lightness (≥ 3:1 on the light work area). The stored value is the light-theme hex; the app shows
 * each through its theme variable (`--hue-1` … `--hue-12`, packages/ui tokens/theme.css), so the dark
 * theme gets its own tuned value. Any other hex still works and is shown as is.
 */
export const PALETTE = [
  { name: '회색', hex: '#79818c' },
  { name: '빨강', hex: '#d24c49' },
  { name: '주황', hex: '#c46016' },
  { name: '호박', hex: '#b26f00' },
  { name: '연두', hex: '#6d8e1c' },
  { name: '초록', hex: '#2a9754' },
  { name: '청록', hex: '#009589' },
  { name: '하늘', hex: '#0091ad' },
  { name: '파랑', hex: '#0486d3' },
  { name: '남색', hex: '#6076de' },
  { name: '보라', hex: '#8f68cb' },
  { name: '분홍', hex: '#bc5694' },
] as const;
export const STATUS_COLORS: string[] = PALETTE.map((color) => color.hex);
/**
 * The 20 Tailwind colours offered before the palette had twelve, each to the nearest palette hue.
 * Projects keep their stored hex; the app shows it as that palette slot (see paletteIndex).
 */
const LEGACY_COLORS: Record<string, number> = {
  '#a1a1aa': 0, '#64748b': 0, '#ef4444': 1, '#f43f5e': 1, '#f97316': 2, '#f59e0b': 3, '#eab308': 3, '#a16207': 3,
  '#84cc16': 4, '#22c55e': 5, '#10b981': 5, '#14b8a6': 6, '#06b6d4': 7, '#0ea5e9': 8, '#3b82f6': 8,
  '#6366f1': 9, '#8b5cf6': 10, '#a855f7': 10, '#d946ef': 11, '#ec4899': 11,
};
/** The palette slot (0–11) a stored colour is shown as, or -1 for a custom hex. */
export function paletteIndex(hex: string): number {
  const key = hex.toLowerCase();
  const index = STATUS_COLORS.indexOf(key);
  return index >= 0 ? index : (LEGACY_COLORS[key] ?? -1);
}
export const DEFAULT_STATUS_COLOR = PALETTE[8].hex;
export const DEFAULT_TAG_COLOR = PALETTE[6].hex;
/** `inReview`: lines in this status are listed in the review inbox, however they got there. */
export const DEFAULT_STATUSES: { key: string; name: string; color: string; kind: StatusKind; inReview: boolean }[] = [
  { key: 'untranslated', name: '미번역', color: PALETTE[0].hex, kind: 'initial', inReview: false },
  { key: 'draft', name: '초벌', color: PALETTE[8].hex, kind: 'normal', inReview: false },
  { key: 'confirmed', name: '확정', color: PALETTE[5].hex, kind: 'final', inReview: false },
];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------------------------
// Default workflows and templates (3.2 of the improvement plan). Every step is a real node: the AI
// node carries its whole prompt (the preset's instructions, visible and editable) and each save is
// an apply node (반영). Nothing is hidden inside an AI node.
// ---------------------------------------------------------------------------------------------

const SETTINGS = { maxVisitsPerNode: 5, concurrency: 2, maxConsecutiveFailures: 3 } as const;
/** Vertical layout, top to bottom, like the editor's auto layout. */
const ROW = 140;
const at = (row: number, column = 0) => ({ x: column * 320, y: row * ROW });

type Model = { model: DraftModelChoice };

const entryNode = (statusIds: string[] = []): WorkflowNode => ({ id: 'entry', type: 'entry', position: at(0), config: { statusIds } });

const aiNode = (id: string, preset: AiPresetId, model: DraftModelChoice, row: number, column = 0, label: string = AI_PRESETS[preset].label): WorkflowNode => ({
  id,
  type: 'ai',
  position: at(row, column),
  label,
  config: presetConfig(preset, model),
});

/** Item fields of a list in a preset (what an apply node can map from). */
const itemFields = (preset: AiPresetId, list: string): JsonField[] => AI_PRESETS[preset].fields.find((field) => field.name === list)?.fields ?? [];

/** Target field → source field of the same name, for every field of the target the list's items have. */
function mapByName(fn: ApplyFunctionName, source: JsonField[]): Record<string, string> {
  const have = new Set(source.map((field) => field.name));
  const targets: readonly { name: string }[] = APPLY_TARGETS[fn].fields;
  return Object.fromEntries(targets.filter((target) => have.has(target.name)).map((target) => [target.name, target.name]));
}

interface ApplyOptions {
  list?: string;
  map: Record<string, string>;
  /** Default on: a proposal a person accepts in the app. */
  propose?: boolean;
  asCandidate?: boolean;
}
const applyNode = (id: string, fn: ApplyFunctionName, fromNodeId: string, row: number, options: ApplyOptions, column = 0): WorkflowNode => ({
  id,
  type: 'function',
  position: at(row, column),
  label: APPLY_TARGETS[fn].label,
  config: { fn, params: { fromNodeId, list: options.list ?? '', map: options.map, propose: options.propose ?? true, asCandidate: options.asCandidate ?? false } },
});
/** An apply node for one list of a preset's JSON output, mapped by field name. */
const saveList = (id: string, fn: ApplyFunctionName, fromNodeId: string, preset: AiPresetId, list: string, row: number): WorkflowNode =>
  applyNode(id, fn, fromNodeId, row, { list, map: mapByName(fn, itemFields(preset, list)) });

const edge = (source: string, sourceHandle: string, target: string): WorkflowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });
/** Edges along a chain of nodes, each from its `out` exit. */
const chain = (...ids: string[]) => ids.slice(1).map((id, index) => edge(ids[index]!, 'out', id));

const statusNode = (id: string, label: string, statusId: string, row: number, column = 0): WorkflowNode => ({
  id,
  type: 'function',
  position: at(row, column),
  label,
  config: { fn: 'setStatus', params: { statusId, addTagIds: [], removeTagIds: [] } },
});
const formatCheckNode = (row: number, column = 0): WorkflowNode => ({
  id: 'check',
  type: 'function',
  position: at(row, column),
  label: '형식 검사',
  config: { fn: 'formatCheck', params: { placeholders: true, tags: true, newlines: true, emptyText: true } },
});
/** Writes the translation now (no proposal, confirmed as a draft): what the default flows always did. */
const writeTranslation = (id: string, fromNodeId: string, row: number, column = 0, label = '번역 후보 기록') => ({ ...applyNode(id, 'saveCandidate', fromNodeId, row, { map: { text: 'text' }, propose: false, asCandidate: false }, column), label });

/**
 * The default translation flow, expressed as an ordinary user workflow:
 * untranslated → AI 번역 → 번역 후보 기록 → 초벌로 → 형식 검사 → AI 검수 → 확정으로;
 * a failing line is revised (each revision written as the translation again) while review has run fewer
 * than 3 times, then is set to "needs review", a status shown in the review inbox. People take it from
 * there; the run itself ends. Translations are written, not proposed, because a translation flow
 * proposing every line would leave nothing to review.
 */
export function translationTemplate(ids: {
  /** The AI the template's nodes use; empty until the user has a connection with a default model. */
  model: DraftModelChoice;
  untranslated: string;
  draft: string;
  needsReview: string;
  confirmed: string;
}): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode([ids.untranslated]),
      aiNode('translate', 'translate', ids.model, 1),
      writeTranslation('save', 'translate', 2),
      statusNode('draft', '초벌로', ids.draft, 3),
      formatCheckNode(4),
      aiNode('review', 'review', ids.model, 5),
      statusNode('confirm', '확정으로', ids.confirmed, 6),
      {
        id: 'retry',
        type: 'condition',
        position: at(5, 1),
        label: '검수 3회 미만?',
        config: { expression: { '<': [{ var: 'visits.review' }, 3] }, description: "'AI 검수' 방문이 3회 미만이면 다시 수정합니다." },
      },
      aiNode('revise', 'revise', ids.model, 4, 2),
      writeTranslation('save-revision', 'revise', 5, 2, '수정 번역 기록'),
      statusNode('escalate', '사람 확인 필요로', ids.needsReview, 6, 1),
    ],
    edges: [
      ...chain('entry', 'translate', 'save', 'draft', 'check'),
      edge('check', 'pass', 'review'),
      edge('check', 'fail', 'retry'),
      edge('review', 'pass', 'confirm'),
      edge('review', 'fail', 'retry'),
      edge('retry', 'true', 'revise'),
      edge('retry', 'false', 'escalate'),
      edge('revise', 'out', 'save-revision'),
      edge('save-revision', 'out', 'check'),
    ],
  };
}

/** 초벌 번역: untranslated → AI 번역 → 번역 후보 기록 → 형식 검사 → 초벌로. */
export function draftTranslationTemplate(ids: { model: DraftModelChoice; untranslated: string; draft: string }): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode([ids.untranslated]), aiNode('translate', 'translate', ids.model, 1), writeTranslation('save', 'translate', 2), formatCheckNode(3), statusNode('draft', '초벌로', ids.draft, 4)],
    edges: [...chain('entry', 'translate', 'save', 'check'), edge('check', 'pass', 'draft')],
  };
}

/**
 * 용어 추출: scene groups of translated lines are read for names and recurring terms that the glossary
 * lacks, each paired with the Korean form the translations use, and saved to the glossary (as a
 * proposal). Statuses and translations are not touched; terms reach AI context only after a person accepts them.
 */
export function termExtractionTemplate(ids: Model): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode(), aiNode('terms', 'terms', ids.model, 1), saveList('save-terms', 'saveTerms', 'terms', 'terms', 'terms', 2)],
    edges: chain('entry', 'terms', 'save-terms'),
  };
}

/** 인물·관계 추출: scene groups are read against what is known; new people, relationships and speech rules are saved. */
export function peopleRelationsTemplate(ids: Model): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode(),
      aiNode('people', 'knowledge', ids.model, 1),
      saveList('save-characters', 'saveCharacters', 'people', 'knowledge', 'characters', 2),
      saveList('save-relationships', 'saveRelationships', 'people', 'knowledge', 'relationships', 3),
      saveList('save-speech-rules', 'saveSpeechRules', 'people', 'knowledge', 'speechRules', 4),
    ],
    edges: chain('entry', 'people', 'save-characters', 'save-relationships', 'save-speech-rules'),
  };
}

/** 사건 추출: scene groups are read for events (cause, outcome, people) and they are saved. */
export function eventExtractionTemplate(ids: Model): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode(), aiNode('events', 'events', ids.model, 1), saveList('save-events', 'saveEvents', 'events', 'events', 'events', 2)],
    edges: chain('entry', 'events', 'save-events'),
  };
}

/** Lines whose listener the AI guesses at or above this confidence get it written (proposed). */
export const LISTENER_CONFIDENCE = 0.7;

/**
 * 청자 추정: the work analysis (or the import) already gave most lines a listener, so lines whose listener
 * is known (import, person, confident AI guess) and lines that are not dialogue stop at the first
 * condition. The rest are read scene by scene with the whole cast; an answer with a confidence of
 * {@link LISTENER_CONFIDENCE} or more is set as the line's listener (a proposal). Translations and statuses are untouched.
 */
export function listenerTemplate(ids: Model): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode(),
      {
        id: 'needs',
        type: 'condition',
        position: at(1),
        label: '청자 미상?',
        config: { expression: { in: ['unknownListener', { var: 'unit.marks' }] }, description: '청자 미상 자동 태그가 붙은 줄만 추정합니다.' },
      },
      aiNode('listener', 'listener', ids.model, 2),
      {
        id: 'sure',
        type: 'condition',
        position: at(3),
        label: `확신도 ${LISTENER_CONFIDENCE} 이상?`,
        config: {
          expression: { '>=': [{ var: 'outputs.listener.confidence' }, LISTENER_CONFIDENCE] },
          description: `확신도가 ${LISTENER_CONFIDENCE} 이상일 때만 적습니다.`,
        },
      },
      applyNode('set-listener', 'setListener', 'listener', 4, { map: { listener: 'value', confidence: 'confidence' } }),
    ],
    edges: [edge('entry', 'out', 'needs'), edge('needs', 'true', 'listener'), edge('listener', 'out', 'sure'), edge('sure', 'true', 'set-listener')],
  };
}

/**
 * After a speech rule or a listener is corrected: re-fit only the speech level and forms of address
 * of the current translations, so the rest of the wording does not drift as a full re-translation would.
 * The fitted text is written as the translation (not proposed); the status stays as it was.
 */
export function speechFixTemplate(ids: Model): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode(), aiNode('fit', 'speechFix', ids.model, 1), writeTranslation('save', 'fit', 2, 0, '말투 맞춘 번역 기록')],
    edges: chain('entry', 'fit', 'save'),
  };
}

/** The workflow that a speech rule's "re-run affected lines" picks first. */
export const SPEECH_FIX_WORKFLOW = '말투만 고치기';

/** The workflow behind the 작품 분석 button of 자료. */
export const ANALYSIS_WORKFLOW = '작품 분석';
export const ANALYSIS_WORKFLOW_DESCRIPTION = '대본 전체를 읽고 개요·인물·관계·사건·말투 규칙·장면별 청자 초안과 용어 후보를 근거와 함께 만듭니다. 번역과 상태는 바꾸지 않습니다.';

/**
 * 작품 분석: a long-context model reads the whole script in one request (split at scene boundaries only
 * beyond the model's window; reading everything at once was found as accurate as reading in parts and five
 * times cheaper) and every list it returns is saved by its own apply node. Remove a field from the AI node
 * and its save node to analyse less. The saves run one after another, not side by side: characters come
 * before the relationships, speech rules and scene listeners that name them, and the order is the same on
 * every run.
 */
export function analysisTemplate(ids: Model): WorkflowDefinition {
  const analysis = 'analysis';
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode(),
      aiNode(analysis, 'analysis', ids.model, 1, 0, '작품 분석'),
      applyNode('save-overview', 'saveDocument', analysis, 2, { map: { title: 'overviewTitle', body: 'overview' } }),
      saveList('save-characters', 'saveCharacters', analysis, 'analysis', 'characters', 3),
      saveList('save-relationships', 'saveRelationships', analysis, 'analysis', 'relationships', 4),
      saveList('save-speech-rules', 'saveSpeechRules', analysis, 'analysis', 'speechRules', 5),
      saveList('save-events', 'saveEvents', analysis, 'analysis', 'events', 6),
      saveList('save-terms', 'saveTerms', analysis, 'analysis', 'terms', 7),
      saveList('save-scene-listeners', 'saveSceneListeners', analysis, 'analysis', 'sceneListeners', 8),
    ],
    edges: chain('entry', analysis, 'save-overview', 'save-characters', 'save-relationships', 'save-speech-rules', 'save-events', 'save-terms', 'save-scene-listeners'),
  };
}

/** Single-purpose templates that only need a model (the `from` of creating a workflow). */
export const MODEL_TEMPLATES = {
  terms: termExtractionTemplate,
  listener: listenerTemplate,
  people: peopleRelationsTemplate,
  events: eventExtractionTemplate,
  speechFix: speechFixTemplate,
  analysis: analysisTemplate,
} as const;

/**
 * The workflows every project starts with (new and imported projects). A workflow a person deletes
 * stays deleted; only projects that never had them get them.
 */
export function defaultWorkflows(ids: { model: DraftModelChoice; untranslated?: string; draft?: string }): { name: string; description: string; definition: WorkflowDefinition }[] {
  return [
    ...(ids.untranslated && ids.draft
      ? [{ name: '초벌 번역', description: '미번역 대사를 AI로 번역하고 형식을 검사해 초벌 상태로 바꿉니다.', definition: draftTranslationTemplate({ model: ids.model, untranslated: ids.untranslated, draft: ids.draft }) }]
      : []),
    { name: '청자 추정', description: '청자가 아직 없는 대사만 장면별로 누구에게 하는 말인지 추정해 적습니다. 번역·상태는 바꾸지 않습니다.', definition: listenerTemplate({ model: ids.model }) },
    { name: '용어 추출', description: '번역된 대사에서 고유명사·반복 용어와 번역에 쓰인 표기를 짝지어 용어집에 넣습니다.', definition: termExtractionTemplate({ model: ids.model }) },
    { name: '인물·관계 추출', description: '등장인물, 인물 사이의 관계와 변화, 화자·청자 말투 규칙을 장면별로 뽑아 자료에 넣습니다.', definition: peopleRelationsTemplate({ model: ids.model }) },
    { name: '사건 추출', description: '사건의 원인·결과와 관련 인물을 장면별로 뽑아 자료에 넣습니다.', definition: eventExtractionTemplate({ model: ids.model }) },
    { name: ANALYSIS_WORKFLOW, description: ANALYSIS_WORKFLOW_DESCRIPTION, definition: analysisTemplate({ model: ids.model }) },
  ];
}
