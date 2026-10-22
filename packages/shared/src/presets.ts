import { EMPTY_MODEL_CHOICE } from './model-choice.ts';
import { AGE_BANDS, CHARACTER_ROLES, GENDERS, SPEECH_LEVEL_GUIDE, SPEECH_LEVELS, TERM_KINDS } from './knowledge.ts';
import type { DraftModelChoice } from './model-choice.ts';
import type { JsonFieldType } from './functions.ts';
import { aiNodeConfigSchema, type AiNode, type AiOutput, type AiScope, type BatchConfig, type ChoiceConfig, type ContextConfig, type JsonField } from './workflow.ts';

/**
 * Built-in AI node configurations: what the default workflows' AI nodes and the editor's AI buttons
 * start from. Each fills a node's instructions, output form, fields and context options; after that
 * it is an ordinary AI node and every field stays editable. Everything the model is told beyond the
 * output format (which the server adds from the node's schema) is in `instructions` or in a field's
 * `description`: nothing is hidden. Only the reusable ones (AI_PRESETS: 번역, 검수, 용어 추출) are offered as
 * presets in the workflow editor; the rest live in the one workflow (or editor button) that uses them.
 */
export interface AiPreset {
  label: string;
  description: string;
  output: AiOutput;
  scope: AiScope;
  instructions: string;
  fields: JsonField[];
  choice?: Partial<ChoiceConfig>;
  include: { candidate: boolean };
  context?: Partial<ContextConfig>;
  batch?: Partial<BatchConfig>;
  /** The node's call time limit when it is not the default (DEFAULT_CALL_MINUTES). */
  timeoutMinutes?: number;
  /** The workflow inputs it works on (default both: it reads an item's source and translation); the palette offers it there. */
  inputs?: readonly ('lines' | 'terms')[];
  /** What the node reads from the step before it (input.previous and which of its fields). */
  input?: { previous: boolean; fields: string[] };
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
const RULE_SPEECH_RULES = `- speechRules: for every speaker → listener direction with several lines (the listener may also be "group", "public", "self" or "others": how the speaker talks to several people present, to an unspecified audience, to themself, or to anyone else without a profile or an extra of their own), the Korean speech level the translation should use, one of: ${SPEECH_LEVEL_GUIDE}. Decide from the relationship (age, rank, intimacy, hostility, era and setting) as a Korean translator would; narration-like or written addresses often take 해라체, close friends 해체. "address" is how the speaker should address the listener in Korean (e.g. "수사관님", "언니"); when several forms are used, separate them with commas (e.g. "행크 경위님, 경위님"); empty if none. If the level changes at some point (falling out, reconciliation, promotion), give one rule per stretch: "startKey" is the line id where the new stretch begins (empty for the first). Do not mark a single sarcastic or emotional line as a change. "note" says why.`;
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
  field('toName', 'string', 'The listener: a name, or "group", "public", "self" or "others" (anyone without a profile of their own, e.g. extras).'),
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
const listField = (name: string, description: string, fields: JsonField[]) => field(name, 'list', description, fields);

const READING_CONTEXT: Partial<ContextConfig> = { glossary: false, speech: false, documents: false, characters: false, relationships: false, cast: true, precedingLines: 0, previousScenes: 0 };

export const AI_PROMPTS = {
  translate: {
    label: 'AI 번역',
    description: '대사마다 번역문 하나를 냅니다.',
    output: 'text',
    scope: 'line',
    include: { candidate: false },
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
    include: { candidate: true },
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
  refine: {
    label: 'AI 다듬기',
    description: '번역문을 의미·규칙·표현 순서로 필요한 곳만 고치고, 고친 이유를 남깁니다.',
    // json, not text: each change says why (the editor shows it on the candidate); "text" is the line's new translation.
    output: 'json',
    scope: 'line',
    include: { candidate: true },
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
  revise: {
    label: 'AI 수정',
    description: '앞 단계(검사·검수)가 지적한 곳만 번역문에서 고칩니다.',
    output: 'text',
    scope: 'line',
    // The translation as it stands, and what the check or review found ("previous").
    include: { candidate: true },
    fields: [],
    input: { previous: true, fields: ['issues', 'categories', 'kind'] },
    instructions:
      'Each line has a translation to fix ("candidate") and what the format check or the review found wrong with it ("previous": "issues" are the problems, "categories" or "kind" their types). ' +
      'Fix only what those findings point out; keep the meaning, word choice, speech level and everything else as it is. ' +
      'Keep every placeholder ({name}, %s), rich-text tag and line break of the source exactly. ' +
      'Return the whole corrected translation of the line. If the findings do not apply to the candidate, return it unchanged.',
  },
  listener: {
    label: 'AI 청자 추정',
    description: '대사마다 누구에게 하는 말인지 고르고 확신도를 냅니다.',
    // A json answer, not a choice: an extra outside the cast (e.g. "SWAT 2") is a valid listener, and a choice would drop it.
    output: 'json',
    scope: 'line',
    include: { candidate: false },
    fields: [
      { ...field('value', 'string', 'Who the line is addressed to: a cast name, an extra as the lines name them, group / public / self, or unknown when you cannot tell.'), required: true },
      { ...field('confidence', 'number', 'How sure you are.'), min: 0, max: 1 },
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
    // It reads scenes of lines.
    inputs: ['lines'],
    output: 'json',
    scope: 'batch',
    // The lines' current translations are where the Korean forms come from.
    include: { candidate: true },
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
    description: '용어마다 한국어 표기와 메모를 냅니다.',
    inputs: ['terms'],
    output: 'json',
    scope: 'line',
    include: { candidate: false },
    fields: [
      { ...field('target', 'string', 'The Korean form to use everywhere.'), required: true },
      field('note', 'string', 'A few Korean words on what it is (e.g. "단체 이름", "지명", "인물 호칭").'),
    ],
    context: { glossary: true, cast: true, characters: false, relationships: false, documents: false, speech: false, precedingLines: 0, previousScenes: 0, examples: 2 },
    batch: { mode: 'count', size: 100 },
    instructions: [
      'Each item is a term of the Korean localization glossary of a video game: the term, what the glossary has for it so far, how many script lines use it and some of those lines (with their current Korean translation when there is one). For each term give:',
      '- target: the Korean form to use everywhere (names transliterated the way Korean localizations usually do; follow the examples\' current translations when they agree).',
      '- note: a few Korean words on what it is; when the same word means different things in different lines, say so.',
      'Keep consistent with the glossary when given.',
    ].join('\n'),
  },
  knowledge: {
    label: 'AI 인물·관계 추출',
    description: '장면 묶음마다 새 인물과, 이미 있는 인물에 대해 알게 된 것(역할·성별·나이대·별칭·프로필), 관계와 그 변화, 말투 규칙을 이미 아는 자료와 견주어 뽑습니다.',
    output: 'json',
    scope: 'batch',
    include: { candidate: false },
    context: { glossary: false, cast: true, characters: true, relationships: true, documents: true, speech: true, precedingLines: 8, previousScenes: 1 },
    // Bigger requests get shorter answers: on a 2,200-line script, 3,000 tokens found the most relationships and speech rules (1,000 contradicted itself, 102,000 found half).
    batch: { mode: 'group', maxTokens: 3_000 },
    fields: [
      listField('characters', 'People these lines add, and people already in the cast that these lines show something about (role, gender, age band, other names, profile); empty when there is nothing.', characterFields),
      listField('relationships', 'Relationships these lines start or change.', relationshipFields),
      listField('speechRules', 'Speaker → listener speech levels these lines show.', speechRuleFields),
    ],
    instructions: [
      'Read these lines as one scene against what is already known (cast, characters, relationships and the speech rules on each line). Report only what the scene adds or changes: people not in the cast, what these lines show about a person who is in the cast (see below), a relationship that starts or changes (with the line where it shows), and a point where a speaker starts addressing a listener at a different Korean speech level. Return empty lists when nothing is new.',
      '- A person already in the cast gets an entry in "characters" too when these lines show something about them: their role, gender or age band, other names they go by ("aliases"), or who they are ("profile": a short Korean description of what these lines show about them, not a retelling of the scene). Leave out what the lines do not show. Use exactly the cast name as "name". A scene that shows nothing new about a cast member gets no entry for them.',
      KNOWN_CAST,
      EVIDENCE_RULES,
      RULE_CHARACTERS,
      RULE_RELATIONSHIPS,
      RULE_SPEECH_RULES,
    ].join('\n'),
  },
  peopleMerge: {
    label: 'AI 인물 합치기',
    description: '인물·관계 추출이 장면 묶음마다 낸 인물 조각을 사람마다 하나로 합칩니다(모으기 뒤).',
    output: 'json',
    scope: 'batch',
    include: { candidate: false },
    // Only the gathered parts go in; the cast keeps the names people fixed.
    context: READING_CONTEXT,
    input: { previous: true, fields: [] },
    fields: [listField('characters', 'Every person the parts name, once.', characterFields.filter((entry) => entry.name !== 'evidence'))],
    instructions: [
      'An earlier node read the script scene by scene; "previous" holds what it found ("parts", one per request, in script order): the people each part reports, new ones and people already in the cast. Combine them into one answer:',
      '- characters: one entry per person. The same person under different names is ONE entry: use the cast name (or, for a new person, the name the parts use most) as "name" and put every other name in "aliases" (all of the parts\' aliases and other names, once each). Merge the profiles into 1-3 Korean sentences and the speech descriptions into one; do not retell scenes. For gender, ageBand and role take the strongest evidence: what most parts say, otherwise the part that states it; "unknown" only when no part knows (role: the highest one a part gives, since a person who is main in one part is main). player is true if any part says so. Never invent a person no part names.',
      KNOWN_CAST,
      '- Use only what the parts say. Write in Korean, except names.',
    ].join('\n'),
  },
  events: {
    label: 'AI 사건 추출',
    description: '장면 묶음마다 사건과 원인·결과, 관련 인물을 뽑습니다.',
    output: 'json',
    scope: 'batch',
    include: { candidate: false },
    context: { glossary: false, cast: true, characters: true, relationships: false, documents: true, speech: false, precedingLines: 0, previousScenes: 1 },
    batch: { mode: 'group' },
    fields: [listField('events', 'Events in these lines that later lines may refer back to; empty when none.', eventFields)],
    instructions: ['Read these lines as one scene and report the events in it.', KNOWN_CAST, EVIDENCE_RULES, RULE_EVENTS].join('\n'),
  },
  analysis: {
    label: 'AI 작품 분석',
    description: '대본 전체를 읽고 개요·인물·관계·사건·말투 규칙·용어를 근거와 함께 냅니다.',
    output: 'json',
    scope: 'batch',
    include: { candidate: false },
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
      RULE_TERMS,
      '- Keep the whole answer under about 15,000 words.',
    ].join('\n'),
  },
} satisfies Record<string, AiPreset>;
export type AiPromptId = keyof typeof AI_PROMPTS;

/** The presets the workflow editor offers (palette, AI node): general ones any workflow can use. */
export const AI_PRESET_IDS = ['translate', 'review', 'terms'] as const satisfies readonly AiPromptId[];
export type AiPresetId = (typeof AI_PRESET_IDS)[number];
export const AI_PRESETS: Record<AiPresetId, AiPreset> = { translate: AI_PROMPTS.translate, review: AI_PROMPTS.review, terms: AI_PROMPTS.terms };
const isPreset = (id: string): id is AiPresetId => (AI_PRESET_IDS as readonly string[]).includes(id);

/** An AI node's configuration filled from a built-in prompt; a preset's id is kept on the node (프리셋 · 번역). */
export function presetConfig(id: AiPromptId, model: DraftModelChoice | null | undefined, overrides: Partial<AiNode['config']> = {}): AiNode['config'] {
  const preset: AiPreset = AI_PROMPTS[id];
  return aiNodeConfigSchema.parse({
    // No AI connection yet: the node waits for one to be picked.
    model: model ?? { ...EMPTY_MODEL_CHOICE },
    instructions: preset.instructions,
    output: preset.output,
    scope: preset.scope,
    fields: structuredClone(preset.fields),
    choice: preset.choice,
    ...(isPreset(id) && { preset: id }),
    include: preset.include,
    context: preset.context,
    batch: preset.batch,
    timeoutMinutes: preset.timeoutMinutes,
    ...(preset.input && { input: { lines: true, ...preset.input } }),
    ...overrides,
  });
}
