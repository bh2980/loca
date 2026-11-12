/**
 * 출구 동작 as the graph draws them: each exit's status and tags as chips (ExitTag) on its line, where the layout keeps
 * room (exitTagSize), or under the exit when no line leaves it; and as words in the panes. One place for the editor and
 * a run's graph.
 */
import { exitActions, exitResultSteps, nodeName, nodePorts, type ExitAction, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@loca/shared';
import { exitTagSize, type ExitTagItem } from '@loca/ui';

/** An exit's key, in the URL (?exit=) and on its tags: `node id:exit`. */
export const exitKey = (nodeId: string, port: string) => `${nodeId}:${port}`;
export function parseExitKey(key: string | undefined): { nodeId: string; port: string } | undefined {
  const at = key?.lastIndexOf(':') ?? -1;
  return key && at > 0 ? { nodeId: key.slice(0, at), port: key.slice(at + 1) } : undefined;
}

/** The project's tags and statuses by id, for the chips' names, colours and a status's icon. */
export interface MarkNames {
  tags?: ReadonlyMap<string, { name: string; color: string }>;
  statuses?: ReadonlyMap<string, { name: string; color: string; kind?: 'initial' | 'normal' | 'final'; inReview?: boolean }>;
}

/** The steps whose result an exit's tags can follow (exitResultSteps), by name: "AI 검수". Empty when there are none. */
export const resultStepNames = (definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>, node: WorkflowNode, port: string) =>
  exitResultSteps(definition, node, port).filter((step) => step.type !== 'gather').map(nodeName).join(' · ');

/**
 * An exit's actions as the marks draw them, in order: the status it sets, each tag it puts on or takes off, and the tags
 * a step's result decides (named by that step, from `definition`; with the tags set for its values).
 */
export function exitTagItems(node: WorkflowNode, port: string, names: MarkNames = {}, definition?: Pick<WorkflowDefinition, 'nodes' | 'edges'>): ExitTagItem[] {
  const from = definition && resultStepNames(definition, node, port);
  return exitActions(node, port).flatMap((action): ExitTagItem[] => {
    if (action.type === 'status') {
      const status = action.statusId ? names.statuses?.get(action.statusId) : undefined;
      return [{ kind: 'status', name: !action.statusId ? '상태 고르기' : status?.name ?? '삭제된 상태', color: status?.color, statusKind: status?.kind, inReview: status?.inReview }];
    }
    return [
      ...action.tagIds.map((id): ExitTagItem => {
        const tag = names.tags?.get(id);
        return { kind: 'tag', action: action.action, name: tag?.name ?? '삭제된 태그', color: tag?.color };
      }),
      ...(action.fromField ? [{
        kind: 'tag' as const,
        action: action.action,
        name: from || '이전 단계',
        fromResult: true,
        options: [...new Set(Object.values(action.categoryTags))].map((id) => ({ name: names.tags?.get(id)?.name ?? '삭제된 태그', color: names.tags?.get(id)?.color })),
      }] : []),
    ];
  });
}

/** The room an exit's tags need on its line, with the line's label on top (none when the exit has no actions). */
export function exitTagRoom(node: WorkflowNode, port: string, names: MarkNames, label?: string, definition?: Pick<WorkflowDefinition, 'nodes' | 'edges'>) {
  const items = exitTagItems(node, port, names, definition);
  return items.length ? exitTagSize(items, label) : undefined;
}

/**
 * One action in words, for the panes: "추가할 태그 · #형식 오류", "제거할 태그 · 7개", "추가할 태그 · AI 검수 결과에 따라",
 * "상태 → 완료". `from`: the step whose result decides tags (exitResultSteps), by name.
 */
export function exitActionText(action: ExitAction, names: MarkNames = {}, from?: string): string {
  if (action.type === 'status') return `상태 → ${!action.statusId ? '(고르세요)' : names.statuses?.get(action.statusId)?.name ?? '삭제된 상태'}`;
  const tags = action.tagIds.length > 3 ? [`${action.tagIds.length}개`] : action.tagIds.map((id) => `#${names.tags?.get(id)?.name ?? '삭제된 태그'}`);
  const what = [...tags, ...(action.fromField ? [`${from ?? '이전 단계'} 결과에 따라`] : [])];
  return `${action.action === 'add' ? '추가할' : '제거할'} 태그${what.length ? ` · ${what.join(', ')}` : ''}`;
}

/**
 * For the auto layout: the room each line's exit tags take (with its label on top: a condition's 예/아니요, an exit sent
 * down several lines). An exit's tags are on its first line only, as the canvas draws them.
 */
export function tagRoomOf(definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>, names: MarkNames) {
  const first = new Map<string, string>();
  for (const edge of definition.edges) if (!first.has(exitKey(edge.source, edge.sourceHandle))) first.set(exitKey(edge.source, edge.sourceHandle), edge.id);
  const exit = (nodeId: string, port: string) => {
    const node = definition.nodes.find((item) => item.id === nodeId);
    return node && exitTagRoom(node, port, names, undefined, definition);
  };
  return { exit, edge: (edge: WorkflowEdge) => {
    if (first.get(exitKey(edge.source, edge.sourceHandle)) !== edge.id) return undefined;
    const source = definition.nodes.find((node) => node.id === edge.source);
    if (!source) return undefined;
    const port = nodePorts(source).find((item) => item.id === edge.sourceHandle);
    const branches = definition.edges.filter((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle).length;
    const label = port && (branches > 1 ? `${port.label} · 모두 보냄` : source.type === 'condition' ? port.label : undefined);
    return exitTagRoom(source, edge.sourceHandle, names, label, definition);
  } };
}
