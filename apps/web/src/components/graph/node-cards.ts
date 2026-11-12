import { shownText, type GraphShow } from '@/lib/graph-show';
import type { NodeInfo } from './graph-canvas';

/** A node of the dialogue or scene graph as the layout answer gives it. */
export interface GraphNodeRow {
  id: string;
  kind: string;
  type?: string | null;
  label?: string | null;
  preview: string | null;
  key: string;
  speaker?: string | null;
  /** The node's first line. */
  text?: string | null;
  /** How many lines it holds. */
  total?: number;
}

interface NodeCardsInput {
  nodes: readonly GraphNodeRow[];
  /** What each of the game's node classes means (its label). */
  nodeTypes?: Record<string, { label?: string | null } | undefined>;
  /** Stand-ins for lines that continue in (or come from) another section. */
  portals?: readonly { id: string; direction: string; section: string }[];
  /** The runs drawn folded, each one block. */
  chains?: readonly { id: string; nodeIds: string[] }[];
  /** Every run that can be folded, and the ones drawn as their lines now. */
  foldable?: readonly { id: string; nodeIds: string[] }[];
  openRuns?: ReadonlySet<string>;
  show: GraphShow;
  /** The first line's translation by node, once translations are on the cards. */
  translations?: Record<string, string>;
  colorOf: (speaker: string | null | undefined) => string | undefined;
}

/**
 * What each thing drawn on the dialogue graph says on its card, by drawn id: a line card leads with who speaks and
 * shows the line (the source, the translation, or both: `show`); a control node is labelled by what the game's node
 * class means, not by its raw name; a choice says what picking it does; a portal names the section it leads to; a
 * folded run reads as how many lines it holds and its first spoken line, and carries the button that opens it (as
 * the first line of an open run carries the one that folds it again). The node key is in the side pane.
 */
export function nodeCards({ nodes, nodeTypes = {}, portals = [], chains = [], foldable = [], openRuns, show, translations, colorOf }: NodeCardsInput): Map<string, NodeInfo> {
  const text = (source: string, translation?: string | null) => shownText(show, source, translation);
  const lineCard = (node: GraphNodeRow) =>
    node.text ? { title: `${node.speaker ?? '지문·화면 문구'}${(node.total ?? 0) > 1 ? ` · ${node.total}줄` : ''}`, titleColor: colorOf(node.speaker), ...text(node.text, translations?.[node.id]) } : {};
  const map = new Map<string, NodeInfo>(
    nodes.map((node) => [
      node.id,
      {
        ...node,
        label: node.label ?? (node.type ? (nodeTypes[node.type]?.label ?? node.type) : null),
        ...(node.kind === 'script' && lineCard(node)),
        ...(node.kind === 'choice' && { title: `▶ ${node.text ?? ''} 고르면`, body: node.text }),
      },
    ]),
  );
  const rows = new Map(nodes.map((node) => [node.id, node] as const));
  for (const portal of portals) map.set(portal.id, { id: portal.id, kind: 'portal', label: `${portal.direction === 'out' ? '→' : '←'} ${portal.section}`, preview: null, key: portal.id });
  for (const chain of chains) {
    const first = map.get(chain.nodeIds[0]!);
    const spoken = chain.nodeIds.map((id) => rows.get(id)).find((node) => node?.text);
    const lines = chain.nodeIds.reduce((sum, id) => sum + (rows.get(id)?.total ?? 0), 0);
    const said = (words: string) => `${spoken?.speaker ? `${spoken.speaker}: ` : ''}${words}`;
    map.set(chain.id, {
      id: chain.id,
      kind: 'chain',
      label: `이어진 대사 ${lines}줄`,
      title: lines ? `이어진 대사 ${lines}줄` : `이어진 노드 ${chain.nodeIds.length}개`,
      ...(spoken?.text ? text(said(spoken.text), translations?.[spoken.id] ? said(translations[spoken.id]!) : null) : { body: first?.label ?? null }),
      preview: spoken?.preview ?? first?.preview ?? first?.label ?? null,
      key: `${first?.key ?? ''} 외 ${chain.nodeIds.length - 1}개`,
    });
  }
  // The card that opens a run, and the first line of an open run that folds it again.
  for (const run of foldable) {
    const card = map.get(run.id);
    if (card) map.set(run.id, { ...card, fold: run.id });
    const head = openRuns?.has(run.id) ? map.get(run.nodeIds[0]!) : undefined;
    if (head) map.set(head.id, { ...head, fold: run.id });
  }
  return map;
}

/** What a drawn thing is called in a list of connections: its card's title and words, else its id. */
export function cardText(cards: ReadonlyMap<string, NodeInfo>, id: string): string {
  const card = cards.get(id);
  return [card?.title, card?.body ?? card?.preview ?? card?.label].filter(Boolean).join(' · ') || id;
}

/** The nodes a finder text matches (key, label, first line, and the translation once it is on the cards), at most `limit`. */
export function findNodes<T extends GraphNodeRow>(nodes: readonly T[], find: string, translations: Record<string, string> | undefined, limit = 50): T[] {
  const text = find.trim().toLowerCase();
  if (!text) return [];
  return nodes.filter((node) => [node.key, node.label, node.preview, translations?.[node.id]].some((value) => value?.toLowerCase().includes(text))).slice(0, limit);
}

/** The nodes a highlight names: a stored view's, one node type's ("kind:<kind>" for nodes without a class), or one scene's. */
export function highlighted(nodes: readonly (GraphNodeRow & { groupId?: string | null })[], by: { mark?: readonly string[]; type?: string; scene?: string }): Set<string> | undefined {
  if (by.mark) return new Set(by.mark);
  if (by.type) return new Set(nodes.filter((node) => (node.type ?? `kind:${node.kind}`) === by.type).map((node) => node.id));
  if (by.scene) return new Set(nodes.filter((node) => node.groupId === by.scene).map((node) => node.id));
  return undefined;
}
