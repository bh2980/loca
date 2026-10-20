import { EMPTY_MODEL_CHOICE } from './model-choice.ts';
import { AGE_BANDS, CHARACTER_ROLES, GENDERS, SPEECH_LEVEL_GUIDE, SPEECH_LEVELS, TERM_KINDS } from './knowledge.ts';
import type { DraftModelChoice } from './model-choice.ts';
import type { JsonFieldType } from './functions.ts';
import { aiNodeConfigSchema, type AiNode, type AiOutput, type AiScope, type BatchConfig, type ChoiceConfig, type ContextConfig, type JsonField } from './workflow.ts';

/**
 * Ready-made AI node configurations (2.3 of the improvement plan). Choosing one only fills the node's
 * instructions, output form, fields and context options; after that it is an ordinary AI node and
 * every field stays editable. Everything the model is told beyond the output format (which the server
 * adds from the node's schema) is in `instructions` or in a field's `description`: nothing is hidden.
 */
export interface AiPreset {
  label: string;
  description: string;
  output: AiOutput;
  scope: AiScope;
  instructions: string;
  fields: JsonField[];
  choice?: Partial<ChoiceConfig>;
  include: { candidate: boolean; issues: boolean };
  context?: Partial<ContextConfig>;
  batch?: Partial<BatchConfig>;
  /** The node's call time limit when it is not the default (DEFAULT_CALL_MINUTES). */
  timeoutMinutes?: number;
}

const field = (name: string, type: JsonFieldType, description: string, fields?: JsonField[]): JsonField => ({ name, type, description, ...(fields && { fields }) });
const evidence = (what = 'the claim') => field('evidence', 'lines', `Ids of the lines that show ${what}, e.g. ["L120","L131"]. Only ids that appear in the script.`);

const EVIDENCE_RULES = [
  '- Use only what the text says. Do NOT use prior knowledge of this work.',
  '- Every item cites evidence as line ids (the ids the script shows, like "L120").',
  '- Write in Korean, except names and quoted source words.',
].join('\n');

const KNOWN_CAST =
  'When the input has a cast list ("cast"), those are the people already stored, with the names the script uses. For these people use exactly these names in every field and put other names they go by in "aliases"; only people not listed there get new names.';

// ---- the rules of each part of a script reading (once SECTION_RULES / CONTRACT, hidden in the server) ----

const RULE_CHARACTERS =
  '- characters: everyone who speaks or is addressed often. "speech" describes how they talk in the source. Mark the player character (the one the player controls or who is addressed as "you" by the game, even if it never speaks) with "player": true. Give "gender" (male, female, other = neither, e.g. an android or a spirit) and "ageBand" (child, teen, young, middle, old) only when the lines show it (pronouns, forms of address, stated age, role); otherwise "unknown". Give "role": main when the story centres on them, supporting when they recur and take part in the plot, minor when they have few lines; use "unknown" when unclear. Name everyone as the source does, in the source language; an unnamed player character gets the role the game uses (e.g. "Detective", "Captain"), never a translated name.';
const RULE_RELATIONSHIPS =
  '- relationships: one per direction that matters, people named as the script does; "changes" give the line id ("at") where the relationship changes, what changed and why.';
const RULE_EVENTS = '- events: what happened, its cause and its outcome, the people involved; include events that later lines refer back to.';
const RULE_SPEECH_RULES = `- speechRules: for every speaker → listener direction with several lines (the listener may also be "group", "public" or "self": how the speaker talks to several people present, to an unspecified audience, or to themself), the Korean speech level the translation should use, one of: ${SPEECH_LEVEL_GUIDE}. Decide from the relationship (age, rank, intimacy, hostility, era and setting) as a Korean translator would; narration-like or written addresses often take 해라체, close friends 해체. "address" is how the speaker should address the listener in Korean (e.g. "수사관님", "언니"); when several forms are used, separate them with commas (e.g. "행크 경위님, 경위님"); empty if none. If the level changes at some point (falling out, reconciliation, promotion), give one rule per stretch: "startKey" is the line id where the new stretch begins (empty for the first). Do not mark a single sarcastic or emotional line as a change. "note" says why.`;
const RULE_SCENE_LISTENERS =
  '- sceneListeners: for each scene and each speaker in it, whom that speaker mostly addresses there ("scene" is the key in [brackets]; "listener" a character name, or for an extra outside the cast (a SWAT officer, a passer-by) their name exactly as it appears as a speaker; "group" when the speaker addresses several people present at once (a meeting, a group call); "public" for an unspecified audience (a broadcast, announcement, speech, post or advert); "self" for thinking aloud, a diary or muttering; or empty when you cannot tell) and your confidence from 0 to 1. In "exceptions", list each line of that speaker in the scene that addresses someone else (an extra, a third person, the group, themself), with its line id, its listener (same names as above) and your confidence; "confidence" then says how sure you are that every OTHER line of that speaker there addresses "listener". Name listeners by name, never by a role ("the negotiator", "the suspect") when the script shows who that is. List exceptions only where the text shows it (a vocative, an order to someone else, an answer to another speaker); do not list a line just because you are unsure. In a group scene where a speaker mostly talks to everyone, "group" is right and the few lines answering one person are exceptions. Skip scenes with a single obvious speaker talking to nobody in particular.';
const RULE_TERMS = `- terms: names and words whose Korean form must stay the same across the whole translation: people, places, organizations, products and technology, coined words and in-world concepts (also lower-case ones, such as a slang word, a species or a drug), ranks and titles, and interface words that recur. Not ordinary words. Skip what the glossary already has. "source" exactly as the script writes it, "kind" one of ${TERM_KINDS.join(', ')}, "meaning" one short Korean sentence, "target" the Korean form a translator should use (names by Korean loanword convention), "evidence" a few lines where it appears. At most about 150, the most important first.`;
/** The terms rule for reading translated lines: the Korean form is taken from the translations, never made up. */
const RULE_TERMS_FROM_TRANSLATIONS = `- terms: names and words whose Korean form must stay the same across the whole translation: people, places, organizations, products and technology, coined words and in-world concepts (also lower-case ones, such as a slang word, a species or a drug), ranks and titles, and interface words that recur. Not ordinary words. Skip what the glossary already has. "source" exactly as the script writes it, "kind" one of ${TERM_KINDS.join(', ')}, "meaning" one short Korean sentence, "target" the Korean form the translations of those lines use for it; when the lines have no translation, or their translations render it in different ways, leave "target" empty and say so in "meaning". "evidence" a few lines where it appears.`;
const RULE_OVERVIEW =
  '- overview: one document about the work so far, with the headings 배경 (setting), 주요 갈등 (main conflict) and 줄거리 (plot so far), at most about 1,500 words; "overviewTitle" is its short title.';

// ---- the fields those rules fill ----

const characterFields: JsonField[] = [
  field('name', 'string', 'The name as the script writes it, in the source language.'),
  field('aliases', 'strings', 'Other names, nicknames or titles the script uses for them.'),
  field('profile', 'string', 'Who they are and what they do in the story, in Korean, 1-3 sentences.'),
  field('speech', 'string', 'How they talk in the source (register, habits), in Korean.'),
  field('player', 'boolean', 'true for the player character (the one the player controls or the game addresses as "you"), even if it never speaks.'),
  field('gender', 'string', `One of: ${GENDERS.join(', ')}. "unknown" unless the lines show it.`),
  field('ageBand', 'string', `One of: ${AGE_BANDS.join(', ')}. "unknown" unless the lines show it.`),
  field('role', 'string', `One of: ${CHARACTER_ROLES.join(', ')}. main = the story centres on them, supporting = recurs and takes part, minor = few lines.`),
  evidence('who they are'),
];
const relationshipFields: JsonField[] = [
  field('from', 'string', 'The person, named as the script does.'),
  field('to', 'string', 'The other person, named as the script does.'),
  field('kind', 'string', 'The relationship in a few words (e.g. 상관-부하, 연인, 적대).'),
  field('description', 'string', 'What the relationship is like, in Korean.'),
  field('changes', 'list', 'Points where the relationship changes, in story order; empty when it stays as it is.', [
    field('at', 'lines', 'The id of the line where the change shows.'),
    field('change', 'string', 'What changes, in Korean.'),
    field('cause', 'string', 'Why it changes.'),
  ]),
  evidence('the relationship'),
];
const speechRuleFields: JsonField[] = [
  field('fromName', 'string', 'The speaker, named as the script does.'),
  field('toName', 'string', 'The listener: a name, or "group", "public" or "self".'),
  field('level', 'string', `The Korean speech level the translation should use, one of: ${SPEECH_LEVELS.join(', ')}. ${SPEECH_LEVEL_GUIDE}.`),
  field('address', 'string', 'How the speaker addresses the listener in Korean (e.g. "수사관님"); several forms separated by commas; empty if none.'),
  field('note', 'string', 'Why this level.'),
  field('startKey', 'lines', 'The id of the line where this stretch begins when the level changes during the work; empty for the first stretch.'),
  evidence('the speaker addressing this listener'),
];
const eventFields: JsonField[] = [
  field('title', 'string', 'A short title for what happened.'),
  field('summary', 'string', 'What happened, in Korean.'),
  field('cause', 'string', 'Why it happened.'),
  field('outcome', 'string', 'What came of it.'),
  field('participants', 'strings', 'The people involved, named as the script does.'),
  evidence('the event'),
];
const termFields: JsonField[] = [
  field('source', 'string', 'The term exactly as the script writes it.'),
  field('target', 'string', 'The Korean form a translator should use (names by Korean loanword convention).'),
  field('kind', 'string', `One of: ${TERM_KINDS.join(', ')}.`),
  field('meaning', 'string', 'What it refers to, in one short Korean sentence.'),
  evidence('where it appears (a few lines)'),
];
/** Term fields for reading translated lines: the target is what the translations use. */
const translatedTermFields: JsonField[] = termFields.map((entry) =>
  entry.name === 'target' ? field('target', 'string', "The Korean form the lines' translations use for it; empty when they have none or disagree.") : entry,
);
const sceneListenerFields: JsonField[] = [
  field('scene', 'string', 'The scene key shown in [brackets] in the script header.'),
  field('speaker', 'string', 'The speaker in that scene.'),
  field('listener', 'string', 'Whom the speaker mostly addresses there: a name, "group", "public" or "self"; empty when you cannot tell.'),
  field('confidence', 'number', 'From 0 to 1; never guess with high confidence.'),
  field('exceptions', 'list', 'Lines of that speaker in the scene that address someone else.', [
    field('line', 'lines', 'The id of the line.'),
    field('listener', 'string', 'Whom that line addresses (same names as above); empty when unclear.'),
    field('confidence', 'number', 'From 0 to 1.'),
  ]),
  evidence('whom the speaker addresses'),
];

const listField = (name: string, description: string, fields: JsonField[]) => field(name, 'list', description, fields);

const READING_CONTEXT: Partial<ContextConfig> = { glossary: false, speech: false, documents: false, characters: false, relationships: false, cast: true, humanOnly: true, precedingLines: 0, previousScenes: 0 };

export const AI_PRESETS = {
  translate: {
    label: 'AI 번역',
    description: '대사마다 번역문 하나를 냅니다.',
    output: 'text',
    scope: 'line',
    include: { candidate: false, issues: false },
    fields: [],
    instructions:
      'Translate each line. Keep every placeholder ({name}, %s), rich-text tag and line break exactly. ' +
      "Match each speaker's voice, and the listener and speech rule a line gives. Use glossary targets when the term is used in that sense.",
  },
  review: {
    label: 'AI 검수',
    description: '번역 후보를 원문과 견주어 통과·실패로 판정합니다.',
    output: 'verdict',
    scope: 'line',
    include: { candidate: true, issues: false },
    fields: [],
    instructions:
      'Review each candidate translation against its source. Pass it only if meaning, nuance, tone, character voice, ' +
      'glossary use and formatting are all acceptable. ' +
      'Also read the lines of the batch together as one scene: forms of address, honorifics, speech level and term choices ' +
      'must stay consistent between lines of the same speaker and relationship. When two lines disagree, fail the line that ' +
      'breaks the established pattern (not every line) and name the line it conflicts with. ' +
      'List concrete problems in issues (in the target language); empty when passed. ' +
      'Name the kind of each problem: speech (speech level, honorifics, form of address), term (a glossary term or name rendered differently), meaning (mistranslation, omission, addition), style (unnatural or awkward Korean), format (placeholders, tags, line breaks) or other.',
  },
  revise: {
    label: 'AI 수정',
    description: '지적된 문제를 고친 번역문을 냅니다.',
    output: 'text',
    scope: 'line',
    include: { candidate: true, issues: true },
    fields: [],
    instructions:
      'Revise each candidate translation so it resolves every listed issue while keeping what was already correct. ' +
      'Keep every placeholder, rich-text tag and line break exactly.',
  },
  refine: {
    label: 'AI 다듬기',
    description: '번역문을 의미·규칙·표현 순서로 필요한 곳만 고치고, 고친 이유를 남깁니다.',
    // json, not text: each change says why (the editor shows it on the candidate); "text" is the line's new translation.
    output: 'json',
    scope: 'line',
    include: { candidate: true, issues: false },
    fields: [
      { ...field('text', 'string', 'The translation after your changes: the candidate exactly as it is when nothing needs fixing.'), required: true },
      field('changes', 'list', 'One entry per change; empty when nothing changed.', [
        field('kind', 'string', 'meaning, rule or language: the check that required the change.'),
        field('why', 'string', 'One short Korean phrase naming what changed, e.g. "용어: 펜 항구 → 쿠헤스마", "말투: 상관에게 존댓말".'),
      ]),
    ],
    instructions: [
      'The candidate translation ("candidate") is the translator\'s own draft. Keep their wording, word choice and style; change only what one of these requires, checked in this order:',
      '1. meaning: something of the source is missing, added or mistranslated (negation, numbers, who does what);',
      '2. rule: a confirmed glossary term, the speech level and address the speech rules give for this speaker and listener, a placeholder or rich-text tag of the source that is missing, extra or misplaced, a particle after a variable;',
      '3. language: translationese, an unnatural particle or word order, spacing or spelling in the target language.',
      'Do not rephrase what is already correct. If nothing needs fixing, return the candidate exactly as it is with no changes.',
      'Keep every placeholder, rich-text tag and line break the source has.',
    ].join('\n'),
  },
  speechFix: {
    label: 'AI 말투 맞추기',
    description: '번역의 어미·호칭만 말투 규칙에 맞게 고칩니다.',
    output: 'text',
    scope: 'line',
    include: { candidate: true, issues: false },
    fields: [],
    context: { speech: true, documents: false, characters: false, relationships: false, glossary: false, precedingLines: 4, previousScenes: 0 },
    batch: { mode: 'group' },
    instructions:
      'Each line has a current translation ("candidate") and, where known, its listener and a confirmed speechRule. ' +
      'Change only the sentence endings, honorifics and forms of address so the line follows its speechRule; keep the meaning, word choice and everything else as it is. ' +
      'If a line already follows its rule, or has no rule, return its candidate unchanged. Keep every placeholder, rich-text tag and line break exactly.',
  },
  listener: {
    label: 'AI 청자 추정',
    description: '대사마다 누구에게 하는 말인지 고르고 확신도를 냅니다.',
    // A json answer, not a choice: an extra outside the cast (e.g. "SWAT 2") is a valid listener, and a choice would drop it.
    output: 'json',
    scope: 'line',
    include: { candidate: false, issues: false },
    fields: [
      { ...field('value', 'string', 'Who the line is addressed to: a cast name, an extra as the lines name them, group / public / self, or unknown when you cannot tell.'), required: true },
      { ...field('confidence', 'number', 'How sure you are.'), min: 0, max: 1 },
      field('reason', 'string', 'One short line on why.'),
    ],
    // Not the lines' own listeners and speech rules: those are what this node decides.
    context: { glossary: false, speech: false, cast: true, characters: true, relationships: true, documents: true, precedingLines: 8, previousScenes: 1 },
    batch: { mode: 'group' },
    instructions:
      'For each line, decide who the speaker is addressing, so a Korean translator can pick the right speech level. ' +
      'Read the whole batch as a scene: who is present, turn-taking, vocatives, questions and answers. ' +
      'Answer with the name as in the cast list (the player character included, even if it never speaks). Someone not in the cast — an extra such as a SWAT officer or a passer-by — is named ' +
      'exactly as they appear as a speaker in the lines (e.g. "SWAT 2"), or as the lines call them when they never speak; never put a cast member in an extra\'s place. Use "group" for several people present, ' +
      '"public" for an unspecified audience (broadcast, announcement, post), "self" for thinking aloud, and "unknown" when you cannot tell. Give a confidence from 0 to 1; never guess with high confidence.',
  },
  terms: {
    label: 'AI 용어 추출',
    description: '번역된 대사에서 용어집에 없는 고유명사·반복 용어와 번역에 쓰인 표기를 짝지어 뽑습니다.',
    output: 'json',
    scope: 'batch',
    // The lines' current translations are where the Korean forms come from.
    include: { candidate: true, issues: false },
    context: { characters: true, documents: true, speech: false, precedingLines: 0, previousScenes: 0 },
    batch: { mode: 'group' },
    fields: [listField('terms', 'Terms found across all lines of the request; empty when there are none.', translatedTermFields)],
    instructions: [
      'Find proper nouns, coined words and recurring game terms in the source lines that are not already in the glossary, and pair each with the Korean form the lines\' translations ("candidate") use for it.',
      RULE_TERMS_FROM_TRANSLATIONS,
      '- Use only what the lines say. Every term cites the lines where it appears as evidence line ids. Return an empty list when there are none.',
    ].join('\n'),
  },
  termTranslate: {
    label: 'AI 용어 번역',
    description: '용어 후보마다 용어인지 가리고, 용어면 한국어 표기와 메모를 냅니다(용어로 실행).',
    output: 'json',
    scope: 'line',
    include: { candidate: false, issues: false },
    fields: [
      { ...field('isTerm', 'boolean', 'true for proper nouns (people, places, organizations, products, titles) and game-specific concepts whose Korean form must stay the same everywhere; false for ordinary words or phrases that only happen to be capitalized.'), required: true },
      field('target', 'string', 'The Korean form to use everywhere; empty when isTerm is false.'),
      field('note', 'string', 'A few Korean words on what it is (e.g. "단체 이름", "지명", "인물 호칭"); empty when isTerm is false.'),
    ],
    context: { glossary: true, cast: true, characters: false, relationships: false, documents: false, speech: false, precedingLines: 0, previousScenes: 0, examples: 2 },
    batch: { mode: 'count', size: 100 },
    instructions: [
      'Each item is a candidate for the Korean localization glossary of a video game: the term, what the glossary has for it so far, how many script lines use it and some of those lines (with their current Korean translation when there is one). For each candidate decide:',
      '- isTerm: true for proper nouns (people, places, organizations, products, titles) and game-specific concepts whose Korean form must stay the same everywhere. False for ordinary words or phrases that happen to be capitalized ("Thank God", "This Nina").',
      '- target: the Korean form to use everywhere (names transliterated the way Korean localizations usually do; follow the examples\' current translations when they agree). Empty when isTerm is false.',
      '- note: a few Korean words on what it is; when the same word means different things in different lines, say so.',
      'Keep consistent with the glossary when given.',
    ].join('\n'),
  },
  knowledge: {
    label: 'AI 인물·관계 추출',
    description: '장면 묶음마다 새 인물, 관계와 그 변화, 말투 규칙을 이미 아는 자료와 견주어 뽑습니다.',
    output: 'json',
    scope: 'batch',
    include: { candidate: false, issues: false },
    context: { glossary: false, cast: true, characters: true, relationships: true, documents: true, speech: true, precedingLines: 8, previousScenes: 1 },
    batch: { mode: 'group' },
    fields: [
      listField('characters', 'People these lines add; empty when none are new.', characterFields),
      listField('relationships', 'Relationships these lines start or change.', relationshipFields),
      listField('speechRules', 'Speaker → listener speech levels these lines show.', speechRuleFields),
    ],
    instructions: [
      'Read these lines as one scene against what is already known (cast, characters, relationships and the speech rules on each line). Report only what the scene adds or changes: people not in the cast, a relationship that starts or changes (with the line where it shows), and a point where a speaker starts addressing a listener at a different Korean speech level. Return empty lists when nothing is new.',
      KNOWN_CAST,
      EVIDENCE_RULES,
      RULE_CHARACTERS,
      RULE_RELATIONSHIPS,
      RULE_SPEECH_RULES,
    ].join('\n'),
  },
  events: {
    label: 'AI 사건 추출',
    description: '장면 묶음마다 사건과 원인·결과, 관련 인물을 뽑습니다.',
    output: 'json',
    scope: 'batch',
    include: { candidate: false, issues: false },
    context: { glossary: false, cast: true, characters: true, relationships: false, documents: true, speech: false, precedingLines: 0, previousScenes: 1 },
    batch: { mode: 'group' },
    fields: [listField('events', 'Events in these lines that later lines may refer back to; empty when none.', eventFields)],
    instructions: ['Read these lines as one scene and report the events in it.', KNOWN_CAST, EVIDENCE_RULES, RULE_EVENTS].join('\n'),
  },
  analysis: {
    label: 'AI 작품 분석',
    description: '대본 전체를 읽고 개요·인물·관계·사건·말투 규칙·장면별 청자·용어를 근거와 함께 냅니다.',
    output: 'json',
    scope: 'batch',
    include: { candidate: false, issues: false },
    // The script itself is the context; stored knowledge would only bias the reading. Only the names people fixed are sent (cast).
    context: READING_CONTEXT,
    batch: { mode: 'whole' },
    // One request reads a large part of the script and writes thousands of words.
    timeoutMinutes: 30,
    fields: [
      field('overviewTitle', 'string', 'A short Korean title for the overview document, e.g. "작품 개요".'),
      field('overview', 'string', 'Markdown document in Korean with the headings 배경 (the setting), 주요 갈등 (the main conflict) and 줄거리 (the plot so far). Use only what the text says.'),
      listField('characters', 'Everyone who speaks or is addressed often.', characterFields),
      listField('relationships', 'One per direction that matters.', relationshipFields),
      listField('events', 'What happened, including events later lines refer back to.', eventFields),
      listField('speechRules', 'For every speaker → listener direction with several lines.', speechRuleFields),
      listField('sceneListeners', 'Per scene and speaker, whom they mostly address.', sceneListenerFields),
      listField('terms', 'Names and words whose Korean form must stay the same everywhere; about 150 at most, the most important first.', termFields),
    ],
    instructions: [
      'You are reading the whole script of a work so that translators into Korean get the background they need. Fill the fields from what the script says.',
      KNOWN_CAST,
      EVIDENCE_RULES,
      RULE_OVERVIEW,
      RULE_CHARACTERS,
      RULE_RELATIONSHIPS,
      RULE_EVENTS,
      RULE_SPEECH_RULES,
      RULE_SCENE_LISTENERS,
      RULE_TERMS,
      '- Keep the whole answer under about 15,000 words.',
    ].join('\n'),
  },
  analysisMerge: {
    label: 'AI 결과 합치기',
    description: '작품 분석이 대본을 여러 요청으로 나눠 읽었을 때, 조각마다 나온 인물과 개요를 하나로 합칩니다(모으기 뒤).',
    output: 'json',
    scope: 'batch',
    include: { candidate: false, issues: false },
    // Only the parts go in: the cast list keeps the names people fixed.
    context: { ...READING_CONTEXT, glossary: false },
    fields: [
      field('overviewTitle', 'string', 'A short Korean title for the overview document, e.g. "작품 개요".'),
      field('overview', 'string', 'One Markdown document in Korean for the whole script, with the headings 배경, 주요 갈등 and 줄거리 (the plot of every part, in order); at most about 1,500 words.'),
      listField('characters', 'Every person of the parts, once.', characterFields.filter((entry) => entry.name !== 'evidence' && entry.name !== 'speech')),
    ],
    instructions: [
      'An earlier node read the script in several requests, in script order; "previous" holds what they found ("parts", one per request): each part\'s characters and overview. Combine them into one answer:',
      '- characters: one entry per person. The same person under different names (one part calls them by a title or a code name, another by their name) is ONE entry: use the name the parts use most (or the cast list\'s name) as "name" and put every other name in "aliases". Merge the profiles into 1-3 sentences. For gender, ageBand, role and player keep what the parts say when they agree, otherwise "unknown" (player: true if any part says so). Never invent a person no part names.',
      '- overview: rewrite the parts\' overviews as one document for the whole script; the plot follows the parts in order.',
      KNOWN_CAST,
      '- Use only what the parts say. Write in Korean, except names.',
    ].join('\n'),
  },
} satisfies Record<string, AiPreset>;
export type AiPresetId = keyof typeof AI_PRESETS;
export const AI_PRESET_IDS = Object.keys(AI_PRESETS) as AiPresetId[];

/** Core AI presets offered in the workflow node library. */
export const PALETTE_AI_PRESET_IDS = ['translate', 'review', 'revise', 'refine', 'speechFix', 'listener', 'terms', 'termTranslate', 'knowledge', 'events', 'analysis'] as const satisfies readonly AiPresetId[];
export type PaletteAiPresetId = (typeof PALETTE_AI_PRESET_IDS)[number];

/** The configuration of an AI node filled from a preset (what choosing the preset in the editor writes). */
export function presetConfig(id: AiPresetId, model: DraftModelChoice | null | undefined, overrides: Partial<AiNode['config']> = {}): AiNode['config'] {
  const preset: AiPreset = AI_PRESETS[id];
  return aiNodeConfigSchema.parse({
    // No AI connection yet: the node waits for one to be picked.
    model: model ?? { ...EMPTY_MODEL_CHOICE },
    instructions: preset.instructions,
    output: preset.output,
    scope: preset.scope,
    fields: structuredClone(preset.fields),
    choice: preset.choice,
    preset: id,
    include: preset.include,
    context: preset.context,
    batch: preset.batch,
    timeoutMinutes: preset.timeoutMinutes,
    ...overrides,
  });
}
