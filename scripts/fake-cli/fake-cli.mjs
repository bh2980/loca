/**
 * Fake agent CLIs (claude, codex, grok, agy, opencode) for testing the real CLI adapter
 * (packages/ai/src/cli.ts) without a real CLI, a login or a model call.
 *
 * Manual end-to-end run: in Settings, add a CLI connection of the kind you want to test and set its
 * "executable" to the absolute path of the wrapper, e.g. <repo>/scripts/fake-cli/grok (the wrappers are
 * `claude`, `codex`, `grok`, `agy`, `opencode`; agy is the Antigravity connection). The workbench then spawns it exactly like the
 * real CLI: same arguments, same stdin/prompt-file/schema-file hand-over, same stdout envelope. Answers come from
 * scripts/mock-llm-core.ts (the brain of `pnpm mock-llm`), so workflows run end to end. Needs Node >= 22.18
 * (it imports the .ts core directly). The environment is inherited from the workbench server, so set the variables
 * below before starting `pnpm dev`/the API.
 *
 * Environment:
 *   FAKE_CLI_FIXED_TOKENS     input tokens the CLI itself adds per call (its system prompt and tools).
 *                             Defaults: claude 23000, codex 13000, grok 8600, agy 9000, opencode 15000.
 *   FAKE_CLI_CACHED_TOKENS    part of the input reported as cache read (default: half of the fixed tokens)
 *   FAKE_CLI_STARTUP_MS       sleep before answering, to simulate process start (default 0)
 *   FAKE_CLI_PID_FILE         write the process id here at start (tests check the process was killed)
 *   FAKE_CLI_IGNORE_SIGTERM   1 = ignore SIGTERM, so only the adapter's forced kill ends the process
 *   FAKE_CLI_EXIT             exit with this code and a stderr message instead of answering
 *   MOCK_*                    the fault and latency variables of mock-llm-core (DROP_RATE, DUP_RATE, EMPTY_RATE,
 *                             BAD_JSON_RATE, TRUNCATE_RATE, 429_RATE, LATENCY_MS, SEED, PROFILE).
 *                             Latency is 0 unless MOCK_LATENCY_MS is set.
 *
 * Failure behaviour: a 429 fault ends like the real CLIs do when a plan is exhausted (claude: is_error envelope on
 * stdout, exit 1; the others: message on stderr, exit 1). A truncate fault reports a max_tokens stop with cut-off
 * text; a bad-JSON fault answers with prose around broken JSON. Both exit 0 with usage reported.
 * `--version`, `models`, `debug models`, `login status` and `auth status` answer too, for the settings page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const FIXED = { claude: 23000, codex: 13000, grok: 8600, antigravity: 9000, opencode: 15000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message, code = 2) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const flag = (argv, name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index === argv.length - 1) return undefined;
  return argv[index + 1];
};

/** A value that satisfies a JSON schema, for prompts that are not a workbench batch. */
function sample(schema) {
  if (!schema || typeof schema !== 'object') return 'fake';
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return sample(union.find((option) => option.type !== 'null') ?? union[0]);
  switch (Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, sample(value)]));
    case 'array':
      return schema.items ? [sample(schema.items)] : [];
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return 'fake';
  }
}

/** The JSON schema the adapter handed over, wherever this CLI gets it. */
function readSchema(kind, argv, prompt) {
  try {
    if (kind === 'claude' || kind === 'grok') return JSON.parse(flag(argv, '--json-schema'));
    if (kind === 'codex') return JSON.parse(readFileSync(flag(argv, '--output-schema'), 'utf8'));
    if (kind === 'antigravity') return JSON.parse(readFileSync(flag(argv, '--json-schema'), 'utf8'));
    const marker = 'follows this JSON Schema, and nothing else:\n';
    return JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
  } catch {
    return undefined;
  }
}

/** The adapter sends `${PREAMBLE}\n\n${system}\n\n${prompt}`; the workbench's input is a JSON object after the last blank line. */
function splitPrompt(full) {
  // opencode has no schema flag: the adapter appends the schema after the input.
  const cut = full.indexOf('\n\nAnswer with one JSON value that follows this JSON Schema');
  const prompt = cut < 0 ? full : full.slice(0, cut);
  const at = prompt.lastIndexOf('\n\n{');
  return at < 0 ? { system: prompt, user: '' } : { system: prompt.slice(0, at), user: prompt.slice(at + 2) };
}

async function answer(kind, prompt, schema) {
  const core = await import(pathToFileURL(path.resolve(import.meta.dirname, '..', 'mock-llm-core.ts')).href).catch((error) => fail(`fake-cli needs Node >= 22.18 to load mock-llm-core.ts: ${error.message}`));
  const fixed = Number(process.env.FAKE_CLI_FIXED_TOKENS ?? process.env.MOCK_FIXED_TOKENS ?? FIXED[kind]);
  const cached = Number(process.env.FAKE_CLI_CACHED_TOKENS ?? process.env.MOCK_CACHED_TOKENS ?? Math.floor(fixed / 2));
  const options = { ...core.resolveOptions(core.envGetter(process.env)), fixedTokens: fixed, cachedTokens: cached };
  options.latencyMs ??= 0;
  const rand = core.makeRand(options.seed);
  const { system, user } = splitPrompt(prompt);
  let batch = false;
  try {
    const input = JSON.parse(user);
    batch = Array.isArray(input.lines) || Array.isArray(input.scenes);
  } catch {
    /* not a per-line batch */
  }
  const isAnalysis = prompt.includes('complete script of a game');
  if (batch || isAnalysis) {
    const outcome = core.respond(isAnalysis ? { system: prompt, user: prompt, schema } : { system, user, schema }, options, rand);
    if (outcome.delayMs) await sleep(outcome.delayMs);
    return outcome;
  }
  // Not a workbench prompt: answer the schema with a placeholder value, still with the CLI's overhead.
  const content = JSON.stringify(sample(schema));
  return { status: 200, finishReason: 'stop', content, usage: core.usageFor(prompt.length, content.length, options), faults: [] };
}

const cost = (input, cacheRead, output) => Math.round(((input * 3 + cacheRead * 0.3 + output * 15) / 1e6) * 1e6) / 1e6;
const line = (value) => `${JSON.stringify(value)}\n`;

export async function main(kind) {
  const argv = process.argv.slice(2);
  if (process.env.FAKE_CLI_PID_FILE) writeFileSync(process.env.FAKE_CLI_PID_FILE, String(process.pid));
  if (process.env.FAKE_CLI_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {});

  // Side commands the settings page uses.
  if (argv[0] === '--version' || argv[0] === 'version') return void process.stdout.write(`fake-${kind} 0.0.0\n`);
  if (argv[0] === 'models') return void process.stdout.write(kind === 'grok' ? '* fake (default)\n- fake-2\n' : kind === 'antigravity' ? 'fake\tFake\n' : 'fake/fake\n');
  if (kind === 'codex' && argv[0] === 'debug') return void process.stdout.write(JSON.stringify({ models: [{ slug: 'fake', visibility: 'list', priority: 0 }] }));
  if ((argv[0] === 'login' || argv[0] === 'auth') && argv[1] === 'status') return void process.stdout.write('Logged in (fake)\n');

  // Required arguments, as cli.ts passes them.
  let prompt;
  if (kind === 'grok') {
    const file = flag(argv, '--prompt-file');
    if (!file) fail('error: --prompt-file is required');
    prompt = readFileSync(file, 'utf8');
  } else {
    if (kind === 'codex' && (argv[0] !== 'exec' || argv.at(-1) !== '-' || !flag(argv, '--output-last-message') || !flag(argv, '--output-schema'))) fail('error: codex exec needs --output-schema, --output-last-message and "-"');
    if (kind === 'claude' && (!argv.includes('--print') || !flag(argv, '--json-schema'))) fail('error: --print and --json-schema are required');
    if (kind === 'antigravity' && (!argv.includes('--print=') || !flag(argv, '--json-schema'))) fail('error: --print= and --json-schema are required');
    if (kind === 'opencode' && argv[0] !== 'run') fail('error: opencode needs the run command');
    const stdin = await readStdin();
    if (kind === 'antigravity') {
      try {
        prompt = JSON.parse(stdin.split('\n').find(Boolean)).message.content;
      } catch {
        fail('error: agy expects a stream-json user message on stdin');
      }
    } else prompt = stdin;
  }
  if (!prompt?.trim()) fail('error: empty prompt');
  if (!flag(argv, '--model')) fail('error: --model is required');

  await sleep(Number(process.env.FAKE_CLI_STARTUP_MS ?? 0));
  if (process.env.FAKE_CLI_EXIT) fail('fake CLI crashed (FAKE_CLI_EXIT)', Number(process.env.FAKE_CLI_EXIT));

  const outcome = await answer(kind, prompt, readSchema(kind, argv, prompt));
  const out = (text) => process.stdout.write(text);

  if (outcome.status === 429) {
    const message = 'Error: 429 rate limit reached, usage limit exceeded (fake)';
    if (kind === 'claude') {
      out(line({ type: 'result', subtype: 'success', is_error: true, result: message, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));
      process.exit(1);
    }
    fail(message, 1);
  }

  const total = outcome.usage.prompt_tokens;
  const cacheRead = outcome.usage.prompt_tokens_details.cached_tokens;
  const output = outcome.usage.completion_tokens;
  const truncated = outcome.finishReason === 'length';
  let parsed;
  try {
    parsed = JSON.parse(outcome.content);
  } catch {
    parsed = undefined;
  }

  switch (kind) {
    case 'claude':
      out(
        line({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: parsed === undefined ? outcome.content : '',
          ...(parsed === undefined ? {} : { structured_output: parsed }),
          ...(truncated ? { stop_reason: 'max_tokens' } : {}),
          total_cost_usd: cost(total - cacheRead, cacheRead, output),
          // Anthropic style: input_tokens leaves the cache read out.
          usage: { input_tokens: total - cacheRead, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: output },
        }),
      );
      break;
    case 'grok':
      out(
        JSON.stringify(
          {
            stopReason: truncated ? 'max_tokens' : 'end_turn',
            sessionId: 'fake-session',
            usage: { input_tokens: total - cacheRead, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: output, reasoning_tokens: 0, total_tokens: total + output },
            total_cost_usd: cost(total - cacheRead, cacheRead, output),
            ...(parsed === undefined ? { text: outcome.content } : { structuredOutput: parsed }),
          },
          null,
          2,
        ) + '\n',
      );
      break;
    case 'codex':
      // The answer is the last-message file; stdout is JSONL events. Codex counts cached input inside input_tokens.
      writeFileSync(flag(argv, '--output-last-message'), outcome.content);
      out(line({ type: 'thread.started', thread_id: 'fake-thread' }) + line({ type: 'turn.started' }) + line({ type: 'turn.completed', usage: { input_tokens: total, cached_input_tokens: cacheRead, output_tokens: output, reasoning_output_tokens: 0 } }));
      break;
    case 'antigravity':
      out(
        line({ event: 'init', conversation_id: 'fake-conversation' }) +
          line({
            event: 'result',
            result: {
              status: 'SUCCESS',
              ...(parsed === undefined ? { result: outcome.content } : { structured_output: parsed }),
              ...(truncated ? { stop_reason: 'max_tokens' } : {}),
              usage: { input_tokens: total, output_tokens: output, cache_read_tokens: cacheRead },
            },
          }),
      );
      break;
    case 'opencode': {
      // Two steps like a real turn: opencode counts cache outside `input`.
      const half = Math.floor(output / 2);
      const split = (n) => [Math.floor(n / 2), n - Math.floor(n / 2)];
      const [input1, input2] = split(total - cacheRead);
      const [read1, read2] = split(cacheRead);
      const step = (input, read, outputTokens, reason) =>
        line({ type: 'step_finish', part: { type: 'step-finish', reason, cost: cost(input, read, outputTokens), tokens: { input, output: outputTokens, reasoning: 0, cache: { read, write: 0 } } } });
      out(
        line({ type: 'step_start', part: { type: 'step-start' } }) +
          step(input1, read1, half, 'tool-calls') +
          line({ type: 'text', part: { type: 'text', text: outcome.content } }) +
          step(input2, read2, output - half, truncated ? 'length' : 'stop'),
      );
      break;
    }
  }
}
