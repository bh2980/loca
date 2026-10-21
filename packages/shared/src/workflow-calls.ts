import { INPUT_TYPES, nodeName, nodePorts, workflowInput, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from './workflow.ts';

/** A saved workflow as expandCalls reads it. */
export interface CallableWorkflow {
  name: string;
  definition: WorkflowDefinition;
}

type Call = Extract<WorkflowNode, { type: 'call' }>;
type Calls = NonNullable<WorkflowDefinition['calls']>;
interface Expanded {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  calls: Calls;
}

/**
 * Replaces every 워크플로 호출 node by the nodes of the workflow it calls, so a run (and its
 * preflight) only ever sees ordinary nodes. A run stores the result as its definition.
 *
 * For a call node C calling W (W itself expanded first, so nested calls work to any depth):
 * - W's entry node is dropped: W's entry config (its input type, which a call checks matches) and its
 *   `settings` are ignored, the calling workflow's apply. Every other node of W is copied with the
 *   id `${C.id}/${id}` (nested: `c1/c2/n`) and keeps its label.
 * - Every edge into C goes to each target of W's entry `out` edges (W with nothing after its entry:
 *   to C's `out` targets, the call being a no-op).
 * - Where W's lines would end, they leave C: an edge into one of W's `end` nodes goes to C's `out`
 *   targets; an exit of W's nodes that is not connected would end the line (failed while it carries a
 *   failure: that is what an unconnected `error` exit does, any other unconnected exit ends it done),
 *   so an unconnected `error` exit is connected to C's `error` targets and any other unconnected exit
 *   to C's `out` targets. Where C's exit has no targets, the inner exit stays as it is (unconnected,
 *   ending the line exactly as it would after C), and an edge into an `end` node is dropped.
 * - Edges of W that were connected stay as they were (a connected `error` exit is W handling it).
 * - Inner nodes take C's position (they are not shown in the editor).
 * - `calls` on the result names every expanded call by its prefix, so "호출 이름 › 노드 이름" can be
 *   shown for an inner node (see callTrail); kept on the stored run definition, so it survives
 *   continuing a run.
 *
 * `load` finds a saved workflow by id. Throws (the message is the run-start error) when a call picks
 * nothing, a workflow is missing, takes the other input type, or leads back to a workflow already being
 * expanded (`options.workflowId`: the workflow `definition` belongs to). A definition without calls is
 * returned as it is.
 */
export function expandCalls(definition: WorkflowDefinition, load: (workflowId: string) => CallableWorkflow | undefined, options: { workflowId?: string } = {}): WorkflowDefinition {
  if (!definition.nodes.some((node) => node.type === 'call')) return definition;
  const { nodes, edges, calls } = expand(definition, load, options.workflowId ? [options.workflowId] : []);
  return { ...definition, nodes, edges, ...(Object.keys(calls).length && { calls }) };
}

function expand(definition: Pick<WorkflowDefinition, 'nodes' | 'edges' | 'calls'>, load: (workflowId: string) => CallableWorkflow | undefined, stack: string[]): Expanded {
  const calls: Calls = { ...definition.calls };
  let nodes: WorkflowNode[] = definition.nodes.filter((node) => node.type !== 'call');
  let edges = [...definition.edges];
  const taken = new Set(edges.map((edge) => edge.id));
  const fresh = (base: string) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}~${n}`;
    taken.add(id);
    return id;
  };
  const input = workflowInput(definition);

  for (const call of definition.nodes.filter((node): node is Call => node.type === 'call')) {
    const picked = call.config.workflowId;
    if (!picked) throw new Error('부를 워크플로를 고르세요.');
    const called = load(picked);
    if (!called) throw new Error('부르는 워크플로가 없습니다.');
    const calledInput = workflowInput(called.definition);
    if (calledInput !== input) throw new Error(`'${called.name}'은(는) ${INPUT_TYPES[calledInput].label}를 받는 워크플로라 여기서 부를 수 없습니다.`);
    if (stack.includes(picked)) throw new Error(`'${called.name}'을(를) 부르면 다시 이 워크플로로 돌아옵니다.`);
    const inner = expand(called.definition, load, [...stack, picked]);

    const prefix = (id: string) => `${call.id}/${id}`;
    const outTargets = edges.filter((edge) => edge.source === call.id && edge.sourceHandle === 'out').map((edge) => edge.target);
    const errorTargets = edges.filter((edge) => edge.source === call.id && edge.sourceHandle === 'error').map((edge) => edge.target);
    const entry = inner.nodes.find((node) => node.type === 'entry');
    const ends = new Set(inner.nodes.filter((node) => node.type === 'end').map((node) => node.id));
    const work = inner.nodes.filter((node) => node.type !== 'entry' && node.type !== 'end');
    // Where a line that reaches `target` inside W goes: an end leaves the call, anything else is a copy.
    const into = (target: string) => (ends.has(target) ? outTargets : [prefix(target)]);

    const added: WorkflowEdge[] = [];
    const connect = (source: string, sourceHandle: string, targets: string[]) => {
      for (const target of targets) added.push({ id: fresh(`${source}:${sourceHandle}>${target}`), source, sourceHandle, target });
    };
    for (const node of work) {
      for (const port of nodePorts(node)) {
        const own = inner.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === port.id);
        if (own.length) for (const edge of own) connect(prefix(node.id), port.id, into(edge.target));
        else connect(prefix(node.id), port.id, port.id === 'error' ? errorTargets : outTargets);
      }
    }
    const entryTargets = entry ? inner.edges.filter((edge) => edge.source === entry.id && edge.sourceHandle === 'out').flatMap((edge) => into(edge.target)) : [];
    // W with nothing after its entry does nothing: lines go straight on out of the call.
    const enter = (entryTargets.length ? entryTargets : outTargets).filter((target) => target !== call.id);

    nodes = [...nodes, ...work.map((node) => ({ ...node, id: prefix(node.id), position: call.position }))];
    calls[call.id] = { name: called.name, workflowId: picked };
    for (const [key, value] of Object.entries(inner.calls)) calls[prefix(key)] = value;

    // Edges into the call (the ones just added included: a call can lead back to itself) go into W; its own exits are now W's.
    const rewired: WorkflowEdge[] = [];
    for (const edge of [...edges.filter((candidate) => candidate.source !== call.id), ...added]) {
      if (edge.target !== call.id) rewired.push(edge);
      else for (const target of enter) rewired.push({ id: fresh(`${edge.id}>${target}`), source: edge.source, sourceHandle: edge.sourceHandle, target });
    }
    edges = rewired;
  }

  // The same exit to the same node twice would send a line there twice.
  const seen = new Set<string>();
  edges = edges.filter((edge) => {
    const key = `${edge.source}|${edge.sourceHandle}|${edge.target}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return { nodes, edges, calls };
}

/** The names of the calls an expanded node sits in, outermost first (empty for a node of the workflow itself). */
export function callTrail(definition: Pick<WorkflowDefinition, 'calls'>, nodeId: string): string[] {
  const trail: string[] = [];
  for (let at = nodeId.indexOf('/'); at !== -1; at = nodeId.indexOf('/', at + 1)) {
    const call = definition.calls?.[nodeId.slice(0, at)];
    if (call) trail.push(call.name);
  }
  return trail;
}

/** A node's name for a run: "호출 이름 › 노드 이름" for a node inside a called workflow, else just its name. */
export const runNodeName = (definition: Pick<WorkflowDefinition, 'calls'>, node: WorkflowNode) => [...callTrail(definition, node.id), nodeName(node)].join(' › ');
