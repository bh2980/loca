import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { snapshot } from './proposal-undo.ts';

/**
 * What a proposal's card says it does, from the project's own data instead of the ids the tool was called with: who or
 * what each saved item is (a name, not an id), and for each field the value it has now (or had, once accepted) next to the
 * value it gets. `refs` names the other ids a tool names (a line, a scene, a status, a workflow).
 */
export interface ProposalDetailItem {
  kind: s.KnowledgeKind;
  action: '수정' | '추가';
  label: string;
  changes: { field: string; before?: string; after: string }[];
}
export interface ProposalDetails {
  items: ProposalDetailItem[];
  refs: Record<string, string>;
}

type Proposal = typeof s.proposals.$inferSelect;
type Values = Record<string, unknown>;

const isRecord = (value: unknown): value is Values => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Values[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const KIND_BY_TOOL: Record<string, s.KnowledgeKind> = {
  save_character: 'characters',
  save_relationship: 'relationships',
  save_speech_rule: 'speechRules',
  save_event: 'events',
  save_document: 'documents',
};

/** The fields of each kind a person reads, in this order, with what they are called. */
const FIELDS: Record<s.KnowledgeKind, [string, string][]> = {
  characters: [['name', '이름'], ['aliases', '별칭'], ['role', '역할'], ['gender', '성별'], ['ageBand', '나이대'], ['player', '플레이어'], ['profile', '프로필'], ['speech', '말투 메모']],
  relationships: [['kind', '관계'], ['description', '설명'], ['mutual', '쌍방']],
  speechRules: [['fromName', '화자'], ['toName', '청자'], ['level', '말투'], ['address', '호칭'], ['note', '메모'], ['startKey', '적용 시작']],
  events: [['title', '제목'], ['summary', '요약'], ['cause', '원인'], ['outcome', '결과'], ['participants', '등장인물']],
  documents: [['kind', '종류'], ['title', '제목'], ['body', '내용'], ['alwaysInclude', '문맥에 넣기']],
};

const SHOWN_CHARS = 500;
const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(비어 있음)';
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? '예' : '아니오') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}…` : text;
};

/** The values a change gave up, from the calls that undo it (an accepted proposal): by kind and id. */
function givenUp(proposal: Proposal) {
  const out = new Map<string, Values>();
  const undo = proposal.undo;
  if (!undo || !('calls' in undo)) return out;
  for (const call of undo.calls) {
    if (call.tool === 'save_knowledge') {
      for (const kind of Object.keys(FIELDS) as s.KnowledgeKind[])
        for (const item of list(call.input[kind])) if (typeof item.id === 'string') out.set(`${kind}:${item.id}`, item);
    } else if (KIND_BY_TOOL[call.tool] && typeof call.input.id === 'string') out.set(`${KIND_BY_TOOL[call.tool]}:${call.input.id}`, call.input);
  }
  return out;
}

function labelOf(kind: s.KnowledgeKind, request: Values, row: Values | undefined) {
  const pick = (key: string) => String(request[key] ?? row?.[key] ?? '').trim();
  switch (kind) {
    case 'characters':
      return pick('name');
    case 'relationships':
      return `${pick('from') || '?'} → ${pick('to') || '?'}`;
    case 'speechRules':
      return `${pick('fromName') || '?'} → ${pick('toName') || '?'}`;
    default:
      return pick('title');
  }
}

function itemsOf(db: Db, proposal: Proposal): ProposalDetailItem[] {
  const requests: { kind: s.KnowledgeKind; request: Values }[] = proposal.tool === 'save_knowledge'
    ? (Object.keys(FIELDS) as s.KnowledgeKind[]).flatMap((kind) => list(proposal.input[kind]).map((request) => ({ kind, request })))
    : KIND_BY_TOOL[proposal.tool] ? [{ kind: KIND_BY_TOOL[proposal.tool], request: proposal.input }] : [];
  if (!requests.length) return [];
  const gone = givenUp(proposal);
  return requests.map(({ kind, request }) => {
    const id = typeof request.id === 'string' ? request.id : undefined;
    const row = id ? snapshot(db, kind, proposal.projectId, id) : undefined;
    // Accepted: the row already holds the new values, the old ones are what the undo calls would restore. Not yet: the row.
    const before: Values | undefined = proposal.status === 'accepted' ? (id ? gone.get(`${kind}:${id}`) : undefined) : row;
    const changes = FIELDS[kind]
      .filter(([field]) => request[field] !== undefined)
      .flatMap(([field, name]) => {
        const after = show(request[field]);
        if (!id) return [{ field: name, after }];
        if (before === undefined || !(field in before)) return proposal.status === 'accepted' ? [{ field: name, after }] : [];
        const was = show(before[field]);
        return was === after ? [] : [{ field: name, before: was, after }];
      });
    return { kind, action: id ? ('수정' as const) : ('추가' as const), label: labelOf(kind, request, row), changes };
  });
}

/** Names for the ids the tool was called with, for the cards of tools that name something by id. */
function refsOf(db: Db, proposal: Proposal): Record<string, string> {
  const input = proposal.input;
  const refs: Record<string, string> = {};
  const ids = (key: string) => (typeof input[key] === 'string' ? [input[key] as string] : Array.isArray(input[key]) ? (input[key] as unknown[]).filter((value): value is string => typeof value === 'string') : []);
  const named = (table: 'statuses' | 'tags' | 'workflows' | 'groups', wanted: string[]) => {
    if (!wanted.length) return;
    const t = s[table];
    const column = table === 'groups' ? s.groups.title : (t as typeof s.statuses).name;
    for (const row of db.select({ id: (t as typeof s.statuses).id, name: column }).from(t as typeof s.statuses).where(and(eq((t as typeof s.statuses).projectId, proposal.projectId), inArray((t as typeof s.statuses).id, wanted))).all()) refs[row.id] = row.name;
  };
  switch (proposal.tool) {
    case 'update_unit':
      for (const unitId of ids('unitId'))
        for (const unit of db.select({ id: s.units.id, key: s.units.key, speaker: s.units.speaker, source: s.units.source }).from(s.units).where(and(eq(s.units.id, unitId), eq(s.units.projectId, proposal.projectId))).all())
          refs[unit.id] = `${unit.key}${unit.speaker ? ` · ${unit.speaker}` : ''}: ${unit.source.trim().slice(0, 60)}`;
      named('groups', ids('groupId'));
      break;
    case 'update_group':
    case 'delete_group':
      named('groups', ids('groupId'));
      break;
    case 'update_status':
    case 'delete_status':
      named('statuses', [...ids('id'), ...ids('ids'), ...ids('moveTo')]);
      break;
    case 'update_tag':
    case 'delete_tag':
      named('tags', [...ids('id'), ...ids('ids')]);
      break;
    case 'save_workflow':
    case 'delete_workflow':
    case 'start_run':
    case 'edit_workflow_node':
      named('workflows', [...ids('id'), ...ids('workflowId')]);
      break;
  }
  return refs;
}

/** Null for a tool whose card already says everything from its input. */
export function proposalDetails(db: Db, proposal: Proposal): ProposalDetails | null {
  const items = itemsOf(db, proposal);
  const refs = refsOf(db, proposal);
  return items.length || Object.keys(refs).length ? { items, refs } : null;
}
