import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import type { CliKind } from '@loca/shared';
import { cliCommand, cliMissing, CODEX_UNUSED_FEATURES } from './cli.ts';
import { failureInText, ModelError } from './errors.ts';
import { hostedToolNames, type HostedServer } from './mcp-host.ts';
import { adapterExecutable, cliSpawn, resolveCli, type SpawnDeps } from './spawn.ts';
import type { Usage } from './types.ts';

/**
 * Project chat with agent CLIs over the Agent Client Protocol: one long-lived process per CLI
 * serves every conversation. (Workflow and analysis requests stay one-shot runs, cli.ts: an agent
 * session costs them more tokens and time than a stripped-down call with a JSON schema.) The CLI keeps its own login; we never see a
 * token. Workbench tools reach the agent as an MCP server (mcp-host.ts); the agent's own tools
 * are refused when it asks.
 *
 * | Kind        | Agent                                                    | Uses the connection's executable as |
 * |-------------|----------------------------------------------------------|-------------------------------------|
 * | claude      | @agentclientprotocol/claude-agent-acp                    | CLAUDE_CODE_EXECUTABLE              |
 * | codex       | @agentclientprotocol/codex-acp (`codex app-server`)      | CODEX_PATH                          |
 * | grok        | `grok agent stdio`                                       | the command                         |
 * | opencode    | `opencode acp`                                           | the command                         |
 * | antigravity | @simonepri/refined-antigravity-acp (Google's agy_acp_server) | — (finds the ACP server itself) |
 */

const packageFile = (specifier: string) => fileURLToPath(import.meta.resolve(specifier));

/** Codex's own base instructions are a coding agent's; ours say only what every session shares. */
const CODEX_BASE = 'You are an assistant inside a translation workbench. Follow the developer instructions. Use only the tools from the "loca" MCP server; never run commands or edit files.';

let codexBaseFile: string | undefined;
function codexConfig() {
  if (!codexBaseFile) {
    codexBaseFile = path.join(mkdtempSync(path.join(tmpdir(), 'loca-codex-')), 'instructions.md');
    writeFileSync(codexBaseFile, CODEX_BASE);
  }
  return {
    approval_policy: 'never',
    web_search: 'disabled',
    model_instructions_file: codexBaseFile,
    ...Object.fromEntries(CODEX_UNUSED_FEATURES.map((feature) => [`features.${feature}`, false])),
  };
}

/** The process to start for a kind: a bundled adapter run with this Node, or the CLI's own ACP mode. */
export function agentCommand(
  kind: CliKind,
  executable?: string,
  host: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; deps?: SpawnDeps } = {},
): { file: string; args: string[]; env: NodeJS.ProcessEnv; windowsVerbatimArguments?: boolean } {
  // Tests and end-to-end runs without a real CLI (fake-acp.ts).
  if (process.env.WORKBENCH_ACP_AGENT) return { file: process.execPath, args: [process.env.WORKBENCH_ACP_AGENT, kind], env: {} };
  const resolved = () => {
    const found = resolveCli(cliCommand(kind, executable), host.platform, host.env, host.deps?.home, host.deps?.exists);
    if (!found) throw new ModelError('config', cliMissing(cliCommand(kind, executable)), false);
    return found;
  };
  switch (kind) {
    case 'claude': {
      // The Claude Agent SDK starts this without a shell: on Windows never a `.cmd` shim (spawn EINVAL).
      const found = resolved();
      const native = adapterExecutable(found, host.platform, host.env, host.deps);
      if (!native) throw new ModelError('config', `Windows에서는 ${found}(.cmd)를 채팅에서 바로 실행할 수 없습니다. 연결 설정의 실행 파일에 claude.exe의 전체 경로를 입력하세요.`, false);
      const env: NodeJS.ProcessEnv = { CLAUDE_CODE_EXECUTABLE: native.file };
      // A script is run by the SDK with `node` from PATH: make it this server's Node.
      if (native.js) {
        const base = host.env ?? process.env;
        const key = Object.keys(base).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
        const platformPath = (host.platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
        env[key] = [platformPath.dirname(process.execPath), base[key]].filter(Boolean).join(platformPath.delimiter);
      }
      return { file: process.execPath, args: [packageFile('@agentclientprotocol/claude-agent-acp/dist/index.js')], env };
    }
    case 'codex':
      return { file: process.execPath, args: [packageFile('@agentclientprotocol/codex-acp/dist/index.js')], env: { CODEX_PATH: resolved(), CODEX_CONFIG: JSON.stringify(codexConfig()) } };
    case 'antigravity':
      // Google's ACP server offers its Claude and GPT models only to the editors it names; as Zed,
      // the chat gets the same models as the agy CLI (the wrapper's own opt-in for this).
      return { file: process.execPath, args: [path.join(path.dirname(path.dirname(packageFile('@simonepri/refined-antigravity-acp'))), 'bin/cli.js')], env: { REFINED_AGY_CLIENT_NAME: 'zed' } };
    case 'grok':
    case 'opencode': {
      const spawned = cliSpawn(resolved(), kind === 'grok' ? ['agent', 'stdio'] : ['acp'], host.platform, host.env, host.deps);
      return { file: spawned.file, args: spawned.args, env: {}, ...(spawned.windowsVerbatimArguments && { windowsVerbatimArguments: true }) };
    }
  }
}

/** A login method an ACP agent offers (initialize's authMethods). */
interface AuthMethodInfo {
  id: string;
  name: string;
  description?: string;
}

/** What a session's updates go to while one of our requests runs on it. */
export interface SessionListener {
  update: (update: acp.SessionUpdate) => void;
}

const AUTH = /auth(entication)? required|not (logged|signed) in|login required|unauthori[sz]ed|\b401\b/i;

/** An ACP or process failure as a ModelError, with the CLI's last words when it died, the login methods it offers and the command that was run. */
export function acpError(error: unknown, stderr = '', extra: { command?: string } = {}): ModelError {
  if (error instanceof ModelError) return error;
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  const data = typeof error === 'object' && error && 'data' in error ? JSON.stringify((error as { data: unknown }).data ?? '') : '';
  const detail = [raw, data && data !== '""' ? data : '', stderr.trim().split('\n').slice(-3).join(' ')].filter(Boolean).join(' · ').slice(0, 400);
  const tail = extra.command ? ` (실행: ${extra.command})` : '';
  const named = failureInText(detail, detail, { tail });
  if (named) return named;
  // Only what the CLI says: a bare JSON-RPC -32000 is any server error.
  if (AUTH.test(detail)) return new ModelError('auth', `CLI에 로그인이 필요합니다. 연결 설정의 '로그인 창 열기'로 로그인하세요. ${detail}`, false);
  return new ModelError('cli', `CLI가 실패했습니다: ${detail}${tail}`, false);
}

/** How long a stream that closed waits for the process to exit and its stderr to end, to report why. */
const CLOSE_GRACE_MS = 1000;

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * What a turn used: the protocol's `usage`, or the agent's own report in `_meta.usage` (Grok sums
 * every model call of the turn there and gives cost in 1e-10 USD ticks).
 */
export function readUsage(response: Pick<acp.PromptResponse, 'usage' | '_meta'>): Usage {
  const own = response._meta?.usage;
  const usage = (response.usage ?? (own && typeof own === 'object' ? own : null)) as Record<string, unknown> | null;
  if (!usage) return {};
  const ticks = num(usage.costUsdTicks);
  // Anthropic-style counts leave the cache out of inputTokens; ours include it.
  const cached = (num(usage.cachedReadTokens) ?? 0) + (num(usage.cachedWriteTokens) ?? 0);
  const input = num(usage.inputTokens);
  const result: Usage = {
    inputTokens: input !== undefined && cached > input ? input + cached : input,
    outputTokens: num(usage.outputTokens),
    cachedInputTokens: num(usage.cachedReadTokens),
    reasoningTokens: num(usage.thoughtTokens) ?? num(usage.reasoningTokens),
    costUsd: ticks === undefined ? undefined : ticks / 1e10,
  };
  for (const key of Object.keys(result) as (keyof Usage)[]) if (result[key] === undefined) delete result[key];
  return result;
}

/** Options the kind needs on every session: Claude without its own tools and settings; the system prompt where `_meta` carries it. */
function sessionMeta(kind: CliKind, system: string): Record<string, unknown> | undefined {
  // None of the user's own MCP servers, plugins, hooks, CLAUDE.md or settings ride along (they
  // cost about 100k tokens a request). Not --safe-mode: it turns our MCP server off too.
  if (kind === 'claude') return { claudeCode: { options: { tools: [], settingSources: [], strictMcpConfig: true, extraArgs: { 'no-chrome': null } } } };
  if (kind === 'codex') return { jetbrains: { air: { customInstructions: system } } };
  if (kind === 'antigravity') return { systemPrompt: system };
  return undefined;
}

/** What a CLI says about a tool call: in a `tool_call` update, and again (or only its id) when it asks permission for it. */
export interface ToolCallFacts {
  title?: string | null;
  /** Not in the protocol; some CLIs put the tool's own name here. */
  name?: unknown;
  rawInput?: unknown;
  _meta?: unknown;
}

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** The ways a CLI writes "tool T of MCP server S" as one id: Claude and Grok (mcp__S__T, S__T), Codex's announced calls (mcp.S.T, S.T), opencode (S_T). */
const idPrefixes = (server: string) => [`mcp__${server}__`, `${server}__`, `mcp.${server}.`, `${server}.`, `${server}_`];

/**
 * Which tool of ours (an MCP server we gave the session, and a tool it serves) a tool call is, or null.
 * Read only from the fields where a CLI states an MCP tool's identity as structure, each as a whole value:
 * - Claude Code: `_meta.claudeCode.toolName`, mcp__<server>__<tool>, which the adapter sets from the tool that runs;
 * - Codex: `rawInput` = { server, tool, arguments }, which its adapter builds for an MCP call;
 * - the others: the tool's id as the whole `name` or `title` (see idPrefixes).
 * Never from text that only mentions a name: a shell command, a file path or a description can say anything
 * (`{"command":"loca import out.jsonl"}`, a file under a folder called loca-…).
 */
export function ourTool(kind: CliKind, call: ToolCallFacts, servers: readonly { name: string; tools: readonly string[] }[]): { server: string; tool: string } | null {
  const ids: unknown[] = [];
  if (kind === 'claude') ids.push(record(record(call._meta)?.claudeCode)?.toolName);
  // Claude has none of its own tools here (sessionMeta: tools []), so a tool id as the title can only be an MCP tool's.
  if (kind !== 'codex') ids.push(call.name, call.title);
  const input = kind === 'codex' ? record(call.rawInput) : null;
  for (const server of servers) {
    if (input && input.server === server.name && typeof input.tool === 'string' && server.tools.includes(input.tool)) return { server: server.name, tool: input.tool };
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const prefix = idPrefixes(server.name).find((candidate) => id.startsWith(candidate) && server.tools.includes(id.slice(candidate.length)));
      if (prefix) return { server: server.name, tool: id.slice(prefix.length) };
    }
  }
  return null;
}

/** The read-only mode a CLI has (Claude has no tools of its own here, so it keeps its default). */
const SAFE_MODE: Partial<Record<CliKind, string>> = { codex: 'read-only', opencode: 'plan' };

/** One running agent process and its sessions. */
export class AcpAgent {
  private readonly listeners = new Map<string, SessionListener>();
  /** Sessions this process has open (created, resumed or loaded here), with when each last ran. */
  readonly sessions = new Map<string, number>();
  /** The MCP servers each open session was given: the only tools it may run. */
  private readonly servers = new Map<string, HostedServer[]>();
  /** Tool calls the agent announced, by id: a permission request may name its call only by that id (Codex). */
  private readonly announced = new Map<string, ToolCallFacts>();
  /** Each open session's config options and the model and effort it was set to. */
  private readonly settings = new Map<string, { options: acp.SessionConfigOption[]; model?: string; effort?: string }>();
  private stderr = '';
  private exitError: ModelError | undefined;
  active = 0;
  lastUsed = Date.now();
  readonly exited: Promise<void>;

  readonly kind: CliKind;
  readonly init: acp.InitializeResponse;
  /** The login methods the agent offers; a session that fails with a login error answers with the first (see withLogin). */
  readonly authMethods: AuthMethodInfo[];
  readonly command: string | undefined;
  private readonly child: Pick<ChildProcess, 'once' | 'kill' | 'stderr'>;
  private readonly connection: acp.ClientSideConnection;

  private constructor(kind: CliKind, child: Pick<ChildProcess, 'once' | 'kill' | 'stderr'>, connection: acp.ClientSideConnection, init: acp.InitializeResponse, command?: string) {
    this.kind = kind;
    this.command = command;
    this.authMethods = (init.authMethods ?? []).map((method) => ({ id: method.id, name: method.name || method.id, ...(method.description && { description: method.description }) }));
    if (this.authMethods.length) console.debug(`[acp] ${kind} auth methods: ${this.authMethods.map((method) => method.name).join(', ')}`);
    this.child = child;
    this.connection = connection;
    this.init = init;
    this.exited = new Promise((resolve) => child.once('exit', () => resolve()));
  }

  static async start(kind: CliKind, executable: string | undefined): Promise<AcpAgent> {
    const command = agentCommand(kind, executable);
    const child = spawn(command.file, command.args, { env: { ...process.env, ...command.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...(command.windowsVerbatimArguments && { windowsVerbatimArguments: true }) });
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? new ModelError('config', cliMissing(cliCommand(kind, executable)), false) : acpError(error)));
    });
    await spawned;
    return AcpAgent.over(kind, child, acp.ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>), [command.file, ...command.args].join(' '));
  }

  /** An agent on an existing stream; `child` is its process, or a stand-in with `once('exit')`, `kill` and no stderr (tests). */
  static async over(kind: CliKind, child: Pick<ChildProcess, 'once' | 'kill' | 'stderr'>, stream: acp.Stream, command?: string): Promise<AcpAgent> {
    let self: AcpAgent | undefined;
    const connection = new acp.ClientSideConnection(
      () => ({
        sessionUpdate: async (notification) => {
          self?.remember(notification.update);
          self?.listeners.get(notification.sessionId)?.update(notification.update);
        },
        // Only our own MCP tools run; the CLI's shell, file and web tools are refused.
        requestPermission: async (request) => ({ outcome: self?.permit(request) ?? { outcome: 'cancelled' } }),
      }),
      stream,
    );
    const stderrTail = { text: '' };
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail.text = (stderrTail.text + chunk.toString()).slice(-4000);
      if (self) self.stderr = stderrTail.text;
    });
    let exitCode: number | null | undefined;
    const exitSeen = new Promise<void>((resolve) => child.once('exit', (code) => ((exitCode = code), resolve())));
    const stderrEnded = new Promise<void>((resolve) => {
      if (!child.stderr) return resolve();
      child.stderr.once('end', resolve);
      child.stderr.once('close', resolve);
    });
    const exitedEarly = exitSeen.then(() => Promise.reject(new Error('exited')));
    exitedEarly.catch(() => {});
    const init = await Promise.race([
      connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: 'loca', title: 'Translation Workbench', version: '1.0.0' } }),
      exitedEarly,
    ]).catch(async (error: unknown) => {
      // A closed stream or an exit says nothing by itself: give the process a moment to finish and its stderr to end.
      const closed = !(error instanceof ModelError) && (error instanceof Error ? /closed|exited/i.test(error.message) : false);
      if (closed) await Promise.race([Promise.all([exitSeen, stderrEnded]), new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS))]);
      child.kill();
      const reason = closed ? new Error(exitCode === undefined ? 'ACP 연결이 닫혔습니다.' : `ACP 프로세스가 바로 종료되었습니다 (exit ${exitCode}).`) : error;
      throw acpError(reason, stderrTail.text, { command });
    });
    self = new AcpAgent(kind, child, connection, init, command);
    self.stderr = stderrTail.text;
    child.once('exit', (code) => {
      self!.exitError = acpError(new Error(`ACP 프로세스가 종료되었습니다 (exit ${code}).`), self!.stderr, { command });
    });
    return self;
  }

  get alive() {
    return !this.exitError;
  }

  /** Keeps what the agent said about a tool call until it ends, for a permission request that refers to it by id. */
  private remember(update: acp.SessionUpdate) {
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return;
    if (update.status === 'completed' || update.status === 'failed') this.announced.delete(update.toolCallId);
    else this.announced.set(update.toolCallId, { ...this.announced.get(update.toolCallId), ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined && value !== null)) });
    // A call whose end never came (a stopped turn) is dropped once many newer ones have been announced.
    if (this.announced.size > 500) this.announced.delete(this.announced.keys().next().value!);
  }

  /** Allows a tool call only when it is a tool of an MCP server this session was given (ourTool); everything else a CLI can do is refused. */
  private permit(request: acp.RequestPermissionRequest): acp.RequestPermissionOutcome {
    const servers = (this.servers.get(request.sessionId) ?? []).map((server) => ({ name: server.name, tools: hostedToolNames(server) }));
    const announced = this.announced.get(request.toolCall.toolCallId);
    const ours = Boolean(ourTool(this.kind, request.toolCall, servers) ?? (announced && ourTool(this.kind, announced, servers)));
    const option = request.options.find((candidate) => candidate.kind === (ours ? 'allow_once' : 'reject_once')) ?? request.options.find((candidate) => candidate.kind.startsWith(ours ? 'allow' : 'reject'));
    return option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' };
  }

  private capabilities() {
    return this.init.agentCapabilities ?? {};
  }

  /** Whether the agent takes images in a prompt (initialize's promptCapabilities.image); undefined when it did not say. */
  takesImages(): boolean | undefined {
    const prompt = this.capabilities().promptCapabilities;
    return prompt ? Boolean(prompt.image) : undefined;
  }

  /** How the system prompt goes in: the protocol field when the agent takes it, else in `_meta` (claude, codex, agy) or the first message. */
  private systemPromptField(system: string): { field?: acp.SystemPrompt; inMessage: boolean } {
    const supported = this.capabilities().sessionCapabilities?.systemPrompt;
    if (supported) {
      const override = Boolean((supported.mode as Record<string, unknown> | null | undefined)?.override);
      return { field: { mode: override ? 'override' : 'append', content: [{ type: 'text', text: system }] }, inMessage: false };
    }
    return { inMessage: this.kind !== 'codex' && this.kind !== 'antigravity' };
  }

  /** A new session; `inMessage` says whether the system prompt must lead the first message. */
  async newSession(input: { cwd: string; mcpServers: HostedServer[]; system: string }): Promise<{ sessionId: string; configOptions: acp.SessionConfigOption[]; inMessage: boolean }> {
    const { field, inMessage } = this.systemPromptField(input.system);
    const response = await this.withLogin(() =>
      this.connection.newSession({ cwd: input.cwd, mcpServers: input.mcpServers, ...(field && { systemPrompt: field }), _meta: sessionMeta(this.kind, input.system) ?? null }),
    );
    this.sessions.set(response.sessionId, Date.now());
    this.servers.set(response.sessionId, input.mcpServers);
    this.settings.set(response.sessionId, { options: response.configOptions ?? [] });
    return { sessionId: response.sessionId, configOptions: response.configOptions ?? [], inMessage };
  }

  /** Opens a session the CLI saved (another process, a server restart). Null when the agent cannot or the session is gone. */
  async reopen(input: { sessionId: string; cwd: string; mcpServers: HostedServer[]; system: string }): Promise<{ configOptions: acp.SessionConfigOption[] } | null> {
    const { field } = this.systemPromptField(input.system);
    const common = { sessionId: input.sessionId, cwd: input.cwd, mcpServers: input.mcpServers, ...(field && { systemPrompt: field }), _meta: sessionMeta(this.kind, input.system) ?? null };
    try {
      if (this.capabilities().sessionCapabilities?.resume) {
        const response = await this.withLogin(() => this.connection.resumeSession(common));
        this.sessions.set(input.sessionId, Date.now());
        this.servers.set(input.sessionId, input.mcpServers);
        this.settings.set(input.sessionId, { options: response.configOptions ?? [] });
        return { configOptions: response.configOptions ?? [] };
      }
      if (this.capabilities().loadSession) {
        // Loading replays the history as updates; nobody listens to them yet.
        const response = await this.withLogin(() => this.connection.loadSession(common));
        this.sessions.set(input.sessionId, Date.now());
        this.servers.set(input.sessionId, input.mcpServers);
        this.settings.set(input.sessionId, { options: response.configOptions ?? [] });
        return { configOptions: response.configOptions ?? [] };
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Sets an open session to the model and effort, when it is not already. */
  async use(sessionId: string, model: string, effort?: string): Promise<void> {
    const current = this.settings.get(sessionId);
    if (!current || (current.model === model && current.effort === effort)) return;
    await this.configure(sessionId, current.options, model, effort);
    this.settings.set(sessionId, { options: current.options, model, effort });
  }

  /** Picks the model and effort (and a read-only mode) from the session's options. */
  async configure(sessionId: string, options: acp.SessionConfigOption[], model: string, effort?: string): Promise<void> {
    // agy's CLI names a model with its level ("gemini-3.8-flash-low"); its ACP server takes the base and the level apart.
    const suffixed = /^(.+)-(low|medium|high|xhigh|max)$/.exec(model);
    const values = (option: acp.SessionConfigOption) =>
      option.type === 'select' ? (option.options as (acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup)[]).flatMap((entry) => ('group' in entry ? entry.options : [entry])) : [];
    const set = (configId: string, value: string) => this.call(() => this.connection.setSessionConfigOption({ sessionId, configId, value }));
    const byId = (...ids: string[]) => options.find((option) => ids.includes(option.id) || ids.includes(option.category ?? ''));
    const modelOption = byId('model');
    if (model && modelOption) {
      const choices = values(modelOption);
      // Codex lists a model once per effort ("gpt-6.1-sol[high]").
      const pick =
        choices.find((choice) => choice.value === model) ??
        choices.find((choice) => effort && choice.value === `${model}[${effort}]`) ??
        choices.find((choice) => choice.value.startsWith(`${model}[`)) ??
        choices.find((choice) => choice.name === model) ??
        (suffixed ? choices.find((choice) => choice.value === suffixed[1]) : undefined);
      if (pick && suffixed && pick.value === suffixed[1]) effort ??= suffixed[2];
      if (!pick) throw new ModelError('config', `이 CLI에서 모델을 찾지 못했습니다: ${model}. 쓸 수 있는 모델: ${choices.map((choice) => choice.value).slice(0, 12).join(', ')}`, false);
      if (pick.value !== (modelOption as { currentValue?: string }).currentValue) await set(modelOption.id, pick.value);
    }
    const effortOption = byId('effort', 'reasoning_effort', 'thinking_level', 'thought_level');
    if (effort && effortOption) {
      const pick = values(effortOption).find((choice) => choice.value.toLowerCase() === effort.toLowerCase());
      if (pick) await set(effortOption.id, pick.value);
    }
    const modeOption = byId('mode');
    if (modeOption && SAFE_MODE[this.kind]) {
      const pick = values(modeOption).find((choice) => choice.value === SAFE_MODE[this.kind]);
      if (pick && pick.value !== (modeOption as { currentValue?: string }).currentValue) await set(modeOption.id, pick.value).catch(() => {});
    }
  }

  /**
   * One prompt turn. Updates go to `listener` while it runs; the signal cancels it. A turn that
   * reports nothing for `idleMs` is cancelled as stuck; one past `timeoutMs` (when given) as too long.
   */
  async prompt(sessionId: string, text: string, listener: SessionListener, options: { signal?: AbortSignal; timeoutMs?: number; idleMs?: number; /** Base64 images sent after the text; only when takesImages() is not false. */ images?: { data: string; mimeType: string }[] }): Promise<{ stopReason: acp.StopReason; usage: Usage }> {
    this.active++;
    this.lastUsed = Date.now();
    this.sessions.set(sessionId, this.lastUsed);
    let timedOut: 'idle' | 'total' | null = null;
    const cancel = () => void this.connection.cancel({ sessionId }).catch(() => {});
    let idle: NodeJS.Timeout | undefined;
    const arm = () => {
      if (!options.idleMs) return;
      clearTimeout(idle);
      idle = setTimeout(() => {
        timedOut = 'idle';
        cancel();
      }, options.idleMs);
    };
    // Claude reports the turn's cost in its last usage_update, not in the response.
    let cost: number | undefined;
    this.listeners.set(sessionId, {
      update: (update) => {
        arm();
        if (update.sessionUpdate === 'usage_update' && update.cost?.currency === 'USD') cost = update.cost.amount;
        listener.update(update);
      },
    });
    arm();
    const total =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = 'total';
            cancel();
          }, options.timeoutMs);
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (options.signal?.aborted) throw new ModelError('cancelled', '중단했습니다.', false);
      const response = await this.call(() => this.connection.prompt({ sessionId, prompt: [{ type: 'text', text }, ...(options.images ?? []).map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType }))] }));
      const usage = readUsage(response);
      if (cost !== undefined && usage.costUsd === undefined) usage.costUsd = cost;
      if (timedOut === 'idle') throw new ModelError('timeout', `CLI가 ${Math.round((options.idleMs ?? 0) / 1000)}초 동안 아무 응답도 없어 중단했습니다.`, undefined, usage);
      if (timedOut === 'total') throw new ModelError('timeout', 'CLI 응답 시간이 초과되었습니다.', undefined, usage);
      if (response.stopReason === 'cancelled' && options.signal?.aborted) throw new ModelError('cancelled', '중단했습니다.', false, usage);
      if (response.stopReason === 'refusal') throw new ModelError('refused', '모델이 응답을 거절했습니다.', false, usage);
      return { stopReason: response.stopReason, usage };
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
      options.signal?.removeEventListener('abort', cancel);
      this.listeners.delete(sessionId);
      this.active--;
      this.lastUsed = Date.now();
      if (this.sessions.has(sessionId)) this.sessions.set(sessionId, this.lastUsed);
    }
  }

  /**
   * Closes a session the chat no longer uses (it moved to another connection or model, or sat idle).
   * The CLI keeps it on disk, so the chat can reopen it later. An agent that cannot close one
   * (Antigravity) keeps it until the process stops.
   */
  async close(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId) || this.listeners.has(sessionId)) return;
    if (!this.capabilities().sessionCapabilities?.close) return;
    this.sessions.delete(sessionId);
    this.servers.delete(sessionId);
    this.settings.delete(sessionId);
    await this.connection.closeSession({ sessionId }).catch(() => {});
  }

  /** Whether a turn is running on the session. */
  busy(sessionId: string) {
    return this.listeners.has(sessionId);
  }

  kill() {
    this.child.kill();
  }

  /**
   * A session request that answers the agent's login question: when the agent asks for a login
   * (some, like Antigravity, refuse a session until the client picks a method), authenticates with the
   * first method it offers, which makes it use the CLI's own login, and tries once more. Never before
   * a session asks. If it still fails, the CLI is not logged in.
   */
  private async withLogin<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await this.call(request);
    } catch (error) {
      if (!(error instanceof ModelError) || error.code !== 'auth' || !this.authMethods.length) throw error;
      try {
        await this.call(() => this.connection.authenticate({ methodId: this.authMethods[0]!.id }));
      } catch (failed) {
        throw failed instanceof ModelError && failed.code === 'auth' ? failed : new ModelError('auth', `CLI에 로그인이 필요합니다. 연결 설정의 '로그인 창 열기'로 로그인하세요. ${failed instanceof ModelError ? failed.message : acpError(failed, this.stderr, { command: this.command }).message}`.slice(0, 600), false);
      }
      return this.call(request);
    }
  }

  /** A request that fails with the process's own reason when it died meanwhile. */
  private async call<T>(request: () => Promise<T>): Promise<T> {
    if (this.exitError) throw this.exitError;
    const died = this.exited.then(() => {
      throw this.exitError ?? acpError(new Error('ACP 프로세스가 종료되었습니다.'), this.stderr, { command: this.command });
    });
    try {
      return await Promise.race([request(), died]);
    } catch (error) {
      throw acpError(error, this.stderr, { command: this.command });
    }
  }
}

/** Processes kept per CLI (kind + executable); more start when one is busy with `perProcess` turns. */
const pool = new Map<string, Promise<AcpAgent>[]>();
/** Turns one process runs at once before another starts. */
const PER_PROCESS = 8;
/** A process with nothing running for this long is stopped. */
const IDLE_STOP_MS = 10 * 60_000;

let starter: (kind: CliKind, executable: string | undefined) => Promise<AcpAgent> = (kind, executable) => AcpAgent.start(kind, executable);
/** Tests start agents in process. */
export function setAgentStarter(start: typeof starter | null) {
  starter = start ?? ((kind, executable) => AcpAgent.start(kind, executable));
  pool.clear();
}

const poolKey = (kind: CliKind, executable?: string) => `${kind}\u0000${executable?.trim() ?? ''}`;

/** A process for a new session: an idle one first, else a new one. */
export async function agentFor(kind: CliKind, executable?: string): Promise<AcpAgent> {
  const key = poolKey(kind, executable);
  const entries = pool.get(key) ?? [];
  pool.set(key, entries);
  for (const entry of entries) {
    const agent = await entry.catch(() => null);
    if (agent?.alive && agent.active < PER_PROCESS) return agent;
  }
  const started = starter(kind, executable);
  entries.push(started);
  started.then(
    (agent) => void agent.exited.then(() => remove(key, started)),
    () => remove(key, started),
  );
  return started;
}

/** How long a login check waits for the agent to start and open a session. */
const LOGIN_CHECK_MS = 60_000;

/**
 * Whether the CLI is logged in, checked the way the chat starts: start the agent, initialize, open a
 * session (answering a login question as the chat does) and close it. No prompt, no model call. A
 * login error is 'signed-out'; any other failure throws with its real message. The process always stops.
 */
export async function checkCliLogin(kind: CliKind, executable?: string): Promise<'signed-in' | 'signed-out'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelError('timeout', `CLI가 ${LOGIN_CHECK_MS / 1000}초 안에 세션을 열지 못했습니다.`, false)), LOGIN_CHECK_MS);
  });
  timeout.catch(() => {});
  const started = starter(kind, executable);
  started.catch(() => {});
  try {
    return await Promise.race([
      (async () => {
        const agent = await started;
        const { sessionId } = await agent.newSession({ cwd: tmpdir(), mcpServers: [], system: '' });
        await agent.close(sessionId);
        return 'signed-in' as const;
      })(),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof ModelError && error.code === 'auth') return 'signed-out';
    throw error;
  } finally {
    clearTimeout(timer);
    // A start still pending at the timeout is stopped when it arrives.
    void started.then((agent) => agent.kill(), () => {});
  }
}

/** The process that has a session open, if any is still running. */
export async function agentWith(kind: CliKind, executable: string | undefined, sessionId: string): Promise<AcpAgent | null> {
  for (const entry of pool.get(poolKey(kind, executable)) ?? []) {
    const agent = await entry.catch(() => null);
    if (agent?.alive && agent.sessions.has(sessionId)) return agent;
  }
  return null;
}

function remove(key: string, entry: Promise<AcpAgent>) {
  const entries = pool.get(key);
  if (!entries) return;
  const index = entries.indexOf(entry);
  if (index >= 0) entries.splice(index, 1);
}

/** Closes a session wherever it is open (a chat that moved on). */
export async function closeSession(sessionId: string): Promise<void> {
  for (const entries of pool.values()) {
    for (const entry of entries) {
      const agent = await entry.catch(() => null);
      if (agent?.alive && agent.sessions.has(sessionId)) await agent.close(sessionId);
    }
  }
}

/** Stops processes nobody used for a while and closes sessions that sat idle (everything at shutdown). */
export async function stopIdleAgents(all = false, now = Date.now()) {
  for (const entries of pool.values()) {
    for (const entry of [...entries]) {
      const agent = await entry.catch(() => null);
      if (!agent) continue;
      if (all || (agent.active === 0 && now - agent.lastUsed > IDLE_STOP_MS)) {
        agent.kill();
        continue;
      }
      for (const [sessionId, lastUsed] of [...agent.sessions]) if (now - lastUsed > IDLE_STOP_MS && !agent.busy(sessionId)) await agent.close(sessionId);
    }
  }
}
setInterval(() => void stopIdleAgents(), 60_000).unref();
