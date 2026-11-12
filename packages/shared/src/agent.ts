import { z } from 'zod';
import { agentPermissionsSchema } from './agent-permissions.ts';
import { modelChoiceSchema } from './model-choice.ts';

/**
 * How a conversation's changes are decided (#45). Every change becomes a proposal row either way, so
 * the agent hears the result the same way and the change log is one.
 */
export const PERMISSION_MODES = ['ask', 'auto', 'bypass'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PERMISSION_MODE_INFO: Record<PermissionMode, { label: string; description: string }> = {
  ask: { label: '매번 묻기', description: '변경마다 카드로 묻고, 사람이 수락하거나 거절합니다.' },
  auto: { label: '자동 검토', description: '검사를 통과한 작은 변경은 바로 반영하고, 큰 일괄 변경·삭제·실행(비용)·경고가 있는 변경만 묻습니다.' },
  bypass: { label: '바로 반영', description: '허용한 작업을 확인 없이 반영합니다. 변경 기록은 남고 되돌릴 수 있습니다.' },
};

/** 저장한 지시: a prompt kept per project and called from the chat box's / list (it fills the box, the person sends it; a `{대상}` in it opens the @ picker there). */
export const savedPromptSchema = z.object({
  /** What follows the slash: no spaces, no leading slash. Korean is fine. */
  name: z
    .string()
    .trim()
    .min(1, '이름을 입력하세요.')
    .max(30, '이름은 30자까지입니다.')
    .regex(/^[^\s/]+$/u, '이름에는 공백과 /를 쓸 수 없습니다.'),
  text: z.string().trim().min(1, '지시 내용을 입력하세요.').max(8000, '지시는 8,000자까지입니다.'),
});
export type SavedPrompt = z.infer<typeof savedPromptSchema>;
export const savedPromptsSchema = z.array(savedPromptSchema).max(100).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((prompt, index) => {
    const key = prompt.name.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'name'], message: `이름이 겹칩니다: ${prompt.name}` });
    seen.add(key);
  });
});

export const agentSettingsSchema = z.object({
  /** Per-resource operations the agent may do (chat and CLI); what is not set is allowed, except deleting. */
  permissions: agentPermissionsSchema.optional(),
  /** The model a new conversation talks to; unset, it takes the one the latest conversation picked. */
  chatModel: modelChoiceSchema.nullable().default(null),
  /** The permission mode a new conversation starts in. */
  defaultPermissionMode: z.enum(PERMISSION_MODES).default('ask'),
  /** How changes from the terminal (`loca`, an agent with a shell) are decided; it has no conversation of its own. */
  terminalPermissionMode: z.enum(PERMISSION_MODES).default('ask'),
  /** 저장한 지시: /name in the chat box inserts the text. */
  prompts: savedPromptsSchema.default([]),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/**
 * A conversation's name from its first message, without a model call: the first sentence, the
 * request ending and filler words dropped ("지금 진행 상황을 요약해줘" → "진행 상황 요약"), so the
 * title names the topic instead of repeating the message shown right below it. At most 24 characters.
 */
export function chatTitle(text: string): string {
  const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.?!。？！])\s|\n/)[0] ?? '';
  let title = first.replace(/[.?!。？！~…]+$/u, '').trim();
  title = title.replace(/^(지금|좀|혹시|그럼|이제|그리고|음|저기|please|can you|could you)\s+/iu, '');
  title = title
    .replace(/\s*(해\s?줘|해\s?주세요|해\s?줄래|해\s?줄\s?수\s?있어|해\s?봐|해\s?볼래|하자|할래|해라|해요|줘|주세요|줄래|부탁해|부탁드려요)$/u, '')
    .replace(/(을|를)$/u, '')
    .trim();
  // "요약" left after dropping "해줘" from "요약해줘"; an object particle before it reads better without.
  title = title.replace(/(\S+)(을|를) (\S+)$/u, '$1 $3');
  if (!title) title = first.trim() || '새 대화';
  return title.length > 24 ? `${title.slice(0, 23).trimEnd()}…` : title;
}
