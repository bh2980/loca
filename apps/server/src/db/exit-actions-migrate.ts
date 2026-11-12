/**
 * 태그 붙이기·떼기 and 상태 변경 were nodes; they are exit actions now. This
 * turns a definition with such nodes into one without: each node's work goes onto every exit that led to it, those lines
 * go where its 다음 exit went (none: the exit ends the line), its 오류 lines go; upstream nodes first, so a run of them adds
 * up in order. Only the database's migration (0122) goes through it. A definition without such nodes comes back as it
 * is (the same object).
 */
type ExitRaw = {
  edges?: { id: string; source: string; sourceHandle: string; target: string }[];
  nodes?: { id: string; type?: string; config?: { fn?: string; params?: Record<string, unknown> }; exits?: Record<string, unknown[]> }[];
  groups?: { nodeIds?: string[] }[];
};
const marking = (node: NonNullable<ExitRaw['nodes']>[number] | undefined) => node?.type === 'function' && (node.config?.fn === 'tagLines' || node.config?.fn === 'setStatus');
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const ownActions = (node: NonNullable<ExitRaw['nodes']>[number]): unknown[] => {
  const params = node.config?.params ?? {};
  if (node.config?.fn === 'setStatus') {
    const statusId = typeof params.statusId === 'string' && params.statusId ? params.statusId : undefined;
    const add = strings(params.addTagIds);
    const remove = strings(params.removeTagIds);
    return [
      ...(statusId ? [{ type: 'status', statusId }] : []),
      ...(add.length ? [{ type: 'tag', action: 'add', tagIds: add, categoryTags: {} }] : []),
      ...(remove.length ? [{ type: 'tag', action: 'remove', tagIds: remove, categoryTags: {} }] : []),
    ];
  }
  const tagIds = strings(params.tagIds);
  const fromField = typeof (params.map as Record<string, unknown> | undefined)?.tag === 'string' && (params.map as Record<string, string>).tag ? (params.map as Record<string, string>).tag : undefined;
  if (!tagIds.length && !fromField) return [];
  return [{ type: 'tag', action: params.action === 'remove' ? 'remove' : 'add', tagIds, ...(fromField && { fromField }), categoryTags: (params.categoryTags as Record<string, string> | undefined) ?? {} }];
};
export function exitActionsFromNodes<T>(definition: T): T {
  if (!definition || typeof definition !== 'object' || !((definition as ExitRaw).nodes ?? []).some(marking)) return definition;
  const parsed = structuredClone(definition) as ExitRaw;
  let nodes = parsed.nodes ?? [];
  let edges = parsed.edges ?? [];
  const doomed = () => nodes.filter(marking);
  while (doomed().length) {
    const left = new Set(doomed().map((node) => node.id));
    // Upstream first: one no other such node leads to (in a loop of nothing else, any).
    const node = doomed().find((candidate) => !edges.some((edge) => edge.target === candidate.id && left.has(edge.source))) ?? doomed()[0]!;
    const actions = [...ownActions(node), ...((node.exits?.out as unknown[] | undefined) ?? [])];
    const onward = edges.filter((edge) => edge.source === node.id && edge.sourceHandle === 'out').map((edge) => edge.target);
    const incoming = edges.filter((edge) => edge.target === node.id);
    const byId = new Map(nodes.map((item) => [item.id, item]));
    for (const edge of incoming) {
      const source = byId.get(edge.source);
      if (!source || !actions.length) continue;
      source.exits = { ...source.exits, [edge.sourceHandle]: [...((source.exits?.[edge.sourceHandle] as unknown[] | undefined) ?? []), ...actions] };
    }
    const rewired = incoming.flatMap((edge) => onward.map((target, index) => ({ id: index ? `${edge.id}-${index}` : edge.id, source: edge.source, sourceHandle: edge.sourceHandle, target })));
    edges = [...edges.filter((edge) => edge.source !== node.id && edge.target !== node.id), ...rewired]
      .filter((edge, index, all) => all.findIndex((other) => other.source === edge.source && other.sourceHandle === edge.sourceHandle && other.target === edge.target) === index);
    nodes = nodes.filter((item) => item.id !== node.id);
  }
  parsed.nodes = nodes;
  parsed.edges = edges;
  const gone = new Set(((definition as ExitRaw).nodes ?? []).filter(marking).map((node) => node.id));
  for (const group of parsed.groups ?? []) group.nodeIds = (group.nodeIds ?? []).filter((id) => !gone.has(id));
  return parsed as T;
}
