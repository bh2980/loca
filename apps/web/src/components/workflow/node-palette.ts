/**
 * What the workflow editor can add, as its '＋ 노드' library lists it, and the node each entry starts as. AI presets and
 * functions are pre-filled configs of the two node kinds; the flow kinds are added as they are; an exit action is not
 * a node at all (it goes on the exit of the line it is dropped on, or picked and then clicked).
 */
import { AI_PRESETS, FUNCTIONS, INPUT_TYPES, NODE_TYPES, functionTakes, isFunctionName, paletteFunctions, presetTakes, workflowInput, type BatchConfig, type ExitAction, type Subject, type WorkflowDefinition, type WorkflowNode, type WorkflowNodeType } from '@tw/shared';
import type { NodeLibraryGroup } from '@loca/ui';

/**
 * The node kinds the library adds as they are, with the config a new one starts from. The other kinds have their own
 * way in: an AI node from a preset or free form, a function by its name, and the entry is never added. Keyed by every
 * such kind, so a new kind does not compile until the library has it.
 */
const FLOW_NODES: Record<Exclude<WorkflowNodeType, 'entry' | 'ai' | 'function'>, { config: object; description?: string }> = {
  condition: { config: { expression: true, description: '' } },
  gather: { config: { fields: [] } },
  call: { config: { workflowId: '' }, description: '다른 워크플로를 여기서 돌립니다.' },
};
const FLOW_NODE_TYPES = Object.keys(FLOW_NODES) as (keyof typeof FLOW_NODES)[];
const isFlowNodeType = (id: string): id is keyof typeof FLOW_NODES => Object.hasOwn(FLOW_NODES, id);

/** A preset as the palette reads it: label/description for the list, the rest is the AI node config it fills. */
type PresetEntry = { label: string; description?: string; output: string; inputs?: readonly Subject[] } & Record<string, unknown>;
const PRESETS = AI_PRESETS as unknown as Record<string, PresetEntry>;

/** The 출구 동작 the palette offers. */
export const EXIT_ACTION_ITEMS: { id: string; label: string; kind: 'apply' | 'status'; make: () => ExitAction }[] = [
  { id: 'exit:tag-add', label: '태그 붙이기', kind: 'apply', make: () => ({ type: 'tag', action: 'add', tagIds: [], categoryTags: {} }) },
  { id: 'exit:tag-remove', label: '태그 떼기', kind: 'apply', make: () => ({ type: 'tag', action: 'remove', tagIds: [], categoryTags: {} }) },
  { id: 'exit:status', label: '상태 바꾸기', kind: 'status', make: () => ({ type: 'status', statusId: '' }) },
];
export const exitActionItem = (id: string) => EXIT_ACTION_ITEMS.find((item) => item.id === id);

/** The library for a workflow: the core nodes and those of the workflow's input (INPUT_TYPES via functionTakes / presetTakes). */
export function nodePalette(definition: WorkflowDefinition): NodeLibraryGroup[] {
  const input = workflowInput(definition);
  return [
    {
      id: 'ai',
      label: 'AI',
      items: [
        ...Object.entries(PRESETS).filter(([, preset]) => presetTakes(preset, input)).map(([id, preset]) => ({ id, label: preset.label, kind: 'ai' as const, icon: null })),
        { id: 'ai', label: 'AI 자유 형식', kind: 'ai' as const, icon: null },
      ],
    },
    { id: 'apply', label: '반영', items: paletteFunctions('apply').filter((fn) => functionTakes(fn, input)).map((fn) => ({ id: fn, label: FUNCTIONS[fn].label, kind: 'apply' as const, icon: null })) },
    // Not nodes: dropped on a line (or picked, then a line clicked), they go on that line's exit.
    { id: 'exit', label: '출구 동작 (선에 붙임)', items: EXIT_ACTION_ITEMS.map((item) => ({ id: item.id, label: item.label, kind: item.kind, icon: null })) },
    { id: 'function', label: '함수', items: paletteFunctions('function').filter((fn) => functionTakes(fn, input)).map((fn) => ({ id: fn, label: FUNCTIONS[fn].label, kind: 'function' as const, icon: null })) },
    { id: 'flow', label: '흐름', items: FLOW_NODE_TYPES.map((type) => ({ id: type, label: NODE_TYPES[type].label, kind: type, icon: null, ...(FLOW_NODES[type].description && { description: FLOW_NODES[type].description }) })) },
  ];
}

/** What a new node is made from: its kind, label and config (the schema fills the rest). */
export type NodeSeed = Pick<WorkflowNode, 'type'> & { label?: string; config?: unknown };

/**
 * The node a library entry starts as, or null when the entry is not a node (an exit action, an unknown id).
 * A new AI node starts with the model the workflow already uses, else none (validation asks for one), and packs
 * requests in a way the workflow's input has (용어 has no scenes: it starts 개수별).
 */
export function librarySeed(id: string, definition: WorkflowDefinition): NodeSeed | null {
  const input = workflowInput(definition);
  const used = definition.nodes.find((node) => node.type === 'ai' && node.config.model.model);
  const model = used?.type === 'ai' ? used.config.model : { connectionId: '', model: '' };
  const batchFor = (batch?: { mode?: BatchConfig['mode'] }) => {
    const modes: readonly BatchConfig['mode'][] = INPUT_TYPES[input].batchModes;
    return { ...batch, mode: modes.includes(batch?.mode ?? 'group') ? (batch?.mode ?? 'group') : modes[0]! };
  };
  const preset = PRESETS[id];
  if (preset) {
    const { label, description: _description, ...config } = preset;
    return { type: 'ai', label, config: { ...config, batch: batchFor(config.batch as { mode?: BatchConfig['mode'] } | undefined), model, preset: id } };
  }
  if (isFunctionName(id)) return { type: 'function', config: { fn: id } };
  if (id === 'ai') return { type: 'ai', config: { model, output: 'json', scope: 'line', batch: batchFor(), fields: [{ name: 'note', type: 'string', description: '' }] } };
  if (isFlowNodeType(id)) return { type: id, config: FLOW_NODES[id].config };
  return null;
}
