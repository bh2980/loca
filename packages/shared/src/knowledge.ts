import { z } from 'zod';

/**
 * Where a knowledge item or term stands: 확정 (used as AI context), 후보 (waiting) or 버림 (discarded,
 * kept so a later analysis does not propose it again).
 */
export const KNOWLEDGE_STATUSES = ['candidate', 'confirmed', 'rejected'] as const;
/** Who made the content. "script": found in the script by code (glossary candidates). */
export const KNOWLEDGE_ORIGINS = ['human', 'ai', 'import', 'script'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];
export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = { candidate: '후보', confirmed: '확정', rejected: '버림' };
export const KNOWLEDGE_ORIGIN_LABELS: Record<KnowledgeOrigin, string> = { human: '사람', ai: 'AI', import: '가져오기', script: '대본에서 찾음' };

/**
 * Who put something in its current status — a line's (user-defined) status, a knowledge item's or a
 * term's 후보/확정/버림. AI: a workflow node, the work analysis. 사람: an edit, a confirm, an accepted
 * chat or CLI proposal, an import. Statuses are never split into AI and human versions.
 */
export const STATUS_BY = ['ai', 'human'] as const;
export type StatusBy = (typeof STATUS_BY)[number];
export const STATUS_BY_LABELS: Record<StatusBy, string> = { ai: 'AI', human: '사람' };
/** AI set it and no person has looked since: shown with the ✦ mark, and what 확인함 is for. */
export const aiDecided = (item: { status?: string; statusBy: StatusBy }) => item.statusBy === 'ai' && item.status !== 'candidate' && item.status !== 'rejected';

/**
 * Who made the content, for the 출처 column: the work analysis (it carries the job), AI elsewhere
 * (a workflow node, the chat), the script finder, an import, or a person. Separate from who set the
 * status: a person can confirm an analysis item without rewriting it.
 */
export const KNOWLEDGE_SOURCES = ['analysis', 'workflow', 'script', 'import', 'human'] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];
export const SOURCE_LABELS: Record<KnowledgeSource, string> = { analysis: '작품 분석', workflow: '워크플로·채팅', script: '대본에서 찾음', import: '가져오기', human: '사람' };
export const sourceOf = (item: { origin: KnowledgeOrigin; jobId?: string | null }): KnowledgeSource =>
  item.origin === 'ai' ? (item.jobId ? 'analysis' : 'workflow') : item.origin;
/** Nothing left to decide: confirmed by a person. Everything else can be confirmed or discarded. */
export const isSettled = (item: { status: KnowledgeStatus; statusBy: StatusBy }) => item.status === 'confirmed' && item.statusBy === 'human';

/** What becomes of AI results per knowledge kind (AI 결과 반영): used right away, or a candidate. */
export const AI_CONFIRM_KINDS = { terms: '용어', documents: '문서', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙' } as const;
export type AiConfirmKind = keyof typeof AI_CONFIRM_KINDS;
export const aiConfirmSchema = z.object({
  terms: z.enum(['auto', 'candidate']).default('auto'),
  documents: z.enum(['auto', 'candidate']).default('auto'),
  characters: z.enum(['auto', 'candidate']).default('auto'),
  relationships: z.enum(['auto', 'candidate']).default('auto'),
  events: z.enum(['auto', 'candidate']).default('auto'),
  speechRules: z.enum(['auto', 'candidate']).default('auto'),
});
export type AiConfirm = z.infer<typeof aiConfirmSchema>;
export const DEFAULT_AI_CONFIRM: AiConfirm = aiConfirmSchema.parse({});
/** The status an AI result of this kind lands in. */
export const aiStatus = (policy: AiConfirm, kind: AiConfirmKind) => (policy[kind] === 'auto' ? ('confirmed' as const) : ('candidate' as const));

/**
 * Where a line's listener came from. A person's choice always wins over the AI's. "scene": the work
 * analysis's whom-a-speaker-mostly-addresses for a whole scene, copied to the speaker's lines there;
 * "ai": a guess for this very line (a listener workflow node).
 */
export const LISTENER_ORIGINS = ['import', 'scene', 'ai', 'human'] as const;
export type ListenerOrigin = (typeof LISTENER_ORIGINS)[number];
/** AI listeners below this confidence count as unknown (experiment sample: 99% right at >= 0.9). */
export const LISTENER_MIN_CONFIDENCE = 0.9;
/**
 * A guess that does not count: below the bar, by line or by scene. A low scene guess means the
 * speaker addresses several people there ("mostly X"), so it is a hint about the scene, not the line.
 */
export const isUnsureListener = (line: { listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null }) =>
  (line.listenerOrigin === 'ai' || line.listenerOrigin === 'scene') && (line.listenerConfidence ?? 0) < LISTENER_MIN_CONFIDENCE;
/**
 * Listeners that are not one person: everyone present, an unspecified audience (broadcasts,
 * notices, posts), and the speaker themself (thinking aloud). Speech rules can name them as the
 * listener too ("Mira → group"). A listener nobody could tell is null (an AI null = looked, unsure).
 */
export const SPECIAL_LISTENERS = { group: '여럿', public: '불특정 다수', self: '혼잣말' } as const;
export type SpecialListener = keyof typeof SPECIAL_LISTENERS;
export const isSpecialListener = (name: string | null | undefined): name is SpecialListener => !!name && Object.hasOwn(SPECIAL_LISTENERS, name);
/**
 * A speech rule's listener for "everyone else": the speaker's level toward anyone without a rule of
 * their own (extras such as SWAT, a passer-by). Only rules use it; a line's listener is never "others".
 */
export const OTHERS_LISTENER = 'others';
/** A listener as people read it: a name, or the Korean word for a special listener. */
export const listenerLabel = (name: string) => (isSpecialListener(name) ? SPECIAL_LISTENERS[name] : name === OTHERS_LISTENER ? '그 밖의 사람' : name);

/** Korean speech levels: the archaic 하소서 (to a king, a god, in prayer), four formal (하십시오·하오·하게·해라) and two informal (해요·해) ones. */
export const SPEECH_LEVELS = ['hasoseo', 'hasipsio', 'hao', 'hage', 'haera', 'haeyo', 'hae', 'other'] as const;
export type SpeechLevel = (typeof SPEECH_LEVELS)[number];
export const SPEECH_LEVEL_LABELS: Record<SpeechLevel, string> = {
  hasoseo: '하소서체',
  hasipsio: '하십시오체',
  hao: '하오체',
  hage: '하게체',
  haera: '해라체',
  haeyo: '해요체',
  hae: '해체(반말)',
  other: '기타',
};
/** For prompts: the level ids with an example ending each. */
export const SPEECH_LEVEL_GUIDE = 'hasoseo (하소서체, archaic: to a king or a god, prayers: 하나이다/하나이까/하소서), hasipsio (하십시오체: 합니다/합니까/하십시오), hao (하오체: 하오/하구려), hage (하게체: 하네/하게/하는가), haera (해라체: 한다/하느냐/해라/하자), haeyo (해요체: 해요), hae (해체·반말: 해/해?/하지), other';

/**
 * A character's written style (문체) on three axes, each a pair of opposites or neither (보통).
 * The name stays Korean for people; the model gets plain instructions, since names like 우유체
 * mean little to it. 개조식 is a format for UI and notes, not a person's voice, so it is not here.
 */
export const STYLE_AXES = {
  length: {
    label: '문장 길이',
    options: {
      concise: { name: '간결체', instruction: 'short sentences; few connectives and modifiers' },
      elaborate: { name: '만연체', instruction: 'long, flowing sentences joined with connectives' },
    },
  },
  force: {
    label: '힘',
    options: {
      strong: { name: '강건체', instruction: 'firm, forceful, decisive wording' },
      soft: { name: '우유체', instruction: 'soft, gentle, indirect wording' },
    },
  },
  ornament: {
    label: '꾸밈',
    options: {
      plain: { name: '건조체', instruction: 'plain and factual; no imagery' },
      florid: { name: '화려체', instruction: 'rich modifiers, imagery and figures of speech' },
    },
  },
} as const;
export type StyleAxis = keyof typeof STYLE_AXES;
export const characterStyleSchema = z.object({
  length: z.enum(['concise', 'elaborate']).optional(),
  force: z.enum(['strong', 'soft']).optional(),
  ornament: z.enum(['plain', 'florid']).optional(),
});
export type CharacterStyle = z.infer<typeof characterStyleSchema>;
/** The style as an instruction for the translation prompt, or undefined when no axis is set. */
export function styleInstruction(style: CharacterStyle | null | undefined) {
  const parts = (Object.keys(STYLE_AXES) as StyleAxis[]).flatMap((axis) => {
    const value = style?.[axis];
    return value ? [(STYLE_AXES[axis].options as Record<string, { instruction: string }>)[value].instruction] : [];
  });
  return parts.length ? `Korean style: ${parts.join('; ')}.` : undefined;
}
/** The style in Korean names (간결체 · 강건체), for screens. */
export function styleNames(style: CharacterStyle | null | undefined) {
  return (Object.keys(STYLE_AXES) as StyleAxis[]).flatMap((axis) => {
    const value = style?.[axis];
    return value ? [(STYLE_AXES[axis].options as Record<string, { name: string }>)[value].name] : [];
  });
}

/**
 * A character's gender and age band: the basics of Korean forms of address (형·오빠·누나·언니·씨·님)
 * and speech level. 'unknown' is the default and what the work analysis leaves without evidence;
 * 'other' is neither (an android, a spirit, a genderless being), its details in the profile.
 */
export const GENDERS = ['unknown', 'male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { unknown: '모름', male: '남성', female: '여성', other: '그 외' };
export const AGE_BANDS = ['unknown', 'child', 'teen', 'young', 'middle', 'old'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const AGE_BAND_LABELS: Record<AgeBand, string> = { unknown: '모름', child: '어린이', teen: '청소년', young: '청년', middle: '중년', old: '노년' };
/** How central the character is to the story; 'unknown' until a person or the analysis decides. */
export const CHARACTER_ROLES = ['unknown', 'main', 'supporting', 'minor'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];
export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = { unknown: '모름', main: '주연', supporting: '조연', minor: '단역' };
const GENDER_WORDS: Record<Gender, string | undefined> = { unknown: undefined, male: 'male', female: 'female', other: 'neither male nor female' };
const AGE_WORDS: Record<AgeBand, string | undefined> = { unknown: undefined, child: 'child', teen: 'teenager', young: 'young adult', middle: 'middle-aged', old: 'elderly' };
/** Gender and age band in plain words for a prompt ("female, young adult"), or undefined when both are unknown. */
export function personNote(character: { gender?: Gender | null; ageBand?: AgeBand | null }) {
  const words = [GENDER_WORDS[character.gender ?? 'unknown'], AGE_WORDS[character.ageBand ?? 'unknown']].filter(Boolean);
  return words.length ? words.join(', ') : undefined;
}
/** Gender and age band in Korean for screens ("여성 · 청년"), leaving out what is unknown. */
export function personLabel(character: { gender?: Gender | null; ageBand?: AgeBand | null }) {
  return [character.gender && character.gender !== 'unknown' ? GENDER_LABELS[character.gender] : '', character.ageBand && character.ageBand !== 'unknown' ? AGE_BAND_LABELS[character.ageBand] : ''].filter(Boolean).join(' · ');
}

export const relationshipChangeSchema = z.object({
  /** The line key where the change shows. */
  at: z.string().min(1),
  change: z.string().min(1),
  cause: z.string().default(''),
});
export type RelationshipChange = z.infer<typeof relationshipChangeSchema>;

/** Final consonant index of a Hangul syllable (0 = none, 4 = ㄴ, 17 = ㅂ, 18 = ㅄ, 20 = ㅆ, 25 = ㅌ). */
const finalOf = (syllable: string | undefined) => {
  const code = syllable?.charCodeAt(0) ?? 0;
  return code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : -1;
};

/**
 * The Korean speech level a translation ends in, guessed from its last sentence ending.
 * A heuristic (labelled "추정" wherever it is shown) that answers null when unsure: very short
 * answers ("네", "응"), noun fragments ("주소.", "용의자.", "수사관님!") and endings that are also
 * common word endings are not guessed. Compare lines with `politenessOf`, not this level, when a
 * speaker may mix neighbouring levels.
 */
export function speechLevelOf(text: string): Exclude<SpeechLevel, 'other'> | null {
  const plain = text
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .trim()
    .replace(/[\s.,!?…~"'”’)\]]+$/u, '');
  if (!/[가-힣]$/u.test(plain)) return null;
  const before = plain.at(-2);
  const multiWord = /\s/u.test(plain);
  // 하소서체 first: its 나이다/나이까 would otherwise read as nothing, and 소서 as 하오체.
  if (/(나이다|나이까|소서)$/u.test(plain)) return 'hasoseo';
  // 니다/니까/ㅂ시다 only after a syllable ending in ㅂ ("합니다", "갑시다"), not "그러니까".
  if (/(니다|니까)$/u.test(plain) && finalOf(plain.at(-3)) === 17) return 'hasipsio';
  if (/십시오$/u.test(plain) || (/시다$/u.test(plain) && finalOf(plain.at(-3)) === 17) || /읍시다$/u.test(plain)) return 'hasipsio';
  if (/(요|죠)$/u.test(plain)) return 'haeyo';
  if (/(구려|시오|하오|이오)$/u.test(plain) || (/소$/u.test(plain) && [20, 18].includes(finalOf(before)))) return 'hao';
  if (/던가$/u.test(plain)) return 'hae'; // "그랬던가?": musing aloud, not 하게체
  if (/(는가|게나|세나)$/u.test(plain)) return 'hage';
  // 해라체. "-다" counts only after a verbal stem (ㄴ/ㅆ/ㅄ/ㅌ, 하·이·되); "바다" or "사다" are not guessed.
  if (/(느냐|거라|어라|아라|여라|해라|워라|와라)$/u.test(plain)) return 'haera';
  if (/다$/u.test(plain)) return [4, 20, 18, 25].includes(finalOf(before)) || (before !== undefined && '하이되'.includes(before)) ? 'haera' : null;
  if (/자$/u.test(plain)) return multiWord || finalOf(before) > 0 || (before !== undefined && '하가보오서나타'.includes(before)) ? 'haera' : null;
  // 해체. Strong endings are verbal; weak ones are also common noun endings ("아버지") so a one-word line is not guessed.
  if (/(국|영|단|언|용)어$/u.test(plain)) return null;
  if (/(해|아|어|여|워|와|줘|봐|써|잖아|거든|는데|은데|구나|군|냐)$/u.test(plain)) return plain.length >= 2 ? 'hae' : null;
  if (multiWord && /(지|야|네|나|니|라|까|래|게|걸|데)$/u.test(plain)) return 'hae';
  return null;
}

export type Politeness = 'polite' | 'plain';
const POLITE_LEVELS: readonly SpeechLevel[] = ['hasoseo', 'hasipsio', 'hao', 'haeyo'];
const PLAIN_LEVELS: readonly SpeechLevel[] = ['hae', 'haera', 'hage'];

/** The two-axis view of a speech level: 존댓말 (하소서·하십시오·하오·해요) or 반말 (해·해라·하게). Null for other/unknown. */
export const politenessOfLevel = (level: SpeechLevel | null): Politeness | null =>
  level && POLITE_LEVELS.includes(level) ? 'polite' : level && PLAIN_LEVELS.includes(level) ? 'plain' : null;

/** Whether the text ends politely or plainly; speakers mix neighbouring levels, so this is the reliable axis. */
export const politenessOf = (text: string): Politeness | null => politenessOfLevel(speechLevelOf(text));

/** What kind of glossary term the work analysis says a name or word is (shown in the term's note). */
export const TERM_KINDS = ['person', 'place', 'organization', 'item', 'concept', 'title', 'ui', 'other'] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const TERM_KIND_LABELS: Record<TermKind, string> = { person: '인물', place: '장소', organization: '조직', item: '물건·기술', concept: '개념·은어', title: '호칭·직함', ui: 'UI', other: '' };

/** What a work analysis can read the script for (an "analysis" AI node's sections). */
export const ANALYSIS_SECTIONS = ['overview', 'characters', 'relationships', 'events', 'speechRules', 'sceneListeners', 'terms'] as const;
export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];
export const ANALYSIS_SECTION_LABELS: Record<AnalysisSection, string> = { overview: '작품 개요', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙', sceneListeners: '장면별 청자', terms: '용어' };
/** The sections a node reads: its own, or every one when it names none. */
export const analysisSectionsOf = (sections: readonly AnalysisSection[] | undefined): AnalysisSection[] => (sections?.length ? ANALYSIS_SECTIONS.filter((section) => sections.includes(section)) : [...ANALYSIS_SECTIONS]);
