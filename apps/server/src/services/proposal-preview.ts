import { and, eq } from 'drizzle-orm';
import { AGE_BAND_LABELS, bySubject, cardSummary, CHARACTER_ROLE_LABELS, GENDER_LABELS, GROUP_KIND_LABELS, KNOWLEDGE_STATUS_LABELS, nodeName, SPEECH_LEVEL_LABELS, startCaps, TERM_LINE_KIND_LABELS, type AutoMark, type ProposalDetail, type RunCaps, type WorkflowDefinition } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { DELETABLE } from './item-delete.ts';
import { snapshot } from './proposal-undo.ts';

/**
 * What a tool's `preview` (agent-tools.ts) is built from: the few shapes a proposal's card draws (ProposalDetail,
 * @loca/shared), with the project's own names for the ids a change names and, for a save, what each field holds now
 * (or held, once accepted) beside what it gets. A tool says its own change here; nothing looks a tool up by name.
 */
type Proposal = typeof s.proposals.$inferSelect;
/** The proposal a preview is made for: an accepted one reads its old values from the calls that undo it, a proposed run its plan from the check's report. */
export type Previewed = Pick<Proposal, 'tool' | 'status' | 'undo' | 'report'>;

type Values = Record<string, unknown>;
const isRecord = (value: unknown): value is Values => typeof value === 'object' && value !== null && !Array.isArray(value);
const records = (value: unknown): Values[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

type Row = readonly [label: string, value: unknown, as?: 'code'];
/** Label → value rows. A value that is not there (undefined, null, '', an empty list) leaves its row out, and no row leaves the detail out. */
export function fields(...rows: (Row | false | null | undefined | '')[]): ProposalDetail[] {
  const kept = rows.flatMap((row) => {
    if (!row) return [];
    const [label, value, as] = row;
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return [];
    return [{ label, value: Array.isArray(value) ? value.map(String).join(', ') : String(value), ...(as === 'code' && { code: true as const }) }];
  });
  return kept.length ? [{ kind: 'fields', rows: kept }] : [];
}
/** A remark that always shows. */
export const remark = (text: string): ProposalDetail => ({ kind: 'note', tone: 'muted', text });
/** What accepting does, said only while the proposal waits. */
export const onAccept = (text: string, tone: 'muted' | 'danger' = 'danger'): ProposalDetail => ({ kind: 'note', tone, text, whilePending: true });
/** A long list as its first entries and how many more. */
export const some = (values: readonly string[], shown = 3) => (values.length > shown ? `${values.slice(0, shown).join(', ')} 외 ${values.length - shown}개` : values.join(', '));
/** What an item of each kind is called. */
export const WHAT: Record<string, string> = { ...Object.fromEntries(Object.entries(DELETABLE).map(([kind, entry]) => [kind, entry.what])), script: '대사', scenes: '묶음' };

/** The project's names for ids: an id it does not have (or a name written instead of an id) is shown as written. */
export function previewNames(db: Db, projectId: string) {
  const named = (find: (id: string) => string | undefined) => (id: unknown): string | undefined => (typeof id === 'string' && id ? (find(id) ?? id) : undefined);
  return {
    status: named((id) => db.select({ name: s.statuses.name }).from(s.statuses).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).get()?.name),
    tag: named((id) => db.select({ name: s.tags.name }).from(s.tags).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).get()?.name),
    workflow: named((id) => db.select({ name: s.workflows.name }).from(s.workflows).where(and(eq(s.workflows.id, id), eq(s.workflows.projectId, projectId))).get()?.name),
    group: named((id) => db.select({ name: s.groups.title }).from(s.groups).where(and(eq(s.groups.id, id), eq(s.groups.projectId, projectId))).get()?.name),
    term: named((id) => db.select({ name: s.terms.source }).from(s.terms).where(and(eq(s.terms.id, id), eq(s.terms.projectId, projectId))).get()?.name),
    connection: named((id) => db.select({ name: s.connections.name }).from(s.connections).where(and(eq(s.connections.id, id), eq(s.connections.projectId, projectId))).get()?.name),
    /** A line as its key, speaker and the start of its source. */
    line: named((id) => {
      const unit = db.select({ key: s.units.key, speaker: s.units.speaker, source: s.units.source }).from(s.units).where(and(eq(s.units.id, id), eq(s.units.projectId, projectId))).get();
      return unit && `${unit.key}${unit.speaker ? ` · ${unit.speaker}` : ''}: ${unit.source.trim().slice(0, 200)}`;
    }),
  };
}
export type PreviewNames = ReturnType<typeof previewNames>;

// ── knowledge saves ─────────────────────────────────────────────────────────────

/** The fields of each kind a person reads, in this order, with what they are called. */
const FIELDS: Record<s.KnowledgeKind, [string, string][]> = {
  characters: [['name', '이름'], ['aliases', '별칭'], ['role', '역할'], ['gender', '성별'], ['ageBand', '나이대'], ['player', '플레이어'], ['profile', '프로필'], ['speech', '말투 메모']],
  relationships: [['kind', '관계'], ['description', '설명'], ['mutual', '쌍방']],
  speechRules: [['fromName', '화자'], ['toName', '청자'], ['level', '말투'], ['address', '호칭'], ['note', '메모'], ['startKey', '적용 시작']],
  events: [['title', '제목'], ['summary', '요약'], ['cause', '원인'], ['outcome', '결과'], ['participants', '등장인물']],
  documents: [['kind', '종류'], ['title', '제목'], ['body', '내용'], ['alwaysInclude', '문맥에 넣기']],
};
export const KNOWLEDGE_KINDS = Object.keys(FIELDS) as s.KnowledgeKind[];

const SHOWN_CHARS = 500;
/** Fields whose stored value is a code: shown by its name, as the app's own fields show it. */
const NAMES: Record<string, Record<string, string>> = { role: CHARACTER_ROLE_LABELS, gender: GENDER_LABELS, ageBand: AGE_BAND_LABELS, level: SPEECH_LEVEL_LABELS };
const show = (value: unknown, field?: string): string => {
  if (value === null || value === undefined || value === '') return '(비어 있음)';
  if (field && typeof value === 'string' && NAMES[field]?.[value]) return NAMES[field][value];
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? '예' : '아니오') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}…` : text;
};

/** The values an accepted save gave up, by item id: what the calls that undo it would put back (calls of the same tool, one item or a batch by kind). */
function givenUp(of: Previewed) {
  const out = new Map<string, Values>();
  if (!of.undo || !('calls' in of.undo)) return out;
  for (const call of of.undo.calls) {
    if (call.tool !== of.tool) continue;
    if (typeof call.input.id === 'string') out.set(call.input.id, call.input);
    for (const kind of KNOWLEDGE_KINDS) for (const item of records(call.input[kind])) if (typeof item.id === 'string') out.set(item.id, item);
  }
  return out;
}

function labelOf(kind: s.KnowledgeKind, request: Values, row: Values | undefined) {
  const pick = (key: string) => String(request[key] ?? row?.[key] ?? '').trim();
  if (kind === 'characters') return pick('name');
  if (kind === 'relationships') return `${pick('from') || '?'} → ${pick('to') || '?'}`;
  if (kind === 'speechRules') return `${pick('fromName') || '?'} → ${pick('toName') || '?'}`;
  return pick('title');
}

/** Saved knowledge items, each as who it is and, field by field, what it has now (or had, once accepted) next to what it gets. */
export function knowledgeChanges(db: Db, projectId: string, of: Previewed, requests: { kind: s.KnowledgeKind; request: unknown }[]): ProposalDetail[] {
  const saves = requests.flatMap(({ kind, request }) => (isRecord(request) ? [{ kind, request }] : []));
  if (!saves.length) return [];
  const gone = givenUp(of);
  return [{
    kind: 'changes',
    items: saves.map(({ kind, request }) => {
      const id = typeof request.id === 'string' ? request.id : undefined;
      const row = id ? snapshot(db, kind, projectId, id) : undefined;
      // Accepted: the row already holds the new values, the old ones are what the undo calls would restore. Not yet: the row.
      const before: Values | undefined = of.status === 'accepted' ? (id ? gone.get(id) : undefined) : row;
      const changes = FIELDS[kind]
        .filter(([field]) => request[field] !== undefined)
        .flatMap(([field, name]) => {
          const after = show(request[field], field);
          if (!id) return [{ field: name, after }];
          if (before === undefined || !(field in before)) return of.status === 'accepted' ? [{ field: name, after }] : [];
          const was = show(before[field], field);
          return was === after ? [] : [{ field: name, before: was, after }];
        });
      return { title: `${id ? '수정' : '추가'} · ${WHAT[kind] ?? kind} · ${labelOf(kind, request, row) || '(이름 없음)'}`, changes };
    }),
  }];
}

// ── line batches ────────────────────────────────────────────────────────────────

/** Lines of a batch a card lists; the rest are counted. */
const SHOWN_LINES = 50;
const TRANSLATE_WORDS: Record<string, string> = { exclude: '번역 제외', include: '번역 대상' };

/** A batch of line changes: how many lines get a translation, a status, tags, and the first of them. */
export function lineChanges(input: { changes?: unknown }): ProposalDetail[] {
  const changes = records(input.changes);
  const tagged = (change: Values) => strings(change.addTags).length + strings(change.removeTags).length > 0;
  return [
    {
      kind: 'lines',
      total: changes.length,
      translations: changes.filter((change) => change.translation !== undefined).length,
      statuses: changes.filter((change) => change.status).length,
      tagged: changes.filter(tagged).length,
      shown: changes.slice(0, SHOWN_LINES).map((change) => {
        const words = [
          typeof change.status === 'string' && change.status && `→ ${change.status}`,
          ...strings(change.addTags).map((tag) => `+#${tag}`),
          ...strings(change.removeTags).map((tag) => `−#${tag}`),
          change.listener !== undefined && `청자 ${typeof change.listener === 'string' && change.listener ? change.listener : '미상'}`,
          change.memo !== undefined && (change.memo ? '메모' : '메모 지움'),
          change.translate !== undefined && (TRANSLATE_WORDS[String(change.translate)] ?? '번역 제외는 규칙대로'),
        ].filter(Boolean);
        return { key: String(change.key ?? ''), ...(typeof change.translation === 'string' && { translation: change.translation }), ...(words.length && { change: words.join(' ') }) };
      }),
    },
    onAccept('그사이 바뀐 대사는 덮어쓰지 않고 건너뜁니다.', 'muted'),
  ];
}

// ── runs ────────────────────────────────────────────────────────────────────────

/** This run's models as "node → connection · model": node and connection by name where the project has them. */
function modelsText(models: unknown, definition: WorkflowDefinition | undefined, names: PreviewNames) {
  return Object.entries(isRecord(models) ? models : {})
    .map(([node, pick]) => {
      const found = definition?.nodes.find((candidate) => candidate.id === node);
      const choice = isRecord(pick) ? pick : {};
      return `${node === '*' ? '모든 AI 노드' : found ? nodeName(found) : node} → ${names.connection(choice.connection) ?? ''} · ${String(choice.model ?? '')}`;
    })
    .join(', ');
}

/** A proposed run: what it takes in and costs (the plan made when it was proposed) and everything that narrows it, as asked. */
export function startRunDetails(db: Db, projectId: string, input: Values, of: Previewed, names: PreviewNames): ProposalDetail[] {
  // The scope as it was asked (runScopeInputSchema): the line filter of a lines run, or the terms of a terms run.
  const filter = isRecord(input.filter) ? input.filter : {};
  const asked = isRecord(input.terms) ? input.terms : {};
  const listed = (from: Values, key: string, name: (value: string) => string | undefined = (value) => value) => some(strings(from[key]).map((value) => name(value) ?? value));
  const count = (from: Values, key: string) => (strings(from[key]).length ? `${strings(from[key]).length.toLocaleString()}개` : undefined);
  const people = (key: string) => strings(filter[key]).map((name) => (name === '-' ? '청자 모름' : name)).join(', ');
  const run = of.report?.run;
  // A run on glossary terms is scoped within the glossary and has no person-set statuses to keep.
  const terms = bySubject(run?.input ?? 'lines', { lines: false, terms: true });
  const marks = [...strings(filter.marks), ...strings(asked.marks)] as AutoMark[];
  const hiddenMarks = strings(filter.hideMarks) as AutoMark[];
  const narrowed = Object.keys(filter).length > 0 || Object.keys(asked).length > 0;
  const decidedBy = filter.decidedBy ?? asked.decidedBy;
  const summary = run && cardSummary(run.input, run.plan);
  const workflow = typeof input.workflowId === 'string' ? db.select({ name: s.workflows.name, definition: s.workflows.definition }).from(s.workflows).where(and(eq(s.workflows.id, input.workflowId), eq(s.workflows.projectId, projectId))).get() : undefined;
  const termStatus = (value: string) => (KNOWLEDGE_STATUS_LABELS as Record<string, string>)[value];
  const models = modelsText(input.models, workflow?.definition, names);
  return [
    ...fields(
      ['워크플로', workflow?.name ?? input.workflowId],
      summary && ['대상', [summary.targets, `AI 요청 ${summary.requests}`, summary.time && `약 ${summary.time}`, summary.money].filter(Boolean).join(' · ')],
      summary && summary.excluded > 0 && ['빠지는 줄', `번역 제외 ${summary.excluded.toLocaleString()}줄`],
      !narrowed && ['범위', terms ? '용어집 전체' : '프로젝트 전체'],
      ['장면', listed(filter, 'groups', names.group)],
      ['구역', listed(filter, 'sections')],
      ['묶음 종류', typeof filter.groupKind === 'string' ? ((GROUP_KIND_LABELS as Record<string, string>)[filter.groupKind] ?? filter.groupKind) : undefined],
      ['보기', filter.view],
      ['대사', count(filter, 'ids') ?? count(filter, 'keys')],
      ['종류', typeof filter.kind === 'string' ? ((TERM_LINE_KIND_LABELS as Record<string, string>)[filter.kind] ?? filter.kind) : undefined],
      ['상태', listed(filter, 'statuses', names.status) || listed(asked, 'statuses', termStatus)],
      ['숨긴 상태', listed(filter, 'hideStatuses', names.status)],
      filter.review === true && ['검토함', '검토함에 보이는 상태만'],
      ['화자', people('speakers')],
      ['숨긴 화자', people('hideSpeakers')],
      ['청자', people('listeners')],
      ['언급', people('mentions')],
      ['태그', listed(filter, 'tags', names.tag) || listed(asked, 'tags', names.tag)],
      ['숨긴 태그', listed(filter, 'hideTags', names.tag)],
      ['용어', listed(asked, 'terms', names.term)],
    ),
    ...(marks.length ? [{ kind: 'marks' as const, label: '표시', marks }] : []),
    ...(hiddenMarks.length ? [{ kind: 'marks' as const, label: '숨긴 표시', marks: hiddenMarks }] : []),
    ...fields(
      ['검색', filter.q],
      filter.unfinished !== undefined && ['진행', filter.unfinished ? '최종 아님' : '최종'],
      decidedBy !== undefined && ['정한 쪽', decidedBy === 'ai' ? 'AI' : '사람'],
      filter.noted !== undefined && ['메모', filter.noted ? '있음' : '없음'],
      filter.translated !== undefined && ['번역', filter.translated ? '있는 줄만' : '없는 줄만'],
      filter.excluded === 'only' && ['번역 제외', '번역 제외인 줄만 (실행에서는 빠짐)'],
      asked.emptyTarget !== undefined && ['번역', asked.emptyTarget ? '비어 있음' : '있음'],
      !terms && ['사람이 정한 것', input.changeHuman ? '상태·태그도 바꿈' : '그대로 두고 실행 상세에 남김'],
      ['모델', models],
      (run || input.limits !== undefined) && ['상한', startCaps(input.limits as RunCaps | undefined, run?.plan.suggestedLimits)],
    ),
    onAccept('수락하면 바로 실행이 시작되고 AI 호출 비용이 듭니다.', 'muted'),
  ];
}

/** Going on with a run: which run, what happens to its failed lines, and the models and caps it goes on with. */
export function continueRunDetails(db: Db, projectId: string, input: Values, names: PreviewNames): ProposalDetail[] {
  const run = typeof input.runId === 'string' ? db.select({ name: s.runs.workflowName, definition: s.runs.definition }).from(s.runs).where(and(eq(s.runs.id, input.runId), eq(s.runs.projectId, projectId))).get() : undefined;
  const limits = isRecord(input.limits) ? input.limits : {};
  const cap = (value: unknown, unit: string) => (value === undefined ? undefined : value === null ? '없앰' : `${Number(value).toLocaleString()}${unit}`);
  return [
    ...fields(
      ['실행', run?.name ?? input.runId],
      ['실패한 대사', input.retryFailed ? '실패한 단계부터 다시' : '그대로 두기'],
      ['모델', modelsText(input.models, run?.definition, names)],
      ['호출 상한', cap(limits.maxCalls, '회')],
      ['입력 토큰 상한', cap(limits.maxInputTokens, '')],
    ),
    onAccept('수락하면 실행이 이어지고 AI 호출 비용이 듭니다.', 'muted'),
  ];
}

// ── nested object & workflow diffs ──────────────────────────────────────────────

const full = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(비어 있음)';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const CONFIG_LABELS: Record<string, string> = {
  instructions: '지시문',
  model: '모델',
  connectionId: '연결',
  expression: '조건식',
  code: '코드',
  label: '이름',
  description: '설명',
  presets: '프리셋',
  custom: '직접 만든 규칙',
};

function flatten(value: unknown, path: string[] = [], out = new Map<string, string>()): Map<string, string> {
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) flatten(entry, [...path, key], out);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => entry === null || typeof entry !== 'object')) {
      out.set(path.join('.'), full(value));
    } else {
      value.forEach((entry, i) => flatten(entry, [...path, String(i + 1)], out));
    }
    return out;
  }
  out.set(path.join('.'), full(value));
  return out;
}

const pathLabel = (top: string, path: string) =>
  [top, ...(path ? path.split('.').map((part) => CONFIG_LABELS[part] ?? part) : [])].join(' › ');

export function objectChanges(
  top: string,
  before: unknown,
  after: unknown,
  known: boolean,
): { field: string; before?: string; after: string }[] {
  const afterMap = flatten(after);
  if (!known) {
    return [...afterMap].map(([path, value]) => ({ field: pathLabel(top, path), after: value }));
  }
  const beforeMap = flatten(before);
  const paths = [...new Set([...afterMap.keys(), ...[...beforeMap.keys()].sort()])];
  const out: { field: string; before?: string; after: string }[] = [];
  for (const path of paths) {
    const b = beforeMap.get(path);
    const a = afterMap.get(path);
    if (b === a) continue;
    out.push({ field: pathLabel(top, path), before: b ?? '(없음)', after: a ?? '(없음)' });
  }
  return out;
}

export function undoInput(of: Previewed): Values | undefined {
  if (!of.undo || !('calls' in of.undo)) return undefined;
  return of.undo.calls.find((call) => call.tool === of.tool)?.input;
}

type WorkflowNodeShape = { id: string; type: string; label?: string; config?: unknown };

export function workflowChanges(
  before: { name?: unknown; description?: unknown; definition?: unknown } | undefined,
  input: { name?: string; description?: string; definition?: { nodes?: WorkflowNodeShape[]; edges?: unknown[] } },
): ProposalDetail[] {
  const nodes = input.definition?.nodes ?? [];
  const edges = input.definition?.edges ?? [];
  if (!before) {
    return fields(['작업', '새로 만들기'], ['이름', input.name], ['노드', nodes.map((n) => n.label ?? n.type)], ['연결', edges.length]);
  }
  const oldDef = isRecord(before.definition) ? before.definition : {};
  const oldNodes = (Array.isArray(oldDef.nodes) ? oldDef.nodes : []) as WorkflowNodeShape[];
  const oldEdges = Array.isArray(oldDef.edges) ? oldDef.edges : [];
  const oldById = new Map(oldNodes.map((n) => [n.id, n]));
  const newById = new Map(nodes.map((n) => [n.id, n]));

  const headerChanges = [
    ...objectChanges('이름', before.name, input.name, true),
    ...objectChanges('설명', before.description, input.description, true),
  ];
  const nodeItems: { title: string; changes: { field: string; before?: string; after: string }[] }[] = [];
  for (const node of nodes) {
    const old = oldById.get(node.id);
    if (!old || JSON.stringify(old) === JSON.stringify(node)) continue;
    const changes = [...objectChanges('이름', old.label, node.label, true), ...objectChanges('설정', old.config, node.config, true)];
    if (changes.length) nodeItems.push({ title: `노드 수정 · ${node.label ?? node.type}`, changes });
  }

  const added = nodes.filter((n) => !oldById.has(n.id));
  const removed = oldNodes.filter((n) => !newById.has(n.id));
  const lists: ProposalDetail[] = [
    ...(added.length ? [{ kind: 'list' as const, title: '추가할 노드', items: added.map((n) => `${n.label ?? n.type} (${n.type})`) }] : []),
    ...(removed.length ? [{ kind: 'list' as const, title: '삭제할 노드', items: removed.map((n) => n.label ?? n.type) }] : []),
  ];

  const oldEdgeSet = new Set(oldEdges.map((edge) => JSON.stringify(edge)));
  const newEdgeSet = new Set(edges.map((edge) => JSON.stringify(edge)));
  const edgeChanged = JSON.stringify([...oldEdgeSet].sort()) !== JSON.stringify([...newEdgeSet].sort());
  const edgeFields = edgeChanged
    ? fields([
        '연결',
        `${oldEdges.length} → ${edges.length}개 (추가 ${[...newEdgeSet].filter((e) => !oldEdgeSet.has(e)).length} · 삭제 ${[...oldEdgeSet].filter((e) => !newEdgeSet.has(e)).length})`,
      ])
    : [];

  const items = [...(headerChanges.length ? [{ title: `워크플로 · ${input.name ?? ''}`, changes: headerChanges }] : []), ...nodeItems];
  const details: ProposalDetail[] = [...(items.length ? [{ kind: 'changes' as const, items }] : []), ...lists, ...edgeFields];
  return details.length ? details : [remark('바뀌는 내용이 없습니다.')];
}
