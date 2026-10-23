import { z } from 'zod';

/**
 * What the chat's @ can point at (docs/CHAT-INPUT-DESIGN.md 2-1). The kind is the label people read,
 * the same word pages report with useReportView, and the word that narrows the picker (`@인물 lo`).
 */
export const ATTACH_KINDS = ['대사', '장면', '인물', '관계', '말투 규칙', '사건', '노트', '용어', '태그', '상태', '워크플로', '실행 기록'] as const;
export type AttachKind = (typeof ATTACH_KINDS)[number];
export const isAttachKind = (value: string): value is AttachKind => (ATTACH_KINDS as readonly string[]).includes(value);

/** Short words that also narrow to a kind when typed after the @ (the list still shows the full name). */
export const ATTACH_KIND_ALIASES: Record<string, AttachKind> = { 말투: '말투 규칙', 실행: '실행 기록', 문서: '노트', 규칙: '말투 규칙' };

/** Top matches per kind in the combined list, and the page size once one kind is picked. */
export const ATTACH_PER_KIND = 3;
export const ATTACH_PAGE = 20;

/** One thing @ can attach: `href` is where its page is (a path with its search params). */
export const attachItemSchema = z.object({
  kind: z.enum(ATTACH_KINDS),
  id: z.string(),
  label: z.string(),
  /** The second column of the list row (a key, a count, a short summary); also told to the model. */
  detail: z.string().optional(),
  href: z.string(),
});
export type AttachItem = z.infer<typeof attachItemSchema>;

/** The search answer: matches grouped by kind; `more` says another page follows. */
export interface AttachSearchResult {
  groups: { kind: AttachKind; items: AttachItem[]; more: boolean }[];
}

/**
 * What a /workflow run can be pointed at (the run dialog's scopes): scenes, lines, tags, statuses and
 * people (their lines) for a lines workflow, terms for a terms workflow.
 */
export const RUN_SCOPE_KINDS: Record<'lines' | 'terms', readonly AttachKind[]> = {
  lines: ['장면', '대사', '태그', '상태', '인물'],
  terms: ['용어'],
};
/** Scenes and lines (and a person's lines) are alternative targets: the scope ANDs, so mixing them would silently narrow it. */
export const RUN_TARGET_KINDS: readonly AttachKind[] = ['장면', '대사', '인물'];

/** The kinds still on offer once some are picked for a run: one target family at a time, tags and statuses as filters. */
export function runKindsLeft(input: 'lines' | 'terms', picked: readonly { kind: string }[]): readonly AttachKind[] {
  const all = RUN_SCOPE_KINDS[input];
  const target = picked.find((item) => (RUN_TARGET_KINDS as readonly string[]).includes(item.kind))?.kind;
  if (!target) return all;
  const sceneFamily = target === '장면';
  return all.filter((kind) => !(RUN_TARGET_KINDS as readonly string[]).includes(kind) || (kind === '장면') === sceneFamily);
}

/** The `{대상}` place in a saved prompt: inserting the prompt opens the @ picker there. */
export const PROMPT_TARGET = '{대상}';

/** Replaces the first `{대상}` with what the pick is called; text without one is returned as it was. */
export function fillPromptTarget(text: string, label: string): string {
  const at = text.indexOf(PROMPT_TARGET);
  return at < 0 ? text : text.slice(0, at) + label + text.slice(at + PROMPT_TARGET.length);
}

/** What a chip says in the box and in the sent message: the kind and a short name. */
export const shortLabel = (label: string, max = 24) => {
  const plain = label.replace(/^asset-[a-f0-9-]+\s*·\s*/i, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

/** A chip kept with the message it was sent with (message.metadata.chips). */
export const chatChipSchema = z.object({ kind: z.string(), id: z.string(), label: z.string(), detail: z.string().optional(), href: z.string().optional() });
export type ChatChip = z.infer<typeof chatChipSchema>;

/** The chips a stored message carries (none for older messages or anything malformed). */
export function messageChips(message: { metadata?: unknown }): ChatChip[] {
  const raw = (message.metadata as { chips?: unknown } | undefined)?.chips;
  const parsed = z.array(chatChipSchema).max(40).safeParse(raw);
  return parsed.success ? parsed.data : [];
}
