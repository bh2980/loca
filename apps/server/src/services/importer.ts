import { DEFAULT_STATUSES, knowledgeTemplate, listenerTemplate, SPEECH_FIX_WORKFLOW, speechFixTemplate, termExtractionTemplate, translationTemplate, type ImportFile } from '@tw/shared';
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
        graphFlow: file.graph?.flow ?? 'partial',
        ...(file.project.formatRules && { formatRules: file.project.formatRules }),
      })
      .run();

    const statusIds = Object.fromEntries(DEFAULT_STATUSES.map((status) => [status.key, crypto.randomUUID()]));
    insertMany(
      tx,
      s.statuses,
      DEFAULT_STATUSES.map((status, sort) => ({ id: statusIds[status.key], projectId, name: status.name, color: status.color, kind: status.kind, inReview: status.inReview, sort })),
    );

    const groupIds = new Map<string, string>();
    insertMany(
      tx,
      s.groups,
      file.groups.map((group, index) => {
        const id = crypto.randomUUID();
        groupIds.set(group.key, id);
        return { id, projectId, key: group.key, kind: group.kind, title: group.title, description: group.description ?? '', section: group.section ?? null, sort: group.order ?? index, meta: group.meta };
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
        listener: unit.listener ?? null,
        listenerOrigin: unit.listener ? 'import' : null,
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
          return { id, projectId, key: node.key, type: node.type ?? null, kind, label: node.label ?? null, groupId: node.group ? groupIds.get(node.group)! : ids.length ? unitGroup.get(ids[0])! : null, unitIds: ids, meta: node.meta };
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
        return { id, projectId, name: character.name, aliases: character.aliases, profile: character.profile, speech: character.speech, player: character.player, origin: 'import' as const };
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
        changes: rel.changes,
        origin: 'import' as const,
      })),
    );
    insertMany(tx, s.documents, file.documents.map((doc) => ({ projectId, ...doc, origin: 'import' as const })));
    insertMany(tx, s.storyEvents, file.events.map((event) => ({ projectId, ...event, origin: 'import' as const })));
    insertMany(
      tx,
      s.speechRules,
      file.speechRules.map((rule) => ({ projectId, fromName: rule.from, toName: rule.to, level: rule.level, address: rule.address, note: rule.note, startKey: rule.start ?? null, origin: 'import' as const })),
    );
    insertMany(tx, s.terms, file.terms.map((term) => ({ projectId, ...term })));

    tx.insert(s.workflows)
      .values({
        projectId,
        name: '기본 번역',
        description: '번역 → 형식 검사 → 검수 → 확정. 실패는 3회까지 수정 후 사람 확인 필요(검토함)로.',
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
    tx.insert(s.workflows)
      .values({
        projectId,
        name: '청자 추정',
        description: '장면별로 대사마다 누구에게 하는 말인지 추정해 적습니다. 번역·상태는 바꾸지 않습니다. 말투 규칙은 청자가 정해진 대사에만 쓰입니다.',
        definition: listenerTemplate({ profileId: defaultProfileId }),
      })
      .run();
    tx.insert(s.workflows)
      .values({
        projectId,
        name: '자료 갱신',
        description: '장면을 순서대로 읽으며 새 인물·관계 변화·사건·말투가 바뀌는 지점을 자료에 AI 항목으로 넣습니다. 정식 자료는 바꾸지 않고 다른 의견은 후보로 남깁니다. 번역·상태는 그대로입니다.',
        definition: knowledgeTemplate({ profileId: defaultProfileId }),
      })
      .run();
    tx.insert(s.workflows)
      .values({
        projectId,
        name: SPEECH_FIX_WORKFLOW,
        description: '말투 규칙이나 청자를 고친 뒤, 해당 대사의 현재 번역에서 어미·호칭만 확정 규칙에 맞춥니다. 뜻과 다른 표현은 그대로 두고 상태도 바꾸지 않습니다.',
        definition: speechFixTemplate({ profileId: defaultProfileId }),
      })
      .run();
  });
  return {
    projectId,
    groups: file.groups.length,
    units: file.units.length,
    graphNodes: file.graph?.nodes.length ?? 0,
    graphEdges: file.graph?.edges.length ?? 0,
  };
}
