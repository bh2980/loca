import { z } from 'zod';

/**
 * Standard project file. Game-specific extractors convert their output into this
 * shape; the workbench never needs to know the game's internal format.
 * Keys are the extractor's stable ids and are preserved verbatim.
 */
export const IMPORT_FORMAT = 'translation-workbench/v1' as const;

export const GROUP_KINDS = ['scene', 'document', 'ui'] as const;
export const UNIT_KINDS = ['dialogue', 'document', 'ui'] as const;
export const GRAPH_NODE_KINDS = ['script', 'condition', 'wait', 'event', 'state', 'connector', 'unknown'] as const;
export const DOCUMENT_KINDS = ['story', 'world', 'style', 'note'] as const;

const key = z.string().min(1).max(512);
const meta = z.record(z.string(), z.unknown()).optional();

export const importGroupSchema = z.object({
  key,
  kind: z.enum(GROUP_KINDS).default('scene'),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().optional(),
  meta,
});

export const importUnitSchema = z.object({
  key,
  group: key,
  order: z.number().int().optional(),
  kind: z.enum(UNIT_KINDS).default('dialogue'),
  speaker: z.string().optional(),
  source: z.string(),
  translation: z.string().optional(),
  meta,
});

export const importGraphNodeSchema = z.object({
  key,
  kind: z.enum(GRAPH_NODE_KINDS).default('script'),
  label: z.string().optional(),
  units: z.array(key).default([]),
  meta,
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
});

export const importRelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().default(''),
  mutual: z.boolean().default(false),
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

export const importFileSchema = z
  .object({
    format: z.literal(IMPORT_FORMAT),
    project: z.object({
      name: z.string().min(1),
      description: z.string().default(''),
      sourceLanguage: z.string().min(2).default('en'),
      targetLanguage: z.string().min(2).default('ko'),
    }),
    groups: z.array(importGroupSchema).min(1),
    units: z.array(importUnitSchema).min(1),
    graph: z
      .object({ nodes: z.array(importGraphNodeSchema), edges: z.array(importGraphEdgeSchema) })
      .optional(),
    characters: z.array(importCharacterSchema).default([]),
    relationships: z.array(importRelationshipSchema).default([]),
    documents: z.array(importDocumentSchema).default([]),
    terms: z.array(importTermSchema).default([]),
  })
  .superRefine((file, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const unique = (items: { key: string }[], path: string) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.key)) issue([path, index, 'key'], `중복된 key: ${item.key}`);
        seen.add(item.key);
      });
      return seen;
    };
    const groups = unique(file.groups, 'groups');
    const units = unique(file.units, 'units');
    file.units.forEach((unit, index) => {
      if (!groups.has(unit.group)) issue(['units', index, 'group'], `없는 group: ${unit.group}`);
    });
    if (file.graph) {
      const nodes = unique(file.graph.nodes, 'graph.nodes');
      file.graph.nodes.forEach((node, index) =>
        node.units.forEach((unit) => {
          if (!units.has(unit)) issue(['graph', 'nodes', index, 'units'], `없는 unit: ${unit}`);
        }),
      );
      file.graph.edges.forEach((edge, index) => {
        if (!nodes.has(edge.from)) issue(['graph', 'edges', index, 'from'], `없는 node: ${edge.from}`);
        if (!nodes.has(edge.to)) issue(['graph', 'edges', index, 'to'], `없는 node: ${edge.to}`);
      });
    }
    const names = new Set(file.characters.flatMap((c) => [c.name, ...c.aliases]));
    file.relationships.forEach((rel, index) => {
      if (!names.has(rel.from)) issue(['relationships', index, 'from'], `없는 인물: ${rel.from}`);
      if (!names.has(rel.to)) issue(['relationships', index, 'to'], `없는 인물: ${rel.to}`);
    });
  });

export type ImportFile = z.infer<typeof importFileSchema>;
export type ImportFileInput = z.input<typeof importFileSchema>;
