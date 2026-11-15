import { AGE_BANDS, CHARACTER_ROLES, GENDERS } from './knowledge.ts';
import { formatRulesSchema } from './format-check.ts';
import { exclusionReason, exclusionRulesSchema, LINE_TRANSLATE, type ExclusionReason } from './exclusion.ts';
import { savedWorkflowSchema, templateStatusesSchema, templateTagSchema } from './app-defaults.ts';
import { z } from 'zod';
import { relationshipChangeSchema, SPEECH_LEVELS } from './knowledge.ts';

/**
 * Standard project file. Game-specific extractors convert their output into this
 * shape; the workbench never needs to know the game's internal format.
 * Keys are the extractor's stable ids and are preserved verbatim.
 */
export const IMPORT_FORMAT = 'loca/v1' as const;

export const GROUP_KINDS = ['scene', 'document', 'ui'] as const;
/** A group kind in a word, and as what such a group is called (a document line is one in-game document; its group bundles them, like UI strings). */
export const GROUP_KIND_LABELS = { scene: '장면', document: '문서', ui: 'UI' } as const;
export const SOURCE_GROUP_LABELS = { scene: '장면', ui: 'UI 묶음', document: '문서 묶음' } as const;
export const UNIT_KINDS = ['dialogue', 'document', 'ui'] as const;
/** The kind of a line of a group of this kind that does not say its own. */
export const unitKindOf = (kind: (typeof GROUP_KINDS)[number]): (typeof UNIT_KINDS)[number] => (kind === 'scene' ? 'dialogue' : kind);
/** script: lines; choice: an option the player picks (its text is a line too); the rest carry no text. */
export const GRAPH_NODE_KINDS = ['script', 'choice', 'condition', 'wait', 'event', 'state', 'connector', 'unknown'] as const;
/** Content nodes carry text to translate; control nodes (branches, waits, events…) shape the flow. */
export const CONTENT_KINDS = new Set<string>(['script', 'scene']);
export const isContentKind = (kind: string) => CONTENT_KINDS.has(kind);

export const DOCUMENT_KINDS = ['story', 'world', 'style', 'note'] as const;

const key = z.string().min(1).max(512);
const meta = z.record(z.string(), z.unknown()).optional();

export const importGroupSchema = z.object({
  key,
  kind: z.enum(GROUP_KINDS).default('scene'),
  title: z.string().min(1),
  description: z.string().optional(),
  /** Folder the script list shows this group under, e.g. a chapter or where a document is found. */
  section: z.string().optional(),
  order: z.number().int().optional(),
  meta,
});

export const importUnitSchema = z.object({
  key,
  group: key,
  order: z.number().int().optional(),
  /** Left out, its group's (scene → dialogue, document, ui); given, as given (a scene's narration may be a document). */
  kind: z.enum(UNIT_KINDS).optional(),
  speaker: z.string().optional(),
  /** Who the line is addressed to (a character name), when the game data knows it. */
  listener: z.string().optional(),
  source: z.string(),
  translation: z.string().optional(),
  /** Labels from the game data (category, voiced, a length limit…): they become the project's tags. */
  tags: z.array(z.string().trim().min(1)).default([]),
  /** The line's translation status by name (a project's own export); left out, it starts in the initial status (번역됨 with a translation). */
  status: z.string().trim().min(1).optional(),
  /** The line's memo (a project's own export). */
  note: z.string().optional(),
  /** A person's call on 번역 제외 (a project's own export); left out, the project's rules decide. */
  translate: z.enum(LINE_TRANSLATE).optional(),
  meta,
});

export const importGraphNodeSchema = z.object({
  key,
  /** The game's own node class, e.g. "IfElseState". Described once in graph.nodeTypes. */
  type: z.string().optional(),
  /** Display category. Defaults to nodeTypes[type].kind, else script (has lines) or unknown. */
  kind: z.enum(GRAPH_NODE_KINDS).optional(),
  label: z.string().optional(),
  units: z.array(key).default([]),
  /**
   * The group (scene) this node belongs to when it has no lines of its own, e.g. a conversation's
   * container state whose connections lead to other conversations. Defaults to its first line's group.
   */
  group: key.optional(),
  meta,
});

/** What each original node class means, written by the game's converter (not by the workbench). */
export const nodeTypeSchema = z.object({
  kind: z.enum(GRAPH_NODE_KINDS),
  label: z.string().min(1),
  description: z.string().default(''),
});

export const importGraphEdgeSchema = z.object({
  from: key,
  to: key,
  kind: z.string().optional(),
  label: z.string().optional(),
});

export const importCharacterSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  profile: z.string().default(''),
  /** How the character talks in the source. */
  speech: z.string().default(''),
  /** The player character (e.g. a silent protagonist that lines are addressed to). */
  player: z.boolean().default(false),
  /** The color the character's name is shown in (#rrggbb, as tags); '' = none. */
  color: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).default(''),
  /** male, female, other (neither: an android, a spirit), or unknown. */
  gender: z.enum(GENDERS).default('unknown'),
  /** child, teen, young (adult), middle(-aged), old, or unknown. */
  ageBand: z.enum(AGE_BANDS).default('unknown'),
  /** How central the character is to the story. */
  role: z.enum(CHARACTER_ROLES).default('unknown'),
});

export const importRelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().default(''),
  mutual: z.boolean().default(false),
  changes: z.array(relationshipChangeSchema).default([]),
});

export const importEventSchema = z.object({
  title: z.string().min(1),
  summary: z.string().default(''),
  cause: z.string().default(''),
  outcome: z.string().default(''),
  participants: z.array(z.string()).default([]),
  evidence: z.array(key).default([]),
});

export const importSpeechRuleSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  level: z.enum(SPEECH_LEVELS),
  address: z.string().default(''),
  note: z.string().default(''),
  /** The rule applies from this line on; omitted = from the beginning. */
  start: key.optional(),
});

export const importDocumentSchema = z.object({
  title: z.string().min(1),
  kind: z.enum(DOCUMENT_KINDS).default('note'),
  body: z.string().default(''),
  alwaysInclude: z.boolean().default(false),
});

export const importTermSchema = z.object({
  source: z.string().min(1),
  target: z.string().default(''),
  note: z.string().default(''),
});

/** A new project's own facts: what the app's 새 프로젝트, `loca projects create` and a file's `project` all give. */
export const newProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(''),
  sourceLanguage: z.string().trim().min(2).default('en'),
  targetLanguage: z.string().trim().min(2).default('ko'),
});
export type NewProject = z.infer<typeof newProjectSchema>;

/** What a file's parts point at by key or name, and what each kind is called in a message. */
export const FILE_REFERENCE_LABELS = { group: '묶음', unit: '대사', node: '노드', character: '인물' } as const;
export type FileReferenceKind = keyof typeof FILE_REFERENCE_LABELS;
export interface FileReference {
  path: (string | number)[];
  to: FileReferenceKind;
  key: string;
}

const fileShape = z.object({
  format: z.literal(IMPORT_FORMAT),
  groups: z.array(importGroupSchema).default([]),
  units: z.array(importUnitSchema).min(1),
  graph: z
    .object({
      nodeTypes: z.record(z.string(), nodeTypeSchema).default({}),
      nodes: z.array(importGraphNodeSchema),
      edges: z.array(importGraphEdgeSchema),
    })
    .optional(),
  characters: z.array(importCharacterSchema).default([]),
  relationships: z.array(importRelationshipSchema).default([]),
  documents: z.array(importDocumentSchema).default([]),
  terms: z.array(importTermSchema).default([]),
  events: z.array(importEventSchema).default([]),
  speechRules: z.array(importSpeechRuleSchema).default([]),
  /**
   * A project's own export (프로젝트 파일로 내보내기) carries its set-up too: the statuses in order, the tags, the workflows
   * with what their ids stand for (refs, by name). A project made from the file starts with these instead of the 홈 설정's.
   * Adding such a file to a project that has its own uses only its lines' status names (they must be the project's).
   */
  statuses: templateStatusesSchema.optional(),
  tags: z.array(templateTagSchema).optional(),
  workflows: z.array(savedWorkflowSchema).optional(),
});
const projectFacts = newProjectSchema.extend({
  /** Placeholder / tag families in this game's strings; the extractor knows them best. */
  formatRules: formatRulesSchema.optional(),
  /** 번역 제외 rules (a project's own export). */
  exclusionRules: exclusionRulesSchema.optional(),
});
type FileBody = z.infer<typeof fileShape>;

/** Every key or name one part of the file gives for another: a line's group, a node's lines, a relationship's people… */
function fileReferences(file: FileBody): FileReference[] {
  const refs: FileReference[] = [];
  const ref = (path: (string | number)[], to: FileReferenceKind, key: string) => refs.push({ path, to, key });
  file.units.forEach((unit, index) => ref(['units', index, 'group'], 'group', unit.group));
  file.graph?.nodes.forEach((node, index) => {
    node.units.forEach((unit) => ref(['graph', 'nodes', index, 'units'], 'unit', unit));
    if (node.group) ref(['graph', 'nodes', index, 'group'], 'group', node.group);
  });
  file.graph?.edges.forEach((edge, index) => {
    ref(['graph', 'edges', index, 'from'], 'node', edge.from);
    ref(['graph', 'edges', index, 'to'], 'node', edge.to);
  });
  file.relationships.forEach((rel, index) => {
    ref(['relationships', index, 'from'], 'character', rel.from);
    ref(['relationships', index, 'to'], 'character', rel.to);
    rel.changes.forEach((change, at) => ref(['relationships', index, 'changes', at, 'at'], 'unit', change.at));
  });
  file.speechRules.forEach((rule, index) => rule.start && ref(['speechRules', index, 'start'], 'unit', rule.start));
  file.events.forEach((event, index) => event.evidence.forEach((key, at) => ref(['events', index, 'evidence', at], 'unit', key)));
  return refs;
}

/** The keys and names the file itself has, by kind. */
function fileKeys(file: FileBody): Record<FileReferenceKind, Set<string>> {
  return {
    group: new Set(file.groups.map((group) => group.key)),
    unit: new Set(file.units.map((unit) => unit.key)),
    node: new Set((file.graph?.nodes ?? []).map((node) => node.key)),
    character: new Set(file.characters.flatMap((character) => [character.name, ...character.aliases])),
  };
}

/** The references neither the file nor `known` (the project's own keys, when the file adds to one) has. */
export function unresolvedReferences(file: FileBody, known?: Record<FileReferenceKind, Set<string>>): FileReference[] {
  const own = fileKeys(file);
  return fileReferences(file).filter((ref) => !own[ref.to].has(ref.key) && !known?.[ref.to].has(ref.key));
}

/** Checks that need the whole file: no key twice, one term per source; with `closed`, every reference is in the file. */
function checkFile(file: FileBody, ctx: z.RefinementCtx, closed: boolean) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const unique = (items: { key: string }[], path: string[]) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.key)) issue([...path, index, 'key'], `중복된 key: ${item.key}`);
      seen.add(item.key);
    });
  };
  // One term per source whatever its case (the glossary is unique that way).
  const termSources = new Set<string>();
  file.terms.forEach((term, index) => {
    const lower = term.source.trim().toLowerCase();
    if (termSources.has(lower)) issue(['terms', index, 'source'], `중복된 용어: ${term.source}`);
    termSources.add(lower);
  });
  unique(file.groups, ['groups']);
  unique(file.units, ['units']);
  if (file.graph) unique(file.graph.nodes, ['graph', 'nodes']);
  // A line's status names one of the file's statuses when the file brings them (a new project starts with only those).
  if (closed && file.statuses) {
    const statuses = new Set(file.statuses.map((status) => status.name));
    file.units.forEach((unit, index) => unit.status && !statuses.has(unit.status) && issue(['units', index, 'status'], `없는 상태: ${unit.status}`));
  }
  if (closed) for (const ref of unresolvedReferences(file)) issue(ref.path, `없는 ${FILE_REFERENCE_LABELS[ref.to]}: ${ref.key}`);
}

/** A file that makes a new project: its own facts, and everything it points at is in it. */
export const importFileSchema = fileShape
  .extend({ project: projectFacts, groups: z.array(importGroupSchema).min(1) })
  .superRefine((file, ctx) => checkFile(file, ctx, true));

/**
 * A file added to an existing project (원문 추가, e.g. the UI strings after the dialogue): `project` may be left
 * out, and its lines, nodes and relationships may point at the project's own groups, lines, nodes and people by
 * key or name. Those references are checked against the project (diffSource), not here.
 */
export const sourceFileSchema = fileShape.extend({ project: projectFacts.optional() }).superRefine((file, ctx) => checkFile(file, ctx, false));
/**
 * add_source's input: a file to add, and the formats its new lines use that the project's rules lack to turn on with
 * it (FormatOffer ids from the diff; [] to add without them). Left out while there are such formats, the add is
 * refused until someone decides. `update`: the keys the project has that the file gives otherwise are changed too.
 */
export const addSourceSchema = fileShape
  .extend({
    project: projectFacts.optional(),
    formats: z.array(z.string().min(1)).max(50).optional(),
    /** Also change what the project has otherwise under the same key (a patched source, a renamed group); left out, it stays. */
    update: z.boolean().default(false),
    /** The file's name, for the 원문 넣기 log. */
    name: z.string().trim().max(200).optional(),
  })
  .superRefine((file, ctx) => checkFile(file, ctx, false));
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type AddSourceInput = z.infer<typeof addSourceSchema>;

export type ImportFile = z.infer<typeof importFileSchema>;

/** The standard file as JSON Schema, for converter authors (`loca format schema`). Cross-reference checks are not expressible there. */
export const importFileJsonSchema = () => z.toJSONSchema(importFileSchema, { io: 'input', unrepresentable: 'any' });

/** Counts for a validated file, shown before import (app and `loca format check`). */
export function summarizeImport(file: ImportFile) {
  // 번역 제외 under the default rules (the project's own rules start as the defaults).
  const excludedBy: Partial<Record<ExclusionReason, number>> = {};
  for (const unit of file.units) {
    const reason = exclusionReason(unit.source, file.project.formatRules, undefined, file.project.sourceLanguage);
    if (reason) excludedBy[reason] = (excludedBy[reason] ?? 0) + 1;
  }
  return {
    excluded: Object.values(excludedBy).reduce((sum, count) => sum + count, 0),
    excludedBy,
    name: file.project.name,
    groups: file.groups.length,
    units: file.units.length,
    graphNodes: file.graph?.nodes.length ?? 0,
    graphEdges: file.graph?.edges.length ?? 0,
    characters: file.characters.length,
    documents: file.documents.length,
    terms: file.terms.length,
    events: file.events.length,
    speechRules: file.speechRules.length,
    listeners: file.units.filter((unit) => unit.listener).length,
  };
}

/**
 * Valid but probably not what the converter meant. Not errors: some games really have these.
 * Each warning carries a few example keys so the converter's author can look them up.
 */
export function importWarnings(file: ImportFile): { message: string; examples: string[] }[] {
  const warnings: { message: string; examples: string[] }[] = [];
  if (file.graph) {
    const placed = new Set(file.graph.nodes.flatMap((node) => node.units));
    const scenes = new Set(file.groups.filter((group) => group.kind === 'scene').map((group) => group.key));
    const loose = file.units.filter((unit) => scenes.has(unit.group) && !placed.has(unit.key));
    if (loose.length) warnings.push({ message: `그래프 노드에 들어가지 않은 장면 대사 ${loose.length}개: 앞 대사 문맥을 장면 순서로만 찾습니다`, examples: loose.slice(0, 5).map((unit) => unit.key) });
  }
  if (file.characters.length) {
    const names = new Set(file.characters.flatMap((character) => [character.name, ...character.aliases]));
    const unknown = [...new Set(file.units.flatMap((unit) => (unit.speaker && !names.has(unit.speaker) ? [unit.speaker] : [])))];
    if (unknown.length) warnings.push({ message: `인물 목록에 없는 화자 ${unknown.length}명: 프로필·관계가 문맥에 붙지 않습니다`, examples: unknown.slice(0, 5) });
  }
  return warnings;
}
export type NodeType = z.infer<typeof nodeTypeSchema>;
export type ImportFileInput = z.input<typeof importFileSchema>;

/**
 * A PATCH schema: every field optional and *without* its default, so a partial update never
 * overwrites fields the client did not send (zod's .partial() keeps defaults).
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>): ReturnType<z.ZodObject<T>['partial']> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, (field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : (field as z.ZodType)).optional()]),
  );
  return z.object(shape) as unknown as ReturnType<z.ZodObject<T>['partial']>;
}
