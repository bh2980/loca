/**
 * Cost regression harness: runs real workflows in-process on a realistic project with a mock model that
 * charges realistic per-call overhead, prints what they cost, and fails when the cost regresses.
 *   pnpm budget                        run every scenario, compare with scripts/budget-baseline.json
 *   pnpm budget --only translate-cli   one scenario (--json for machine output)
 *   pnpm budget --update               rewrite the baseline from this run
 *   pnpm budget --size 3000            smaller project (the baseline is only compared at its own size)
 * Time is not simulated: no sleeps, no real backoff. Cost is read from `run_steps` / `run_items` after the run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ai from '../packages/ai/src/index.ts';
import { importFileSchema, knowledgeTemplate } from '../packages/shared/src/index.ts';
import { openDatabase } from '../apps/server/src/db/index.ts';
import * as s from '../apps/server/src/db/schema.ts';
import { importProject } from '../apps/server/src/services/importer.ts';
import { snapshotWorkflowModels } from '../apps/server/src/services/routes.ts';
import { memoryStore } from '../apps/server/src/services/secrets.ts';
import { Runner, type ModelPort } from '../apps/server/src/engine/runner.ts';
import { createRun } from '../apps/server/src/engine/run-create.ts';
import { DEFAULT_OPTIONS, PROFILES, makeRand, respond, type MockOptions } from './mock-llm-core.ts';
import { realistic } from './realistic-sample.ts';
import { compare } from './budget-compare.ts';

const BASELINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'budget-baseline.json');
const DEFAULT_SIZE = 9000;
const SEED = 7;

interface Scenario {
  name: string;
  workflow: string;
  profiles: string[];
  /** Workflow settings this scenario overrides. */
  settings?: { maxConsecutiveFailures?: number };
}
const SCENARIOS: Scenario[] = [
  { name: 'translate-cli', workflow: '기본 번역', profiles: ['cli-like'] },
  // ~6% of calls fail here, and which ones depends on timing (batches gather on the clock), so three
  // failures in a row — the default pause guard — came up in about 1 run in 4 and made its cost
  // incomparable. This scenario measures what faults cost in a finished run; the guard has its own tests.
  { name: 'translate-faulty', workflow: '기본 번역', profiles: ['cli-like', 'faulty'], settings: { maxConsecutiveFailures: 10 } },
  { name: 'listener-cli', workflow: '청자 추정', profiles: ['cli-like'] },
  { name: 'terms-cli', workflow: '용어 추출', profiles: ['cli-like'] },
  { name: 'knowledge-cli', workflow: '자료 갱신', profiles: ['cli-like'] },
  { name: 'analysis-cli', workflow: '작품 분석', profiles: ['cli-like'] },
];

export interface Metrics {
  linesInScope: number;
  status: string;
  notice: string | null;
  /** Lines with work still queued or running when the run stopped. */
  unfinishedLines: number;
  calls: number;
  failedCalls: number;
  callsByNode: Record<string, number>;
  callsPer100Lines: number;
  linesPerCallMean: number;
  smallCallShare: number;
  inputTokens: number;
  inputPerLine: number;
  cachedInputTokens: number;
  fixedOverheadShare: number;
  outputTokens: number;
  failedLines: number;
  failedLineShare: number;
  wallSeconds: number;
}

/** A model port answering from the mock LLM's brain: same bodies, usage and faults as `pnpm mock-llm`. */
function mockPort(options: MockOptions): ModelPort {
  const rand = makeRand(options.seed);
  return {
    judge: async () => {
      throw new Error('the budget harness has no judge model');
    },
    generate: (async (_route: unknown, request: ai.GenerateRequest<unknown>) => {
      const out = respond({ system: request.system, user: request.prompt }, options, rand);
      if (out.status === 429) throw new ai.ModelError('rate-limit', 'mock rate limit', true);
      const usage: ai.Usage = {
        inputTokens: out.usage.prompt_tokens,
        cachedInputTokens: out.usage.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: out.usage.completion_tokens,
      };
      if (out.finishReason === 'length') throw new ai.ModelError('invalid-output', 'mock output cut off', false, usage);
      let parsed: unknown;
      try {
        parsed = JSON.parse(out.content);
      } catch {
        throw new ai.ModelError('invalid-output', 'mock output is not JSON', false, usage);
      }
      const checked = request.schema.safeParse(parsed);
      if (!checked.success) throw new ai.ModelError('invalid-output', `mock output does not match the schema: ${checked.error.message.slice(0, 200)}`, false, usage);
      return { object: checked.data, usage };
    }) as ModelPort['generate'],
  };
}

async function runScenario(scenario: Scenario, size: number): Promise<Metrics> {
  const options = scenario.profiles.reduce<MockOptions>((all, name) => ({ ...all, ...PROFILES[name] }), { ...DEFAULT_OPTIONS, seed: SEED });
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://localhost:1/v1', maxOutputTokens: 8000, timeoutSeconds: 30, maxAttempts: 1 }).returning().get();
  const choice = { connectionId: connection.id, model: 'mock' };
  const { file } = realistic(size);
  const { projectId } = importProject(db, importFileSchema.parse(file), choice);
  // New projects no longer get "자료 갱신"; it stays a template of "새 워크플로", so the scenario adds it itself.
  if (scenario.workflow === '자료 갱신') db.insert(s.workflows).values({ projectId, name: scenario.workflow, definition: knowledgeTemplate({ model: choice }) }).run();
  let workflow = db.select().from(s.workflows).all().find((row) => row.projectId === projectId && row.name === scenario.workflow);
  if (!workflow) throw new Error(`workflow "${scenario.workflow}" is not among the imported templates`);
  // The run takes its definition from here (a snapshot), so the override needs no write.
  if (scenario.settings) workflow = { ...workflow, definition: { ...workflow.definition, settings: { ...workflow.definition.settings, ...scenario.settings } } };
  const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: { ignoreStatus: true } });

  const started = performance.now();
  await new Runner(db, memoryStore(), mockPort(options)).drain(1_000_000);
  const wallSeconds = (performance.now() - started) / 1000;

  // The database is fresh per scenario, so every row belongs to this run.
  const run = db.select().from(s.runs).all().find((row) => row.id === runId)!;
  const steps = db.select({ nodeId: s.runSteps.nodeId, ok: s.runSteps.ok, units: s.runSteps.subjectIds, input: s.runSteps.inputTokens, cached: s.runSteps.cachedInputTokens, output: s.runSteps.outputTokens }).from(s.runSteps).all();
  const items = db.select({ unitId: s.runItems.subjectId, state: s.runItems.state }).from(s.runItems).all();
  const failed = new Set(items.filter((item) => item.state === 'failed').map((item) => item.unitId));
  const unfinished = new Set(items.filter((item) => item.state === 'queued' || item.state === 'running').map((item) => item.unitId));

  const label = (id: string) => workflow.definition.nodes.find((node) => node.id === id)?.label ?? id;
  const callsByNode: Record<string, number> = {};
  for (const step of steps) callsByNode[label(step.nodeId)] = (callsByNode[label(step.nodeId)] ?? 0) + 1;
  const calls = steps.length;
  const input = steps.reduce((sum, step) => sum + (step.input ?? 0), 0);
  const lines = run.total;
  const round = (value: number, digits = 2) => Number(value.toFixed(digits));
  return {
    linesInScope: lines,
    status: run.status,
    notice: run.notice,
    unfinishedLines: unfinished.size,
    calls,
    failedCalls: steps.filter((step) => !step.ok).length,
    callsByNode,
    callsPer100Lines: round((calls / lines) * 100),
    linesPerCallMean: round(calls ? steps.reduce((sum, step) => sum + step.units.length, 0) / calls : 0),
    smallCallShare: round(calls ? steps.filter((step) => step.units.length <= 5).length / calls : 0, 3),
    inputTokens: input,
    inputPerLine: round(input / lines, 1),
    cachedInputTokens: steps.reduce((sum, step) => sum + (step.cached ?? 0), 0),
    fixedOverheadShare: round(input ? (calls * options.fixedTokens) / input : 0, 3),
    outputTokens: steps.reduce((sum, step) => sum + (step.output ?? 0), 0),
    failedLines: failed.size,
    failedLineShare: round(failed.size / lines, 4),
    wallSeconds: round(wallSeconds, 1),
  };
}

interface Baseline {
  size: number;
  /** Each scenario's expected end (status, unfinishedLines) and the costs of that run. */
  scenarios: Record<string, Pick<Metrics, 'status' | 'calls' | 'inputPerLine' | 'failedLineShare'> & Partial<Metrics>>;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number) => value.toLocaleString('en-US');

function table(results: Record<string, Metrics>) {
  const names = Object.keys(results);
  const rows: [string, (m: Metrics) => string][] = [
    ['lines in scope', (m) => num(m.linesInScope)],
    ['run status', (m) => m.status],
    ['unfinished lines', (m) => num(m.unfinishedLines)],
    ['model calls', (m) => num(m.calls)],
    ['  failed calls', (m) => num(m.failedCalls)],
    ['calls per 100 lines', (m) => String(m.callsPer100Lines)],
    ['lines per call (mean)', (m) => String(m.linesPerCallMean)],
    ['calls with <= 5 lines', (m) => pct(m.smallCallShare)],
    ['input tokens', (m) => num(m.inputTokens)],
    ['input tokens per line', (m) => num(m.inputPerLine)],
    ['cached input tokens', (m) => num(m.cachedInputTokens)],
    ['fixed overhead share', (m) => pct(m.fixedOverheadShare)],
    ['output tokens', (m) => num(m.outputTokens)],
    ['failed lines', (m) => `${num(m.failedLines)} (${pct(m.failedLineShare)})`],
    ['harness seconds', (m) => String(m.wallSeconds)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const col = names.map((name) => Math.max(name.length, ...rows.map(([, f]) => f(results[name]).length)));
  const line = (cells: string[]) => `${cells[0].padEnd(width)}  ${cells.slice(1).map((cell, index) => cell.padStart(col[index])).join('  ')}`;
  const out = [line(['', ...names]), ...rows.map(([label, f]) => line([label, ...names.map((name) => f(results[name]))]))];
  for (const name of names) {
    out.push('', `${name}: calls by node ${Object.entries(results[name].callsByNode).map(([node, count]) => `${node} ${num(count)}`).join(', ') || '-'}`);
    if (results[name].notice) out.push(`${name}: notice: ${results[name].notice}`);
  }
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const at = args.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    return at < 0 ? undefined : args[at].includes('=') ? args[at].split('=')[1] : args[at + 1];
  };
  const has = (name: string) => args.includes(`--${name}`);
  const size = Number(flag('size') ?? DEFAULT_SIZE);
  if (!Number.isInteger(size) || size < 100) throw new Error(`--size must be an integer of at least 100, got "${flag('size')}"`);
  const only = flag('only');
  const chosen = only ? SCENARIOS.filter((scenario) => scenario.name === only) : SCENARIOS;
  if (!chosen.length) throw new Error(`unknown --only "${only}" (known: ${SCENARIOS.map((scenario) => scenario.name).join(', ')})`);

  const results: Record<string, Metrics> = {};
  const total = performance.now();
  for (const scenario of chosen) {
    if (!has('json')) process.stderr.write(`running ${scenario.name} (${size} lines)...\n`);
    results[scenario.name] = await runScenario(scenario, size);
  }
  const seconds = Number(((performance.now() - total) / 1000).toFixed(1));

  if (has('update')) {
    const previous: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { size, scenarios: {} };
    const next: Baseline = { size, scenarios: previous.size === size ? { ...previous.scenarios, ...results } : { ...results } };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(has('json') ? JSON.stringify({ results, seconds, updated: true }, null, 2) : `${table(results)}\n\nbaseline updated: ${path.relative(process.cwd(), BASELINE)} (${Object.keys(next.scenarios).length} scenarios, ${size} lines, ${seconds}s)`);
    return;
  }

  const baseline: Baseline | undefined = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined;
  const report: Record<string, { regressions: string[]; improvements: string[] }> = {};
  let failed = false;
  let skipped = '';
  if (!baseline) skipped = 'no baseline yet; run `pnpm budget --update`';
  else if (baseline.size !== size) skipped = `baseline is for ${baseline.size} lines, this run used ${size}; comparison skipped`;
  else
    for (const [name, metrics] of Object.entries(results)) {
      const base = baseline.scenarios[name];
      if (!base) {
        skipped += `${name} has no baseline entry. `;
        continue;
      }
      report[name] = compare(metrics, base);
      if (report[name].regressions.length) failed = true;
    }

  if (has('json')) console.log(JSON.stringify({ size, seconds, results, comparison: report, skipped: skipped || undefined, failed }, null, 2));
  else {
    console.log(`${table(results)}\n\nharness total: ${seconds}s`);
    if (skipped) console.log(`\nnote: ${skipped}`);
    for (const [name, { regressions, improvements }] of Object.entries(report)) {
      for (const text of regressions) console.log(`REGRESSION ${name}: ${text}`);
      for (const text of improvements) console.log(`improved ${name}: ${text} (run \`pnpm budget --update\` to keep it)`);
    }
    if (!failed && !skipped) console.log('\nbudget ok');
  }
  if (failed) process.exitCode = 1;
}

await main();
