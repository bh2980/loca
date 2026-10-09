/**
 * Orwell: Ignorance is Strength → an English-only standard file whose scenes are conversations.
 *
 * Reads the extractor's output (never writes to it except the new file named below):
 *   workbench/ignorance-is-strength.json      the extractor's standard file (chapters as scenes)
 *   scenes/conversations/<chapter>/<id>.json  one file per conversation: container state, message
 *                                             nodes and the record ids of its lines in review order
 *   scenes/conversations/index.json           titles and review ranks
 *
 * Changes made, nothing else:
 *   - only lines whose meta.language is "en" are kept (German and unlabelled text stay in the source);
 *   - every conversation becomes its own scene group; its container and message nodes carry
 *     `group`, so scene connections can be derived from the dialogue graph (chapters alone share none);
 *   - chapter lines outside any conversation (profile updates, bookmarks, objectives, mail and
 *     ticker text set by event states) stay in their chapter group, which becomes a UI group:
 *     as a scene it would sit between every pair of conversations;
 *   - groups get a section for the script list: the chapter for conversations and event text,
 *     the source ("insider_davidspc", "website_beholder") for documents;
 *   - groups left without lines are dropped. Graph nodes and edges are kept as they are.
 *
 * Usage: pnpm tsx scripts/orwell2-en.ts <orwell2-data folder>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importFileSchema, type ImportFileInput } from '../packages/shared/src/index.ts';

type File = ImportFileInput & { groups: NonNullable<ImportFileInput['groups']>; units: NonNullable<ImportFileInput['units']> };
interface Conversation {
  object_key: string;
  state_id: number;
  context?: { _stateName?: string; _stateFolder?: string };
  entries: { record_id: string }[];
  message_nodes: { object_key: string }[];
  declared_children?: string[];
}
interface IndexRow {
  object_key: string;
  scene_id: string;
  scene_review_rank: number;
  title: string;
  speakers: string[];
}

const root = process.argv[2];
if (!root) throw new Error('사용법: pnpm tsx scripts/orwell2-en.ts <orwell2-data 폴더>');
const read = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

const base = read<File>('workbench/ignorance-is-strength.json');
const index = new Map(read<IndexRow[]>('scenes/conversations/index.json').map((row) => [row.object_key, row]));
const conversations: Conversation[] = readdirSync(join(root, 'scenes/conversations'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    readdirSync(join(root, 'scenes/conversations', dir.name))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => read<Conversation>(join('scenes/conversations', dir.name, name))),
  );

const english = base.units.filter((unit) => (unit.meta as { language?: string } | undefined)?.language === 'en');
const unitByKey = new Map(english.map((unit) => [unit.key, unit]));
const chapterOrder = new Map(base.groups.filter((group) => group.kind === 'scene').map((group) => [group.title, group.order ?? 0]));

// Conversation groups, ordered by chapter then review rank.
const groupOfNode = new Map<string, string>();
const newGroups: File['groups'] = [];
for (const conversation of conversations) {
  const info = index.get(conversation.object_key);
  const chapter = info?.scene_id ?? conversation.context?._stateFolder ?? '';
  const key = `conversation/${conversation.state_id}`;
  let lines = 0;
  conversation.entries.forEach((entry, position) => {
    const unit = unitByKey.get(entry.record_id);
    if (!unit) return;
    unit.group = key;
    unit.order = position;
    lines++;
  });
  if (!lines) continue;
  newGroups.push({
    key,
    kind: 'scene',
    title: info?.title ?? conversation.context?._stateName ?? key,
    description: '',
    section: chapter,
    order: (chapterOrder.get(chapter) ?? 99) * 100_000 + (info?.scene_review_rank ?? 0),
    meta: { chapter, state_id: conversation.state_id, object_key: conversation.object_key, speakers: info?.speakers ?? [] },
  });
  for (const nodeKey of [conversation.object_key, ...conversation.message_nodes.map((node) => node.object_key), ...(conversation.declared_children ?? [])])
    if (!groupOfNode.has(nodeKey)) groupOfNode.set(nodeKey, key);
}

// Documents are filed under their source: "insider_davidspc_folder_x" → "insider_davidspc".
const withSection = (group: File['groups'][number]) => (group.kind === 'document' ? { ...group, section: group.title.split('_').slice(0, 2).join('_') } : group);
// Chapter lines outside conversations are event text; their chapter group is kept as a UI group.
const used = new Set(english.map((unit) => unit.group));
const groups = [
  ...base.groups
    .filter((group) => used.has(group.key))
    .map((group) => (group.kind === 'scene' ? { ...group, kind: 'ui' as const, title: `${group.title} · 이벤트 문구`, section: group.title, order: (group.order ?? 0) * 100_000 - 1 } : withSection(group))),
  ...newGroups,
];
const groupKeys = new Set(groups.map((group) => group.key));

const graph = base.graph && {
  ...base.graph,
  nodes: base.graph.nodes.map((node) => {
    const group = groupOfNode.get(node.key);
    return { ...node, units: (node.units ?? []).filter((key) => unitByKey.has(key)), ...(group && groupKeys.has(group) ? { group } : {}) };
  }),
};

const output: File = {
  ...base,
  project: {
    ...base.project,
    description: `${base.project.description ?? ''}\n영어(en) 원문만 담았습니다. 장면은 대화(conversation) 단위이고, 장(Day)은 묶음 메타데이터 chapter에 있습니다.`.trim(),
  },
  groups,
  units: english,
  graph,
};
const parsed = importFileSchema.safeParse(output);
if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));

const target = join(root, 'workbench/ignorance-is-strength.en.json');
writeFileSync(target, `${JSON.stringify(output)}\n`);
const kinds = (items: { kind?: string }[]) => Object.fromEntries([...Map.groupBy(items, (item) => item.kind ?? '?')].map(([kind, list]) => [kind, list.length]));
console.log(
  JSON.stringify(
    {
      output: target,
      units: { before: base.units.length, after: english.length, byKind: kinds(english) },
      groups: { before: base.groups.length, after: groups.length, byKind: kinds(groups), conversations: newGroups.length },
      graph: { nodes: graph?.nodes.length, edges: graph?.edges.length, nodesWithGroup: graph?.nodes.filter((node) => 'group' in node).length },
    },
    null,
    2,
  ),
);
