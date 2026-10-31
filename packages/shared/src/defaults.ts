import { APPLY_TARGETS, type ApplyFunctionName, type JsonField, type TagAction } from './functions.ts';
import { ISSUE_KIND_IDS, REVIEW_KIND_IDS, type IssueKind } from './issues.ts';
import { AI_PROMPTS, presetConfig, type AiPromptId } from './presets.ts';
import type { DraftModelChoice } from './model-choice.ts';
import { entryConfigSchema, retryConfigSchema, type EntryConfig, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from './workflow.ts';

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
  { key: 'translated', name: '번역됨', color: PALETTE[8].hex, kind: 'normal', inReview: false },
  { key: 'needsReview', name: '검토 필요', color: PALETTE[2].hex, kind: 'normal', inReview: true },
  { key: 'confirmed', name: '완료', color: PALETTE[5].hex, kind: 'final', inReview: false },
];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------------------------
// Default workflows and templates (3.2 of the improvement plan). Every step is a real node: the AI
// node carries its whole prompt (the preset's instructions, visible and editable) and each save is
// an apply node (반영). Nothing is hidden inside an AI node.
// ---------------------------------------------------------------------------------------------

/** 8 visits: an AI node's first call plus the 5 resends its two 재요청 nodes allow (2 + 3), with room for a review loop. */
const SETTINGS = { maxVisitsPerNode: 8, maxConsecutiveFailures: 3 } as const;
/** Vertical layout, top to bottom, like the editor's auto layout. */
const ROW = 140;
const at = (row: number, column = 0) => ({ x: column * 320, y: row * ROW });

const entryNode = (input: EntryConfig['input'] = 'lines'): WorkflowNode => ({ id: 'entry', type: 'entry', position: at(0), config: entryConfigSchema.parse({ input }) });

const aiNode = (id: string, preset: AiPromptId, model: DraftModelChoice, row: number, column = 0, label: string = AI_PROMPTS[preset].label): WorkflowNode => ({
  id,
  type: 'ai',
  position: at(row, column),
  label,
  config: presetConfig(preset, model),
});

/** Item fields of a list in a preset (what an apply node can map from). */
const itemFields = (preset: AiPromptId, list: string): JsonField[] => AI_PROMPTS[preset].fields.find((field) => field.name === list)?.fields ?? [];

/** Target field → source field of the same name, for every field of the target the list's items have. */
function mapByName(fn: ApplyFunctionName, source: JsonField[]): Record<string, string> {
  const have = new Set(source.map((field) => field.name));
  const targets: readonly { name: string }[] = APPLY_TARGETS[fn].fields;
  return Object.fromEntries(targets.filter((target) => have.has(target.name)).map((target) => [target.name, target.name]));
}

interface ApplyOptions {
  list?: string;
  map: Record<string, string>;
  /** Settings of the node besides its field links. */
  params?: Record<string, unknown>;
}
/** An apply node: it applies the result of the step before it (the AI or script node it is drawn after). */
const applyNode = (id: string, fn: ApplyFunctionName, row: number, options: ApplyOptions, column = 0): WorkflowNode => ({
  id,
  type: 'function',
  position: at(row, column),
  label: APPLY_TARGETS[fn].label,
  config: { fn, params: { list: options.list ?? '', map: options.map, ...options.params }, concurrency: 2 },
});
/** An apply node for one list of a preset's JSON output, mapped by field name. */
const saveList = (id: string, fn: ApplyFunctionName, preset: AiPromptId, list: string, row: number, column = 0, params?: Record<string, unknown>): WorkflowNode =>
  applyNode(id, fn, row, { list, map: mapByName(fn, itemFields(preset, list)), params }, column);

/**
 * A 태그 붙이기 / 떼기 node. `tagIds` are the project's tags it puts on or takes off; `from` names the field of the
 * previous step's result whose values (a review's `categories`) become tags through `categories` (kind → tag id).
 */
const tagNode = (id: string, label: string, action: TagAction, options: { from?: string; tagIds?: string[]; categories?: Record<string, string> }, row: number, column = 0): WorkflowNode => ({
  id,
  type: 'function',
  position: at(row, column),
  label,
  config: { fn: 'tagLines', params: { list: '', map: options.from ? { tag: options.from } : {}, action, tagIds: options.tagIds ?? [], categoryTags: options.categories ?? {} }, concurrency: 2 },
});

/** The project's tags for these kinds (the ones a new project gets for them), those it has. */
const issueTagIds = (ids: TemplateIds, kinds: readonly IssueKind[]) => kinds.flatMap((kind) => (ids.issueTags?.[kind] ? [ids.issueTags[kind]!] : []));

const edge = (source: string, sourceHandle: string, target: string): WorkflowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });

/**
 * The two 재요청 nodes every AI node of a template has, chained on its 오류 exit:
 *  - `-resend`: what failed because of the request (cut off, too long, left out, malformed, timed out) goes back to the AI node
 *    in half-size requests, at most twice;
 *  - `-wait`: what failed because of the provider (usage limit, dropped connection) goes back unchanged after 60 seconds, at most 3 times.
 * A failure of another kind, or one that used up its times at the first, goes on to the second; the second's 오류 exit
 * is the workflow's failure path (a failure marker, see failTag and the 번역 template).
 */
const resendNodes = (aiId: string, row: number, column = 1): WorkflowNode[] => [
  {
    id: `${aiId}-resend`,
    type: 'retry',
    position: at(row, column),
    config: retryConfigSchema.parse({ kinds: ['cut-off', 'too-long', 'missing', 'invalid-output', 'timeout'], scale: 0.5, maxTimes: 2 }),
  },
  {
    id: `${aiId}-wait`,
    type: 'retry',
    position: at(row, column + 1),
    config: retryConfigSchema.parse({ kinds: ['rate-limit', 'network'], scale: 1, wait: 60, maxTimes: 3 }),
  },
];
/** AI node → 재요청 → 재요청 (each 다시 보냄 back to the AI node); the last 재요청's 오류 exit goes to `failedId` (none: unconnected, the line ends failed). */
const resendEdges = (aiId: string, failedId?: string) => [
  edge(aiId, 'error', `${aiId}-resend`),
  edge(`${aiId}-resend`, 'retry', aiId),
  edge(`${aiId}-resend`, 'error', `${aiId}-wait`),
  edge(`${aiId}-wait`, 'retry', aiId),
  ...(failedId ? [edge(`${aiId}-wait`, 'error', failedId)] : []),
];

/** Edges along a chain of nodes, each from its `out` exit. */
const chain = (...ids: string[]) => ids.slice(1).map((id, index) => edge(ids[index]!, 'out', id));

/** The failure marker of an extraction AI node's 재요청: puts the `AI 실패` tag on the line. */
const failTag = (aiId: string, ids: TemplateIds, row: number, column = 3): WorkflowNode =>
  tagNode(`${aiId}-failed`, 'AI 실패 태그', 'add', { tagIds: issueTagIds(ids, ['aiFailed']) }, row, column);

const statusNode = (id: string, label: string, statusId: string, row: number, column = 0): WorkflowNode => ({
  id,
  type: 'function',
  position: at(row, column),
  label,
  config: { fn: 'setStatus', params: { statusId, addTagIds: [], removeTagIds: [] }, concurrency: 2 },
});
/** 용어 검사: a confirmed glossary term in the source whose Korean form the translation lacks fails the line (no model call). */
const glossaryCheckNode = (row: number, column = 0): WorkflowNode => ({
  id: 'glossary',
  type: 'function',
  position: at(row, column),
  label: '용어 검사',
  config: { fn: 'glossaryCheck', params: {}, concurrency: 2 },
});
const formatCheckNode = (row: number, column = 0): WorkflowNode => ({
  id: 'check',
  type: 'function',
  position: at(row, column),
  label: '형식 검사',
  config: { fn: 'formatCheck', params: { placeholders: true, tags: true, newlines: true, emptyText: true }, concurrency: 2 },
});
/** Writes the translation into the line (a person's saved translation is kept). */
const writeTranslation = (id: string, row: number, column = 0, label = '번역 저장') => ({ ...applyNode(id, 'saveCandidate', row, { map: { text: 'text' } }, column), label });

/**
 * 말투 판정 and its conditions: a line with no speaker → listener rule skips it (nothing to compare with);
 * unsure → AI 검수; the rule's level → AI 검수; else 말투 tag → AI 수정.
 */
const speechNodes = (ids: TemplateIds): WorkflowNode[] => [
  {
    id: 'has-rule',
    type: 'condition',
    position: at(4.875, 0),
    label: '말투 규칙이 있나?',
    config: { expression: { '!!': [{ var: 'unit.speechLevel' }] }, description: '이 대사의 화자 → 청자 말투 규칙이 있으면 말투를 판정하고, 없으면 견줄 것이 없으니 AI 검수로 바로 갑니다.' },
  },
  aiNode('speech', 'speechLevel', ids.model, 5),
  ...resendNodes('speech', 5),
  {
    id: 'speech-sure',
    type: 'condition',
    position: at(6, 0),
    label: '판정 확신 0.7 이상?',
    config: { expression: { '>=': [{ var: 'outputs.speech.confidence' }, 0.7] }, description: '말투 판정의 확신도가 0.7 이상이면 규칙과 견주고, 아니면 AI 검수에 맡깁니다.' },
  },
  {
    id: 'speech-ok',
    type: 'condition',
    position: at(6, 1),
    label: '말투가 규칙대로?',
    config: { expression: { '==': [{ var: 'outputs.speech.value' }, { var: 'unit.speechLevel' }] }, description: '판정한 말투가 이 대사의 화자 → 청자 말투 규칙과 같으면 통과합니다.' },
  },
  tagNode('tag-speech', '말투 태그 붙이기', 'add', { tagIds: issueTagIds(ids, ['speech']) }, 6, 2),
];
const speechEdges = [
  edge('has-rule', 'true', 'speech'),
  edge('has-rule', 'false', 'review'),
  edge('speech', 'out', 'speech-sure'),
  edge('speech-sure', 'true', 'speech-ok'),
  edge('speech-sure', 'false', 'review'),
  edge('speech-ok', 'true', 'review'),
  edge('speech-ok', 'false', 'tag-speech'),
  edge('tag-speech', 'out', 'retry'),
  // A judgment that keeps failing is not a reason to stop: AI 검수 still reads the line.
  ...resendEdges('speech', 'review'),
];

/**
 * 번역: a larger flow with a review loop: untranslated → AI 번역 → 번역 저장 → 형식 검사 → 용어 검사 → AI 검수 →
 * 완료로 → AI 용어 추출 → 용어 저장;
 * checks only judge, so each exit has the 태그 붙이기 node that records it: a failing check or review
 * puts its kind on the line (형식, or the review's categories), a passing one takes off only the kinds
 * it covers (the format check 형식, the review every 문제 유형);
 * a failing line is revised by AI 수정 (it reads the translation and what a check or the review found; each
 * revision is written as the translation again and checked again) while AI 수정 has run fewer than 3
 * times, then is set to "검토 필요", a status shown in the review inbox. A revision that leaves the
 * translation as it was goes to "검토 필요" at once: checking it again would find the same thing. People take it from there; the
 * run itself ends. Translations are written, not proposed, because a translation flow proposing every
 * line would leave nothing to review.
 * Every AI node fails the same way: error → a 재요청 node (sent again in half-size requests, at most
 * twice) → a second 재요청 node (usage limit or dropped connection: sent again unchanged after 60 seconds,
 * at most 3 times) → back to the AI node; when both give up, 번역·검수·수정 set the line to "검토 필요" and
 * 용어 추출 puts the `AI 실패` tag on it (the translation is already done by then).
 * Layout: the main path runs down column 0; the two 재요청 sit right of their AI node and its failure marker
 * right of those; the revise loop has its own column further right.
 */
export function translationTemplate(ids: TemplateIds): WorkflowDefinition {
  return reviewLoop(ids, false);
}

/**
 * The 번역 flow, with or without 말투 판정 between 형식 검사 and AI 검수. 번역 goes without it (one more call
 * per batch for every translation); 검수 has it, so a judging connection can check speech levels of lines
 * that are already translated.
 */
function reviewLoop(ids: TemplateIds, judgeSpeech: boolean): WorkflowDefinition {
  const failed = (aiId: string, row: number, column: number, label = '검토 필요로') => statusNode(`${aiId}-failed`, label, ids.needsReview ?? '', row, column);
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode(),
      aiNode('translate', 'translate', ids.model, 1),
      ...resendNodes('translate', 1),
      failed('translate', 1, 3),
      writeTranslation('save', 2),
      formatCheckNode(3),
      tagNode('untag-format', '형식 태그 떼기', 'remove', { tagIds: issueTagIds(ids, ['format']) }, 4),
      tagNode('tag-format', '형식 태그 붙이기', 'add', { tagIds: issueTagIds(ids, ['format']) }, 4, 1),
      // Glossary use is checked by code, not left to AI 검수 alone.
      glossaryCheckNode(4.5),
      tagNode('untag-term', '용어 태그 떼기', 'remove', { tagIds: issueTagIds(ids, ['term']) }, 4.75),
      tagNode('tag-term', '용어 태그 붙이기', 'add', { tagIds: issueTagIds(ids, ['term']) }, 4.75, 1),
      // 말투 판정: which speech level the translation uses, compared with the line's rule. A judging
      // connection (System One) answers this quickly; an unsure answer leaves it to AI 검수.
      ...(judgeSpeech ? speechNodes(ids) : []),
      aiNode('review', 'review', ids.model, 7),
      ...resendNodes('review', 7),
      failed('review', 7, 3),
      tagNode('untag-review', '문제 태그 모두 떼기', 'remove', { tagIds: issueTagIds(ids, ISSUE_KIND_IDS) }, 8),
      tagNode('tag-review', '검수 지적 태그 붙이기', 'add', { from: 'categories', categories: Object.fromEntries(REVIEW_KIND_IDS.flatMap((kind) => (ids.issueTags?.[kind] ? [[kind, ids.issueTags[kind]!]] : []))) }, 8, 1),
      statusNode('confirm', '완료로', ids.confirmed ?? '', 9),
      // The revise loop, in its own column.
      {
        id: 'retry',
        type: 'condition',
        position: at(8, 3),
        label: 'AI 수정 3회 미만?',
        config: { expression: { '<': [{ var: 'visits.revise' }, 3] }, description: "'AI 수정'을 3회 미만 지났으면 다시 수정합니다. 형식 검사, 용어 검사, 말투 판정, AI 검수 어느 쪽 실패든 한 번으로 셉니다." },
      },
      statusNode('escalate', '검토 필요로', ids.needsReview ?? '', 8, 4),
      aiNode('revise', 'revise', ids.model, 9, 3, 'AI 수정'),
      ...resendNodes('revise', 9, 4),
      failed('revise', 9, 6),
      writeTranslation('save-revision', 10, 3, '수정 번역 저장'),
      {
        id: 'revised',
        type: 'condition',
        position: at(11, 3),
        label: '수정으로 바뀌었나?',
        config: { expression: { '!': [{ var: 'outputs.save-revision.unchanged' }] }, description: "'AI 수정'이 번역을 그대로 두었으면(공백·줄바꿈만 다르면) 다시 검사해도 같은 지적이 나오니 검토 필요로 보냅니다." },
      },
      // Its own end, so each condition's dead end folds into a chip of its own.
      statusNode('unrevised', '검토 필요로', ids.needsReview ?? '', 11, 4),
      // The findings were about the text AI 수정 replaced: off before the checks look at the new one.
      tagNode('untag-revised', '지적 태그 모두 떼기', 'remove', { tagIds: issueTagIds(ids, ISSUE_KIND_IDS) }, 12, 3),
      aiNode('terms', 'terms', ids.model, 10),
      ...resendNodes('terms', 10),
      failTag('terms', ids, 10, 4),
      saveList('save-terms', 'saveTerms', 'terms', 'terms', 11),
    ],
    edges: [
      ...chain('entry', 'translate', 'save', 'check'),
      edge('check', 'pass', 'untag-format'),
      edge('untag-format', 'out', 'glossary'),
      edge('glossary', 'pass', 'untag-term'),
      edge('untag-term', 'out', judgeSpeech ? 'has-rule' : 'review'),
      edge('glossary', 'fail', 'tag-term'),
      edge('tag-term', 'out', 'retry'),
      edge('check', 'fail', 'tag-format'),
      edge('tag-format', 'out', 'retry'),
      ...(judgeSpeech ? speechEdges : []),
      edge('review', 'pass', 'untag-review'),
      edge('untag-review', 'out', 'confirm'),
      ...chain('confirm', 'terms', 'save-terms'),
      edge('review', 'fail', 'tag-review'),
      edge('tag-review', 'out', 'retry'),
      edge('retry', 'true', 'revise'),
      edge('retry', 'false', 'escalate'),
      edge('revise', 'out', 'save-revision'),
      edge('save-revision', 'out', 'revised'),
      edge('revised', 'true', 'untag-revised'),
      edge('untag-revised', 'out', 'check'),
      edge('revised', 'false', 'unrevised'),
      ...resendEdges('translate', 'translate-failed'),
      ...resendEdges('review', 'review-failed'),
      ...resendEdges('revise', 'revise-failed'),
      ...resendEdges('terms', 'terms-failed'),
    ],
  };
}

/**
 * 검수: the 번역 flow without its translation step and with 말투 판정, for lines that already have one (run
 * it with a status scope such as 번역됨): 형식 검사 → 말투 판정 → AI 검수, and the same revise loop and 검토 필요 end.
 */
export function reviewTemplate(ids: TemplateIds): WorkflowDefinition {
  const translation = reviewLoop(ids, true);
  const dropped = new Set(['translate', 'translate-resend', 'translate-wait', 'translate-failed', 'save']);
  return {
    ...translation,
    nodes: translation.nodes.filter((node) => !dropped.has(node.id)),
    edges: [edge('entry', 'out', 'check'), ...translation.edges.filter((item) => !dropped.has(item.source) && !dropped.has(item.target) && item.source !== 'entry')],
  };
}

/**
 * 용어 추출: scene groups of translated lines are read for names and recurring terms that the glossary
 * lacks, each paired with the Korean form the translations use, and saved to the glossary (confirmed
 * or as candidates, as the project's AI 문맥 switch says). Statuses and translations are not touched.
 */
export function termExtractionTemplate(ids: TemplateIds): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode(), aiNode('terms', 'terms', ids.model, 1), ...resendNodes('terms', 1), failTag('terms', ids, 1), saveList('save-terms', 'saveTerms', 'terms', 'terms', 2)],
    edges: [...chain('entry', 'terms', 'save-terms'), ...resendEdges('terms', 'terms-failed')],
  };
}

/**
 * 용어 번역: each term in the run's scope gets its Korean form and note (only while still empty),
 * 100 to a request with two example lines each. A candidate lands confirmed or as a candidate as the
 * project's AI 문맥 switch says. The 재요청 node's 오류 exit stays unconnected: the AI 실패 tag is a line
 * tag and cannot be put on a term, so a term that still fails ends failed with its reason.
 */
export function termTranslationTemplate(ids: TemplateIds): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode('terms'),
      aiNode('translate', 'termTranslate', ids.model, 1),
      ...resendNodes('translate', 1),
      applyNode('save-term', 'saveCandidate', 2, { map: { text: 'target', note: 'note' } }),
    ],
    edges: [...chain('entry', 'translate', 'save-term'), ...resendEdges('translate')],
  };
}

/**
 * The fields of what each part passes on to AI 인물·관계 합치기: the people without their evidence lines, relationships and speech rules with
 * theirs (the line ids of a change, of a rule's start and of the evidence are what the merge keeps and the saves store).
 */
const MERGED_PATHS = [
  ...['name', 'aliases', 'newFacts.text', 'newFacts.evidence', 'newSpeech.text', 'newSpeech.evidence', 'player', 'gender', 'ageBand', 'role'].map((field) => `characters.${field}`),
  ...['between', 'kind', 'reason'].map((field) => `pairsWithoutRelationship.${field}`),
  ...['name', 'reason'].map((field) => `notPeople.${field}`),
  ...['between', 'views.from', 'views.to', 'views.kind', 'views.description', 'views.evidence', 'views.changes.at', 'views.changes.kind', 'views.changes.cause'].map((field) => `relationships.${field}`),
  ...['fromName', 'toName', 'level', 'address', 'note', 'startKey', 'evidence'].map((field) => `speechRules.${field}`),
];

/**
 * 인물·관계 추출: scene groups are read against what is known (new people, what the scenes show about people already
 * stored, relationships and speech rules). Nothing is saved while the scenes are read: 모으기 waits for every request
 * and collects the people, relationships and speech rules of every part, AI 인물·관계 합치기 makes one entry per person,
 * one relationship per pair of people (a view per direction, its changes in script order) and one speech rule per speaker → listener stretch, and
 * then each list is saved once: 인물 저장 (new facts are appended to the end of the stored profile and speech description, nothing stored is rewritten),
 * then 관계 저장 (new changes are appended) and 말투 규칙 저장 (new stretches and pairs only), which find the people they name.
 * The 합치기 AI has a 재요청 node but no failure marker: after the 모으기 one item stands for the whole run, so an `AI 실패`
 * tag would land on an arbitrary line; its 오류 ends that item failed with the reason (nothing of the run is saved then).
 * The save nodes read the 합치기 AI's lists: a save node passes the result of the step before it on.
 */
export function peopleRelationsTemplate(ids: TemplateIds): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode(),
      aiNode('people', 'knowledge', ids.model, 1),
      ...resendNodes('people', 1),
      failTag('people', ids, 1),
      { id: 'gather', type: 'gather', position: at(2), label: '인물·관계 조각 모으기', config: { fields: MERGED_PATHS } },
      {
        id: 'merge',
        type: 'ai',
        position: at(3),
        label: AI_PROMPTS.peopleMerge.label,
        config: presetConfig('peopleMerge', ids.model, { input: { lines: false, previous: true, fields: [] } }),
      },
      ...resendNodes('merge', 3),
      saveList('save-characters', 'saveCharacters', 'peopleMerge', 'characters', 4, 0, { notPeople: 'notPeople' }),
      saveList('save-relationships', 'saveRelationships', 'peopleMerge', 'relationships', 5, 0, { unresolved: 'unresolvedPairs' }),
      saveList('save-speech-rules', 'saveSpeechRules', 'peopleMerge', 'speechRules', 6),
    ],
    edges: [...chain('entry', 'people', 'gather', 'merge', 'save-characters', 'save-relationships', 'save-speech-rules'), ...resendEdges('people', 'people-failed'), ...resendEdges('merge')],
  };
}

/** 사건 추출: scene groups are read for events (cause, outcome, people) and they are saved. */
export function eventExtractionTemplate(ids: TemplateIds): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode(), aiNode('events', 'events', ids.model, 1), ...resendNodes('events', 1), failTag('events', ids, 1), saveList('save-events', 'saveEvents', 'events', 'events', 2)],
    edges: [...chain('entry', 'events', 'save-events'), ...resendEdges('events', 'events-failed')],
  };
}

/**
 * 청자 추정: the lines in the run's scope (pick #청자 미상 in the run dialog) are read scene by scene with
 * the whole cast and each answer is set as the line's listener with its confidence; an unsure guess stays
 * marked 청자 미상. A listener a person set or imported is never changed. Translations and statuses are untouched.
 */
export function listenerTemplate(ids: TemplateIds): WorkflowDefinition {
  return {
    settings: { ...SETTINGS },
    nodes: [entryNode(), aiNode('listener', 'listener', ids.model, 1), ...resendNodes('listener', 1), failTag('listener', ids, 1), applyNode('set-listener', 'setListener', 2, { map: { listener: 'value', confidence: 'confidence' } })],
    edges: [...chain('entry', 'listener', 'set-listener'), ...resendEdges('listener', 'listener-failed')],
  };
}

/** A whole-script analysis (not offered as a template; whole-script reading is tested with it). */
export const ANALYSIS_WORKFLOW = '작품 분석';

/**
 * 작품 분석: a long-context model reads the whole script in one request (split at scene boundaries only
 * beyond the model's window; reading everything at once was found as accurate as reading in parts and five
 * times cheaper) and every list it returns is saved by its own apply node. Remove a field from the AI node
 * and its save node to analyse less. The saves run one after another, characters first so the
 * relationships, and speech rules after them find the people they name. A script read in
 * parts saves each part's lists as it comes (people of the same name merge; the overview is updated).
 */
export function analysisTemplate(ids: TemplateIds): WorkflowDefinition {
  const analysis = 'analysis';
  return {
    settings: { ...SETTINGS },
    nodes: [
      entryNode(),
      aiNode(analysis, 'analysis', ids.model, 1, 0, '작품 분석'),
      ...resendNodes(analysis, 1),
      failTag(analysis, ids, 1),
      saveList('save-characters', 'saveCharacters', 'analysis', 'characters', 2),
      saveList('save-relationships', 'saveRelationships', 'analysis', 'relationships', 3),
      saveList('save-speech-rules', 'saveSpeechRules', 'analysis', 'speechRules', 4),
      saveList('save-events', 'saveEvents', 'analysis', 'events', 5),
      saveList('save-terms', 'saveTerms', 'analysis', 'terms', 6),
      applyNode('save-overview', 'saveDocument', 7, { map: { title: 'overviewTitle', body: 'overview' } }),
    ],
    edges: [...chain('entry', analysis, 'save-characters', 'save-relationships', 'save-speech-rules', 'save-events', 'save-terms', 'save-overview'), ...resendEdges(analysis, `${analysis}-failed`)],
  };
}


/** What a template needs to fill its nodes: the AI, and the statuses and tag it sets. A missing id leaves that field empty (validation asks the person to pick). */
export interface TemplateIds {
  model: DraftModelChoice;
  untranslated?: string;
  translated?: string;
  needsReview?: string;
  confirmed?: string;
  /** The project's tag for each kind a check or review names (and AI 실패), found by the name a new project gives it. */
  issueTags?: Partial<Record<IssueKind, string>>;
}

/** The templates a person can start a workflow from, in the order they are offered. */
export const WORKFLOW_TEMPLATES: { key: string; name: string; description: string; input: 'lines' | 'terms'; build: (ids: TemplateIds) => WorkflowDefinition }[] = [
  {
    key: 'translation',
    name: '번역',
    description: '번역하고 검수까지 합니다. 못 넘으면 검토 필요로 보냅니다.',
    input: 'lines',
    build: translationTemplate,
  },
  { key: 'review', name: '검수', description: '번역이 있는 대사를 형식·말투·AI 검수로 다시 보고, 못 넘으면 고치거나 검토 필요로 보냅니다. 상태(예: 번역됨)로 골라 돌립니다.', input: 'lines', build: reviewTemplate },
  { key: 'listener', name: '청자 추정', description: '대사마다 누구에게 하는 말인지 적습니다.', input: 'lines', build: listenerTemplate },
  { key: 'people', name: '인물·관계 추출', description: '인물, 관계, 말투 규칙을 자료에 넣습니다.', input: 'lines', build: peopleRelationsTemplate },
  { key: 'events', name: '사건 추출', description: '사건과 관련 인물을 자료에 넣습니다.', input: 'lines', build: eventExtractionTemplate },
  { key: 'terms', name: '용어 추출', description: '번역에 쓰인 용어 표기를 용어집에 넣습니다.', input: 'lines', build: termExtractionTemplate },
  { key: 'termTranslate', name: '용어 번역', description: '용어마다 한국어 표기와 메모를 적습니다.', input: 'terms', build: termTranslationTemplate },
];

/**
 * The workflows every project starts with (new and imported projects): the first five templates. A
 * workflow a person deletes stays deleted; only projects that never had them get them.
 */
export function defaultWorkflows(ids: TemplateIds): { name: string; description: string; definition: WorkflowDefinition }[] {
  return WORKFLOW_TEMPLATES.slice(0, 5).map(({ name, description, build }) => ({ name, description, definition: build(ids) }));
}
