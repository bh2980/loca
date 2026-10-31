import { ATTACH_KIND_ALIASES, ATTACH_KINDS, PROMPT_TARGET, type AttachKind, type SavedPrompt } from '@tw/shared';

/** An `@query` being typed: where it starts in the box and everything between the @ and the caret. */
export interface AtTrigger {
  start: number;
  query: string;
}

/** The words that narrow `@` to one kind when followed by a space (`@인물 lo`), longest first so `말투 규칙` wins over `말투`. */
const KIND_WORDS: [string, AttachKind][] = [...ATTACH_KINDS.map((kind): [string, AttachKind] => [kind, kind]), ...Object.entries(ATTACH_KIND_ALIASES)].sort((a, b) => b[0].length - a[0].length);

/**
 * What an `@` query says: the kind it narrows to (the kind's name followed by a space) and the search
 * text after it. `@lo` searches every kind for "lo"; `@인물 lo` only people; `@인물 ` lists people.
 */
export function parseAtQuery(query: string, allowed: readonly AttachKind[] = ATTACH_KINDS): { kind: AttachKind | null; term: string } {
  for (const [word, kind] of KIND_WORDS) {
    if (!allowed.includes(kind) || !query.startsWith(word)) continue;
    const rest = query.slice(word.length);
    if (/^\s/.test(rest)) return { kind, term: rest.replace(/^\s+/, '') };
  }
  return { kind: null, term: query };
}

/**
 * The @-mention the caret is in: an @ at the start of the box or after whitespace, with no whitespace
 * between it and the caret, except after a kind's name (`@인물 lo`, a search inside that kind, on one
 * line). Mid-word (a@b, an e-mail) is not a mention. Text still being composed by an IME is part of
 * the value, so a half-typed Hangul query counts.
 */
export function findAtTrigger(value: string, caret: number): AtTrigger | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\n/.test(query)) return null;
  if (/\s/.test(query) && !parseAtQuery(query).kind) return null;
  return { start: at, query };
}

/** Takes the `@query` out of the box (and one space it leaves doubled); returns the new text and caret. */
export function removeAtTrigger(value: string, trigger: AtTrigger, caret: number): { value: string; caret: number } {
  const before = value.slice(0, trigger.start);
  let after = value.slice(caret);
  if (/\s$/.test(before) && /^\s/.test(after) && before.length > 0) after = after.slice(1);
  return { value: before + after, caret: before.length };
}

/** Puts `text` in place of the `@query` (a `{대상}` slot takes the pick's short name); returns the new text and caret after it. */
export function replaceAtTrigger(value: string, trigger: AtTrigger, caret: number, text: string): { value: string; caret: number } {
  return { value: value.slice(0, trigger.start) + text + value.slice(caret), caret: trigger.start + text.length };
}

/** Rewrites the `@query` to narrow it to a kind (`@인물 `), keeping the search text; with no kind, back to the plain `@term`. */
export function narrowAtTrigger(value: string, trigger: AtTrigger, caret: number, kind: AttachKind | null, term: string): { value: string; caret: number } {
  return replaceAtTrigger(value, trigger, caret, `@${kind ? `${kind} ` : ''}${term}`);
}

/**
 * The first `{대상}` in a saved prompt becomes an `@` with the caret after it, so the picker opens at that
 * spot; null when there is none. `start` is where the @ sits.
 */
export function openNextTarget(text: string): { value: string; caret: number; start: number } | null {
  const start = text.indexOf(PROMPT_TARGET);
  if (start < 0) return null;
  return { value: `${text.slice(0, start)}@${text.slice(start + PROMPT_TARGET.length)}`, caret: start + 1, start };
}

/** A command being typed: `/` at the very start of the box, on one line; everything after it is the name filter (workflow names have spaces). */
export function findSlashTrigger(value: string, caret: number): { query: string } | null {
  if (!value.startsWith('/') || caret < 1) return null;
  const query = value.slice(1, caret);
  return /\n/.test(query) ? null : { query };
}

export interface WorkflowCommand {
  kind: 'workflow';
  id: string;
  name: string;
  description: string;
  /** What it takes in: decides which things can be picked as its target. */
  input: 'lines' | 'terms';
  /** Why it cannot run now (the run dialog does not offer workflows with errors). */
  blocked?: string;
}
export interface PromptCommand {
  kind: 'prompt';
  id: string;
  name: string;
  description: string;
  text: string;
}
export type Command = WorkflowCommand | PromptCommand;

/** The list for `/`: the project's workflows, then its saved prompts. The app has no commands of its own. */
export function allCommands(
  workflows: readonly { id: string; name: string; description: string; input: 'lines' | 'terms'; errorCount?: number }[],
  prompts: readonly SavedPrompt[],
): Command[] {
  return [
    ...workflows.map((workflow): Command => ({ kind: 'workflow', id: workflow.id, name: workflow.name, description: workflow.description, input: workflow.input, ...(workflow.errorCount ? { blocked: `워크플로에 오류가 ${workflow.errorCount}개 있어 실행할 수 없습니다.` } : {}) })),
    ...prompts.map((prompt): Command => ({ kind: 'prompt', id: `prompt:${prompt.name}`, name: prompt.name, description: prompt.text.replace(/\s+/g, ' ').slice(0, 60), text: prompt.text })),
  ];
}

/** Commands whose name starts with what was typed first, then those that contain it; workflows stay above saved prompts within each. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(needle));
  const contains = commands.filter((command) => !starts.includes(command) && command.name.toLowerCase().includes(needle));
  return [...starts, ...contains];
}
