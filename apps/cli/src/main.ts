import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, Option } from 'commander';
import { hc } from 'hono/client';
import type { AppType } from '@tw/server/app';
import { acceptedLabel, AUTO_MARKS, CHECK_KINDS, EXCLUSION_REASON_LABELS, CONTEXT_ITEM_KINDS, importFileJsonSchema, importFileSchema, importWarnings, KNOWLEDGE_MARK_IDS, KNOWLEDGE_STATUS_LABELS, LINE_MARK_IDS, lineChangeSchema, summarizeImport, retryConfigSchema, retrySummary, TERM_MARK_IDS, termScopeLabel, type AutoMark, type KnowledgeStatus, type LineFilterInput, type LineMark, personLabel, DECIDED_BY, type DecidedBy, EXCLUDED_FILTERS, type ExcludedFilter } from '@tw/shared';

/**
 * loca — the workbench from a terminal, for people and for agents with a shell (codex, claude…).
 * It talks to the running app's local API, so the screen updates live and nothing touches the
 * database directly. Reading prints results; anything that changes the project becomes a proposal
 * the user accepts in the app. With --json / --jsonl only data goes to stdout; messages go to stderr.
 * `format` and `workspace` work without the app.
 */

const program = new Command('loca')
  .description('게임 번역 작업실 loca를 터미널에서 씁니다. format·workspace 말고는 실행 중인 loca 앱에 연결합니다.')
  .option('--url <url>', 'loca 앱 주소', process.env.LOCA_URL ?? 'http://127.0.0.1:4317')
  .option('-p, --project <이름|id>', '프로젝트 (환경 변수 LOCA_PROJECT). 프로젝트가 하나면 생략 가능')
  .option('--json', '사람용 표 대신 JSON으로 출력 (목록은 {total, rows})')
  .showHelpAfterError()
  .addHelpText(
    'after',
    `
자주 쓰는 흐름:
  번역      loca export --untranslated -g s1 -c 4 -t -o s1.jsonl  →  번역해 채운 뒤  loca import s1.jsonl
  점검      loca check terms -g s1        (찾은 게 있으면 종료 코드 1)
  워크플로  loca workflows list · loca workflows show 번역 --json > wf.json  →  고친 뒤  loca workflows save wf.json
  실행      loca runs plan 번역 -g s1  →  loca runs start 번역 -g s1  →  loca runs list · loca runs show <id>
  그래프    loca views create --label "미라와 요나스" -s MIRA JONAS  (링크 출력)
  그 밖     loca tools · loca tools <이름> · loca call <이름> '{...}'

바꾸는 명령(import, workflows save, runs start, 변경 도구)은 모두 제안이 되고, 앱에서 수락해야 반영됩니다.
loca proposals list --status pending 으로 대기 중인 제안을 봅니다.`,
  );

const globals = () => program.opts<{ url: string; project?: string; json?: boolean }>();
const api = () => hc<AppType>(globals().url.replace(/\/+$/, '')).api;
const log = (...parts: unknown[]) => console.error(...parts);

class CliError extends Error {}

async function unwrap<T extends Response & { json(): Promise<unknown> }>(request: Promise<T>): Promise<Awaited<ReturnType<T['json']>>> {
  let response: T;
  try {
    response = await request;
  } catch {
    throw new CliError(`loca 앱(${globals().url})에 연결하지 못했습니다. 앱이 켜져 있는지 확인하세요.`);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new CliError(body.error ?? `요청이 실패했습니다 (HTTP ${response.status}).`);
  }
  return (await response.json()) as Awaited<ReturnType<T['json']>>;
}

let cachedProject: string | null = null;
async function projectId(): Promise<string> {
  if (cachedProject) return cachedProject;
  const wanted = globals().project ?? process.env.LOCA_PROJECT;
  const projects = await unwrap(api().cli.projects.$get());
  if (!projects.length) throw new CliError('프로젝트가 없습니다. 앱에서 표준 파일을 먼저 가져오세요.');
  const match = wanted
    ? (projects.find((project) => project.id === wanted) ??
      projects.find((project) => project.name.toLowerCase() === wanted.toLowerCase()) ??
      projects.find((project) => project.name.toLowerCase().includes(wanted.toLowerCase())))
    : projects.length === 1
      ? projects[0]
      : undefined;
  if (!match) throw new CliError(`프로젝트를 골라 주세요 (--project 또는 LOCA_PROJECT):\n${projects.map((project) => `  ${project.name}  (${project.id})`).join('\n')}`);
  return (cachedProject = match.id);
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
/** A list in --json is always { total, rows }: rows are what was read, total how many there are. */
const printList = (total: number, rows: unknown[]) => print({ total, rows });
/** Says when a page left lines out, and how to get the rest. */
const moreHint = (total: number, shown: number, offset: number, all = true) => {
  if (shown && offset + shown < total) log(`다음: --offset ${offset + shown}${all ? ' (전부: --all)' : ''} · 남은 ${(total - offset - shown).toLocaleString()}개`);
};
/** A page in the app, from the app address the CLI talks to. */
const appLink = (pathname: string, search: Record<string, string | undefined> = {}) => {
  const query = new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return `${globals().url.replace(/\/+$/, '')}${pathname}${query ? `?${query}` : ''}`;
};
const printJsonl = (rows: unknown[]) => {
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
};
const short = (text: string | null | undefined, length = 80) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

/** Marks as the app shows them: #name. */
const markText = (marks: readonly string[] | undefined) => (marks ?? []).map((mark) => `#${AUTO_MARKS[mark as AutoMark]?.name ?? mark}`).join(' ');
const withMarks = (text: string, marks: readonly string[] | undefined, tags: readonly string[] = []) => [text, markText(marks), ...tags.map((tag) => `#${tag}`)].filter(Boolean).join('  ');

/** A read-only agent tool (the same one the chat and `loca call` use). A tool-level error becomes a CliError. */
async function readTool<T = Record<string, any>>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const response = await unwrap(api().projects[':projectId'].tools[':name'].$post({ param: { projectId: await projectId(), name }, json: input }));
  if (response.proposed) throw new CliError(`${name}은(는) 변경 도구라 읽기 명령으로 부를 수 없습니다.`);
  const result = (response as { result?: unknown }).result as { error?: string } | undefined;
  if (result && typeof result === 'object' && typeof result.error === 'string') throw new CliError(result.error);
  return result as T;
}
/** What became of a change: applied now (the terminal permission mode allowed it), failed while applying, or waiting for the person. */
type Outcome = { proposalId: string; applied: boolean; status: string; result?: unknown; review?: string | null };

/** A change tool, through the terminal permission mode. Prints what the check left out and returns the outcome. */
async function proposeTool(name: string, input: Record<string, unknown>): Promise<Outcome> {
  const response = await unwrap(api().projects[':projectId'].tools[':name'].$post({ param: { projectId: await projectId(), name }, json: input }));
  if (!response.proposed) {
    const result = (response as { result?: { error?: string } }).result;
    throw new CliError(result?.error ?? `${name}은(는) 제안을 만들지 않았습니다.`);
  }
  logDropped((response as { report?: Report }).report);
  const outcome = response as unknown as Outcome;
  return { proposalId: outcome.proposalId, applied: outcome.applied, status: outcome.status, result: outcome.result, review: outcome.review };
}

type Report = { dropped?: { key: string; reason: string }[]; warnings?: { key: string; issues: string[] }[] } | null | undefined;
/** What the check left out and why (a duplicate term, a tag that cannot go there, a stale line), not just the first. */
const logDropped = (report: Report) => {
  for (const entry of report?.dropped?.slice(0, 20) ?? []) log(`  뺌  ${entry.key}: ${entry.reason}`);
  for (const entry of report?.warnings?.slice(0, 20) ?? []) log(`  경고  ${entry.key}: ${entry.issues.join(' / ')}`);
};

/** Where waiting proposals are decided. */
const ACCEPT_HINT = 'loca 앱 채팅 패널의 ‘제안’에서 수락하면 반영됩니다';
const failure = (result: unknown) => (result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string' ? (result as { error: string }).error : JSON.stringify(result));

/** Says what became of a change; a change that failed while applying fails the command. */
function reportOutcome(outcome: Outcome, what = '변경') {
  if (outcome.applied) return console.log(`${what}: 반영했습니다 (${outcome.proposalId}, 터미널 권한 모드).`);
  if (outcome.status === 'failed') {
    process.exitCode = 1;
    return console.log(`${what}: 반영하려 했지만 실패했습니다 (${outcome.proposalId}): ${failure(outcome.result)}`);
  }
  console.log(`${what}: 제안으로 올렸습니다 (${outcome.proposalId}). ${ACCEPT_HINT}.${outcome.review ? `\n자동 검토가 넘김: ${outcome.review}` : ''}\n기다리려면: loca proposals wait ${outcome.proposalId}`);
}

/** --json prints the outcome; otherwise one sentence. */
const printOutcome = (outcome: Outcome, what?: string) => {
  if (globals().json) {
    if (outcome.status === 'failed') process.exitCode = 1;
    return print(outcome);
  }
  reportOutcome(outcome, what);
};

/** A workflow by id, exact name, or part of its name. */
async function resolveWorkflow(ref: string) {
  const workflows = await unwrap(api().projects[':projectId'].workflows.$get({ param: { projectId: await projectId() } }));
  const lower = ref.toLowerCase();
  const match = workflows.find((item) => item.id === ref) ?? workflows.find((item) => item.name.toLowerCase() === lower) ?? workflows.filter((item) => item.name.toLowerCase().includes(lower));
  if (Array.isArray(match)) {
    if (match.length === 1) return match[0]!;
    throw new CliError(`${match.length ? '여러 워크플로가 맞습니다' : '워크플로를 찾지 못했습니다'}: ${ref}\n${(match.length ? match : workflows).map((item) => `  ${item.name}  (${item.id})`).join('\n')}`);
  }
  return match;
}

/** Scenes / groups by id, key or title. */
async function resolveGroups(refs: string[] | undefined) {
  if (!refs?.length) return undefined;
  const groups = await unwrap(api().projects[':projectId'].groups.$get({ param: { projectId: await projectId() }, query: {} }));
  return refs.map((ref) => {
    const found = groups.find((group) => group.id === ref || group.key === ref) ?? groups.find((group) => group.title === ref);
    if (!found) throw new CliError(`장면·묶음을 찾지 못했습니다: ${ref} (loca scenes list로 확인)`);
    return found;
  });
}

/** The groups of these sections (장·출처), by id, for run scopes that take groups; with `--group` too, both must hold. */
async function sectionGroups(sections: string[] | undefined, groups: string[] | undefined) {
  if (!sections?.length) return groups;
  const all = await unwrap(api().projects[':projectId'].groups.$get({ param: { projectId: await projectId() }, query: {} }));
  const inSections = all.filter((group) => group.section && sections.includes(group.section));
  if (!inSections.length) throw new CliError(`구역을 찾지 못했습니다: ${sections.join(', ')} (loca stats sections로 확인)`);
  const picked = groups?.length ? (await resolveGroups(groups))!.map((group) => group.id) : null;
  const ids = inSections.map((group) => group.id).filter((id) => !picked || picked.includes(id));
  if (!ids.length) throw new CliError('고른 장면·묶음이 그 구역에 없습니다.');
  return ids;
}

/** Every line of a saved view (id and key), for run scopes that take lines. */
async function viewLines(view: string) {
  const rows: { id: string; key: string }[] = [];
  for (let offset = 0; ; ) {
    const page = await unwrap(api().projects[':projectId'].lines.find.$post({ param: { projectId: await projectId() }, json: { view, offset, limit: 1000 } }));
    rows.push(...page.rows.map((row) => ({ id: row.id, key: row.key })));
    offset += page.rows.length;
    if (!page.rows.length || offset >= page.total) break;
  }
  if (!rows.length) throw new CliError(`보기에 대사가 없습니다: ${view}`);
  return rows;
}

/** A tool result cut for length says so (fitResult); the command tells how to narrow it. */
const warnTruncated = (result: { truncated?: { shown: number; total: number } }, hint: string) => {
  if (result.truncated) log(`결과가 길어 ${result.truncated.shown}/${result.truncated.total}개만 받았습니다. ${hint}`);
};

/** A file's text, or stdin for "-"; a file that cannot be read is said plainly, not as a stack trace. */
function readText(file: string): string {
  try {
    return readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (error) {
    throw new CliError(`파일을 읽지 못했습니다: ${file} (${(error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))})`);
  }
}

/** JSON from an argument: literal JSON, @path to a file, or - for stdin (no shell quoting needed). */
function readJsonArg(value: string | undefined): unknown {
  if (value === undefined) return {};
  const text = value === '-' ? readText('-') : value.startsWith('@') ? readText(value.slice(1)) : value;
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('JSON을 읽지 못했습니다. 직접 쓰기 어려우면 @파일 또는 - (표준 입력)으로 넘기세요.');
  }
}

/**
 * Waits on the app's change events (the same SSE stream the screens use; nothing polls): runs
 * `check` once connected and again after each change to `topic` in this project, until it returns
 * a value. `timeout` is in minutes.
 */
async function waitFor<T>(topic: string, check: () => Promise<T | undefined>, timeout?: number): Promise<T> {
  const id = await projectId();
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(new CliError(`${timeout}분 동안 끝나지 않아 기다리기를 멈췄습니다. 하던 일은 앱에서 계속됩니다.`)), timeout * 60_000) : undefined;
  try {
    let response: Response;
    try {
      response = await fetch(`${globals().url.replace(/\/+$/, '')}/api/events`, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
    } catch {
      throw new CliError(`loca 앱(${globals().url})에 연결하지 못했습니다. 앱이 켜져 있는지 확인하세요.`);
    }
    if (!response.ok || !response.body) throw new CliError(`변경 알림을 받지 못했습니다 (HTTP ${response.status}).`);
    const first = await check();
    if (first !== undefined) return first;
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!/^event: change$/m.test(block)) continue;
        const data = /^data: (.*)$/m.exec(block)?.[1];
        const event = data ? (JSON.parse(data) as { projectId?: string; topics: string[] }) : null;
        if (!event || (event.projectId && event.projectId !== id) || !event.topics.includes(topic)) continue;
        const done = await check();
        if (done !== undefined) return done;
      }
    }
    throw new CliError('앱과의 연결이 끊겼습니다. 다시 기다리려면 같은 명령을 실행하세요.');
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof CliError) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

type Proposal = { id: string; tool: string; status: 'pending' | 'running' | 'accepted' | 'rejected' | 'failed'; result?: unknown; reason?: string | null };
/** Until the person (or the permission mode) has decided a proposal and it has been applied. */
const waitProposal = (id: string, timeout?: number) =>
  waitFor('proposals', async () => {
    const proposal = (await unwrap(api().projects[':projectId'].proposals[':id'].$get({ param: { projectId: await projectId(), id } }))) as Proposal;
    return proposal.status === 'pending' || proposal.status === 'running' ? undefined : proposal;
  }, timeout);

// ── line filters ─────────────────────────────────────────────────────

interface FilterOptions {
  q?: string;
  speaker?: string[];
  listener?: string[];
  mentions?: string[];
  group?: string[];
  section?: string[];
  kind?: 'dialogue' | 'document' | 'ui';
  groupKind?: 'scene' | 'document' | 'ui';
  status?: string[];
  tag?: string[];
  mark?: LineMark[];
  unfinished?: boolean;
  finished?: boolean;
  by?: DecidedBy;
  noted?: boolean;
  withoutNote?: boolean;
  excluded?: ExcludedFilter;
  hideSpeaker?: string[];
  hideStatus?: string[];
  hideTag?: string[];
  hideMark?: LineMark[];
  translated?: boolean;
  untranslated?: boolean;
  key?: string[];
  view?: string;
  limit?: string;
  offset?: string;
}

function withFilters(command: Command) {
  return command
    .option('-q, --q <글자>', '원문·번역·화자·키에 들어 있는 글자 (%·_·\\도 그 글자 그대로)')
    .option('-s, --speaker <names...>', '이 인물이 하는 대사 (이름·별칭·화자 키)')
    .option('-l, --listener <names...>', '이 인물에게 하는 대사 (청자). "-"는 청자 모름(청자를 모르거나 AI 추정이 불확실한 대사)')
    .option('-m, --mentions <names...>', '이 인물을 언급하는 대사 ({ALIAS} 포함)')
    .option('-g, --group <groups...>', '장면·묶음')
    .option('--section <sections...>', '구역(장·출처)')
    .addOption(new Option('--kind <종류>', '대사 종류').choices(['dialogue', 'document', 'ui']))
    .addOption(new Option('--group-kind <종류>', '묶음 종류').choices(['scene', 'document', 'ui']))
    .option('--status <statuses...>', '상태 이름')
    .option('--tag <tags...>', '태그 이름 (모두 붙은 대사)')
    .addOption(new Option('--mark <marks...>', '자동 태그가 모두 붙은 대사. 앱 목록의 필터와 같은 규칙').choices(LINE_MARK_IDS))
    .option('--unfinished', '상태가 최종이 아닌 대사 (남은 일. 번역 제외 대사는 빠짐)')
    .option('--finished', '상태가 최종인 대사')
    .addOption(new Option('--by <누구>', '정한 쪽: ai = AI가 정하고 사람이 아직 안 봄(✦), human = 사람이 정함').choices(DECIDED_BY))
    .option('--noted', '메모가 있는 대사')
    .option('--without-note', '메모가 없는 대사')
    .addOption(new Option('--excluded <방식>', '번역 제외 대사: hide = 뺌, only = 그것만 (없으면 함께)').choices(EXCLUDED_FILTERS))
    .option('--hide-speaker <names...>', '숨기기: 이 인물이 하는 대사는 뺌')
    .option('--hide-status <statuses...>', '숨기기: 이 상태의 대사는 뺌')
    .option('--hide-tag <tags...>', '숨기기: 이 태그 중 하나라도 붙은 대사는 뺌')
    .addOption(new Option('--hide-mark <marks...>', '숨기기: 이 자동 태그 중 하나라도 붙은 대사는 뺌').choices(LINE_MARK_IDS))
    .option('--translated', '번역이 있는 대사만')
    .option('--untranslated', '번역이 없는 대사만')
    .option('--key <keys...>', '대사 키')
    .option('--view <보기>', '대사 그래프의 저장된 보기(이름·id) 안의 대사. export는 보기의 흐름 순서로')
    .option('--limit <n>', '한 번에 가져올 수 (최대 1000)')
    .option('--offset <n>', '건너뛸 수');
}

function filterFrom(options: FilterOptions): LineFilterInput {
  return {
    q: options.q,
    speakers: options.speaker,
    listeners: options.listener,
    mentions: options.mentions,
    groups: options.group,
    sections: options.section,
    kind: options.kind,
    groupKind: options.groupKind,
    statuses: options.status,
    tags: options.tag,
    marks: options.mark,
    unfinished: options.unfinished ? true : options.finished ? false : undefined,
    decidedBy: options.by,
    noted: options.noted ? true : options.withoutNote ? false : undefined,
    excluded: options.excluded,
    hideSpeakers: options.hideSpeaker,
    hideStatuses: options.hideStatus,
    hideTags: options.hideTag,
    hideMarks: options.hideMark,
    translated: options.translated ? true : options.untranslated ? false : undefined,
    keys: options.key,
    view: options.view,
    limit: options.limit ? Number(options.limit) : undefined,
    offset: options.offset ? Number(options.offset) : undefined,
  };
}

// ── commands ─────────────────────────────────────────────────────────

const projects = program.command('projects').description('프로젝트: 목록, 표준 파일로 새로 만들기');

projects
  .command('list', { isDefault: true })
  .description('프로젝트 목록')
  .action(async () => {
    const rows = await unwrap(api().cli.projects.$get());
    if (globals().json) return print(rows);
    for (const project of rows) console.log(`${project.name}  (${project.id})`);
  });

projects
  .command('import <파일>')
  .description('표준 파일(loca/v1)로 새 프로젝트 만들기 (앱의 가져오기와 같음; 있던 프로젝트는 건드리지 않음). 먼저 loca format check로 검사합니다. 새 프로젝트는 홈 설정의 기본값을 복사해 가고, 연결 키는 사람이 앱에서 넣습니다')
  .action(async (file: string) => {
    const data = readJsonArg(file === '-' ? '-' : `@${file}`);
    const checked = await unwrap(api().projects.validate.$post({ json: data }));
    if (!checked.ok) {
      process.exitCode = 1;
      if (globals().json) return print(checked);
      return console.log(`형식 오류 ${checked.issues.length}개 (loca format check ${file}로 자세히):\n${checked.issues.slice(0, 20).map((issue) => `  ${issue.path || '(파일)'}: ${issue.message}`).join('\n')}`);
    }
    const summary = await unwrap(api().projects.$post({ json: data as never }));
    if (globals().json) return print(summary);
    console.log(`프로젝트를 만들었습니다: ${checked.summary.name}  (${summary.projectId})\n  묶음 ${summary.groups} · 대사 ${summary.units} · 그래프 노드 ${summary.graphNodes} · 연결 ${summary.graphEdges}\n  이 프로젝트로: LOCA_PROJECT=${summary.projectId}`);
  });

withFilters(program.command('lines').description('대사 찾기. 필터를 조합합니다. 한 번에 --limit(기본 200)개, --all이면 끝까지'))
  .option('--all', '모든 페이지를 읽기')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (options: FilterOptions & { all?: boolean; jsonl?: boolean }) => {
    const id = await projectId();
    const filter = filterFrom(options);
    const rows = [];
    let total = 0;
    for (let offset = filter.offset ?? 0; ; ) {
      const page = await unwrap(api().projects[':projectId'].lines.find.$post({ param: { projectId: id }, json: { ...filter, offset } }));
      total = page.total;
      rows.push(...page.rows);
      offset += page.rows.length;
      if (!options.all || !page.rows.length || offset >= total) break;
    }
    log(`대사 ${total.toLocaleString()}개 중 ${rows.length.toLocaleString()}개`);
    if (!options.all) moreHint(total, rows.length, filter.offset ?? 0);
    if (options.jsonl) return printJsonl(rows);
    if (globals().json) return printList(total, rows);
    for (const row of rows) console.log(`${row.key}  [${row.status}${row.statusBy === 'ai' ? ' ✦' : ''}${row.excluded ? ' · 번역 제외' : ''}] ${row.speaker ?? '—'}${row.listener ? ` → ${row.listener}` : ''}: ${short(row.source)}${row.translation ? `\n    → ${short(row.translation)}` : ''}${row.marks.length || row.tags.length ? `\n    ${withMarks('', row.marks, row.tags)}` : ''}`);
  });

const speakers = program
  .command('speakers')
  .description('화자 목록과 대사 수 (저장된 인물과 연결된 이름 포함)')
  .action(async () => {
    const rows = await unwrap(api().projects[':projectId'].speakers.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return print(rows);
    for (const row of rows) console.log(`${String(row.lines).padStart(6)}  ${row.speaker ?? '(화자 없음)'}${row.character && row.character !== row.speaker ? `  = ${row.character}` : ''}`);
  });

speakers
  .command('first <이름>')
  .description('인물이 처음 말하는 대사와 장면')
  .action(async (name: string) => {
    const row = await unwrap(api().projects[':projectId'].speakers[':name'].first.$get({ param: { projectId: await projectId(), name } }));
    if (!row) throw new CliError(`${name}의 대사가 없습니다.`);
    if (globals().json) return print(row);
    console.log(`${row.group.title} (${row.group.section ?? '구역 없음'})\n${row.key}  ${row.speaker}: ${row.source}`);
  });

const scenes = program.command('scenes').description('장면·묶음: 목록, 한 장면 읽기, 함께 나오는 장면');

scenes
  .command('list')
  .description('장면·문서·UI 묶음을 대본 순서로')
  .option('-q, --q <글자>', '제목·키에 들어 있는 글자')
  .option('--limit <n>', '한 번에 가져올 수 (최대 200)', '200')
  .option('--offset <n>', '건너뛸 수', '0')
  .action(async (options: { q?: string; limit: string; offset: string }) => {
    const data = await readTool<{ total: number; scenes: { id: string; key: string; kind: string; title: string; description: string }[] }>('list_scenes', { q: options.q, limit: Number(options.limit), offset: Number(options.offset) });
    log(`장면·묶음 ${data.total.toLocaleString()}개 중 ${data.scenes.length.toLocaleString()}개`);
    moreHint(data.total, data.scenes.length, Number(options.offset), false);
    if (globals().json) return printList(data.total, data.scenes);
    for (const scene of data.scenes) console.log(`${scene.key.padEnd(12)} ${scene.title}${scene.kind !== 'scene' ? `  [${scene.kind}]` : ''}${scene.description ? `\n             ${short(scene.description, 100)}` : ''}`);
  });

scenes
  .command('show <장면>')
  .description('한 장면의 대사를 대본 순서로 (장면은 키·id·제목)')
  .option('--limit <n>', '한 번에 가져올 수 (최대 200)', '200')
  .option('--offset <n>', '건너뛸 수', '0')
  .action(async (ref: string, options: { limit: string; offset: string }) => {
    const [group] = (await resolveGroups([ref]))!;
    const data = await readTool<{ total: number; lines: { key: string; speaker: string | null; listener?: string | null; source: string; translation: string | null }[] } & Record<string, unknown>>('read_scene', { sceneId: group!.id, limit: Number(options.limit), offset: Number(options.offset) });
    const lines = (data.lines ?? []) as { key: string; speaker: string | null; listener?: string | null; source: string; translation: string | null }[];
    log(`${group!.title}: 대사 ${(data.total ?? lines.length).toLocaleString()}줄 중 ${lines.length.toLocaleString()}줄`);
    moreHint(Number(data.total ?? lines.length), lines.length, Number(options.offset), false);
    if (globals().json) return print(data);
    for (const line of lines) console.log(`${line.key}  ${line.speaker ?? '—'}${line.listener ? ` → ${line.listener}` : ''}: ${short(line.source, 100)}${line.translation ? `\n    → ${short(line.translation, 100)}` : ''}`);
  });

scenes
  .command('with <이름...>')
  .description('여러 인물이 함께 나오는 장면')
  .action(async (names: string[]) => {
    const rows = await unwrap(api().projects[':projectId'].scenes.with.$post({ param: { projectId: await projectId() }, json: { speakers: names } }));
    log(`장면 ${rows.length}개`);
    if (globals().json) return printList(rows.length, rows);
    for (const row of rows) console.log(`${row.title}  (${row.key})  ${Object.entries(row.lines).map(([speaker, lines]) => `${speaker} ${lines}`).join(', ')}`);
  });

program
  .command('line <키>')
  .description('대사 하나와 앞뒤 대사, 대사 그래프의 분기')
  .option('-a, --around <n>', '앞뒤로 볼 대사 수', '5')
  .action(async (key: string, options: { around: string }) => {
    const context = await unwrap(api().projects[':projectId'].lines[':key'].context.$get({ param: { projectId: await projectId(), key }, query: { around: options.around } }));
    if (!context) throw new CliError(`대사를 찾을 수 없습니다: ${key}`);
    if (globals().json) return print(context);
    for (const row of context.before) console.log(`  ${row.speaker ?? '—'}: ${short(row.source)}`);
    console.log(`▶ ${context.line.speaker ?? '—'}${context.line.listener ? ` → ${context.line.listener}` : ''}: ${context.line.source}${context.line.translation ? `\n  → ${context.line.translation}` : ''}${context.line.marks.length ? `\n  ${markText(context.line.marks)}` : ''}`);
    for (const row of context.after) console.log(`  ${row.speaker ?? '—'}: ${short(row.source)}`);
    if (context.graph) {
      const show = (label: string, list: typeof context.graph.incoming) =>
        list.length && console.log(`${label}: ${list.map((item) => `${item.label ?? item.type ?? item.kind}${item.edge ? ` [${item.edge}]` : ''}${item.firstLine ? ` "${short(item.firstLine.source, 40)}"` : ''}`).join(' | ')}`);
      show('들어오는 곳', context.graph.incoming);
      show('나가는 곳', context.graph.outgoing);
    }
  });

withFilters(
  program
    .command('check <종류>')
    .description(`번역 점검: ${Object.entries(CHECK_KINDS).map(([kind, label]) => `${kind}(${label})`).join(', ')}. 찾은 게 있으면 종료 코드 1`),
)
  .option('--ratio <배수>', 'length: 원문보다 몇 배 길면 걸지', '1.5')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (kind: string, options: FilterOptions & { ratio: string; jsonl?: boolean }) => {
    if (!(kind in CHECK_KINDS)) throw new CliError(`점검 종류는 ${Object.keys(CHECK_KINDS).join(', ')} 중 하나입니다.`);
    const items = (await unwrap(
      api().projects[':projectId'].checks[':kind{terms|consistency|format|length}'].$post({
        param: { projectId: await projectId(), kind: kind as 'terms' },
        json: { filter: filterFrom(options), ratio: Number(options.ratio) },
      }),
    )) as Record<string, unknown>[];
    log(`${CHECK_KINDS[kind as keyof typeof CHECK_KINDS]} ${items.length}건`);
    // Findings fail the command, so a script can stop on them.
    if (items.length) process.exitCode = 1;
    if (options.jsonl) return printJsonl(items);
    if (globals().json) return printList(items.length, items);
    for (const item of items) {
      if (kind === 'consistency') {
        console.log(`"${short(String(item.source))}"`);
        for (const variant of item.variants as { translation: string; keys: string[] }[]) console.log(`    → ${short(variant.translation)}  (${variant.keys.length}곳: ${variant.keys.slice(0, 3).join(', ')}${variant.keys.length > 3 ? '…' : ''})`);
      } else {
        const detail =
          kind === 'terms' ? `"${item.term}" → "${item.expected}"` : kind === 'format' ? (item.issues as string[]).join(' / ') : `×${item.ratio}`;
        console.log(`${item.key}  ${detail}\n    ${short(String(item.source))}\n    → ${short(String(item.translation))}`);
      }
    }
  });

program
  .command('stats <대상>')
  .description('진행 상황: groups(묶음별), sections(구역별). 실행은 loca runs list')
  .action(async (of: string) => {
    if (!['groups', 'sections'].includes(of)) throw new CliError('대상은 groups, sections 중 하나입니다.');
    const data = await unwrap(api().projects[':projectId'].stats[':of{groups|sections|runs}'].$get({ param: { projectId: await projectId(), of: of as 'groups' }, query: {} }));
    if (globals().json) return printList((data as unknown[]).length, data as unknown[]);
    for (const row of data as { lines: number; translated: number; untranslated: number; [key: string]: unknown }[])
      console.log(`${String(row.untranslated).padStart(6)} 미번역 / ${String(row.lines).padStart(6)}  ${row.group ?? row.section}`);
  });

withFilters(program.command('export').description('번역할 대사를 JSONL로 내보내기 (key와 rev 포함). 번역해서 import로 돌려보냅니다. --view면 보기의 흐름 순서로'))
  .option('-c, --context <n>', '대사마다 앞 대사 몇 줄을 문맥으로 붙일지 (AI 노드처럼 대사 그래프를 거슬러: before, 갈래가 합쳐지는 곳은 beforeBranches)', '0')
  .option('-t, --terms', '대사에 나오는 확정 용어를 붙이기')
  .option('-o, --out <파일>', '저장할 파일 (없으면 표준 출력)')
  .action(async (options: FilterOptions & { context: string; terms?: boolean; out?: string }) => {
    const rows = await unwrap(
      api().projects[':projectId'].export.$post({ param: { projectId: await projectId() }, json: { filter: filterFrom(options), before: Number(options.context), terms: Boolean(options.terms), all: !options.limit } }),
    );
    const text = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    if (options.out) {
      writeFileSync(options.out, text);
      log(`대사 ${rows.length.toLocaleString()}개를 ${options.out}에 저장했습니다.`);
    } else process.stdout.write(text);
  });

program
  .command('import <파일>')
  .description('JSONL(줄마다 key·rev와 바꿀 translation/status/addTags/removeTags)을 검사하고 제안 하나로 올리기. 앱에서 수락해야 반영됩니다')
  .option('--dry-run', '검사만 하고 제안은 올리지 않기')
  .addOption(new Option('--origin <누가>', '번역한 쪽').choices(['ai', 'human']).default('ai'))
  .option('--model <이름>', '번역한 모델 이름 (후보에 기록)')
  .action(async (file: string, options: { dryRun?: boolean; origin: 'ai' | 'human'; model?: string }) => {
    const text = readText(file);
    const changes = text
      .split(/\r?\n/)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.trim())
      .map(({ line, index }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          throw new CliError(`${index + 1}번째 줄이 JSON이 아닙니다.`);
        }
        const change = lineChangeSchema.safeParse(parsed);
        if (!change.success) throw new CliError(`${index + 1}번째 줄: ${change.error.issues[0]?.path.join('.')} ${change.error.issues[0]?.message}`);
        return change.data;
      });
    if (!changes.length) throw new CliError('바꿀 줄이 없습니다.');
    const report = await unwrap(
      api().projects[':projectId'].import.$post({ param: { projectId: await projectId() }, json: { changes, origin: options.origin, model: options.model, dryRun: Boolean(options.dryRun) } }),
    );
    // Lines that could not go in fail the command, so a script stops on them (the rest still went in).
    if (report.errors.length || report.conflicts.length || ('status' in report && report.status === 'failed')) process.exitCode = 1;
    if (globals().json) return print(report);
    console.log(`줄 ${report.total} · 바뀔 줄 ${report.changes} · 그대로 ${report.unchanged ?? 0} · 충돌 ${report.conflicts.length} · 오류 ${report.errors.length} · 경고 ${report.warnings.length}`);
    for (const entry of report.errors.slice(0, 20)) console.log(`  오류  ${entry.key}: ${entry.reason}`);
    for (const entry of report.conflicts.slice(0, 20)) console.log(`  충돌  ${entry.key}: ${entry.reason}`);
    for (const entry of report.warnings.slice(0, 20)) console.log(`  경고  ${entry.key}: ${entry.issues.join(' / ')}`);
    const hidden = Math.max(0, report.errors.length - 20) + Math.max(0, report.conflicts.length - 20) + Math.max(0, report.warnings.length - 20);
    if (hidden) console.log(`  … ${hidden.toLocaleString()}개 더 (--json으로 전부 보기)`);
    if (report.proposalId && 'applied' in report) reportOutcome({ proposalId: report.proposalId, applied: report.applied, status: report.status, review: report.review }, '\n번역 변경');
    else if (!options.dryRun) console.log('\n올릴 변경이 없어 제안을 만들지 않았습니다.');
  });

program
  .command('context <키>')
  .description('AI 노드가 이 대사를 번역할 때 보낼 문맥: 앞 대사(갈래별), 넣은 것과 이유, 상한 때문에 뺀 것. 모델은 부르지 않습니다')
  .option('-n, --node <id>', 'AI 노드 id (없으면 번역 후보를 만드는 첫 노드)')
  .option('-w, --workflow <id>', '같은 노드 id가 여러 워크플로에 있을 때 워크플로 id')
  .option('--prompt', '실제 프롬프트 전체도 출력')
  .action(async (key: string, options: { workflow?: string; node?: string; prompt?: boolean }) => {
    const data = await unwrap(
      api().projects[':projectId'].lines[':key']['ai-context'].$get({ param: { projectId: await projectId(), key }, query: { workflowId: options.workflow, nodeId: options.node } }),
    );
    if (globals().json) return print(data);
    if (!data || !('batch' in data) || !data.picked) throw new CliError('AI 노드가 있는 워크플로가 없습니다.');
    const { workflowId, nodeId } = data.picked;
    const picked = data.choices.find((choice) => choice.workflowId === workflowId && choice.nodeId === nodeId)!;
    const others = data.choices.filter((choice) => choice !== picked);
    console.log(`${picked.workflowName} › ${picked.nodeName}${others.length ? `   (다른 노드: ${others.map((choice) => `${choice.nodeName} -n ${choice.nodeId}`).join(', ')})` : ''}`);
    console.log(`묶음: 장면 안 ${data.batch.keys.length}줄 (${data.batch.mode}) · 문맥 약 ${data.budget.used} / 상한 ${data.budget.limit} 토큰 · 프롬프트 전체 약 ${data.promptTokens} 토큰 (추정)`);
    const show = (lines: { speaker: string | null; source: string }[]) => lines.map((line) => `    ${line.speaker ? `${line.speaker}: ` : ''}${short(line.source, 100)}`).join('\n');
    if (!data.preceding) console.log(data.precedingLines === 0 ? '\n앞 대사: 이 노드는 넣지 않도록 설정됨' : '\n앞 대사: 같은 묶음 안에 있거나 묶음의 더 앞 대사에 이미 붙음');
    else {
      if (data.preceding.lines.length) console.log(`\n앞 대사:\n${show(data.preceding.lines)}`);
      if (data.preceding.branches.length) {
        console.log('\n갈래가 합쳐지는 곳 (플레이어는 이 중 한 갈래를 거쳐 옴):');
        for (const branch of data.preceding.branches) console.log(`  [${branch.label}]\n${show(branch.lines)}`);
        if (data.preceding.moreBranches) console.log(`  … 갈래 ${data.preceding.moreBranches}개 더 (넣지 않음)`);
      }
    }
    console.log('\n묶음에 넣는 문맥:');
    for (const item of data.items) console.log(`  ${item.included ? '✓' : '✗'} ${CONTEXT_ITEM_KINDS[item.kind].padEnd(6)} ${short(item.label, 40).padEnd(40)} ~${String(item.tokens).padStart(5)}  ${item.included ? item.reason : '상한 초과로 뺌'}`);
    if (options.prompt) console.log(`\n── 프롬프트 ──\n${data.system}\n\n${data.prompt}`);
  });

program
  .command('tools [도구]')
  .description('에이전트 도구 목록 (call로 부를 수 있음). 이름을 주면 그 도구의 설명과 입력 스키마')
  .action(async (name: string | undefined) => {
    const tools = await unwrap(api().projects[':projectId'].tools.$get({ param: { projectId: await projectId() } }));
    if (name) {
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new CliError(`없는 도구입니다: ${name} (loca tools로 목록 보기)`);
      if (globals().json) return print(tool);
      return console.log(`${tool.name}${tool.changes ? ' (변경 → 제안)' : ''}\n\n${tool.description}\n\n입력:\n${JSON.stringify((tool as { input?: unknown }).input ?? {}, null, 2)}`);
    }
    if (globals().json) return printList(tools.length, tools);
    for (const tool of tools) console.log(`${tool.name}${tool.changes ? ' (변경 → 제안)' : ''}\n    ${short(tool.description, 140)}`);
  });

program
  .command('call <도구> [입력]')
  .description('에이전트 도구를 직접 호출. 입력은 JSON, @파일, 또는 - (표준 입력). 변경 도구는 터미널 권한 모드에 따라 바로 반영되거나 제안으로 기다립니다')
  .action(async (name: string, input: string | undefined) => {
    const result = await unwrap(
      api().projects[':projectId'].tools[':name'].$post({ param: { projectId: await projectId(), name }, json: readJsonArg(input) as Record<string, unknown> }),
    );
    if (result.proposed) {
      log(result.message);
      logDropped((result as { report?: Report }).report);
      const outcome = result as unknown as Outcome;
      if (outcome.status === 'failed') process.exitCode = 1;
      return print({ proposalId: outcome.proposalId, applied: outcome.applied, status: outcome.status, ...(outcome.applied || outcome.status === 'failed' ? { result: outcome.result } : {}) });
    }
    // A graph pick comes back with where to open it; say it as a link.
    const open = (result.result as { open?: { to: string; search?: Record<string, string> } } | undefined)?.open;
    if (open) log(`앱에서 열기: ${appLink(open.to.replace('$projectId', await projectId()), open.search)}`);
    print(result.result);
  });

// ── glossary, knowledge, tags, run plan ──────────────────────────────

/** `--status 후보 확정` as the tool's status ids. */
const STATUS_CHOICES = ['후보', '확정'];
const statusIds = (picked: string[] | undefined) => picked?.map((label) => (label === '후보' ? 'candidate' : 'confirmed'));

const terms = program
  .command('terms')
  .description('용어집 목록: 원문, 번역어, 상태, 나온 줄(대본에서 쓰이는 대사 수), 표시(#), 태그. 앱 용어집 화면의 필터와 같은 규칙')
  .option('-q, --q <글자>', '원문·번역어·메모에 들어 있는 글자 (대소문자 무시)')
  .addOption(new Option('--status <status...>', '상태 (앱의 상태 열). 둘을 함께 주면 둘 중 하나').choices(STATUS_CHOICES))
  .addOption(new Option('--mark <marks...>', '자동 태그. 여러 개면 모두 붙은 것').choices(TERM_MARK_IDS))
  .addOption(new Option('--by <누구>', '정한 쪽: ai = AI가 정하고 사람이 아직 안 봄(✦), human = 사람이 정함').choices(DECIDED_BY))
  .option('--empty-target', '번역어가 비어 있는 용어')
  .option('--has-target', '번역어가 있는 용어')
  .option('--unreviewed', '사람이 아직 정하지 않은 용어 (상태가 후보이거나 AI가 정한 것)')
  .option('--tag <tags...>', '태그 이름 (모두 붙은 용어)')
  .option('--limit <n>', '최대 몇 개까지')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (options: { q?: string; status?: string[]; mark?: string[]; by?: DecidedBy; emptyTarget?: boolean; hasTarget?: boolean; unreviewed?: boolean; tag?: string[]; limit?: string; jsonl?: boolean }) => {
    type Term = { id: string; source: string; target: string; targetCandidates?: string[]; scope?: string[]; matchCase?: boolean; note: string; status: KnowledgeStatus; statusBy: string; lines: number | null; examples: string[]; marks: string[]; tags: string[] };
    const wanted = options.limit ? Number(options.limit) : Infinity;
    const rows: Term[] = [];
    let total = 0;
    // A page the tool had to cut still arrives; continue from what came.
    while (rows.length < wanted) {
      const page = await readTool<{ total: number; terms: Term[] }>('list_terms', { q: options.q, status: statusIds(options.status), marks: options.mark, decidedBy: options.by, emptyTarget: options.emptyTarget ? true : options.hasTarget ? false : undefined, unreviewed: options.unreviewed || undefined, tags: options.tag, offset: rows.length, limit: Math.min(100, wanted - rows.length) });
      total = page.total;
      rows.push(...page.terms);
      if (!page.terms.length || rows.length >= total) break;
    }
    log(`용어 ${total.toLocaleString()}개 중 ${rows.length.toLocaleString()}개`);
    if (options.jsonl) return printJsonl(rows);
    if (globals().json) return printList(total, rows);
    for (const term of rows)
      console.log(`${String(term.lines ?? '?').padStart(5)}줄  ${term.source} → ${term.target || '(번역어 없음)'}${term.targetCandidates?.length ? ` (다른 번역어: ${term.targetCandidates.join(', ')})` : ''}${term.scope ? ` · ${termScopeLabel(term.scope)}만` : ''}${term.matchCase ? ' · 대소문자 일치' : ''}  [${KNOWLEDGE_STATUS_LABELS[term.status]}${term.statusBy === 'ai' && term.status === 'confirmed' ? ' ✦' : ''}]  ${withMarks('', term.marks, term.tags)}  (${term.id})${term.note ? `\n         ${short(term.note, 100)}` : ''}`);
  });

terms
  .command('usage <용어>')
  .description('이 용어(원문 또는 id)가 쓰인 대사. 앱 용어 창의 사용처와 같은 매칭(낱말 단위, 대소문자 무시)')
  .option('--limit <n>', '최대 몇 줄까지', '100')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (term: string, options: { limit: string; jsonl?: boolean }) => {
    const data = await readTool<{ term: { id: string; source: string; target: string; status: KnowledgeStatus }; count: number; lines: { key: string; scene: string; speaker: string | null; source: string; translation: string | null }[]; truncated?: { shown: number; total: number } }>('term_usage', { term, limit: Number(options.limit) });
    log(`${data.term.source}${data.term.target ? ` → ${data.term.target}` : ''}: 대사 ${data.count.toLocaleString()}줄 중 ${data.lines.length.toLocaleString()}줄`);
    warnTruncated(data, '--limit을 줄이세요.');
    if (options.jsonl) return printJsonl(data.lines);
    if (globals().json) return print(data);
    for (const line of data.lines) console.log(`${line.key}  ${line.speaker ?? '—'}: ${short(line.source)}${line.translation ? `\n    → ${short(line.translation)}` : ''}`);
  });

terms
  .command('discover')
  .description('대본에서 용어 후보 찾기 (앱 용어집의 "대본에서 찾기", 모델을 부르지 않음): 새 것은 후보로 더하고 있던 것은 나온 줄 수만 갱신. 터미널 권한 모드를 따름')
  .action(async () => printOutcome(await proposeTool('discover_terms', {}), '용어 후보 찾기'));

const KNOWLEDGE_KINDS = {
  documents: { tool: 'read_documents', pick: undefined, label: '노트' },
  characters: { tool: 'list_characters', pick: 'characters', label: '인물' },
  relationships: { tool: 'list_characters', pick: 'relationships', label: '관계' },
  events: { tool: 'list_events', pick: undefined, label: '사건' },
  'speech-rules': { tool: 'list_speech_rules', pick: undefined, label: '말투 규칙' },
} as const;

program
  .command('knowledge <종류>')
  .description(`작품 자료 목록: ${Object.entries(KNOWLEDGE_KINDS).map(([kind, info]) => `${kind}(${info.label})`).join(', ')}. 상태, 표시(#), 태그 포함. 앱 작품 자료 화면의 필터와 같은 규칙`)
  .addOption(new Option('--status <status...>', '상태 (앱의 상태 열). 둘을 함께 주면 둘 중 하나').choices(STATUS_CHOICES))
  .addOption(new Option('--mark <marks...>', '자동 태그. 여러 개면 모두 붙은 것').choices(KNOWLEDGE_MARK_IDS))
  .addOption(new Option('--by <누구>', '정한 쪽: ai = AI가 정하고 사람이 아직 안 봄(✦), human = 사람이 정함').choices(DECIDED_BY))
  .option('--unreviewed', '사람이 아직 정하지 않은 항목 (상태가 후보이거나 AI가 정한 것)')
  .option('--tag <tags...>', '태그 이름 (모두 붙은 항목)')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (kind: string, options: { status?: string[]; mark?: string[]; by?: DecidedBy; unreviewed?: boolean; tag?: string[]; jsonl?: boolean }) => {
    if (!(kind in KNOWLEDGE_KINDS)) throw new CliError(`종류는 ${Object.keys(KNOWLEDGE_KINDS).join(', ')} 중 하나입니다.`);
    const info = KNOWLEDGE_KINDS[kind as keyof typeof KNOWLEDGE_KINDS];
    const result = await readTool<Record<string, any>>(info.tool, { status: statusIds(options.status), marks: options.mark, decidedBy: options.by, unreviewed: options.unreviewed || undefined, tags: options.tag });
    const rows: Record<string, any>[] = info.pick ? result[info.pick] : Array.isArray(result) ? result : (result.items ?? []);
    log(`${info.label} ${rows.length.toLocaleString()}개`);
    warnTruncated(result, '--status, --by, --mark, --unreviewed, --tag로 좁히세요.');
    if (options.jsonl) return printJsonl(rows);
    if (globals().json) return printList(rows.length, rows);
    const name = (row: Record<string, any>): string =>
      kind === 'documents' ? `[${row.kind}] ${row.title}${row.alwaysInclude ? ' (항상 문맥에)' : ''}`
      : kind === 'characters' ? `${row.name}${row.aliases?.length ? ` (${row.aliases.join(', ')})` : ''}${row.player ? ' 플레이어' : ''}${personLabel(row) ? ` · ${personLabel(row)}` : ''}`
      : kind === 'relationships' ? `${row.from} ${row.mutual ? '↔' : '→'} ${row.to}: ${row.kind}${(row.changes ?? []).map((change: { at: string; kind: string }) => ` ▸ ${change.kind} (${change.at}부터)`).join('')}`
      : kind === 'events' ? `${row.title}${row.summary ? ` — ${short(row.summary, 60)}` : ''}`
      : `${row.from} → ${row.to}  ${row.level}${row.startKey ? ` (${row.startKey}부터)` : ''}${row.address ? `  호칭 ${row.address}` : ''}`;
    for (const row of rows) console.log(`${name(row)}  [${KNOWLEDGE_STATUS_LABELS[row.status as KnowledgeStatus]}]  ${withMarks('', row.marks, row.tags)}  (${row.id})`);
  });

const tagsCommand = program
  .command('tags')
  .description('프로젝트 태그와 기본 표시(#)의 붙는 곳(대사·자료·용어집), 종류, 색, 쓰인 대사·항목 수. 태그는 붙는 곳에만 붙일 수 있고 다른 곳은 거절됩니다')
  .action(async () => {
    type Entry = { name: string; color: string; places: string[]; lines: number; items: number; id: string; description?: string };
    const data = await readTool<{ tags: Entry[]; marks: Entry[] }>('list_tags');
    if (globals().json) return print(data);
    const row = (entry: Entry) => console.log(`  #${entry.name}  ·  붙는 곳 ${entry.places.join('·')}  ·  ${entry.color}  ·  대사 ${entry.lines} · 자료 ${entry.items}${entry.description ? `  ·  ${entry.description}` : ''}`);
    console.log('태그');
    for (const tag of data.tags) row(tag);
    console.log('\n자동 태그 (앱이 상태를 보고 스스로 붙였다 떼는 태그. 붙이거나 뗄 수 없고 필터·조건·실행 범위에서 고릅니다)');
    for (const mark of data.marks) row(mark);
  });

tagsCommand
  .command('order <이름...>')
  .description('태그 순서 바꾸기 (앞에 둘 것부터, 빠진 것은 지금 순서대로 뒤에). 터미널 권한 모드를 따름')
  .action(async (names: string[]) => printOutcome(await proposeTool('order_settings', { type: 'tag', names }), '태그 순서'));

program
  .command('prompts')
  .description('저장한 지시(앱 설정 › 채팅): 채팅 입력창의 / 목록(워크플로 아래)에서 고르는 프롬프트의 이름과 내용. 내용의 {대상} 자리에서는 고를 때 @ 첨부 목록이 열립니다. 읽기 전용이고, 만들기·고치기는 앱 설정에서 합니다')
  .action(async () => {
    const rows = await unwrap(api().projects[':projectId'].prompts.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return printList(rows.length, rows);
    if (!rows.length) return log('저장한 지시가 없습니다.');
    for (const row of rows) console.log(`/${row.name}\n${row.text.split('\n').map((line) => `  ${line}`).join('\n')}`);
  });

const defaults = program.command('defaults').description('홈 설정: 새 프로젝트가 만들어질 때 한 번 복사해 가는 기본값. 이미 있는 프로젝트에는 저절로 반영되지 않습니다');
defaults
  .command('show', { isDefault: true })
  .description('홈 기본값 보기 (연결 이름·종류, 에디터 AI, 채팅 설정, 저장한 지시, 상태, 태그, 워크플로). 고치기는 앱의 홈 › 설정에서 사람이 합니다')
  .action(async () => {
    type Defaults = { connections: { name: string; kind: string }[]; aiAutoConfirm: boolean; statuses: { name: string; kind: string; inReview: boolean }[]; tags: { name: string }[]; workflows: { templates: string[]; saved: { name: string }[] }; agentSettings: { prompts: { name: string }[] } };
    const data = await readTool<Defaults>('read_app_defaults');
    if (globals().json) return print(data);
    const kind: Record<string, string> = { initial: '시작', normal: '중간', final: '최종' };
    console.log(`연결: ${data.connections.map((row) => `${row.name}(${row.kind})`).join(', ') || '(없음)'}`);
    console.log(`상태: ${data.statuses.map((row) => `${row.name}[${kind[row.kind] ?? row.kind}${row.inReview ? '·검토함' : ''}]`).join(', ')}`);
    console.log(`태그: ${data.tags.map((row) => row.name).join(', ') || '(없음)'}`);
    console.log(`워크플로: 템플릿 ${data.workflows.templates.join(', ') || '(없음)'} · 저장한 것 ${data.workflows.saved.map((row) => row.name).join(', ') || '(없음)'}`);
    console.log(`저장한 지시: ${data.agentSettings.prompts.map((row) => `/${row.name}`).join(', ') || '(없음)'}`);
    console.log(`AI 결과 바로 확정: ${data.aiAutoConfirm ? '켬' : '끔'}`);
  });
defaults
  .command('pull <섹션...>')
  .description('홈 기본값을 이 프로젝트로 가져오기를 제안 (앱에서 수락). 섹션: editorAi, prompts, aiAutoConfirm, statuses, tags, workflows. 연결과 채팅 권한은 앱에서 사람이 가져옵니다')
  .action(async (sections: string[]) => printOutcome(await proposeTool('pull_app_defaults', { sections }), '홈 기본값 가져오기'));

/** `--model` specs ("연결:모델" for every AI node, "노드=연결:모델" for one) as plan_run / start_run take them. */
function runModels(specs: string[] | undefined) {
  if (!specs?.length) return undefined;
  const models: Record<string, { connection: string; model: string }> = {};
  for (const spec of specs) {
    const [node, pick] = spec.includes('=') ? [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)] : ['*', spec];
    const colon = pick.indexOf(':');
    if (colon < 1 || colon === pick.length - 1) throw new CliError(`--model은 "연결:모델" 또는 "노드=연결:모델"입니다: ${spec}`);
    models[node.trim()] = { connection: pick.slice(0, colon).trim(), model: pick.slice(colon + 1).trim() };
  }
  return models;
}

// ── statuses, workflows, runs, proposals, graph views ─────────────────

const statusesCommand = program
  .command('statuses')
  .description('번역 상태: 종류(시작·중간·최종), 순서, 검토함 표시')
  .action(async () => {
    type Status = { id: string; name: string; kind: string; sort: number; inReview: boolean; color: string };
    const rows = await readTool<Status[]>('list_statuses');
    if (globals().json) return printList(rows.length, rows);
    const kind: Record<string, string> = { initial: '시작', normal: '중간', final: '최종' };
    for (const row of rows) console.log(`${row.name.padEnd(10)} ${kind[row.kind] ?? row.kind}${row.inReview ? ' · 검토함' : ''}  (${row.id})`);
  });

statusesCommand
  .command('order <이름...>')
  .description('상태 순서 바꾸기 (앞에 둘 것부터, 빠진 것은 지금 순서대로 뒤에). 터미널 권한 모드를 따름')
  .action(async (names: string[]) => printOutcome(await proposeTool('order_settings', { type: 'status', names }), '상태 순서'));

const workflows = program.command('workflows').description('워크플로: 목록, 노드·연결·검증 보기, 파일로 고쳐 제안하기');

workflows
  .command('list')
  .description('워크플로 목록과 노드 수, 오류 수')
  .action(async () => {
    const rows = await unwrap(api().projects[':projectId'].workflows.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return printList(rows.length, rows);
    for (const row of rows) console.log(`${row.name}  노드 ${row.nodeCount}${row.errorCount ? `  오류 ${row.errorCount}` : ''}  (${row.id})${row.description ? `\n    ${short(row.description, 110)}` : ''}`);
  });

workflows
  .command('show <워크플로>')
  .description('노드(종류·이름·설정 요약)와 연결, 검증 결과. --json이면 save로 돌려보낼 수 있는 {id, name, description, definition}')
  .action(async (ref: string) => {
    const found = await resolveWorkflow(ref);
    type Node = { id: string; type: string; label?: string; config: Record<string, any> };
    const data = await readTool<{ id: string; name: string; description: string; definition: { nodes: Node[]; edges: { source: string; sourceHandle: string; target: string }[] }; issues: { level: string; message: string; nodeId?: string }[] }>('read_workflow', { workflowId: found.id });
    if (globals().json) return print({ id: data.id, name: data.name, description: data.description, definition: data.definition, issues: data.issues });
    const names = new Map((await unwrap(api().projects[':projectId'].workflows.$get({ param: { projectId: await projectId() } }))).map((item) => [item.id, item.name]));
    const summary = (node: Node) =>
      node.type === 'entry' ? `대상 ${node.config.input === 'terms' ? '용어' : '대사'} (실행 범위로 고름)`
      : node.type === 'ai' ? `${node.config.output}·${node.config.scope ?? 'line'}${node.config.preset ? ` · 프리셋 ${node.config.preset}` : ''} · ${node.config.model?.model || '모델 없음'} · 동시 ${node.config.concurrency ?? 1}${node.config.fields?.length ? ` · 필드 ${node.config.fields.map((field: { name: string }) => field.name).join(', ')}` : ''}`
      : node.type === 'function' ? `${node.config.fn}${node.config.fn === 'http' || node.config.fn === 'script' ? ` · 동시 ${node.config.concurrency ?? 2}` : ''}`
      : node.type === 'condition' ? JSON.stringify(node.config.expression)
      : node.type === 'retry' ? `재요청 · ${retrySummary(retryConfigSchema.parse(node.config ?? {}))}`
      : node.type === 'gather' ? `모으기 (앞 단계 결과)${node.config.fields?.length ? ` · 필드 ${node.config.fields.join(', ')}` : ''}`
      : node.type === 'call' ? `호출: ${names.get(node.config.workflowId) ?? (node.config.workflowId ? `(없는 워크플로 ${node.config.workflowId})` : '고르지 않음')}`
      : '';
    console.log(`${data.name}  (${data.id})${data.description ? `\n${data.description}` : ''}\n`);
    for (const node of data.definition.nodes) {
      const out = data.definition.edges.filter((edge) => edge.source === node.id).map((edge) => `${edge.sourceHandle} → ${edge.target}`);
      console.log(`${node.id.padEnd(16)} ${node.type.padEnd(9)} ${node.label ?? ''}\n${' '.repeat(17)}${short(summary(node), 120)}${out.length ? `\n${' '.repeat(17)}${out.join(' · ')}` : ''}`);
    }
    if (data.issues.length) console.log(`\n검증:\n${data.issues.map((issue) => `  ${issue.level === 'error' ? '오류' : '경고'}${issue.nodeId ? ` [${issue.nodeId}]` : ''} ${issue.message}`).join('\n')}`);
  });

workflows
  .command('save <파일>')
  .description('워크플로 JSON({id?, name, description?, definition}; show --json 출력 그대로)을 제안으로 올리기. id가 있으면 그 워크플로를 바꾸고, 없으면 새로 만듭니다')
  .action(async (file: string) => {
    const input = readJsonArg(file === '-' ? '-' : `@${file}`) as Record<string, unknown>;
    const { issues: _issues, ...workflow } = input;
    printOutcome(await proposeTool('save_workflow', workflow), '워크플로 저장');
  });

workflows
  .command('reference [프리셋]')
  .description('워크플로를 만들 때 참고: 노드 종류와 출구, 조건이 읽는 값, AI 출력·프리셋(요약), 반영 노드, 연결된 모델. 프리셋 id를 주면 그 프리셋의 지시문·출력 필드·문맥 전문')
  .action(async (preset?: string) => {
    const raw = await readTool<{ text?: string } | Record<string, unknown>>('harness_reference', preset ? { preset } : {});
    // The tool hands the reference over as one JSON string.
    const data = typeof raw.text === 'string' ? (() => { try { return JSON.parse(raw.text as string) as unknown; } catch { return raw.text; } })() : raw;
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  });

workflows
  .command('test <워크플로> <노드>')
  .description('스크립트·HTTP 노드를 대사 하나로 시험 (앱의 노드 시험과 같음, 아무것도 저장하지 않음). 워크플로는 이름·id 또는 show --json으로 받은 파일(저장 전 수정본). HTTP 노드는 실제로 요청을 보내고 프로젝트의 첫 대사를 씁니다. AI 노드는 loca context로 문맥·프롬프트를 봅니다')
  .option('--key <키>', '스크립트 노드: 이 대사로 (없으면 첫 대사)')
  .action(async (ref: string, nodeId: string, options: { key?: string }) => {
    type Node = { id: string; type: string; config: { fn?: string; params?: Record<string, any> } };
    const definition = existsSync(ref) && statSync(ref).isFile()
      ? (readJsonArg(`@${ref}`) as { definition: { nodes: Node[] } }).definition
      : (await readTool<{ definition: { nodes: Node[] } }>('read_workflow', { workflowId: (await resolveWorkflow(ref)).id })).definition;
    const node = definition.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new CliError(`노드가 없습니다: ${nodeId} (${definition.nodes.map((candidate) => candidate.id).join(', ')})`);
    const params = node.config.params ?? {};
    const id = await projectId();
    let result: { ok: boolean; error?: string; ms: number } & Record<string, unknown>;
    if (node.type === 'function' && node.config.fn === 'script') {
      const unitId = options.key ? (await unwrap(api().projects[':projectId'].lines.find.$post({ param: { projectId: id }, json: { keys: [options.key], limit: 1 } }))).rows[0]?.id : undefined;
      if (options.key && !unitId) throw new CliError(`대사를 찾을 수 없습니다: ${options.key}`);
      result = await unwrap(api().projects[':projectId']['script-test'].$post({ param: { projectId: id }, json: { code: params.code ?? '', ports: params.ports ?? ['out'], fields: params.fields ?? [], unitId } }));
    } else if (node.type === 'function' && node.config.fn === 'http') {
      result = await unwrap(api().projects[':projectId']['http-test'].$post({ param: { projectId: id }, json: { params: params as never } }));
    } else throw new CliError(`${node.type}${node.config.fn ? `(${node.config.fn})` : ''} 노드는 시험할 수 없습니다. 스크립트·HTTP 노드만 됩니다${node.type === 'ai' ? '. AI 노드는 loca context <키> -n ' + node.id + ' --prompt' : ''}.`);
    if (!result.ok) process.exitCode = 1;
    if (globals().json) return print(result);
    if (!result.ok) return console.log(`실패 (${result.ms}ms): ${result.error}`);
    const { input: _input, ms, ok: _ok, ...rest } = result;
    console.log(`성공 (${ms}ms)\n${JSON.stringify(rest, null, 2)}`);
  });

const runs = program.command('runs').description('워크플로 실행: 목록, 미리보기, 시작, 기다리기, 일시정지·이어 하기·취소, 실패한 줄 다시');

runs
  .command('list')
  .description('최근 실행 (id, 상태, 대사·용어 수, AI 호출·토큰)과 실패가 많은 노드')
  .option('--since <시간>', '몇 시간 전부터', '24')
  .action(async (options: { since: string }) => {
    const data = (await unwrap(api().projects[':projectId'].stats[':of{groups|sections|runs}'].$get({ param: { projectId: await projectId(), of: 'runs' }, query: { sinceHours: options.since } }))) as {
      runs: { id: string; workflow: string; status: string; subject?: 'lines' | 'terms'; lines: number; calls: number; failedCalls: number; inputTokens: number; outputTokens: number; createdAt: string }[];
      failingNodes: { workflow: string; node: string; failedLines: number }[];
    };
    if (globals().json) return print({ total: data.runs.length, rows: data.runs, failingNodes: data.failingNodes });
    for (const run of data.runs)
      console.log(`${new Date(run.createdAt).toLocaleString()}  ${run.workflow} [${run.status}] ${run.subject === 'terms' ? `용어 ${run.lines}개` : `대사 ${run.lines}`}, 호출 ${run.calls}(실패 ${run.failedCalls}), 토큰 ${(run.inputTokens + run.outputTokens).toLocaleString()}  (${run.id})`);
    if (data.failingNodes.length) console.log(`\n실패가 많은 노드:\n${data.failingNodes.map((node) => `  ${node.workflow} › ${node.node}: ${node.failedLines}줄`).join('\n')}`);
  });

type RunView = { id: string; workflow: string; status: 'running' | 'paused' | 'cancelled' | 'completed'; notice: string | null; filling?: boolean; subject?: 'lines' | 'terms'; total: number; states: Partial<Record<'queued' | 'running' | 'done' | 'failed' | 'cancelled', number>>; nodes: { nodeId: string; state: string; count: number }[]; ends: { nodeId: string; node: string; count: number }[]; errors: { kind: string; nodeId: string; node: string; message: string; count: number }[]; failures: { key?: string | null; unitId?: string; nodeId?: string; error?: string | null }[]; errored?: { unitId: string; key: string | null }[] };
const RUN_STATUS: Record<RunView['status'], string> = { running: '진행 중', paused: '일시정지', cancelled: '취소됨', completed: '끝남' };
const readRun = (id: string) => readTool<RunView>('read_run', { runId: id });
/** A run that stopped by itself or was finished; a run paused by a cap or failures counts as stopped too, one still being filled with lines does not. */
const runSettled = (run: RunView) => run.status !== 'running' && !run.filling;

/** Where a run stands and what to do next. A run that did not finish cleanly fails the command. */
async function printRun(run: RunView, options: { nodes?: boolean } = {}) {
  const errored = run.errors.reduce((sum, error) => sum + error.count, 0);
  if (run.status !== 'completed' || run.states.failed || errored) process.exitCode = 1;
  if (globals().json) return print(run);
  const unit = run.subject === 'terms' ? '개' : '줄';
  const count = (state: keyof RunView['states']) => (run.states[state] ?? 0).toLocaleString();
  console.log(`${run.workflow} [${RUN_STATUS[run.status]}] ${run.subject === 'terms' ? '용어' : '대사'} ${run.total.toLocaleString()}${unit}  (${run.id})`);
  console.log(`  끝남 ${count('done')} · 실패 ${count('failed')} · 남음 ${((run.states.queued ?? 0) + (run.states.running ?? 0)).toLocaleString()} · 취소 ${count('cancelled')}`);
  if (run.notice) console.log(`  멈춘 이유: ${run.notice}`);
  if (run.ends.length) console.log(`  끝난 곳: ${run.ends.map((end) => `${end.node} ${end.count.toLocaleString()}`).join(' · ')}`);
  if (errored) console.log(`  실패했거나 오류로 빠진 ${run.subject === 'terms' ? '용어' : '줄'} ${errored.toLocaleString()}:\n${run.errors.map((error) => `    ${error.node} · ${error.kind} ${error.count.toLocaleString()} — ${short(error.message, 100)}`).join('\n')}`);
  if (options.nodes) for (const node of run.nodes) console.log(`  ${node.nodeId.padEnd(16)} ${node.state.padEnd(9)} ${node.count.toLocaleString()}`);
  if (run.failures.length) console.log(`\n실패${(run.states.failed ?? 0) > run.failures.length ? ` (${run.failures.length}개만)` : ''}:\n${run.failures.map((failure) => `  ${failure.key ?? failure.unitId ?? ''} ${failure.nodeId ? `[${failure.nodeId}] ` : ''}${short(failure.error ?? '', 120)}`).join('\n')}`);
  const next = [
    run.states.failed && run.status !== 'cancelled' && `실패한 ${run.subject === 'terms' ? '용어' : '줄'} 다시: loca runs continue ${run.id} --retry-failed --wait`,
    errored && run.status !== 'running' && `실패했거나 오류로 빠진 것만 새로 실행: loca runs start "${run.workflow}" --rerun-errors ${run.id} --wait (모델을 바꾸려면 --model)`,
    run.status === 'paused' && `이어서: loca runs resume ${run.id} --wait`,
    run.status === 'running' && `끝날 때까지: loca runs wait ${run.id}`,
    run.status === 'completed' && run.subject !== 'terms' && '결과 점검: loca check terms · loca check format (범위는 -g/--key로)',
  ].filter(Boolean);
  if (next.length) console.log(`\n다음:\n${next.map((line) => `  ${line}`).join('\n')}`);
  console.log(`앱에서 보기: ${appLink(`/p/${await projectId()}/runs/${run.id}`)}`);
}

/** Until the run is no longer running, saying how far it got now and then (on stderr). */
async function waitRun(id: string, timeout?: number) {
  let said = 0;
  const run = await waitFor('runs', async () => {
    const current = await readRun(id);
    if (runSettled(current)) return current;
    if (Date.now() - said > 5_000) {
      said = Date.now();
      log(`  ${current.workflow}: 끝남 ${(current.states.done ?? 0).toLocaleString()} / ${current.total.toLocaleString()} · 실패 ${(current.states.failed ?? 0).toLocaleString()}`);
    }
    return undefined;
  }, timeout);
  await printRun(run);
}

/** A run change (start, resume, continue) waited on when asked: the proposal first, then the run. */
async function followRun(outcome: Outcome, options: { wait?: boolean; timeout?: string }, what: string) {
  const timeout = options.timeout ? Number(options.timeout) : undefined;
  let result = outcome.result;
  if (!outcome.applied) {
    if (outcome.status === 'failed' || !options.wait) return printOutcome(outcome, what);
    log(`${what}: 제안으로 올렸습니다 (${outcome.proposalId}). ${ACCEPT_HINT}. 결정을 기다립니다…`);
    const decided = await waitProposal(outcome.proposalId, timeout);
    if (decided.status !== 'accepted') {
      process.exitCode = 1;
      return console.log(`${what}: ${decided.status === 'rejected' ? `거절됐습니다${decided.reason ? `: ${decided.reason}` : ''}` : `실패했습니다: ${failure(decided.result)}`} (${decided.id})`);
    }
    result = decided.result;
  } else if (!options.wait) return printOutcome(outcome, what);
  const runId = (result as { runId?: string } | null)?.runId;
  if (!runId) throw new CliError(`실행 id를 받지 못했습니다: ${JSON.stringify(result)}`);
  log(`실행 ${runId}: 끝날 때까지 기다립니다…`);
  await waitRun(runId, timeout);
}

runs
  .command('show <id>')
  .description('한 실행의 상태, 끝난·실패한·남은 수, 멈춘 이유, 실패한 줄, 다음에 할 명령. 끝나지 않았거나 실패가 있으면 종료 코드 1')
  .option('--nodes', '노드별·상태별 수도')
  .action(async (id: string, options: { nodes?: boolean }) => printRun(await readRun(id), options));

runs
  .command('wait <id>')
  .description('실행이 끝나거나 멈출 때까지 기다린 뒤 show와 같은 요약 (앱의 변경 알림을 받아 기다림). 깨끗하게 끝나지 않으면 종료 코드 1')
  .option('--timeout <분>', '이만큼 지나면 기다리기만 멈춤')
  .action(async (id: string, options: { timeout?: string }) => waitRun(id, options.timeout ? Number(options.timeout) : undefined));

for (const [action, description] of [
  ['pause', '실행 일시정지 (보낸 요청은 끝까지 받고 멈춤). 비용이 들지 않아 권한 모드와 상관없이 바로 됩니다'],
  ['cancel', '실행 취소 (남은 줄은 하지 않고, 이미 반영된 결과는 그대로). 취소한 실행은 이어서 할 수 없습니다'],
] as const)
  runs
    .command(`${action} <id>`)
    .description(description)
    .action(async (id: string) => {
      await unwrap(api().runs[':id'][':action{pause|resume|cancel}'].$post({ param: { id, action } }));
      const run = await readRun(id);
      if (globals().json) return print(run);
      console.log(`${run.workflow}: ${RUN_STATUS[run.status]} (${run.id})`);
    });

runs
  .command('resume <id>')
  .description('일시정지한 실행 이어 하기 (AI 비용이 들어 터미널 권한 모드를 따름: 바로 되거나 제안으로 기다림)')
  .option('--max-calls <n>', '호출 상한을 이만큼으로 (none이면 없앰)')
  .option('--max-input-tokens <n>', '입력 토큰 상한을 이만큼으로 (none이면 없앰)')
  .option('--wait', '실행이 끝날 때까지 기다린 뒤 요약')
  .option('--timeout <분>', '--wait을 이만큼만')
  .action(async (id: string, options: { maxCalls?: string; maxInputTokens?: string; wait?: boolean; timeout?: string }) => {
    const cap = (value: string | undefined) => (value === undefined ? undefined : value === 'none' ? null : Number(value));
    const limits = options.maxCalls !== undefined || options.maxInputTokens !== undefined ? { maxCalls: cap(options.maxCalls), maxInputTokens: cap(options.maxInputTokens) } : undefined;
    await followRun(await proposeTool('continue_run', { runId: id, limits }), options, '실행 이어 하기');
  });

runs
  .command('continue <id>')
  .description('멈췄거나 끝난 실행을 이어서: --retry-failed면 실패한 줄을 실패한 단계부터 다시, --model이면 이 실행의 AI 단계만 다른 모델로. 터미널 권한 모드를 따름')
  .option('--retry-failed', '실패한 줄 다시')
  .option('--model <specs...>', 'plan과 같은 "연결:모델" 또는 "노드=연결:모델"')
  .option('--wait', '실행이 끝날 때까지 기다린 뒤 요약')
  .option('--timeout <분>', '--wait을 이만큼만')
  .action(async (id: string, options: { retryFailed?: boolean; model?: string[]; wait?: boolean; timeout?: string }) => {
    await followRun(await proposeTool('continue_run', { runId: id, retryFailed: Boolean(options.retryFailed), models: runModels(options.model) }), options, '실행 이어 하기');
  });

runs
  .command('plan <워크플로>')
  .description('실행 전 미리보기(실행 대화상자와 같은 계산, 모델은 부르지 않고 아무것도 시작하지 않음). 워크플로는 이름·id: 범위의 대사 수(용어 입력이면 용어 수), 묶음·요청 수 추정, 준비 상태(청자 미상, 확인 안 한 말투 규칙·용어, 말투 규칙 없는 쌍). 범위 조건은 모두 만족해야 합니다. 용어 입력 워크플로(진입 input이 terms)는 --term으로 범위를 정하고 대사 범위 옵션은 쓸 수 없습니다')
  .option('-g, --group <groups...>', '장면·묶음 (키·id·제목)')
  .option('--key <keys...>', '대사 키')
  .addOption(new Option('--mark <marks...>', '자동 표시가 모두 붙은 것 (대사 입력: 대사 표시, 용어 입력: 용어 표시)').choices([...new Set([...LINE_MARK_IDS, ...TERM_MARK_IDS])]))
  .option('--tag <tags...>', '태그 이름 (모두 붙은 대사)')
  .option('--term <terms...>', '용어 입력 워크플로만: 이 용어(원문·id)만. 없으면 진입 노드의 용어 상태·표시 조건(많이 쓰인 순)')
  .option('--status <statuses...>', '이 상태인 것만 (대사: 상태 이름·id, 용어: 후보·확정·버림). 없으면 모든 상태')
  .option('--model <specs...>', '이번 실행만 다른 모델로: "연결:모델"(모든 AI 단계) 또는 "노드=연결:모델" (연결·노드는 이름이나 id). 워크플로는 바뀌지 않습니다')
  .option('--view <보기>', '대사 그래프의 저장된 보기(이름·id) 안의 대사만')
  .option('--section <sections...>', '구역(장·출처)의 장면·묶음만')
  .option('-s, --speaker <names...>', '이 화자의 대사만 (이름·별칭·화자 키)')
  .option('--listener <names...>', '이 청자에게 하는 대사만 (- = 청자 모름)')
  .option('--unfinished', '상태가 최종이 아닌 대사만')
  .option('--noted', '메모가 있는 대사만')
  .addOption(new Option('--by <누구>', '정한 쪽: ai = AI가 정하고 사람이 아직 안 봄(✦), human = 사람이 정함').choices(DECIDED_BY))
  .option('--empty-target', '용어 입력 워크플로만: 번역어가 비어 있는 용어만')
  .option('--kind <kinds...>', '대사 종류만 (dialogue, ui …)')
  .option('-q, --q <글자>', '원문에 이 글자가 있는 대사만')
  .action(async (workflow: string, options: { group?: string[]; key?: string[]; mark?: string[]; tag?: string[]; term?: string[]; status?: string[]; model?: string[]; view?: string; section?: string[]; speaker?: string[]; listener?: string[]; kind?: string[]; q?: string; unfinished?: boolean; noted?: boolean; by?: DecidedBy; emptyTarget?: boolean }) => {
    const groups = await sectionGroups(options.section, options.group);
    const keys = options.view ? (await viewLines(options.view)).map((row) => row.key).filter((key) => !options.key || options.key.includes(key)) : options.key;
    if (keys && !keys.length) throw new CliError('고른 대사가 보기에 없습니다.');
    type Names = { count: number; examples: string[]; names: string[]; more: boolean };
    const data = await readTool<{
      workflow: { id: string; name: string };
      lines: { total: number; translated: number; untranslated: number };
      subject?: 'lines' | 'terms';
      plan: { batches: number; linesPerBatch: { min: number; median: number; max: number } | null };
      nodes: { name: string; model: string | null; concurrency: number; requests: { min: number; expected: number | null; max: number }; promptTokens: number }[];
      totals: { calls: { min: number; expected: number | null; max: number }; inputTokens: { min: number; expected: number | null; max: number } };
      pace: { seconds: number | null; costUsd: number | null; subscription: boolean };
      load: { runs: number; max: number; added: number };
      readiness: { dialogueLines: number; unknownListenerLines: number; candidateRules: Names; candidateTerms: Names; pairsWithoutRule: { count: number; examples: string[] } };
    }>('plan_run', { workflow, groups, keys, tags: options.tag, marks: options.mark, terms: options.term, statuses: options.status, speakers: options.speaker, listeners: options.listener, kinds: options.kind, q: options.q, unfinished: options.unfinished || undefined, noted: options.noted || undefined, decidedBy: options.by, emptyTarget: options.emptyTarget || undefined, models: runModels(options.model) });
    if (globals().json) return print(data);
    const range = (value: { min: number; expected: number | null; max: number }) => (value.expected !== null ? `약 ${value.expected.toLocaleString()} (${value.min.toLocaleString()}~${value.max.toLocaleString()})` : `${value.min.toLocaleString()}~${value.max.toLocaleString()}`);
    console.log(`${data.workflow.name} 실행 미리보기`);
    const terms = data.subject === 'terms';
    console.log(`  ${terms ? '용어' : '대사'} ${data.lines.total.toLocaleString()}개 (번역${terms ? '어' : ''} 있음 ${data.lines.translated.toLocaleString()} · 없음 ${data.lines.untranslated.toLocaleString()})`);
    const per = data.plan.linesPerBatch;
    if (!terms) console.log(`  묶음 ${data.plan.batches.toLocaleString()}개${per ? ` (묶음당 ${per.min}~${per.max}줄, 중간 ${per.median})` : ''}`);
    console.log(`  AI 요청 ${range(data.totals.calls)} · 입력 토큰 ${range(data.totals.inputTokens)}${data.pace.seconds !== null ? ` · 약 ${Math.round(data.pace.seconds / 60)}분` : ''}${data.pace.subscription ? ' · 구독' : data.pace.costUsd !== null ? ` · 약 $${data.pace.costUsd.toFixed(2)}` : ''}`);
    for (const node of data.nodes) console.log(`    ${node.name}  ${node.model ?? '(모델 없음)'}  요청 ${range(node.requests)} · 동시 ${node.concurrency} · 프롬프트 약 ${node.promptTokens.toLocaleString()}토큰`);
    if (data.load.runs) console.log(`  주의: 다른 실행 ${data.load.runs}개가 AI 요청을 최대 ${data.load.max}개까지 동시에 보내는 중입니다. 이 실행을 시작하면 최대 ${data.load.max + data.load.added}개가 됩니다.   → loca runs list`);
    if (terms) return console.log('\n용어 입력 워크플로는 청자·말투 규칙 준비 상태를 보지 않습니다. 시작 전 loca terms로 대상 용어를 확인하세요.');
    const ready = data.readiness;
    console.log('\n준비 상태');
    console.log(`  청자 모름 대사 ${ready.unknownListenerLines.toLocaleString()} / 청자가 필요한 대사 ${ready.dialogueLines.toLocaleString()}${ready.unknownListenerLines ? '   → loca lines --mark unknownListener' : ''}`);
    const list = (entry: Names) => `${entry.names.slice(0, 8).join(', ')}${entry.count > Math.min(8, entry.names.length) ? ` 외 ${entry.count - Math.min(8, entry.names.length)}개` : ''}`;
    console.log(`  후보 말투 규칙 ${ready.candidateRules.count}개${ready.candidateRules.count ? `: ${list(ready.candidateRules)}   → loca knowledge speech-rules --status 후보` : ''}`);
    console.log(`  후보 용어 ${ready.candidateTerms.count}개${ready.candidateTerms.count ? `: ${list(ready.candidateTerms)}   → loca terms --status 후보` : ''}`);
    console.log(`  말투 규칙 없는 화자 쌍 ${ready.pairsWithoutRule.count}개${ready.pairsWithoutRule.count ? `: ${ready.pairsWithoutRule.examples.join(', ')}${ready.pairsWithoutRule.count > ready.pairsWithoutRule.examples.length ? ' …' : ''}` : ''}`);
  });

runs
  .command('start <워크플로>')
  .description('실행 시작 (AI 호출에 비용이 들어 터미널 권한 모드를 따름: 바로 반영이면 시작, 아니면 앱에서 수락할 때까지 제안으로 기다림). 범위는 plan과 같고(대사 입력 워크플로는 대사 범위, 용어 입력 워크플로는 --term), 먼저 plan으로 확인하세요. --wait이면 끝날 때까지 기다린 뒤 요약')
  .option('-g, --group <groups...>', '장면·묶음 (키·id·제목)')
  .option('--key <keys...>', '대사 키')
  .addOption(new Option('--mark <marks...>', '자동 표시가 모두 붙은 것 (대사 입력: 대사 표시, 용어 입력: 용어 표시)').choices([...new Set([...LINE_MARK_IDS, ...TERM_MARK_IDS])]))
  .option('--tag <tags...>', '태그 이름 (모두 붙은 대사)')
  .option('--term <terms...>', '용어 입력 워크플로만: 이 용어(원문·id)만. 없으면 진입 노드의 용어 상태·표시 조건(많이 쓰인 순)')
  .option('--status <statuses...>', 'plan과 같은 상태 조건')
  .option('--model <specs...>', 'plan과 같은 "연결:모델" 또는 "노드=연결:모델"')
  .option('--view <보기>', '대사 그래프의 저장된 보기(이름·id) 안의 대사만')
  .option('--section <sections...>', '구역(장·출처)의 장면·묶음만')
  .option('-s, --speaker <names...>', 'plan과 같은 화자 조건')
  .option('--listener <names...>', 'plan과 같은 청자 조건 (- = 청자 모름)')
  .option('--unfinished', 'plan과 같은 최종 아님 조건')
  .option('--noted', 'plan과 같은 메모 조건')
  .addOption(new Option('--by <누구>', '정한 쪽: ai = AI가 정하고 사람이 아직 안 봄(✦), human = 사람이 정함').choices(DECIDED_BY))
  .option('--empty-target', 'plan과 같은 번역어 비어 있음 조건')
  .option('--kind <kinds...>', 'plan과 같은 대사 종류 조건')
  .option('-q, --q <글자>', 'plan과 같은 원문 글자 조건')
  .option('--rerun-errors <실행id>', '그 실행에서 실패했거나 오류 출구로 빠진 대사·용어만 (다른 범위 조건과 함께 쓰면 모두 만족)')
  .option('--wait', '(제안이면 결정을 기다린 뒤) 실행이 끝날 때까지 기다리고 요약. 깨끗하게 끝나지 않으면 종료 코드 1')
  .option('--timeout <분>', '--wait을 이만큼만')
  .action(async (ref: string, options: { group?: string[]; key?: string[]; mark?: string[]; tag?: string[]; term?: string[]; status?: string[]; model?: string[]; view?: string; section?: string[]; speaker?: string[]; listener?: string[]; kind?: string[]; q?: string; unfinished?: boolean; noted?: boolean; by?: DecidedBy; emptyTarget?: boolean; rerunErrors?: string; wait?: boolean; timeout?: string }) => {
    const workflow = await resolveWorkflow(ref);
    const groupIds = options.section?.length ? await sectionGroups(options.section, options.group) : (await resolveGroups(options.group))?.map((group) => group.id);
    let unitIds: string[] | undefined;
    // A page of keys at a time: one request is capped at 1000 lines.
    for (let at = 0; options.key?.length && at < options.key.length; at += 1000)
      unitIds = [...(unitIds ?? []), ...(await unwrap(api().projects[':projectId'].lines.find.$post({ param: { projectId: await projectId() }, json: { keys: options.key.slice(at, at + 1000), limit: 1000 } }))).rows.map((row) => row.id)];
    let termIds = options.term;
    if (options.view) {
      const ids = new Set((await viewLines(options.view)).map((row) => row.id));
      unitIds = unitIds ? unitIds.filter((id) => ids.has(id)) : [...ids];
    }
    if (options.rerunErrors) {
      const earlier = await unwrap(api().projects[':projectId'].runs[':runId'].errors.$get({ param: { projectId: await projectId(), runId: options.rerunErrors } }));
      const what = earlier.subject === 'terms' ? '용어' : '대사';
      if (!earlier.items.length) throw new CliError(`그 실행에는 실패했거나 오류로 빠진 ${what}가 없습니다.`);
      log(`${earlier.workflow} 실행에서 다시 할 ${what} ${earlier.items.length.toLocaleString()}개`);
      // Like every other scope option, it narrows what the rest picked.
      if (earlier.subject === 'terms') termIds = termIds ? earlier.items.filter((item) => termIds!.includes(item.unitId) || termIds!.includes(item.key ?? '')).map((item) => item.unitId) : earlier.items.map((item) => item.unitId);
      else unitIds = unitIds ? unitIds.filter((id) => earlier.items.some((item) => item.unitId === id)) : earlier.items.map((item) => item.unitId);
    }
    // An empty list reads as "no condition" on the server: refuse it here instead of running everything.
    if ((unitIds && !unitIds.length) || (termIds && !termIds.length)) throw new CliError('범위 조건을 모두 만족하는 대사·용어가 없습니다.');
    const tagIds = options.tag?.length
      ? (await readTool<{ tags: { id: string; name: string }[] }>('list_tags')).tags.filter((tag) => options.tag!.includes(tag.name)).map((tag) => tag.id)
      : undefined;
    const outcome = await proposeTool('start_run', { workflowId: workflow.id, groupIds, unitIds, tagIds, marks: options.mark, termIds, statuses: options.status, speakers: options.speaker, listeners: options.listener, kinds: options.kind, q: options.q, unfinished: options.unfinished || undefined, noted: options.noted || undefined, decidedBy: options.by, emptyTarget: options.emptyTarget || undefined, models: runModels(options.model) });
    await followRun(outcome, options, '실행 시작');
  });

const graph = program.command('graph').description('대사 그래프 잇기(변경은 제안으로 올라가 앱에서 수락). 장면 연결은 저장되지 않고 대사 그래프에서 계산됩니다');

graph
  .command('link <from키> <to키>')
  .description('대사(또는 노드 키)에서 대사로 선 하나 잇기를 제안으로 올리기')
  .option('--label <이름>', '선택지 이름')
  .action(async (from: string, to: string, options: { label?: string }) => {
    printOutcome(await proposeTool('link_lines', { from, to, action: 'link', label: options.label }), '선 잇기');
  });

graph
  .command('unlink <from키> <to키>')
  .description('두 대사 사이의 선을 지우는 제안 올리기')
  .action(async (from: string, to: string) => {
    printOutcome(await proposeTool('link_lines', { from, to, action: 'unlink' }), '선 지우기');
  });

graph
  .command('order')
  .description('대본 순서로 잇기 제안 올리기: 장면 안에서 노드를 대본 순서대로 잇습니다. 이미 나가는 길·들어오는 길이 있는 노드는 건드리지 않습니다 (그래프 없이 가져온 파일용)')
  .option('--scene <scenes...>', '장면 (키·id·제목): 그 장면의 모든 노드')
  .option('--line <keys...>', '대사 키: 이 대사들의 노드끼리만 (장면별로)')
  .action(async (options: { scene?: string[]; line?: string[] }) => {
    if (!options.scene?.length && !options.line?.length) throw new CliError('--scene 또는 --line을 하나 이상 주세요.');
    printOutcome(await proposeTool('link_in_order', { scenes: options.scene ?? [], lines: options.line ?? [] }), '대본 순서로 잇기');
  });

const proposals = program.command('proposals').description('CLI가 올린 제안: 목록과 결정 상태 (결정은 앱에서)');

proposals
  .command('list')
  .description('제안 목록, 최근 것부터')
  .addOption(new Option('--status <상태>', '이 상태만').choices(['pending', 'running', 'accepted', 'rejected', 'failed']))
  .option('--limit <n>', '최대 몇 개', '50')
  .action(async (options: { status?: 'pending'; limit: string }) => {
    const response = await api().projects[':projectId'].proposals.$get({ param: { projectId: await projectId() }, query: { status: options.status, limit: options.limit } });
    const rows = await unwrap(Promise.resolve(response));
    const total = Number(response.headers.get('x-total-count') ?? rows.length);
    log(`제안 ${total.toLocaleString()}개 중 ${rows.length.toLocaleString()}개`);
    if (globals().json) return printList(total, rows);
    const word: Record<string, string> = { pending: '대기', running: '적용 중', accepted: '수락', rejected: '거절', failed: '실패' };
    const from: Record<string, string> = { cli: 'CLI', api: 'API' };
    for (const row of rows as { id: string; tool: string; status: string; source?: string; input?: Record<string, unknown>; createdAt: string }[]) {
      // How many entries it carries (lines, items, changes), when it is a list.
      const size = Object.values(row.input ?? {}).find(Array.isArray)?.length;
      console.log(`${new Date(row.createdAt).toLocaleString()}  [${word[row.status] ?? row.status}] ${row.tool}${size ? ` ${size.toLocaleString()}건` : ''} · ${from[row.source ?? ''] ?? row.source ?? ''}  (${row.id})`);
    }
  });

proposals
  .command('show <id>')
  .description('제안 하나의 결정 상태와 결과')
  .action(async (id: string) => {
    const proposal = await unwrap(api().projects[':projectId'].proposals[':id'].$get({ param: { projectId: await projectId(), id } }));
    if (globals().json) return print(proposal);
    const word = { pending: '대기 중', running: '수락되어 적용하는 중', rejected: '거절됨', failed: '수락했지만 실패' } as const;
    console.log(`${proposal.tool}: ${proposal.status === 'accepted' ? acceptedLabel(proposal.tool).decided : word[proposal.status]}${proposal.result ? `\n${JSON.stringify(proposal.result)}` : ''}`);
  });

proposals
  .command('wait <id>')
  .description('제안이 결정되고 반영될 때까지 기다리기 (앱의 변경 알림을 받아 기다림). 거절·실패면 종료 코드 1')
  .option('--timeout <분>', '이만큼 지나면 기다리기만 멈춤')
  .action(async (id: string, options: { timeout?: string }) => {
    const proposal = await waitProposal(id, options.timeout ? Number(options.timeout) : undefined);
    if (proposal.status !== 'accepted') process.exitCode = 1;
    if (globals().json) return print(proposal);
    console.log(`${proposal.tool}: ${proposal.status === 'accepted' ? acceptedLabel(proposal.tool).decided : proposal.status === 'rejected' ? `거절됨${proposal.reason ? ` (${proposal.reason})` : ''}` : `수락했지만 실패: ${failure(proposal.result)}`}`);
  });

proposals
  .command('undo <id...>')
  .description('터미널 권한 모드로 반영된 변경 되돌리기 (최근 것부터, 그사이 바뀐 대사는 건너뜀). 사람이 수락한 제안은 앱에서 되돌립니다')
  .action(async (ids: string[]) => {
    const answered = await unwrap(api().projects[':projectId'].proposals.undo.$post({ param: { projectId: await projectId() }, json: { ids } }));
    const results = [...answered, ...ids.filter((id) => !answered.some((result) => result.id === id)).map((id) => ({ id, ok: false, error: '이 터미널이 올린 제안이 아닙니다 (loca proposals list로 확인)', skipped: undefined as string[] | undefined }))];
    if (results.some((result) => !result.ok)) process.exitCode = 1;
    if (globals().json) return print(results);
    for (const result of results) console.log(`${result.id}: ${result.ok ? `되돌렸습니다${result.skipped?.length ? ` (그사이 바뀌어 건너뜀: ${result.skipped.slice(0, 10).join(', ')})` : ''}` : result.error}`);
  });

const views = program.command('views').description('대사 그래프의 저장된 보기(고른 노드만 남긴 간략 그래프): 목록, 흐름대로 읽기, 만들기·고치기·지우기. 보기는 lines·export·check·runs의 --view 범위로 씁니다');

const viewLink = async (id: string) => appLink(`/p/${await projectId()}/graph`, { scope: 'dialogue', section: `view:${id}` });

views
  .command('list')
  .description('저장된 보기와 앱에서 열 링크')
  .action(async () => {
    const rows = await unwrap(api().projects[':projectId'].graph.views.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return printList(rows.length, await Promise.all(rows.map(async (row) => ({ ...row, link: await viewLink(row.id) }))));
    for (const row of rows) console.log(`${row.label}  노드 ${row.nodes} · ${row.origin === 'ai' ? 'AI' : '직접'}  (${row.id})\n    ${await viewLink(row.id)}`);
  });

views
  .command('create')
  .description('노드를 골라 보기로 저장하고 링크를 출력 (제안 없이 바로 저장: 번역 데이터는 바꾸지 않음). 고르는 조건은 더해집니다')
  .requiredOption('--label <이름>', '보기 이름')
  .option('-g, --scene <scenes...>', '장면 (키·id·제목)')
  .option('-s, --speaker <names...>', '이 인물이 하는 대사')
  .option('--line <keys...>', '대사 키')
  .option('-q, --q <글자>', '대사에 들어 있는 글자')
  .option('--between <keys...>', '두 대사(시작 키, 끝 키) 사이의 모든 경로')
  .option('--around <n>', '앞뒤로 몇 걸음 더', '0')
  .option('--exclude <keys...>', '뺄 대사·노드')
  .option('--request <설명>', '무엇을 보려는지 (다시 만들 때 쓰임)')
  .addOption(new Option('--mode <방식>', 'view: 저장된 보기로, mark: 전체 그래프에서 강조만').choices(['view', 'mark']).default('view'))
  .action(async (options: { label: string; scene?: string[]; speaker?: string[]; line?: string[]; q?: string; between?: string[]; around: string; exclude?: string[]; request?: string; mode: 'view' | 'mark' }) => {
    if (options.between && options.between.length !== 2) throw new CliError('--between에는 시작과 끝 대사 키 두 개를 줍니다.');
    const result = await readTool<{ ok: boolean; error?: string; nodes: number; unknown: string[]; open: { to: string; search: Record<string, string> } }>('show_graph', {
      label: options.label,
      request: options.request,
      mode: options.mode,
      scenes: options.scene,
      speakers: options.speaker,
      lines: options.line,
      q: options.q,
      between: options.between ? { start: options.between[0], end: options.between[1] } : undefined,
      around: Number(options.around),
      exclude: options.exclude,
    });
    if (!result.ok) throw new CliError(result.error ?? '보기를 만들지 못했습니다.');
    const link = appLink(result.open.to.replace('$projectId', await projectId()), result.open.search);
    if (result.unknown.length) log(`찾지 못함: ${result.unknown.slice(0, 10).join(', ')}`);
    if (globals().json) return print({ ...result, link });
    console.log(`노드 ${result.nodes.toLocaleString()}개로 ${options.mode === 'view' ? '보기를 저장했습니다' : '강조했습니다'}: ${link}`);
  });

views
  .command('show <보기>')
  .description('보기의 대사를 흐름 순서로 (보기 안에서 들어오고 나가는 길과 선택지 이름 포함). 보기는 이름·id')
  .option('--jsonl', '노드마다 한 줄 JSON')
  .action(async (ref: string, options: { jsonl?: boolean }) => {
    type Way = { key: string; label: string | null };
    const flow = await unwrap(api().projects[':projectId'].views[':ref'].flow.$get({ param: { projectId: await projectId(), ref: encodeURIComponent(ref) } }));
    log(`${flow.view.label}: 노드 ${flow.nodes.length.toLocaleString()}개 · 대사 ${flow.nodes.reduce((sum, node) => sum + node.lines.length, 0).toLocaleString()}줄  (${flow.view.id})`);
    if (options.jsonl) return printJsonl(flow.nodes);
    if (globals().json) return print(flow);
    const ways = (list: Way[]) => list.map((way) => `${way.key}${way.label ? ` [${short(way.label, 30)}]` : ''}`).join(', ');
    for (const node of flow.nodes) {
      if (node.from.length > 1) console.log(`  ⤶ 갈래가 합쳐짐: ${ways(node.from)}`);
      if (!node.lines.length) console.log(`  · ${node.label ?? node.key}`);
      for (const line of node.lines) console.log(`${line.key}  [${line.status ?? '—'}] ${line.speaker ?? '—'}${line.listener ? ` → ${line.listener}` : ''}: ${short(line.source, 100)}${line.translation ? `\n    → ${short(line.translation, 100)}` : ''}`);
      if (node.to.length > 1 || node.to.some((way) => way.label)) console.log(`  ⤷ ${node.to.length > 1 ? '갈림' : '다음'}: ${ways(node.to)}`);
    }
    console.log(`\n앱에서 보기: ${await viewLink(flow.view.id)}`);
  });

views
  .command('update <보기>')
  .description('보기 이름 바꾸기, 대사(그 대사를 가진 노드) 더하기·빼기. 번역 데이터는 바꾸지 않아 바로 저장됩니다')
  .option('--label <이름>', '새 이름')
  .option('--add <keys...>', '더할 대사·노드 키')
  .option('--remove <keys...>', '뺄 대사·노드 키')
  .action(async (ref: string, options: { label?: string; add?: string[]; remove?: string[] }) => {
    const flow = await unwrap(api().projects[':projectId'].views[':ref'].flow.$get({ param: { projectId: await projectId(), ref: encodeURIComponent(ref) } }));
    const view = await unwrap(api().projects[':projectId'].graph.views[':id'].$patch({ param: { projectId: await projectId(), id: flow.view.id }, json: { label: options.label, addKeys: options.add ?? [], removeKeys: options.remove ?? [] } }));
    if (globals().json) return print(view);
    console.log(`${view.label}: 노드 ${view.nodes.toLocaleString()}개  ${await viewLink(view.id)}`);
  });

views
  .command('delete <보기>')
  .description('보기 지우기 (대사·그래프는 그대로)')
  .action(async (ref: string) => {
    const flow = await unwrap(api().projects[':projectId'].views[':ref'].flow.$get({ param: { projectId: await projectId(), ref: encodeURIComponent(ref) } }));
    await unwrap(api().projects[':projectId'].graph.views[':id'].$delete({ param: { projectId: await projectId(), id: flow.view.id } }));
    console.log(`지웠습니다: ${flow.view.label}`);
  });

// ── connections, regex helper ─────────────────────────────────────

const connections = program.command('connections').description('이 프로젝트의 AI·HTTP 연결: 목록과 모델 시험. 연결 추가·키는 사람이 앱에서 합니다');

connections
  .command('list', { isDefault: true })
  .description('연결 이름, 종류, 주소, 키가 있는지 (키 값은 보이지 않음)')
  .action(async () => {
    const rows = await unwrap(api().projects[':projectId'].connections.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return printList(rows.length, rows.map(({ id, name, kind, baseUrl, hasKey }) => ({ id, name, kind, baseUrl, hasKey })));
    for (const row of rows) console.log(`${row.name.padEnd(16)} ${row.kind.padEnd(12)} ${row.baseUrl ?? ''}${row.hasKey ? '' : '  (키 없음)'}  (${row.id})`);
  });

connections
  .command('test <연결> <모델> [원문]')
  .description('연결로 짧은 번역 한 번 (앱의 모델 시험과 같음, 프로젝트에 기록하지 않음). 요청 한 번만큼 비용이 듭니다')
  .action(async (ref: string, model: string, source: string | undefined) => {
    const rows = await unwrap(api().projects[':projectId'].connections.$get({ param: { projectId: await projectId() } }));
    const connection = rows.find((row) => row.id === ref) ?? rows.find((row) => row.name.toLowerCase() === ref.toLowerCase());
    if (!connection) throw new CliError(`연결을 찾지 못했습니다: ${ref} (${rows.map((row) => row.name).join(', ')})`);
    const result = await unwrap(api().connections[':id'].test.$post({ param: { id: connection.id }, json: { model, source: source ?? 'Hello. Is this thing on?' } }));
    if (!result.ok) process.exitCode = 1;
    if (globals().json) return print(result);
    console.log(result.ok ? `${result.model} (${result.ms}ms): ${result.text}` : `실패 (${result.ms}ms): ${result.detail}`);
  });

program
  .command('regex <설명>')
  .description('자연어로 정규식 만들기 (앱 설정의 서식 규칙·번역 제외와 같음): 에디터 AI 모델을 한 번 부르고, 아무것도 저장하지 않습니다. 쓰려면 update_project_settings로 규칙에 넣습니다')
  .addOption(new Option('--target <대상>', 'token: 자리표시자·태그 패턴, check: 형식 검사 규칙').choices(['token', 'check']).default('token'))
  .action(async (prompt: string, options: { target: 'token' | 'check' }) => {
    const result = await unwrap(api().projects[':projectId']['generate-regex'].$post({ param: { projectId: await projectId() }, json: { prompt, target: options.target } }));
    print(result);
  });

// ── standard file, without the app ───────────────────────────────────

const format = program.command('format').description('표준 파일(loca/v1) 규격과 검사. 앱이 꺼져 있어도 됩니다');

format
  .command('schema')
  .description('표준 파일의 JSON Schema를 출력 (변환기를 만들 때 참고. 파일 사이 참조 검사는 check로)')
  .action(() => print(importFileJsonSchema()));

format
  .command('check <파일>')
  .description('표준 파일 검사: 형식 오류(경로와 함께), 개수 요약, 의도와 다를 수 있는 경고. 오류가 있으면 종료 코드 1')
  .action((file: string) => {
    let data: unknown;
    try {
      data = JSON.parse(readText(file));
    } catch (error) {
      throw new CliError(`JSON을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = importFileSchema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      if (globals().json) print({ ok: false, issues });
      else {
        console.log(`형식 오류 ${issues.length}개:`);
        for (const issue of issues.slice(0, 50)) console.log(`  ${issue.path || '(파일)'}: ${issue.message}`);
        if (issues.length > 50) console.log(`  … 외 ${issues.length - 50}개`);
      }
      process.exitCode = 1;
      return;
    }
    const summary = summarizeImport(result.data);
    const warnings = importWarnings(result.data);
    if (globals().json) return print({ ok: true, summary, warnings });
    console.log(`형식이 맞습니다: ${summary.name}`);
    console.log(`  묶음 ${summary.groups} · 대사 ${summary.units} · 인물 ${summary.characters} · 노트 ${summary.documents} · 용어 ${summary.terms}`);
    if (summary.excluded) console.log(`  번역 제외로 보이는 원문 ${summary.excluded} (${Object.entries(summary.excludedBy).map(([reason, count]) => `${EXCLUSION_REASON_LABELS[reason as keyof typeof EXCLUSION_REASON_LABELS]} ${count}`).join(' · ')}): 진행률·실행·내보내기에서 빠집니다. 규칙은 앱의 설정 › 에디터 › 번역 제외`);
    console.log(summary.graphNodes ? `  그래프 노드 ${summary.graphNodes} · 연결 ${summary.graphEdges}` : '  그래프 없음: 앞 대사 문맥을 장면 순서로만 찾습니다');
    for (const warning of warnings) console.log(`  경고  ${warning.message}${warning.examples.length ? ` (예: ${warning.examples.join(', ')})` : ''}`);
  });

// ── workspace: where agents keep scratch files ───────────────────────

/** LOCA_WORKSPACE, else the nearest existing .loca above here, else .loca at the git repository root, else here. */
function workspaceRoot(): string {
  if (process.env.LOCA_WORKSPACE) return path.resolve(process.env.LOCA_WORKSPACE);
  const upFrom = (marker: string) => {
    for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, marker))) return dir;
      if (path.dirname(dir) === dir) return null;
    }
  };
  return path.join(upFrom('.loca') ?? upFrom('.git') ?? process.cwd(), '.loca');
}

/** The folder ignores itself, so nothing in it is committed and no .gitignore elsewhere is touched. */
function ensureWorkspaceRoot(): string {
  const root = workspaceRoot();
  mkdirSync(root, { recursive: true });
  const ignore = path.join(root, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '# loca 작업 폴더: 에이전트의 임시 파일. 커밋하지 않습니다.\n*\n');
  return root;
}

const taskName = (name: string) => {
  if (!/^[\p{L}\p{N}_.-]+$/u.test(name) || name === '.' || name === '..') throw new CliError(`작업 이름에는 글자·숫자·_ . - 만 쓸 수 있습니다: ${name}`);
  return name;
};

function folderStats(dir: string): { files: number; bytes: number; modified: number } {
  let files = 0;
  let bytes = 0;
  let modified = statSync(dir).mtimeMs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = folderStats(full);
      files += inner.files;
      bytes += inner.bytes;
      modified = Math.max(modified, inner.modified);
    } else {
      const stat = statSync(full);
      files += 1;
      bytes += stat.size;
      modified = Math.max(modified, stat.mtimeMs);
    }
  }
  return { files, bytes, modified };
}

const workspace = program
  .command('workspace')
  .description('에이전트가 임시 파일(내보낸 대사, 번역 중인 파일, 추출 결과)을 두는 .loca/ 작업 폴더. git에 올라가지 않습니다');

workspace
  .command('new <이름>')
  .description('작업 폴더를 만들고(있으면 그대로) 절대 경로를 출력. 예: W=$(loca workspace new ch1-translate)')
  .action((name: string) => {
    const dir = path.join(ensureWorkspaceRoot(), taskName(name));
    const existed = existsSync(dir);
    mkdirSync(dir, { recursive: true });
    log(existed ? `이미 있는 작업 폴더입니다: ${dir}` : `작업 폴더를 만들었습니다: ${dir}`);
    console.log(dir);
  });

workspace
  .command('list')
  .description('작업 폴더 목록 (파일 수, 크기, 마지막 수정)')
  .action(() => {
    const root = workspaceRoot();
    const tasks = existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({ name: entry.name, path: path.join(root, entry.name), ...folderStats(path.join(root, entry.name)) }))
          .sort((a, b) => b.modified - a.modified)
      : [];
    if (globals().json) return print({ root, tasks: tasks.map((task) => ({ ...task, modified: new Date(task.modified).toISOString() })) });
    log(root);
    if (!tasks.length) return log('작업 폴더가 없습니다. loca workspace new <이름>으로 만드세요.');
    for (const task of tasks) console.log(`${task.name.padEnd(28)} 파일 ${String(task.files).padStart(4)} · ${(task.bytes / 1024).toFixed(0).padStart(6)} KB · ${new Date(task.modified).toLocaleString()}`);
  });

workspace
  .command('clean [이름...]')
  .description('작업 폴더 지우기. 이름을 주거나 --all')
  .option('--all', '모든 작업 폴더')
  .action((names: string[], options: { all?: boolean }) => {
    const root = workspaceRoot();
    if (!names.length && !options.all) throw new CliError('지울 작업 이름을 주거나 --all을 쓰세요. 목록: loca workspace list');
    const targets = options.all ? (existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []) : names.map(taskName);
    for (const name of targets) {
      const dir = path.join(root, name);
      if (!existsSync(dir)) {
        log(`없는 작업 폴더라 건너뜁니다: ${name}`);
        continue;
      }
      rmSync(dir, { recursive: true, force: true });
      log(`지웠습니다: ${dir}`);
    }
  });

/** The command tree, for the test that keeps .claude/skills/ in step with it. */
export { program };

// Run when started as the CLI (bin/loca.mjs runs this file); importing it only builds the tree.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  program.parseAsync().catch((error: unknown) => {
    log(error instanceof CliError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
