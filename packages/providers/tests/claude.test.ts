import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectAuth, invokeProvider, listModels, startLogin, type AuthAttempt, type ProviderConnection, ProviderError } from '../src/index.js';
import { claudeAuthState, safeAuthUrl } from '../src/auth.js';
import { cliArgs, resolveCli } from '../src/cli.js';
import { parseCliOutput } from '../src/output.js';

const connection = (executable: string): ProviderConnection => ({ id: 'claude-test', name: 'Claude fixture', kind: 'claude', executable });
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
async function fixture(source: string, run: (executable: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-claude-test-')), executable = path.join(dir, 'cli.mjs');
  await writeFile(executable, source);
  try { await run(executable, dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('Claude auth status honors documented exit codes and only projects account metadata', async () => {
  for (const signedIn of [true, false]) await fixture(`
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['auth','status']))process.exit(8);
console.error('NEVER-RETURN-SECRET');
console.log(JSON.stringify({loggedIn:${signedIn},authMethod:'${signedIn ? 'claude.ai' : 'none'}',email:'synthetic@example.test',configDirectory:'SECRET-CONFIG-PATH',accessToken:'SECRET-TOKEN'}));
process.exit(${signedIn ? 0 : 1});`, async executable => {
    const result = await inspectAuth(connection(executable));
    assert.equal(result.state, signedIn ? 'signed-in' : 'signed-out'); assert.deepEqual(result.methods, ['browser']);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  });
  assert.equal(claudeAuthState(connection('unused'), { loggedIn: true, authMethod: 'none' }, 0).state, 'unknown');
  assert.equal(claudeAuthState(connection('unused'), { loggedIn: false, authMethod: 'claude.ai' }, 0).state, 'unknown');
  assert.equal(safeAuthUrl('https://claude.ai.evil.test/login', 'claude'), undefined);
  assert.equal(safeAuthUrl('https://claude.ai/oauth/authorize?access_token=secret', 'claude'), undefined);
});

test('Claude browser login uses auth login, verifies status, clears URL and never exposes diagnostics', async () => {
  await fixture(`
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),log=path.join(path.dirname(fileURLToPath(import.meta.url)),'calls.jsonl');
fs.appendFileSync(log,JSON.stringify(args)+'\\n');
if(args[0]!=='auth')process.exit(9);
if(args[1]==='login'){console.log('Open https://claude.ai/oauth/authorize?state=synthetic');console.error('SECRET');setTimeout(()=>process.exit(0),40);}
else if(args[1]==='status'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));process.exit(0);}
else process.exit(9);`, async (executable, dir) => {
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable), { method: 'browser', attemptId: 'fake-login', onUpdate: value => updates.push(value) });
    assert.equal(result.state, 'signed-in'); assert.ok(updates.some(value => value.authUrl === 'https://claude.ai/oauth/authorize?state=synthetic'));
    assert.equal(updates.at(-1)?.state, 'succeeded'); assert.equal(updates.at(-1)?.authUrl, undefined); assert.ok(!JSON.stringify(updates).includes('SECRET'));
    const calls = (await readFile(path.join(dir, 'calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.deepEqual(calls, [['auth', 'login'], ['auth', 'status']]);
  });
});

test('Claude login cancellation and unverifiable successful exits never mark an account connected', async () => {
  await fixture(`if(process.argv.includes('login'))process.exit(0);console.log('{"authMethod":"none","loggedIn":false}');process.exit(1);`, async executable => {
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable), { method: 'browser', attemptId: 'fake', onUpdate: update => updates.push(update) });
    assert.equal(result.state, 'failed'); assert.ok(!updates.some(update => update.state === 'succeeded'));
  });
  await fixture('setInterval(()=>{},1000)', async executable => {
    const controller = new AbortController();
    const result = await startLogin(connection(executable), { method: 'browser', attemptId: 'cancel', signal: controller.signal, onUpdate: update => { if (update.state === 'waiting') controller.abort(); } });
    assert.equal(result.state, 'unknown');
  });
  const unsupported = await startLogin(connection('NEVER-RUN'), { method: 'device-code', attemptId: 'unsupported', onUpdate: () => {} });
  assert.equal(unsupported.state, 'failed');
});

test('Claude structured invocation disables tools/customizations, passes stdin and discards temporary files', async () => {
  await fixture(`
const args=process.argv.slice(2);
if(!args.includes('--safe-mode')||args.includes('--bare')||!args.includes('--no-session-persistence')||!args.includes('--strict-mcp-config'))process.exit(4);
if(args[args.indexOf('--tools')+1]!==''||args[args.indexOf('--disallowedTools')+1]!=='*'||args[args.indexOf('--permission-mode')+1]!=='dontAsk')process.exit(5);
if(args.includes('--dangerously-skip-permissions')||args.includes('--effort'))process.exit(6);
JSON.parse(args[args.indexOf('--json-schema')+1]);
let stdin='';for await(const chunk of process.stdin)stdin+=chunk;
if(!stdin.includes('Translate $(literal); safely')||args.some(arg=>arg.includes('$(literal)')))process.exit(7);
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'thinking',thinking:'synthetic-unused-data'}]}}));
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:'fake',structured_output:{text:process.cwd()},usage:{input_tokens:8,output_tokens:4},modelUsage:{'actual-fixture-model':{inputTokens:8,outputTokens:4}}}));`, async executable => {
    const c = connection(executable);
    const result = await invokeProvider({ connection: c, profile: { connectionId: c.id, model: 'user-fixture-model', effort: '', timeoutMs: 4000, maxOutputTokens: 100, maxAttempts: 1 }, prompt: 'Translate $(literal); safely', schema });
    assert.equal(result.reportedModel, 'actual-fixture-model'); assert.equal(result.reportedEffort, undefined); assert.equal(result.usage?.outputTokens, 4);
    assert.ok(!JSON.stringify(result).includes('synthetic-unused-data'));
    const cwd = (result.data as { text: string }).text; assert.notEqual(cwd, process.cwd()); await assert.rejects(access(cwd));
    const catalog = await listModels(c); assert.equal(catalog.modelListStatus, 'unsupported'); assert.equal(catalog.complete, false); assert.deepEqual(catalog.models, []);
    const args = cliArgs({ connection: c, profile: { connectionId: c.id, model: 'explicit-model', effort: 'medium', timeoutMs: 4000, maxOutputTokens: 100, maxAttempts: 1 }, prompt: 'not an argument', schema }, { dir: 'unused', schema: 'unused', prompt: 'unused', result: 'unused' });
    assert.equal(args[args.indexOf('--effort') + 1], 'medium'); // CLI vocabulary does not assert model support.
  });
});

test('Claude terminal structured output rejects progress, incomplete, error and invalid schema', () => {
  const good = { type: 'result', subtype: 'success', is_error: false, structured_output: { text: 'ok' } };
  assert.deepEqual(parseCliOutput(JSON.stringify(good), schema).data, { text: 'ok' });
  for (const bad of [{ ...good, type: 'progress' }, { ...good, subtype: 'error_max_turns' }, { ...good, is_error: true }, { ...good, structured_output: { bad: 'value' } }, { structured_output: { text: 'unmarked' } }]) assert.throws(() => parseCliOutput(JSON.stringify(bad), schema), ProviderError);
});

test('Windows Claude npm shim resolves to package JS without a command shell', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-claude-test-'));
  try {
    const entry = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'); await mkdir(path.dirname(entry), { recursive: true }); await writeFile(entry, '// fixture');
    const shim = path.join(dir, 'claude.cmd'); await writeFile(shim, 'NEVER EXECUTE');
    assert.deepEqual(await resolveCli(connection(shim)), { executable: process.execPath, prefixArgs: [entry] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
