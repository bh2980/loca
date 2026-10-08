import { DEFAULT_STATUSES, reviewTemplate, termExtractionTemplate, translationTemplate, type ImportFile } from '@tw/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

const CHUNK = 400;
function insertMany<T extends Parameters<Db['insert']>[0]>(tx: Pick<Db, 'insert'>, table: T, rows: T['$inferInsert'][]) {
  for (let index = 0; index < rows.length; index += CHUNK) tx.insert(table).values(rows.slice(index, index + CHUNK)).run();
}

export interface ImportSummary {
  projectId: string;
  groups: number;
  units: number;
  graphNodes: number;
  graphEdges: number;
}

/** Creates a project from a validated standard file. Everything lands in one transaction or nothing does. */
export function importProject(db: Db, file: ImportFile, defaultProfileId = ''): ImportSummary {
  const projectId = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(s.projects)
      .values({
        id: projectId,
        name: file.project.name,
        description: file.project.description,
        sourceLanguage: file.project.sourceLanguage,
        targetLanguage: file.project.targetLanguage,
        nodeTypes: file.graph?.nodeTypes ?? {},
        ...(file.project.formatRules && { formatRules: file.project.formatRules }),
      })
      .run();

    const statusIds = Object.fromEntries(DEFAULT_STATUSES.map((status) => [status.key, crypto.randomUUID()]));
    insertMany(
      tx,
      s.statuses,
      DEFAULT_STATUSES.map((status, sort) => ({ id: statusIds[status.key], projectId, name: status.name, color: status.color, kind: status.kind, sort })),
    );

    const groupIds = new Map<string, string>();
    insertMany(
      tx,
      s.groups,
      file.groups.map((group, index) => {
        const id = crypto.randomUUID();
        groupIds.set(group.key, id);
        return { id, projectId, key: group.key, kind: group.kind, title: group.title, description: group.description ?? '', sort: group.order ?? index, meta: group.meta };
      }),
    );

    const unitIds = new Map<string, string>();
    const unitGroup = new Map<string, string>();
    const unitRows: (typeof s.units.$inferInsert)[] = [];
    const candidateRows: (typeof s.candidates.$inferInsert)[] = [];
    file.units.forEach((unit, index) => {
      const id = crypto.randomUUID();
      const groupId = groupIds.get(unit.group)!;
      unitIds.set(unit.key, id);
      unitGroup.set(id, groupId);
      const candidateId = unit.translation ? crypto.randomUUID() : null;
      if (candidateId) candidateRows.push({ id: candidateId, unitId: id, text: unit.translation!, origin: 'import' });
      unitRows.push({
        id,
        projectId,
        groupId,
        key: unit.key,
        sort: unit.order ?? index,
        kind: unit.kind,
        speaker: unit.speaker ?? null,
        source: unit.source,
        translation: unit.translation ?? null,
        candidateId,
        statusId: unit.translation ? statusIds.draft : statusIds.untranslated,
        meta: unit.meta,
      });
    });
    insertMany(tx, s.units, unitRows);
    insertMany(tx, s.candidates, candidateRows);

    if (file.graph) {
      const nodeIds = new Map<string, string>();
      insertMany(
        tx,
        s.graphNodes,
        file.graph.nodes.map((node) => {
          const id = crypto.randomUUID();
          nodeIds.set(node.key, id);
          const ids = node.units.map((key) => unitIds.get(key)!);
          const kind = node.kind ?? (node.type ? file.graph!.nodeTypes[node.type]?.kind : undefined) ?? (ids.length ? 'script' : 'unknown');
          return { id, projectId, key: node.key, type: node.type ?? null, kind, label: node.label ?? null, groupId: ids.length ? unitGroup.get(ids[0])! : null, unitIds: ids, meta: node.meta };
        }),
      );
      insertMany(
        tx,
        s.graphEdges,
        file.graph.edges.map((edge) => ({ projectId, fromId: nodeIds.get(edge.from)!, toId: nodeIds.get(edge.to)!, kind: edge.kind ?? null, label: edge.label ?? null })),
      );
    }

    const characterIds = new Map<string, string>();
    insertMany(
      tx,
      s.characters,
      file.characters.map((character) => {
        const id = crypto.randomUUID();
        for (const name of [character.name, ...character.aliases]) characterIds.set(name, id);
        return { id, projectId, name: character.name, aliases: character.aliases, profile: character.profile };
      }),
    );
    insertMany(
      tx,
      s.relationships,
      file.relationships.map((rel) => ({
        projectId,
        fromId: characterIds.get(rel.from)!,
        toId: characterIds.get(rel.to)!,
        kind: rel.kind,
        description: rel.description,
        mutual: rel.mutual,
      })),
    );
    insertMany(tx, s.documents, file.documents.map((doc) => ({ projectId, ...doc })));
    insertMany(tx, s.terms, file.terms.map((term) => ({ projectId, ...term })));

    tx.insert(s.workflows)
      .values({
        projectId,
        name: '기본 번역',
        description: '번역 → 형식 검사 → 검수 → 확정. 실패는 3회까지 수정 후 사람 확인.',
        definition: translationTemplate({
          profileId: defaultProfileId,
          untranslated: statusIds.untranslated,
          draft: statusIds.draft,
          needsReview: statusIds['needs-review'],
          confirmed: statusIds.confirmed,
        }),
      })
      .run();
    tx.insert(s.workflows)
      .values({
        projectId,
        name: '용어 추출',
        description: '장면별로 고유명사·반복 용어를 뽑아 용어집 후보로 추가합니다. 용어집에서 수락한 뒤 번역을 돌리세요.',
        definition: termExtractionTemplate({ profileId: defaultProfileId }),
      })
      .run();
    const review = tx.insert(s.workflows)
      .values({
        projectId,
        name: '사람 검토',
        description: "'사람 확인 필요' 상태의 대사를 검토함으로 보냅니다. 확정 / 다시 번역 / 보류 중 하나를 고릅니다.",
        definition: reviewTemplate({ needsReview: statusIds['needs-review'], confirmed: statusIds.confirmed, untranslated: statusIds.untranslated }),
      })
      .returning({ id: s.workflows.id })
      .get();
    // Moving a line to "needs review" by hand sends it to the review inbox.
    tx.update(s.statuses).set({ onEnterWorkflowId: review.id }).where(eq(s.statuses.id, statusIds['needs-review'])).run();
  });
  return {
    projectId,
    groups: file.groups.length,
    units: file.units.length,
    graphNodes: file.graph?.nodes.length ?? 0,
    graphEdges: file.graph?.edges.length ?? 0,
  };
}
