import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import { hc } from 'hono/client';
import type { AppType } from '@tw/server/app';
import { CHECK_KINDS, CONTEXT_ITEM_KINDS, GRAPH_FLOW_LABELS, importFileJsonSchema, importFileSchema, importWarnings, lineChangeSchema, summarizeImport, type LineFilterInput } from '@tw/shared';

/**
 * loca — the workbench from a terminal, for people and for agents with a shell (codex, claude, pi).
 * It talks to the running app's local API, so the screen updates live and nothing touches the
 * database directly. Reading prints results; anything that changes the project becomes a proposal
 * the user accepts in the app. With --json / --jsonl only data goes to stdout; messages go to stderr.
 * `format` and `workspace` work without the app.
 */

const program = new Command('loca')
  .description('게임 번역 작업실 loca를 터미널에서 씁니다. format·workspace 말고는 실행 중인 loca 앱에 연결합니다.')
  .option('--url <url>', 'loca 앱 주소', process.env.LOCA_URL ?? 'http://127.0.0.1:4317')
  .option('-p, --project <이름|id>', '프로젝트 (환경 변수 LOCA_PROJECT). 프로젝트가 하나면 생략 가능')
  .option('--json', '사람용 표 대신 JSON으로 출력')
  .showHelpAfterError();

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
const printJsonl = (rows: unknown[]) => {
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
};
const short = (text: string | null | undefined, length = 80) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
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
  translated?: boolean;
  untranslated?: boolean;
  key?: string[];
  limit?: string;
  offset?: string;
}

function withFilters(command: Command) {
  return command
    .option('-q, --q <글자>', '원문·번역·화자·키에 들어 있는 글자')
    .option('-s, --speaker <names...>', '이 인물이 하는 대사 (이름·별칭·화자 키)')
    .option('-l, --listener <names...>', '이 인물에게 하는 대사 (청자). "-"는 청자 미상')
    .option('-m, --mentions <names...>', '이 인물을 언급하는 대사 ({ALIAS} 포함)')
    .option('-g, --group <groups...>', '장면·묶음')
    .option('--section <sections...>', '구역(장·출처)')
    .addOption(new Option('--kind <종류>', '대사 종류').choices(['dialogue', 'document', 'ui']))
    .addOption(new Option('--group-kind <종류>', '묶음 종류').choices(['scene', 'document', 'ui']))
    .option('--status <statuses...>', '상태 이름')
    .option('--tag <tags...>', '태그 이름')
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

withFilters(program.command('lines').description('대사 찾기. 필터를 조합하고 --all이면 끝까지 읽습니다'))
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
    if (options.jsonl) return printJsonl(rows);
    if (globals().json) return print({ total, rows });
    for (const row of rows) console.log(`${row.key}  [${row.status}] ${row.speaker ?? '—'}${row.listener ? ` → ${row.listener}` : ''}: ${short(row.source)}${row.translation ? `\n    → ${short(row.translation)}` : ''}`);
  });

program
  .command('speakers')
  .description('화자 목록과 대사 수 (저장된 인물과 연결된 이름 포함)')
  .action(async () => {
    const rows = await unwrap(api().projects[':projectId'].speakers.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return print(rows);
    for (const row of rows) console.log(`${String(row.lines).padStart(6)}  ${row.speaker ?? '(화자 없음)'}${row.character && row.character !== row.speaker ? `  = ${row.character}` : ''}`);
  });

program
  .command('first <이름>')
  .description('인물이 처음 말하는 대사와 장면')
  .action(async (name: string) => {
    const row = await unwrap(api().projects[':projectId'].speakers[':name'].first.$get({ param: { projectId: await projectId(), name } }));
    if (!row) throw new CliError(`${name}의 대사가 없습니다.`);
    if (globals().json) return print(row);
    console.log(`${row.group.title} (${row.group.section ?? '구역 없음'})\n${row.key}  ${row.speaker}: ${row.source}`);
  });

program
  .command('scenes')
  .description('여러 인물이 함께 나오는 장면')
  .requiredOption('-w, --with <names...>', '함께 나와야 하는 인물들')
  .action(async (options: { with: string[] }) => {
    const rows = await unwrap(api().projects[':projectId'].scenes.with.$post({ param: { projectId: await projectId() }, json: { speakers: options.with } }));
    if (globals().json) return print(rows);
    log(`장면 ${rows.length}개`);
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
    console.log(`▶ ${context.line.speaker ?? '—'}${context.line.listener ? ` → ${context.line.listener}` : ''}: ${context.line.source}${context.line.translation ? `\n  → ${context.line.translation}` : ''}`);
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
    .description(`번역 점검: ${Object.entries(CHECK_KINDS).map(([kind, label]) => `${kind}(${label})`).join(', ')}`),
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
    if (options.jsonl) return printJsonl(items);
    if (globals().json) return print(items);
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
  .description('진행 상황: groups(묶음별), sections(구역별), runs(최근 실행)')
  .option('--since <시간>', 'runs: 몇 시간 전부터', '24')
  .action(async (of: string, options: { since: string }) => {
    if (!['groups', 'sections', 'runs'].includes(of)) throw new CliError('대상은 groups, sections, runs 중 하나입니다.');
    const data = await unwrap(api().projects[':projectId'].stats[':of{groups|sections|runs}'].$get({ param: { projectId: await projectId(), of: of as 'runs' }, query: { sinceHours: options.since } }));
    if (globals().json) return print(data);
    if (of === 'runs') {
      const runs = data as { runs: { workflow: string; status: string; lines: number; calls: number; failedCalls: number; inputTokens: number; outputTokens: number; createdAt: string }[]; failingNodes: { workflow: string; node: string; failedLines: number }[] };
      for (const run of runs.runs)
        console.log(`${new Date(run.createdAt).toLocaleString()}  ${run.workflow} [${run.status}] 대사 ${run.lines}, 호출 ${run.calls}(실패 ${run.failedCalls}), 토큰 ${(run.inputTokens + run.outputTokens).toLocaleString()}`);
      if (runs.failingNodes.length) console.log(`\n실패가 많은 노드:\n${runs.failingNodes.map((node) => `  ${node.workflow} › ${node.node}: ${node.failedLines}줄`).join('\n')}`);
      return;
    }
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
    if (report.proposalId) console.log(`\n제안을 올렸습니다 (${report.proposalId}). loca 앱 채팅 패널에서 수락하면 한 번에 반영됩니다.`);
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
  .command('tools')
  .description('에이전트 도구 목록 (call로 부를 수 있음)')
  .action(async () => {
    const tools = await unwrap(api().projects[':projectId'].tools.$get({ param: { projectId: await projectId() } }));
    if (globals().json) return print(tools);
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
      return print({ proposalId: result.proposalId });
    }
    print(result.result);
  });

program
  .command('proposal <id>')
  .description('제안이 수락·거절됐는지 보기')
  .action(async (id: string) => {
    const proposal = await unwrap(api().projects[':projectId'].proposals[':id'].$get({ param: { projectId: await projectId(), id } }));
    if (globals().json) return print(proposal);
    const word = { pending: '대기 중', accepted: '수락되어 반영됨', rejected: '거절됨', failed: '수락했지만 실패' } as const;
    console.log(`${proposal.tool}: ${word[proposal.status]}${proposal.result ? `\n${JSON.stringify(proposal.result)}` : ''}`);
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
    console.log(summary.graphFlow ? `  그래프 노드 ${summary.graphNodes} · 연결 ${summary.graphEdges} · 범위: ${GRAPH_FLOW_LABELS[summary.graphFlow]}` : '  그래프 없음: 앞 대사 문맥을 장면 순서로만 찾습니다');
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
  .description('에이전트가 임시 파일(내보낸 대사, 번역 중인 파일, 분석 결과)을 두는 .loca/ 작업 폴더. git에 올라가지 않습니다');

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

program.parseAsync().catch((error: unknown) => {
  log(error instanceof CliError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
