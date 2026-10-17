import type { LayoutJob } from './layout-types.ts';

/** Size of the stand-in for lines in another section ("→ 3장"). */
export const PORTAL_SIZE: [number, number] = [150, 40];

export interface SectionNode {
  id: string;
  width: number;
  height: number;
  /** The section of the node's scene; null for nodes outside a scene (choices, conditions…). */
  section: string | null;
  /** The node's scene, passed through to the layout job. */
  group?: string | null;
  /** Never folded into a run (a player's choice). */
  keep?: boolean;
}

export interface SectionJob {
  name: string;
  job: LayoutJob;
  /** Stand-ins for the edges that leave or enter the section: one per other section and direction. */
  portals: { id: string; section: string; direction: 'in' | 'out' }[];
}

/**
 * Every node gets a section: its scene's, or for a node outside scenes (a choice, a condition) the
 * section of the nearest node it is reached from, else of the nearest node it leads to. Nodes no
 * scene touches at all stay together under `rest`.
 */
export function assignSections(nodes: SectionNode[], edges: { from: string; to: string }[], rest = '(장면 밖)'): Map<string, string> {
  const section = new Map<string, string>();
  for (const node of nodes) if (node.section) section.set(node.id, node.section);
  const next = new Map<string, string[]>();
  const prev = new Map<string, string[]>();
  for (const edge of edges) {
    (next.get(edge.from) ?? next.set(edge.from, []).get(edge.from)!).push(edge.to);
    (prev.get(edge.to) ?? prev.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  // Breadth first from every placed node, forwards first: a choice belongs where it is offered.
  for (const links of [next, prev]) {
    let frontier = [...section.keys()];
    while (frontier.length) {
      const following: string[] = [];
      for (const id of frontier)
        for (const other of links.get(id) ?? [])
          if (!section.has(other)) {
            section.set(other, section.get(id)!);
            following.push(other);
          }
      frontier = following;
    }
  }
  for (const node of nodes) if (!section.has(node.id)) section.set(node.id, rest);
  return section;
}

/**
 * One layout job per section, in `order` (sections not listed follow). An edge between two
 * sections becomes an edge to a portal in the section it leaves and from a portal in the section
 * it enters, so each section is laid out on its own and still shows where its lines lead.
 */
export function sectionJobs(nodes: SectionNode[], edges: LayoutJob['edges'], order: string[]): SectionJob[] {
  const section = assignSections(nodes, edges);
  const names = [...new Set([...order.filter((name) => [...section.values()].includes(name)), ...section.values()])];
  const jobs = new Map<string, SectionJob>(names.map((name) => [name, { name, job: { nodes: [], edges: [] }, portals: [] }]));
  for (const node of nodes) jobs.get(section.get(node.id)!)!.job.nodes.push({ id: node.id, width: node.width, height: node.height, group: node.group ?? null, ...(node.keep && { keep: true }) });
  const portal = (owner: SectionJob, other: string, direction: 'in' | 'out') => {
    const id = `portal:${direction}:${other}`;
    if (!owner.portals.some((entry) => entry.id === id)) {
      owner.portals.push({ id, section: other, direction });
      owner.job.nodes.push({ id, width: PORTAL_SIZE[0], height: PORTAL_SIZE[1] });
    }
    return id;
  };
  for (const edge of edges) {
    const from = section.get(edge.from);
    const to = section.get(edge.to);
    if (!from || !to) continue;
    if (from === to) {
      jobs.get(from)!.job.edges.push(edge);
      continue;
    }
    const leaving = jobs.get(from)!;
    const entering = jobs.get(to)!;
    // A choice leading into another section is said on the way out.
    leaving.job.edges.push({ id: `${edge.id}:out`, from: edge.from, to: portal(leaving, to, 'out'), ...(edge.label && { label: edge.label }), ...(edge.via && { via: edge.via }) });
    entering.job.edges.push({ id: `${edge.id}:in`, from: portal(entering, from, 'in'), to: edge.to });
  }
  return [...jobs.values()].filter((job) => job.job.nodes.some((node) => !node.id.startsWith('portal:')));
}
