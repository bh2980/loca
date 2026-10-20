import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, Option } from 'commander';
import { hc } from 'hono/client';
import type { AppType } from '@tw/server/app';
import { acceptedLabel, AUTO_MARKS, CHECK_KINDS, EXCLUSION_REASON_LABELS, CONTEXT_ITEM_KINDS, importFileJsonSchema, importFileSchema, importWarnings, KNOWLEDGE_MARK_IDS, KNOWLEDGE_STATUS_LABELS, LINE_MARK_IDS, lineChangeSchema, summarizeImport, TERM_MARK_IDS, type AutoMark, type KnowledgeStatus, type LineFilterInput, type LineMark, personLabel } from '@tw/shared';

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
  워크플로  loca workflows list · loca workflows show 초벌 --json > wf.json  →  고친 뒤  loca workflows save wf.json
  실행      loca runs plan 초벌 -g s1  →  loca runs start 초벌 -g s1  →  loca runs list · loca runs show <id>
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
/** A change tool: filed as a proposal the person accepts in the app. Prints what was left out and returns the proposal. */
async function proposeTool(name: string, input: Record<string, unknown>): Promise<{ proposalId: string }> {
  const response = await unwrap(api().projects[':projectId'].tools[':name'].$post({ param: { projectId: await projectId(), name }, json: input }));
  if (!response.proposed) {
    const result = (response as { result?: { error?: string } }).result;
    throw new CliError(result?.error ?? `${name}은(는) 제안을 만들지 않았습니다.`);
  }
  const report = (response as { report?: { dropped?: { key: string; reason: string }[]; warnings?: { key: string; issues: string[] }[] } | null }).report;
  for (const entry of report?.dropped?.slice(0, 20) ?? []) log(`  뺌  ${entry.key}: ${entry.reason}`);
  for (const entry of report?.warnings?.slice(0, 20) ?? []) log(`  경고  ${entry.key}: ${entry.issues.join(' / ')}`);
  return { proposalId: response.proposalId as string };
}
/** Where proposals are decided. */
const ACCEPT_HINT = 'loca 앱 채팅 패널의 ‘CLI 제안’에서 수락하면 반영됩니다';

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

/** A tool result cut for length says so (fitResult); the command tells how to narrow it. */
const warnTruncated = (result: { truncated?: { shown: number; total: number } }, hint: string) => {
  if (result.truncated) log(`결과가 길어 ${result.truncated.shown}/${result.truncated.total}개만 받았습니다. ${hint}`);
};

/** JSON from an argument: literal JSON, @path to a file, or - for stdin (no shell quoting needed). */
function readJsonArg(value: string | undefined): unknown {
  if (value === undefined) return {};
  const text = value === '-' ? readFileSync(0, 'utf8') : value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value;
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('JSON을 읽지 못했습니다. 직접 쓰기 어려우면 @파일 또는 - (표준 입력)으로 넘기세요.');
  }
}

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
  hideSpeaker?: string[];
  hideStatus?: string[];
  hideTag?: string[];
  hideMark?: LineMark[];
  translated?: boolean;
  untranslated?: boolean;
  key?: string[];
  limit?: string;
  offset?: string;
}

function withFilters(command: Command) {
  return command
    .option('-q, --q <글자>', '원문·번역·화자·키에 들어 있는 글자 (%·_·\\도 그 글자 그대로)')
    .option('-s, --speaker <names...>', '이 인물이 하는 대사 (이름·별칭·화자 키)')
    .option('-l, --listener <names...>', '이 인물에게 하는 대사 (청자). "-"는 청자 미상(= --mark unknownListener)')
    .option('-m, --mentions <names...>', '이 인물을 언급하는 대사 ({ALIAS} 포함)')
    .option('-g, --group <groups...>', '장면·묶음')
    .option('--section <sections...>', '구역(장·출처)')
    .addOption(new Option('--kind <종류>', '대사 종류').choices(['dialogue', 'document', 'ui']))
    .addOption(new Option('--group-kind <종류>', '묶음 종류').choices(['scene', 'document', 'ui']))
    .option('--status <statuses...>', '상태 이름')
    .option('--tag <tags...>', '태그 이름 (모두 붙은 대사)')
    .addOption(new Option('--mark <marks...>', '자동 표시(앱의 #태그)가 모두 붙은 대사. 앱 목록의 필터와 같은 규칙').choices(LINE_MARK_IDS))
    .option('--hide-speaker <names...>', '숨기기: 이 인물이 하는 대사는 뺌')
    .option('--hide-status <statuses...>', '숨기기: 이 상태의 대사는 뺌')
    .option('--hide-tag <tags...>', '숨기기: 이 태그 중 하나라도 붙은 대사는 뺌')
    .addOption(new Option('--hide-mark <marks...>', '숨기기: 이 자동 표시 중 하나라도 붙은 대사는 뺌 (예: excluded = #번역 제외)').choices(LINE_MARK_IDS))
    .option('--translated', '번역이 있는 대사만')
    .option('--untranslated', '번역이 없는 대사만')
    .option('--key <keys...>', '대사 키')
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
    hideSpeakers: options.hideSpeaker,
    hideStatuses: options.hideStatus,
    hideTags: options.hideTag,
    hideMarks: options.hideMark,
    translated: options.translated ? true : options.untranslated ? false : undefined,
    keys: options.key,
    limit: options.limit ? Number(options.limit) : undefined,
    offset: options.offset ? Number(options.offset) : undefined,
  };
}

// ── commands ─────────────────────────────────────────────────────────

program
  .command('projects')
  .description('프로젝트 목록')
  .action(async () => {
    const projects = await unwrap(api().cli.projects.$get());
    if (globals().json) return print(projects);
    for (const project of projects) console.log(`${project.name}  (${project.id})`);
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
    for (const row of rows) console.log(`${row.key}  [${row.status}] ${row.speaker ?? '—'}${row.listener ? ` → ${row.listener}` : ''}: ${short(row.source)}${row.translation ? `\n    → ${short(row.translation)}` : ''}${row.marks.length || row.tags.length ? `\n    ${withMarks('', row.marks, row.tags)}` : ''}`);
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
      api().projects[':projectId'].checks[':kind{terms|consistency|format|length|speech}'].$post({
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
          kind === 'terms' ? `"${item.term}" → "${item.expected}"` : kind === 'format' ? (item.issues as string[]).join(' / ') : kind === 'speech' ? `${item.speaker} → ${item.listener}: ${item.rule} · ${item.issue}` : `×${item.ratio}`;
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

withFilters(program.command('export').description('번역할 대사를 JSONL로 내보내기 (key와 rev 포함). 번역해서 import로 돌려보냅니다'))
  .option('-c, --context <n>', '대사마다 앞 대사 몇 줄을 문맥으로 붙일지', '0')
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
    const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
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
    if (globals().json) return print(report);
    console.log(`줄 ${report.total} · 바뀔 줄 ${report.changes} · 그대로 ${report.unchanged ?? 0} · 충돌 ${report.conflicts.length} · 오류 ${report.errors.length} · 경고 ${report.warnings.length}`);
    for (const entry of report.errors.slice(0, 20)) console.log(`  오류  ${entry.key}: ${entry.reason}`);
    for (const entry of report.conflicts.slice(0, 20)) console.log(`  충돌  ${entry.key}: ${entry.reason}`);
    for (const entry of report.warnings.slice(0, 20)) console.log(`  경고  ${entry.key}: ${entry.issues.join(' / ')}`);
    const hidden = Math.max(0, report.errors.length - 20) + Math.max(0, report.conflicts.length - 20) + Math.max(0, report.warnings.length - 20);
    if (hidden) console.log(`  … ${hidden.toLocaleString()}개 더 (--json으로 전부 보기)`);
    if (report.proposalId) console.log(`\n제안을 올렸습니다 (${report.proposalId}). ${ACCEPT_HINT}.`);
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
  .description('에이전트 도구를 직접 호출. 입력은 JSON, @파일, 또는 - (표준 입력). 변경 도구는 제안으로 올라갑니다')
  .action(async (name: string, input: string | undefined) => {
    const result = await unwrap(
      api().projects[':projectId'].tools[':name'].$post({ param: { projectId: await projectId(), name }, json: readJsonArg(input) as Record<string, unknown> }),
    );
    if (result.proposed) {
      log(result.message);
      // What the check left out and why (a duplicate term, a tag that cannot go there, a stale line), not just the first.
      const report = (result as { report?: { dropped?: { key: string; reason: string }[]; warnings?: { key: string; issues: string[] }[] } | null }).report;
      for (const entry of report?.dropped?.slice(0, 20) ?? []) log(`  뺌  ${entry.key}: ${entry.reason}`);
      for (const entry of report?.warnings?.slice(0, 20) ?? []) log(`  경고  ${entry.key}: ${entry.issues.join(' / ')}`);
      return print({ proposalId: result.proposalId });
    }
    // A graph pick comes back with where to open it; say it as a link.
    const open = (result.result as { open?: { to: string; search?: Record<string, string> } } | undefined)?.open;
    if (open) log(`앱에서 열기: ${appLink(open.to.replace('$projectId', await projectId()), open.search)}`);
    print(result.result);
  });

// ── glossary, knowledge, tags, run plan ──────────────────────────────

const terms = program
  .command('terms')
  .description('용어집 목록: 원문, 번역어, 상태, 나온 줄(대본에서 쓰이는 대사 수), 표시(#), 태그. 앱 용어집 화면의 필터와 같은 규칙')
  .option('-q, --q <글자>', '원문·번역어에 들어 있는 글자')
  .addOption(new Option('--mark <marks...>', '자동 표시. 후보와 AI 초안을 함께 주면 둘 중 하나').choices(TERM_MARK_IDS))
  .option('--unreviewed', '사람이 아직 정하지 않은 용어 (--mark candidate ai와 같음)')
  .option('--tag <tags...>', '태그 이름 (모두 붙은 용어)')
  .option('--limit <n>', '최대 몇 개까지')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (options: { q?: string; mark?: string[]; unreviewed?: boolean; tag?: string[]; limit?: string; jsonl?: boolean }) => {
    type Term = { id: string; source: string; target: string; note: string; status: KnowledgeStatus; statusBy: string; lines: number | null; examples: string[]; marks: string[]; tags: string[] };
    const wanted = options.limit ? Number(options.limit) : Infinity;
    const rows: Term[] = [];
    let total = 0;
    // A page the tool had to cut still arrives; continue from what came.
    while (rows.length < wanted) {
      const page = await readTool<{ total: number; terms: Term[] }>('list_terms', { q: options.q, marks: options.mark, unreviewed: options.unreviewed || undefined, tags: options.tag, offset: rows.length, limit: Math.min(100, wanted - rows.length) });
      total = page.total;
      rows.push(...page.terms);
      if (!page.terms.length || rows.length >= total) break;
    }
    log(`용어 ${total.toLocaleString()}개 중 ${rows.length.toLocaleString()}개`);
    if (options.jsonl) return printJsonl(rows);
    if (globals().json) return printList(total, rows);
    for (const term of rows)
      console.log(`${String(term.lines ?? '?').padStart(5)}줄  ${term.source} → ${term.target || '(번역어 없음)'}  [${KNOWLEDGE_STATUS_LABELS[term.status]}]  ${withMarks('', term.marks, term.tags)}  (${term.id})${term.note ? `\n         ${short(term.note, 100)}` : ''}`);
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

const KNOWLEDGE_KINDS = {
  documents: { tool: 'read_documents', pick: undefined, label: '문서' },
  characters: { tool: 'list_characters', pick: 'characters', label: '인물' },
  relationships: { tool: 'list_characters', pick: 'relationships', label: '관계' },
  events: { tool: 'list_events', pick: undefined, label: '사건' },
  'speech-rules': { tool: 'list_speech_rules', pick: undefined, label: '말투 규칙' },
} as const;

program
  .command('knowledge <종류>')
  .description(`작품 자료 목록: ${Object.entries(KNOWLEDGE_KINDS).map(([kind, info]) => `${kind}(${info.label})`).join(', ')}. 상태, 표시(#), 태그 포함. 앱 작품 자료 화면의 필터와 같은 규칙`)
  .addOption(new Option('--mark <marks...>', '자동 표시. 후보와 AI 초안을 함께 주면 둘 중 하나').choices(KNOWLEDGE_MARK_IDS))
  .option('--unreviewed', '사람이 아직 정하지 않은 항목 (--mark candidate ai와 같음)')
  .option('--tag <tags...>', '태그 이름 (모두 붙은 항목)')
  .option('--jsonl', '한 줄에 하나씩 JSON으로 출력')
  .action(async (kind: string, options: { mark?: string[]; unreviewed?: boolean; tag?: string[]; jsonl?: boolean }) => {
    if (!(kind in KNOWLEDGE_KINDS)) throw new CliError(`종류는 ${Object.keys(KNOWLEDGE_KINDS).join(', ')} 중 하나입니다.`);
    const info = KNOWLEDGE_KINDS[kind as keyof typeof KNOWLEDGE_KINDS];
    const result = await readTool<Record<string, any>>(info.tool, { marks: options.mark, unreviewed: options.unreviewed || undefined, tags: options.tag });
    const rows: Record<string, any>[] = info.pick ? result[info.pick] : Array.isArray(result) ? result : (result.items ?? []);
    log(`${info.label} ${rows.length.toLocaleString()}개`);
    warnTruncated(result, '--mark, --unreviewed, --tag로 좁히세요.');
    if (options.jsonl) return printJsonl(rows);
    if (globals().json) return printList(rows.length, rows);
    const name = (row: Record<string, any>): string =>
      kind === 'documents' ? `[${row.kind}] ${row.title}${row.alwaysInclude ? ' (항상 문맥에)' : ''}`
      : kind === 'characters' ? `${row.name}${row.aliases?.length ? ` (${row.aliases.join(', ')})` : ''}${row.player ? ' 플레이어' : ''}${personLabel(row) ? ` · ${personLabel(row)}` : ''}`
      : kind === 'relationships' ? `${row.from} ${row.mutual ? '↔' : '→'} ${row.to}: ${row.kind}`
      : kind === 'events' ? `${row.title}${row.summary ? ` — ${short(row.summary, 60)}` : ''}`
      : `${row.from} → ${row.to}  ${row.level}${row.startKey ? ` (${row.startKey}부터)` : ''}${row.address ? `  호칭 ${row.address}` : ''}`;
    for (const row of rows) console.log(`${name(row)}  [${KNOWLEDGE_STATUS_LABELS[row.status as KnowledgeStatus]}]  ${withMarks('', row.marks, row.tags)}  (${row.id})`);
  });

program
  .command('tags')
  .description('프로젝트 태그와 기본 표시(#)의 붙는 곳(대사·자료·용어집), 종류, 색, 쓰인 대사·항목 수. 태그는 붙는 곳에만 붙일 수 있고 다른 곳은 거절됩니다')
  .action(async () => {
    type Entry = { name: string; color: string; places: string[]; builtin: boolean; lines: number; items: number; id: string; role?: string | null; description?: string };
    const data = await readTool<{ tags: Entry[]; marks: Entry[] }>('list_tags');
    if (globals().json) return print(data);
    const row = (entry: Entry, kind: string) => console.log(`  #${entry.name}  ·  붙는 곳 ${entry.places.join('·')}  ·  ${kind}  ·  ${entry.color}  ·  대사 ${entry.lines} · 자료 ${entry.items}${entry.description ? `  ·  ${entry.description}` : ''}`);
    console.log('태그');
    for (const tag of data.tags) row(tag, tag.builtin ? '기본' : '내 태그');
    console.log('\n자동 표시 (앱이 대본에서 읽는 사실. 붙이는 게 아니라 조건으로 필터·실행 범위에 씁니다)');
    for (const mark of data.marks) row({ ...mark, name: mark.name }, '자동');
  });

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

program
  .command('statuses')
  .description('번역 상태: 종류(시작·중간·최종), 순서, 검토함 표시')
  .action(async () => {
    type Status = { id: string; name: string; kind: string; sort: number; inReview: boolean; color: string };
    const rows = await readTool<Status[]>('list_statuses');
    if (globals().json) return printList(rows.length, rows);
    const kind: Record<string, string> = { initial: '시작', normal: '중간', final: '최종' };
    for (const row of rows) console.log(`${row.name.padEnd(10)} ${kind[row.kind] ?? row.kind}${row.inReview ? ' · 검토함' : ''}  (${row.id})`);
  });

const workflows = program.command('workflows').description('워크플로: 목록, 노드·연결·검증 보기, 파일로 고쳐 제안하기');

workflows
  .command('list')
  .description('워크플로 목록과 노드 수, 오류 수, 시작의 대상 상태')
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
    const summary = (node: Node) =>
      node.type === 'entry' ? `대상 상태 ${node.config.statusIds?.length ?? 0}개`
      : node.type === 'ai' ? `${node.config.output}·${node.config.scope ?? 'line'}${node.config.preset ? ` · 프리셋 ${node.config.preset}` : ''} · ${node.config.model?.model || '모델 없음'}${node.config.fields?.length ? ` · 필드 ${node.config.fields.map((field: { name: string }) => field.name).join(', ')}` : ''}`
      : node.type === 'function' ? `${node.config.fn}`
      : node.type === 'condition' ? JSON.stringify(node.config.expression)
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
    const { proposalId } = await proposeTool('save_workflow', workflow);
    if (globals().json) return print({ proposalId });
    console.log(`제안을 올렸습니다 (${proposalId}). ${ACCEPT_HINT}.`);
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

const runs = program.command('runs').description('워크플로 실행: 목록, 진행 보기, 미리보기, 시작 요청');

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

runs
  .command('show <id>')
  .description('한 실행의 노드별 진행(상태별 대사·용어 수)과 최근 실패')
  .action(async (id: string) => {
    const data = await readTool<{ id: string; workflow: string; status: string; subject?: 'lines' | 'terms'; total: number; nodes: { nodeId: string; state: string; count: number }[]; failures: { key?: string; unitId?: string; nodeId?: string; error?: string }[] }>('read_run', { runId: id });
    if (globals().json) return print(data);
    console.log(`${data.workflow} [${data.status}] ${data.subject === 'terms' ? `용어 ${data.total.toLocaleString()}개` : `대사 ${data.total.toLocaleString()}줄`}\n${appLink(`/p/${await projectId()}/runs/${data.id}`)}`);
    for (const node of data.nodes) console.log(`  ${node.nodeId.padEnd(16)} ${node.state.padEnd(9)} ${node.count.toLocaleString()}`);
    if (data.failures.length) console.log(`\n최근 실패:\n${data.failures.map((failure) => `  ${failure.key ?? failure.unitId ?? ''} ${failure.nodeId ? `[${failure.nodeId}] ` : ''}${short(failure.error ?? '', 120)}`).join('\n')}`);
  });

runs
  .command('plan <워크플로>')
  .description('실행 전 미리보기(실행 대화상자와 같은 계산, 모델은 부르지 않고 아무것도 시작하지 않음). 워크플로는 이름·id: 범위의 대사 수(용어 워크플로는 용어 수), 묶음·요청 수 추정, 준비 상태(청자 미상, 확인 안 한 말투 규칙·용어, 말투 규칙 없는 쌍). 범위 조건은 모두 만족해야 합니다. 용어 워크플로(진입 subject가 terms)는 --term으로 범위를 정하고 대사 범위 옵션은 쓸 수 없습니다')
  .option('-g, --group <groups...>', '장면·묶음 (키·id·제목)')
  .option('--key <keys...>', '대사 키')
  .addOption(new Option('--mark <marks...>', '자동 표시가 모두 붙은 대사').choices(LINE_MARK_IDS))
  .option('--tag <tags...>', '태그 이름 (모두 붙은 대사)')
  .option('--term <terms...>', '용어 워크플로만: 이 용어(원문·id)만. 없으면 진입 노드가 고르는 용어(상태·표시 조건, 많이 쓰인 순)')
  .option('--ignore-status', '진입 노드가 받지 않는 상태의 대사도 포함')
  .option('--model <specs...>', '이번 실행만 다른 모델로: "연결:모델"(모든 AI 단계) 또는 "노드=연결:모델" (연결·노드는 이름이나 id). 워크플로는 바뀌지 않습니다')
  .action(async (workflow: string, options: { group?: string[]; key?: string[]; mark?: string[]; tag?: string[]; term?: string[]; ignoreStatus?: boolean; model?: string[] }) => {
    type Names = { count: number; examples: string[]; names: string[]; more: boolean };
    const data = await readTool<{
      workflow: { id: string; name: string };
      lines: { total: number; translated: number; untranslated: number };
      subject?: 'lines' | 'terms';
      plan: { batches: number; linesPerBatch: { min: number; median: number; max: number } | null };
      nodes: { name: string; model: string | null; requests: { min: number; expected: number | null; max: number }; promptTokens: number }[];
      totals: { calls: { min: number; expected: number | null; max: number }; inputTokens: { min: number; expected: number | null; max: number } };
      pace: { seconds: number | null; costUsd: number | null; subscription: boolean };
      readiness: { dialogueLines: number; unknownListenerLines: number; unreviewedRules: Names; unreviewedTerms: Names; pairsWithoutRule: { count: number; examples: string[] } };
    }>('plan_run', { workflow, groups: options.group, keys: options.key, tags: options.tag, marks: options.mark, terms: options.term, ignoreStatus: options.ignoreStatus, models: runModels(options.model) });
    if (globals().json) return print(data);
    const range = (value: { min: number; expected: number | null; max: number }) => (value.expected !== null ? `약 ${value.expected.toLocaleString()} (${value.min.toLocaleString()}~${value.max.toLocaleString()})` : `${value.min.toLocaleString()}~${value.max.toLocaleString()}`);
    console.log(`${data.workflow.name} 실행 미리보기`);
    const terms = data.subject === 'terms';
    console.log(`  ${terms ? '용어' : '대사'} ${data.lines.total.toLocaleString()}개 (번역${terms ? '어' : ''} 있음 ${data.lines.translated.toLocaleString()} · 없음 ${data.lines.untranslated.toLocaleString()})`);
    const per = data.plan.linesPerBatch;
    if (!terms) console.log(`  묶음 ${data.plan.batches.toLocaleString()}개${per ? ` (묶음당 ${per.min}~${per.max}줄, 중간 ${per.median})` : ''}`);
    console.log(`  AI 요청 ${range(data.totals.calls)} · 입력 토큰 ${range(data.totals.inputTokens)}${data.pace.seconds !== null ? ` · 약 ${Math.round(data.pace.seconds / 60)}분` : ''}${data.pace.subscription ? ' · 구독' : data.pace.costUsd !== null ? ` · 약 $${data.pace.costUsd.toFixed(2)}` : ''}`);
    for (const node of data.nodes) console.log(`    ${node.name}  ${node.model ?? '(모델 없음)'}  요청 ${range(node.requests)} · 프롬프트 약 ${node.promptTokens.toLocaleString()}토큰`);
    if (terms) return console.log('\n용어 워크플로는 청자·말투 규칙 준비 상태를 보지 않습니다. 시작 전 loca terms로 대상 용어를 확인하세요.');
    const ready = data.readiness;
    console.log('\n준비 상태');
    console.log(`  청자 미상 대사 ${ready.unknownListenerLines.toLocaleString()} / 청자가 필요한 대사 ${ready.dialogueLines.toLocaleString()}${ready.unknownListenerLines ? '   → loca lines --mark unknownListener' : ''}`);
    const list = (entry: Names) => `${entry.names.slice(0, 8).join(', ')}${entry.count > Math.min(8, entry.names.length) ? ` 외 ${entry.count - Math.min(8, entry.names.length)}개` : ''}`;
    console.log(`  확인 안 한 말투 규칙 ${ready.unreviewedRules.count}개${ready.unreviewedRules.count ? `: ${list(ready.unreviewedRules)}   → loca knowledge speech-rules --unreviewed` : ''}`);
    console.log(`  확인 안 한 용어 ${ready.unreviewedTerms.count}개${ready.unreviewedTerms.count ? `: ${list(ready.unreviewedTerms)}   → loca terms --unreviewed` : ''}`);
    console.log(`  말투 규칙 없는 화자 쌍 ${ready.pairsWithoutRule.count}개${ready.pairsWithoutRule.count ? `: ${ready.pairsWithoutRule.examples.join(', ')}${ready.pairsWithoutRule.count > ready.pairsWithoutRule.examples.length ? ' …' : ''}` : ''}`);
  });

runs
  .command('start <워크플로>')
  .description('실행 시작을 제안으로 올리기 (AI 호출에 비용이 들어 앱에서 수락해야 시작합니다). 범위는 plan과 같고(대사 워크플로는 대사 범위, 용어 워크플로는 --term), 먼저 plan으로 확인하세요')
  .option('-g, --group <groups...>', '장면·묶음 (키·id·제목)')
  .option('--key <keys...>', '대사 키')
  .addOption(new Option('--mark <marks...>', '자동 표시가 모두 붙은 대사').choices(LINE_MARK_IDS))
  .option('--tag <tags...>', '태그 이름 (모두 붙은 대사)')
  .option('--term <terms...>', '용어 워크플로만: 이 용어(원문·id)만. 없으면 진입 노드가 고르는 용어(상태·표시 조건, 많이 쓰인 순)')
  .option('--ignore-status', '시작의 대상 상태가 아닌 대사도 포함')
  .option('--model <specs...>', 'plan과 같은 "연결:모델" 또는 "노드=연결:모델"')
  .action(async (ref: string, options: { group?: string[]; key?: string[]; mark?: string[]; tag?: string[]; term?: string[]; ignoreStatus?: boolean; model?: string[] }) => {
    const workflow = await resolveWorkflow(ref);
    const groups = await resolveGroups(options.group);
    const unitIds = options.key?.length ? (await unwrap(api().projects[':projectId'].lines.find.$post({ param: { projectId: await projectId() }, json: { keys: options.key, limit: 1000 } }))).rows.map((row) => row.id) : undefined;
    const tagIds = options.tag?.length
      ? (await readTool<{ tags: { id: string; name: string }[] }>('list_tags')).tags.filter((tag) => options.tag!.includes(tag.name)).map((tag) => tag.id)
      : undefined;
    const { proposalId } = await proposeTool('start_run', { workflowId: workflow.id, groupIds: groups?.map((group) => group.id), unitIds, tagIds, marks: options.mark, termIds: options.term, ignoreStatus: options.ignoreStatus, models: runModels(options.model) });
    if (globals().json) return print({ proposalId });
    console.log(`실행 요청을 올렸습니다 (${proposalId}). ${ACCEPT_HINT}. 시작한 뒤에는 loca runs list로 봅니다.`);
  });

const proposals = program.command('proposals').description('CLI와 워크플로가 올린 제안: 목록과 결정 상태 (결정은 앱에서)');

proposals
  .command('list')
  .description('제안 목록, 최근 것부터')
  .addOption(new Option('--status <상태>', '이 상태만').choices(['pending', 'running', 'accepted', 'rejected', 'failed']))
  .option('--run <id>', '이 실행이 올린 제안만')
  .option('--limit <n>', '최대 몇 개', '50')
  .action(async (options: { status?: 'pending'; run?: string; limit: string }) => {
    const response = await api().projects[':projectId'].proposals.$get({ param: { projectId: await projectId() }, query: { status: options.status, runId: options.run, limit: options.limit } });
    const rows = await unwrap(Promise.resolve(response));
    const total = Number(response.headers.get('x-total-count') ?? rows.length);
    log(`제안 ${total.toLocaleString()}개 중 ${rows.length.toLocaleString()}개`);
    if (globals().json) return printList(total, rows);
    const word: Record<string, string> = { pending: '대기', running: '적용 중', accepted: '수락', rejected: '거절', failed: '실패' };
    const from: Record<string, string> = { cli: 'CLI', run: '실행', chat: '채팅' };
    for (const row of rows as { id: string; tool: string; status: string; source?: string; runId?: string | null; input?: Record<string, unknown>; createdAt: string }[]) {
      // How many entries it carries (lines, items, changes), when it is a list.
      const size = Object.values(row.input ?? {}).find(Array.isArray)?.length;
      console.log(`${new Date(row.createdAt).toLocaleString()}  [${word[row.status] ?? row.status}] ${row.tool}${size ? ` ${size.toLocaleString()}건` : ''} · ${from[row.source ?? ''] ?? row.source ?? ''}${row.runId ? ` ${row.runId.slice(0, 8)}` : ''}  (${row.id})`);
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

const views = program.command('views').description('대사 그래프의 저장된 보기(고른 노드만 남긴 간략 그래프): 목록, 링크, 만들기');

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
      data = JSON.parse(file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8'));
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
    console.log(`  묶음 ${summary.groups} · 대사 ${summary.units} · 인물 ${summary.characters} · 문서 ${summary.documents} · 용어 ${summary.terms}`);
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

/** The command tree, for the test that keeps skills/ in step with it. */
export { program };

// Run when started as the CLI (bin/loca.mjs runs this file); importing it only builds the tree.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  program.parseAsync().catch((error: unknown) => {
    log(error instanceof CliError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
