import { z } from 'zod';
import { agentSettingsSchema } from './agent.ts';
import { DEFAULT_STATUSES, DEFAULT_TAG_COLOR, HEX_COLOR, STATUS_COLORS, WORKFLOW_TEMPLATES, type StatusKind, type TemplateIds } from './defaults.ts';
import { editorAiSchema } from './editor-ai.ts';
import { normalizeTagScopes, TAG_SCOPES } from './marks.ts';
import { workflowDefinitionSchema } from './workflow.ts';

/**
 * 홈 설정: what a new project starts with (docs/DESIGN-APP-SETTINGS-2026-10-27.md). It is copied once
 * when a project is made; afterwards the project keeps its own values and a change here touches no
 * existing project. The home's connections are rows of the connections table with no project.
 */

/** A status a new project gets; `id` only ties the home's saved workflows to it (the project's status gets a new id). */
export const templateStatusSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX_COLOR).default(STATUS_COLORS[0]),
  kind: z.enum(['initial', 'normal', 'final']).default('normal'),
  inReview: z.boolean().default(false),
});
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

/** A person's own tag a new project gets (the app's tags, such as AI 실패, every project gets anyway). */
export const templateTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX_COLOR).default(DEFAULT_TAG_COLOR),
  description: z.string().trim().max(300).default(''),
  scope: z
    .array(z.enum(TAG_SCOPES))
    .min(1)
    .transform((scope) => normalizeTagScopes(scope))
    .default(['lines', 'terms', 'people', 'documents', 'events']),
});
export type TemplateTag = z.infer<typeof templateTagSchema>;

/**
 * What an id inside a saved workflow stood for in the project it came from. A copy finds the same
 * name in the new project (a status also by its kind and review flag); one it cannot find is left
 * empty and the workflow's validation asks the person to pick.
 */
export const savedRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), name: z.string(), statusKind: z.enum(['initial', 'normal', 'final']), inReview: z.boolean() }),
  z.object({ kind: z.literal('tag'), name: z.string() }),
  z.object({ kind: z.literal('connection'), name: z.string() }),
]);
export type SavedRef = z.infer<typeof savedRefSchema>;

/** A project's workflow kept as a home default ("홈 기본값으로 저장"): its definition as it was, and what its ids stood for. */
export const savedWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().default(''),
  definition: workflowDefinitionSchema,
  refs: z.record(z.string(), savedRefSchema).default({}),
});
export type SavedWorkflow = z.infer<typeof savedWorkflowSchema>;

const TEMPLATE_KEYS = WORKFLOW_TEMPLATES.map((template) => template.key) as [string, ...string[]];
/** The templates a project starts with: the first five (번역, 검수, 청자 추정, 인물·관계 추출, 사건 추출). */
export const DEFAULT_TEMPLATE_KEYS = WORKFLOW_TEMPLATES.slice(0, 5).map((template) => template.key);

export const DEFAULT_TEMPLATE_STATUSES: TemplateStatus[] = DEFAULT_STATUSES.map(({ key, name, color, kind, inReview }) => ({ id: key, name, color, kind, inReview }));

export const templateStatusesSchema = z
  .array(templateStatusSchema)
  .superRefine((list, ctx) => {
    if (!list.some((status) => status.kind === 'initial')) ctx.addIssue({ code: 'custom', message: '처음 상태는 하나 이상 있어야 합니다.' });
    if (!list.some((status) => status.kind === 'final')) ctx.addIssue({ code: 'custom', message: '완료 상태는 하나 이상 있어야 합니다.' });
    const names = new Set<string>();
    for (const status of list) {
      if (names.has(status.name)) ctx.addIssue({ code: 'custom', message: `상태 이름이 겹칩니다: ${status.name}` });
      names.add(status.name);
    }
  });

export const appDefaultsSchema = z.object({
  editorAi: editorAiSchema.prefault({}),
  agentSettings: agentSettingsSchema.prefault({}),
  aiAutoConfirm: z.boolean().default(true),
  statuses: templateStatusesSchema.default(DEFAULT_TEMPLATE_STATUSES),
  tags: z.array(templateTagSchema).default([]),
  workflows: z
    .object({
      /** Templates (WORKFLOW_TEMPLATES keys) a new project starts with, in this order. */
      templates: z.array(z.enum(TEMPLATE_KEYS)).default(DEFAULT_TEMPLATE_KEYS),
      saved: z.array(savedWorkflowSchema).default([]),
    })
    .prefault({}),
});
export type AppDefaults = z.infer<typeof appDefaultsSchema>;
const PATCHABLE = ['editorAi', 'agentSettings', 'aiAutoConfirm', 'statuses', 'tags', 'workflows'] as const;
/**
 * A change to some sections: only the sections sent are parsed and returned. Not
 * `appDefaultsSchema.partial()` (nor `.optional()` per field): Zod 4 still fills a section left out
 * with its default, and the save would reset it.
 */
export const appDefaultsPatchSchema = z
  .custom<Partial<z.input<typeof appDefaultsSchema>>>((value) => !!value && typeof value === 'object' && !Array.isArray(value), '객체여야 합니다.')
  .transform((raw, ctx) => {
    const patch: Partial<AppDefaults> = {};
    for (const key of PATCHABLE) {
      if (!(key in raw)) continue;
      const parsed = appDefaultsSchema.shape[key].safeParse((raw as Record<string, unknown>)[key]);
      if (parsed.success) Object.assign(patch, { [key]: parsed.data });
      else for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: [key, ...issue.path], message: issue.message });
    }
    return patch;
  });
export const APP_DEFAULT_SECTIONS = ['connections', 'editorAi', 'agentSettings', 'prompts', 'aiAutoConfirm', 'statuses', 'tags', 'workflows'] as const;
export type AppDefaultSection = (typeof APP_DEFAULT_SECTIONS)[number];
export const APP_DEFAULT_SECTION_LABELS: Record<AppDefaultSection, string> = {
  connections: '연결',
  editorAi: '에디터 AI',
  agentSettings: '채팅 (권한·모델·권한 모드)',
  prompts: '저장한 지시',
  aiAutoConfirm: 'AI 결과 바로 확정',
  statuses: '상태',
  tags: '태그',
  workflows: '워크플로',
};

/** The statuses a template fills, picked from a project's statuses by kind and review flag (never by name). */
export function templateStatusIds(statuses: { id: string; kind: StatusKind; inReview: boolean }[]): Omit<TemplateIds, 'model' | 'aiFailedTag'> {
  const normal = statuses.filter((status) => status.kind === 'normal');
  return {
    untranslated: statuses.find((status) => status.kind === 'initial')?.id,
    confirmed: statuses.find((status) => status.kind === 'final')?.id,
    needsReview: normal.find((status) => status.inReview)?.id,
    translated: normal.find((status) => !status.inReview)?.id,
  };
}

/**
 * Every string in `value` that is a key of `ids` replaced by its value; an id mapped to '' is dropped
 * from an array it sits in and left empty elsewhere (a field validation then asks about). Ids are
 * UUIDs, so no other text matches one.
 */
export function remapIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return ids.has(node) ? ids.get(node) : node;
    if (Array.isArray(node)) return node.flatMap((item) => (typeof item === 'string' && ids.get(item) === '' ? [] : [visit(item)]));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, visit(item)]));
    return node;
  };
  return visit(value) as T;
}
