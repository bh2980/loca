import { z } from 'zod';

/**
 * AI drafts are candidates until a person confirms them; only confirmed knowledge reaches AI nodes.
 * A discarded AI item stays as "rejected" so a later analysis does not propose it again.
 */
export const KNOWLEDGE_STATUSES = ['candidate', 'confirmed', 'rejected'] as const;
export const KNOWLEDGE_ORIGINS = ['human', 'ai', 'import'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];
export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = { candidate: '후보', confirmed: '확정', rejected: '버림' };
export const KNOWLEDGE_ORIGIN_LABELS: Record<KnowledgeOrigin, string> = { human: '사람', ai: 'AI', import: '가져오기' };

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

/**
 * The Korean speech level a translation ends in, guessed from its last sentence ending.
 * A heuristic (labelled "추정" wherever it is shown): fragments and quotes may be misread.
 */
export function speechLevelOf(text: string): Exclude<SpeechLevel, 'other'> | null {
  const plain = text
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .trim()
    .replace(/[\s.,!?…~"'”’)\]]+$/u, '');
  if (!/[가-힣]$/u.test(plain)) return null;
  if (/(니다|니까|십시오)$/u.test(plain)) return 'hasipsio';
  if (/요$/u.test(plain)) return 'haeyo';
  if (/(구려|시오|소|오)$/u.test(plain)) return 'hao';
  if (/(는가|던가|게나|세나)$/u.test(plain)) return 'hage';
  // "-냐/-니" questions are 해라체 ("가냐?"), but "아냐/아니" is 해체: only the unambiguous endings count.
  if (/(다|느냐|거라|어라|아라|자)$/u.test(plain)) return 'haera';
  return 'hae';
}
