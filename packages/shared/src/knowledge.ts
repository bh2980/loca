import { z } from 'zod';

/**
 * AI drafts are candidates until a person confirms them; only confirmed knowledge reaches AI nodes.
 * A discarded AI item stays as "rejected" so a later analysis does not propose it again.
 */
export const KNOWLEDGE_STATUSES = ['candidate', 'confirmed', 'rejected'] as const;
/** "script": found in the script by code (glossary candidates), not written by AI or a person. */
export const KNOWLEDGE_ORIGINS = ['human', 'ai', 'import', 'script'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];
export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = { candidate: '후보', confirmed: '확정', rejected: '버림' };
export const KNOWLEDGE_ORIGIN_LABELS: Record<KnowledgeOrigin, string> = { human: '사람', ai: 'AI', import: '가져오기', script: '대본에서 찾음' };

/**
 * Two separate facts about an item: where it stands (확정 used as context / 후보 waiting) and whose
 * it is — AI's (added by AI, nobody has edited or promoted it) or official (a person's, imported,
 * or AI's that a person took over). Auto-confirmed analysis gives confirmed AI items.
 */
export const KNOWLEDGE_SOURCES = ['ai', 'official'] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];
export const SOURCE_LABELS: Record<KnowledgeSource, string> = { ai: 'AI', official: '정식' };
export const sourceOf = (item: { origin: KnowledgeOrigin; reviewed: boolean }): KnowledgeSource => (item.origin === 'ai' && !item.reviewed ? 'ai' : 'official');
/** Nothing left to decide: confirmed and official. Everything else can be promoted or discarded. */
export const isSettled = (item: { status: KnowledgeStatus; origin: KnowledgeOrigin; reviewed: boolean }) => item.status === 'confirmed' && sourceOf(item) === 'official';

/** Where a line's listener came from. A person's choice always wins over the AI's. */
export const LISTENER_ORIGINS = ['import', 'ai', 'human'] as const;
export type ListenerOrigin = (typeof LISTENER_ORIGINS)[number];
/** AI listeners below this confidence count as unknown (experiment sample: 99% right at >= 0.9). */
export const LISTENER_MIN_CONFIDENCE = 0.9;
/**
 * Listeners that are not one person: everyone present, an unspecified audience (broadcasts,
 * notices, posts), and the speaker themself (thinking aloud). Speech rules can name them as the
 * listener too ("Mira → group"). A listener nobody could tell is null (an AI null = looked, unsure).
 */
export const SPECIAL_LISTENERS = { group: '여럿', public: '불특정 다수', self: '혼잣말' } as const;
export type SpecialListener = keyof typeof SPECIAL_LISTENERS;
export const isSpecialListener = (name: string | null | undefined): name is SpecialListener => !!name && Object.hasOwn(SPECIAL_LISTENERS, name);
/** A listener as people read it: a name, or the Korean word for a special listener. */
export const listenerLabel = (name: string) => (isSpecialListener(name) ? SPECIAL_LISTENERS[name] : name);

/** Korean speech levels: four formal (하십시오·하오·하게·해라) and two informal (해요·해) ones. */
export const SPEECH_LEVELS = ['hasipsio', 'hao', 'hage', 'haera', 'haeyo', 'hae', 'other'] as const;
export type SpeechLevel = (typeof SPEECH_LEVELS)[number];
export const SPEECH_LEVEL_LABELS: Record<SpeechLevel, string> = {
  hasipsio: '하십시오체',
  hao: '하오체',
  hage: '하게체',
  haera: '해라체',
  haeyo: '해요체',
  hae: '해체(반말)',
  other: '기타',
};
/** For prompts: the level ids with an example ending each. */
export const SPEECH_LEVEL_GUIDE = 'hasipsio (하십시오체: 합니다/합니까/하십시오), hao (하오체: 하오/하구려), hage (하게체: 하네/하게/하는가), haera (해라체: 한다/하느냐/해라/하자), haeyo (해요체: 해요), hae (해체·반말: 해/해?/하지), other';

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
const POLITE_LEVELS: readonly SpeechLevel[] = ['hasipsio', 'hao', 'haeyo'];
const PLAIN_LEVELS: readonly SpeechLevel[] = ['hae', 'haera', 'hage'];

/** The two-axis view of a speech level: 존댓말 (하십시오·하오·해요) or 반말 (해·해라·하게). Null for other/unknown. */
export const politenessOfLevel = (level: SpeechLevel | null): Politeness | null =>
  level && POLITE_LEVELS.includes(level) ? 'polite' : level && PLAIN_LEVELS.includes(level) ? 'plain' : null;

/** Whether the text ends politely or plainly; speakers mix neighbouring levels, so this is the reliable axis. */
export const politenessOf = (text: string): Politeness | null => politenessOfLevel(speechLevelOf(text));
