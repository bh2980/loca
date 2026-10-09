import { and, asc, eq } from 'drizzle-orm';
import { estimateTokens } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** One scene (or document / UI group) of the script as plain text for a model to read. */
export interface ScriptBlock {
  groupKey: string;
  text: string;
  tokens: number;
}

/**
 * The project's script as text a model can read whole: "## <section> — <title> [<key>]" headers and
 * "L<n> <Speaker>: <text>" lines. Line ids are short (L1…) to save tokens; `keyOf` maps them back.
 * A line reached by a labelled graph edge (a player choice, a condition) is preceded by
 * "▶ <label>", so the model can tell branches apart. Documents are shortened.
 */
export function scriptText(db: Db, projectId: string) {
  const groups = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).orderBy(asc(s.groups.sort)).all();
  const units = db.select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, kind: s.units.kind, speaker: s.units.speaker, source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.sort)).all();
  const byGroup = Map.groupBy(units, (unit) => unit.groupId);

  // Labels of the edges that lead into each line's graph node.
  const nodes = db.select({ id: s.graphNodes.id, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const firstUnitOf = new Map(nodes.flatMap((node) => (node.unitIds[0] ? [[node.id, node.unitIds[0]] as const] : [])));
  const branchLabels = new Map<string, string[]>();
  for (const edge of db.select({ toId: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(and(eq(s.graphEdges.projectId, projectId))).all()) {
    const unitId = firstUnitOf.get(edge.toId);
    if (unitId && edge.label?.trim()) branchLabels.set(unitId, [...(branchLabels.get(unitId) ?? []), edge.label.trim()]);
  }

  const keyOf = new Map<string, string>();
  const idOf = new Map<string, string>();
  const blocks: ScriptBlock[] = [];
  let n = 0;
  for (const group of groups) {
    const rows = byGroup.get(group.id) ?? [];
    if (!rows.length) continue;
    const lines = [`## ${group.section ? `${group.section} — ` : ''}${group.title} [${group.key}]`];
    for (const unit of rows) {
      const id = `L${++n}`;
      keyOf.set(id, unit.key);
      idOf.set(unit.key, id);
      for (const label of branchLabels.get(unit.id) ?? []) lines.push(`  ▶ ${label}`);
      const body = unit.kind === 'document' && unit.source.length > 600 ? `${unit.source.slice(0, 600)}…` : unit.source;
      const who = unit.kind === 'dialogue' ? (unit.speaker ?? '-') : unit.kind === 'document' ? '[문서]' : '[UI]';
      lines.push(`  ${id} ${who}: ${body.replace(/\s*\n\s*/g, ' / ')}`);
    }
    const text = lines.join('\n');
    blocks.push({ groupKey: group.key, text, tokens: estimateTokens(text) });
  }
  return { blocks, keyOf, idOf };
}

/** Consecutive blocks packed into parts of at most `limit` estimated tokens (a single large block stays whole). */
export function packBlocks(blocks: ScriptBlock[], limit: number): string[] {
  const parts: string[][] = [[]];
  let used = 0;
  for (const block of blocks) {
    if (used + block.tokens > limit && parts.at(-1)!.length) {
      parts.push([]);
      used = 0;
    }
    parts.at(-1)!.push(block.text);
    used += block.tokens;
  }
  return parts.map((part) => part.join('\n\n'));
}
