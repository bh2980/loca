import { EMPTY_MODEL_CHOICE } from './model-choice.ts';
import { UNRESOLVED_PAIR_KINDS } from './talking-pairs.ts';
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
  '- characters: people (or person-like beings, e.g. an AI or a spirit) who speak or are spoken to often. A speaker label that is UI text, an objective, a device, a place or a sound effect is not a character. "newFacts" lists who they are and what they do in the story and "newSpeech" how they talk in the source (register, habits): one short Korean sentence per entry, each only when these lines show it and the stored profile or speech description (the same person under "characters", when given) does not already say it, with the line ids that show it; empty when nothing is new. Stored text is never rewritten: only new entries are added to its end. Mark the player character (the one the player controls or who is addressed as "you" by the game, even if it never speaks) with "player": true. Give "gender" (male, female, other = neither, e.g. an android or a spirit) and "ageBand" (child, teen, young, middle, old) only when the lines show it (pronouns, forms of address, stated age, role); otherwise "unknown". Give "role": main when the story centres on them, supporting when they recur and take part in the plot, minor when they have few lines; use "unknown" when unclear. Name everyone as the source does, in the source language; an unnamed player character gets the role the game uses (e.g. "Detective", "Captain"), never a translated name.';
const RULE_NOT_PEOPLE =
  '- notPeople: speaker labels in these lines that are not people (UI text, objectives, devices, places, sound effects): "name" as the script writes it, "reason" one short Korean phrase. They are not characters: write no character, relationship or speech rule for them.';
const RULE_RELATIONSHIPS =
  '- relationships: one entry per pair of people who matter, named as the script does ("between"), with one or two "views", each a direction of the pair ("from" → "to"). Give a direction only when the script shows how "from" sees or treats "to"; when the relationship is the same both ways (동료, 연인, 형제·자매, 친구) give both directions. A view says who "to" is to "from" in "kind": ONE short noun (e.g. 부하, 두목, 언니, 협력자), never both people\'s roles ("두목-부하"), never several joined ("동료 / 파트너"), never a change ("협력에서 적대로"). When "from"\'s view of "to" changes, add to that view\'s "changes" the line id ("at") where it changes, the new relationship in "kind" (again one short noun) and why in "cause".';
const RULE_TALKING_PAIRS =
  '- talkingPairs: when the input has "talkingPairs", those are the pairs of people who talk to each other in these lines ("a", "b") with the number of lines that show it ("turns"). For every listed pair either write the relationship in "relationships" (between + views as above) or list the pair in "pairsWithoutRelationship" with "kind" (notPerson when one of them is a label in "notPeople", noEvidence when the lines show no relationship, undecided otherwise) and a short Korean "reason". A listed pair must not be left out of both. You may also write relationships for pairs that are not listed when the lines show them.';
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
  field('newFacts', 'list', 'Only facts these lines show that the stored profile does not already say; empty when nothing is new. Who they are and what they do in the story, one short Korean sentence per entry. For a person not stored yet these form the profile.', [
    field('text', 'string', 'One fact, one short Korean sentence, not a retelling of the scene.'),
    evidence('this fact'),
  ]),
  field('newSpeech', 'list', 'Only habits of speech these lines show that the stored speech description does not already say; empty when nothing is new. How they talk in the source (register, habits), one short Korean sentence per entry. For a person not stored yet these form the speech description.', [
    field('text', 'string', 'One habit of speech, one short Korean sentence.'),
    evidence('this habit'),
  ]),
  field('player', 'boolean', 'true for the player character (the one the player controls or the game addresses as "you"), even if it never speaks.'),
  field('gender', 'string', `One of: ${GENDERS.join(', ')}. "unknown" unless the lines show it.`),
  field('ageBand', 'string', `One of: ${AGE_BANDS.join(', ')}. "unknown" unless the lines show it.`),
  field('role', 'string', `One of: ${CHARACTER_ROLES.join(', ')}. main = the story centres on them, supporting = recurs and takes part, minor = few lines.`),
  evidence('who they are'),
];
const relationshipFields: JsonField[] = [
  field('between', 'strings', 'The two people of the pair, named as the script does: exactly two names.'),
  field('views', 'list', 'One or two views, each a direction of the pair (between[0] → between[1] or between[1] → between[0]), never the same direction twice. Give a direction only when the script shows how "from" sees or treats "to"; when the relationship is the same both ways (동료, 연인, 형제·자매, 친구) give both.', [
    field('from', 'string', 'The person who sees the other, one of "between".'),
    field('to', 'string', 'The person who is seen, the other of "between".'),
    field('kind', 'string', 'Who "to" is to "from": ONE short noun (e.g. 부하, 두목, 언니, 협력자). Never both people\'s roles, never several joined, never a change over time.'),
    field('description', 'string', 'How "from" sees and treats "to", in Korean.'),
    evidence('how "from" sees "to"'),
    field('changes', 'list', 'Points where the view of "to" by "from" changes, in script order; empty when it stays as it is.', [
      field('at', 'lines', 'The id of the line where the view changes.'),
      field('kind', 'string', 'Who "to" is to "from" from then on: ONE short noun.'),
      field('cause', 'string', 'Why it changes.'),
    ]),
  ]),
];
/** A pair of people with no relationship to write, and why (the unlisted / unresolved pairs of the talking-pairs context). */
const pairWithoutFields: JsonField[] = [
  field('between', 'strings', 'The two people of the pair, named as in "talkingPairs": exactly two names.'),
  { ...field('kind', 'string', `Why there is no relationship, one of: ${UNRESOLVED_PAIR_KINDS.join(', ')}. notPerson = one of them is not a person (a UI text, objective, device, place, sound effect), noEvidence = the lines show no relationship, undecided = there is evidence but it does not settle one.`), required: true },
  field('reason', 'string', 'Why there is no relationship to write, one short Korean phrase (e.g. 사람이 아님, 대사에 근거 없음).'),
];
/** A speaker label that is not a person, and why. */
const notPeopleFields: JsonField[] = [
  field('name', 'string', 'The speaker label exactly as the script writes it.'),
  field('reason', 'string', 'Why it is not a person, one short Korean phrase (e.g. 게임 목표 문구, 장치, 장소, 효과음).'),
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
  speechLevel: {
    label: '말투 판정',
    description: '번역문이 어떤 말투(높임법 등급)로 쓰였는지 고르고 확신도를 냅니다. 조건 노드가 이 답을 대사의 말투 규칙과 견줍니다. 판정 연결(System One 등)로도 돌릴 수 있습니다.',
    output: 'choice',
    scope: 'line',
    include: { candidate: true },
    fields: [],
    choice: { source: 'speechLevels', values: [], allowNone: true },
    // Not the speech rules: the answer is compared with them afterwards, so it must not be led by them.
    context: { glossary: false, speech: false, documents: false, characters: false, relationships: false, cast: false, pairs: false, precedingLines: 0, previousScenes: 0 },
    instructions:
      'Which Korean speech level does the translation ("candidate") of each line use toward the person it addresses? ' +
      'Judge from the endings of the sentences the speaker says to that person, not from quoted words, names or a single exclamation. ' +
      'Pick none when the translation has no sentence ending to judge (a name, a sound, a single word). Give a confidence from 0 to 1.',
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
    input: { previous: true, fields: ['issues', 'categories', 'kind', 'value'] },
    instructions:
      'Each line has a translation to fix ("candidate") and what the format check or the review found wrong with it ("previous": "issues" are the problems, "categories" or "kind" their types). ' +
      'When "previous" has a "value" instead, it is the speech level a judgment found the translation uses, and it differs from the speech rule the line gives: change the speech level and form of address to the rule\'s, nothing else. ' +
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
    context: { glossary: false, cast: true, characters: true, relationships: true, documents: true, speech: true, pairs: true, precedingLines: 8, previousScenes: 1 },
    // Bigger requests get shorter answers: on a 2,200-line script, 3,000 tokens found the most relationships and speech rules (1,000 contradicted itself, 102,000 found half).
    batch: { mode: 'group', maxTokens: 3_000 },
    fields: [
      listField('characters', 'People these lines add, and people already in the cast that these lines show something about (role, gender, age band, other names, new facts); empty when there is nothing.', characterFields),
      listField('notPeople', 'Speaker labels in these lines that are not people (UI text, objectives, devices, places, sound effects), each with a short Korean reason; empty when there are none.', notPeopleFields),
      listField('relationships', 'Pairs of people whose relationship these lines start or change, with a view for each direction the script shows.', relationshipFields),
      listField('pairsWithoutRelationship', 'Pairs listed in "talkingPairs" that get no relationship from these lines, each with a short Korean reason; empty when every listed pair has a relationship or none are listed.', pairWithoutFields),
      listField('speechRules', 'Speaker → listener speech levels these lines show.', speechRuleFields),
    ],
    instructions: [
      'Read these lines as one scene against what is already known (cast, characters, relationships and the speech rules on each line). Report only what the scene adds or changes: people not in the cast, what these lines show about a person who is in the cast (see below), a relationship that starts or changes (with the line where it shows), and a point where a speaker starts addressing a listener at a different Korean speech level. Return empty lists when nothing is new.',
      '- A person already in the cast gets an entry in "characters" too when these lines show something about them: their role, gender or age band, other names they go by ("aliases"), or something new about who they are ("newFacts") or how they talk ("newSpeech"): only what the stored profile and speech description (under "characters") do not already say, one short Korean sentence each with the line ids that show it, never a retelling of the scene or a rewrite of what is stored. Leave out what the lines do not show. Use exactly the cast name as "name". A scene that shows nothing new about a cast member gets no entry for them.',
      KNOWN_CAST,
      EVIDENCE_RULES,
      RULE_CHARACTERS,
      RULE_NOT_PEOPLE,
      RULE_RELATIONSHIPS,
      RULE_TALKING_PAIRS,
      RULE_SPEECH_RULES,
    ].join('\n'),
  },
  peopleMerge: {
    label: 'AI 인물·관계 합치기',
    description: '인물·관계 추출이 장면 묶음마다 낸 인물·관계·말투 규칙 조각을 사람마다, 방향마다 하나로 합칩니다(모으기 뒤).',
    output: 'json',
    scope: 'batch',
    include: { candidate: false },
    // The gathered parts go in; the cast keeps the names people fixed, and what is stored about the people they name
    // (profile, speech, role, gender, age band, aliases, relationships, speech rules) tells what is already known.
    context: { ...READING_CONTEXT, characters: true, relationships: true, speech: true, pairs: true },
    input: { previous: true, fields: [] },
    fields: [
      listField('characters', 'Every person the parts name, once.', characterFields.filter((entry) => entry.name !== 'evidence')),
      listField('notPeople', 'Every speaker label the parts report as not a person, once each; never a name that is in "characters".', notPeopleFields),
      listField('relationships', 'One per pair of people that the parts report, two views each, the changes of a view in script order.', relationshipFields),
      listField('unresolvedPairs', 'Pairs listed in "talkingPairs" that still have no relationship after combining the parts, each with a short Korean reason; empty when every listed pair has a relationship.', pairWithoutFields),
      listField('speechRules', 'One per speaker → listener stretch.', speechRuleFields),
    ],
    instructions: [
      'An earlier node read the script scene by scene; "previous" holds what it found ("parts", one per request, in script order): the people, speaker labels that are not people ("notPeople"), relationships, pairs without a relationship and speech rules each part reports, new ones and ones about people already in the cast. Combine them into one answer:',
      '- characters: one entry per person. The same person under different names is ONE entry: use the cast name (or, for a new person, the name the parts use most) as "name" and put every other name in "aliases" (all of the parts\' aliases and other names, once each). "newFacts" and "newSpeech" are lists of new entries, never a rewritten profile: collect the parts\' entries, each fact once (drop repeats of the same fact, and every fact the stored profile or speech description of that person under "characters" or "aiNotes" already says), each with the line ids ("evidence") its parts give; leave them empty when nothing is new. For a person not stored yet they form the profile and the speech description. Do not retell scenes. For gender, ageBand and role take the strongest evidence: what most parts say, otherwise the part that states it; "unknown" only when no part knows (role: the highest one a part gives, since a person who is main in one part is main). player is true if any part says so. Never invent a person no part names. When two names are the same person (a title, rank, full name or nickname of the other: "Inspector Voltaire" and "Voltaire"), output ONE character, the most complete name, with the other names in "aliases", and use that one name in relationships, unresolvedPairs and speech rules.',
      '- notPeople: collect the parts\' "notPeople" once each (same label, one entry; keep a reason). A label the parts report as not a person is never in "characters", "relationships" or "speechRules"; if the parts disagree about a label (one calls it a person, another not), decide from the evidence they give, and when it is still unclear leave it out of "notPeople" and keep it a character.',
      '- A person who is stored comes with their stored profile, speech description, role, gender, age band and aliases under "characters" (unverified AI ones under "aiNotes"), the stored relationships under "relationships" and the stored speech rules under "speechRules": that is what is already known, and it is never rewritten. Return only what the parts add to it.',
      '- relationships: one entry per pair of people ("between"), with one or two views, each a direction (give a direction only when a part shows how "from" sees or treats "to"; when the relationship is the same both ways (동료, 연인, 형제·자매, 친구) give both). Merge the parts\' entries of the same pair (in either order of names) into one: for each direction given one "kind" (ONE short noun for who "to" is to "from", never both roles, never several joined, never a change) and one description that fit the whole story, and every change of that view once, in script order (the order of the parts), with the line id ("at") the part gives and the new relationship in its "kind". A change is a new relationship, so a pair that goes from allies to enemies is kind 협력자 with a change to 적. Never invent a line id; keep the evidence ids of the parts. A stored relationship of the pair keeps its kind and description: add only the changes the parts show that the stored changes do not have (at another line).',
      '- unresolvedPairs: "talkingPairs" lists the pairs of people who talk to each other in all the lines this run read ("a", "b", "turns" = lines that show it). The parts give relationships and, in "pairsWithoutRelationship", pairs they found no relationship for. Every listed pair must end up either in "relationships" (merged from the parts, in either order of names) or in "unresolvedPairs" with "kind" (notPerson when one of them is in "notPeople", noEvidence when no part shows a relationship, undecided when the parts disagree or the evidence does not settle one) and a short Korean "reason". A pair one part leaves without a relationship but another part gives one for gets the relationship. Relationships the parts report for pairs that are not listed stay in "relationships". Never invent a relationship the parts do not show.',
      '- speechRules: one entry per speaker → listener stretch. When parts disagree on the level, decide from the relationship and from what most of the evidence shows. Keep a change of level (a "startKey" line id) only when the parts show a lasting change, not one scene\'s tone; a rule that only differs by one scene\'s tone is one entry without "startKey". A stored rule for the same speaker → listener and the same stretch stays: do not give another level for it, only rules for a new stretch (another "startKey") or a new pair. Keep the line ids ("startKey", evidence) from the parts, never invent one.',
      '- Name people as the characters list does (the cast name, or the name the parts use most).',
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
      listField('relationships', 'One per pair of people that matters, two views each.', relationshipFields),
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
