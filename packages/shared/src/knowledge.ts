import { z } from 'zod';

/** AI drafts are candidates until a person confirms them; only confirmed knowledge reaches AI nodes. */
export const KNOWLEDGE_STATUSES = ['candidate', 'confirmed'] as const;
export const KNOWLEDGE_ORIGINS = ['human', 'ai', 'import'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];
export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = { candidate: '후보', confirmed: '확정' };
export const KNOWLEDGE_ORIGIN_LABELS: Record<KnowledgeOrigin, string> = { human: '사람', ai: 'AI', import: '가져오기' };

/** Where a line's listener came from. A person's choice always wins over the AI's. */
export const LISTENER_ORIGINS = ['import', 'ai', 'human'] as const;
export type ListenerOrigin = (typeof LISTENER_ORIGINS)[number];
/** AI listeners below this confidence count as unknown (experiment sample: 99% right at >= 0.9). */
export const LISTENER_MIN_CONFIDENCE = 0.9;

export const SPEECH_LEVELS = ['banmal', 'haeyo', 'hasipsio', 'other'] as const;
export type SpeechLevel = (typeof SPEECH_LEVELS)[number];
export const SPEECH_LEVEL_LABELS: Record<SpeechLevel, string> = { banmal: '반말', haeyo: '해요체', hasipsio: '하십시오체', other: '기타' };

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
  if (/(습니다|습니까|십시오|니다|니까|시오)$/u.test(plain)) return 'hasipsio';
  if (/요$/u.test(plain)) return 'haeyo';
  return 'banmal';
}
