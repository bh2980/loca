import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectAuth, startLogin, listModels, type AuthAttempt, type ProviderConnection } from '../src/index.js';
import { grokAuthProgress, parseGrokModelsOutput, safeAuthUrl, selectCodexAuthOverrides } from '../src/auth.js';

async function fixture(source: string, run: (executable: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workbench-auth-test-'));
  const executable = path.join(dir, 'cli.mjs');
  await writeFile(executable, source, 'utf8');
  try { await run(executable, dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const connection = (executable: string, kind: ProviderConnection['kind'] = 'codex'): ProviderConnection => ({ id: 'auth-test', name: 'auth fixture', kind, executable });

const rpcFixture = (mode: 'success' | 'cancel' | 'signed-out' | 'malicious-url') => `
import fs from 'node:fs'; import path from 'node:path'; import readline from 'node:readline';
const log=path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\\/(?:([A-Za-z]):)/,'$1:'),'requests.jsonl');
const send=(o)=>console.log(JSON.stringify(o));
for await (const line of readline.createInterface({input:process.stdin})) {
  const m=JSON.parse(line); fs.appendFileSync(log, JSON.stringify(m)+'\\n');
  if(m.method==='initialize') send({id:m.id,result:{userAgent:'fake'}});
  if(m.method==='account/read') send({id:m.id,result:{account:${mode === 'signed-out' ? 'null' : "{type:'chatgpt',email:'fixture@example.test',planType:'test'}"},requiresOpenaiAuth:true}});
  if(m.method==='account/login/start') {
    send({id:m.id,result:m.params.type==='chatgptDeviceCode'?{type:'chatgptDeviceCode',loginId:'login-1',verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234'}:{type:'chatgpt',loginId:'login-1',authUrl:'${mode === 'malicious-url' ? 'https://evil.example/phishing' : 'https://auth.openai.com/authorize?state=fixture'}'}});
    ${mode === 'success' ? "send({method:'account/login/completed',params:{loginId:'other-login',success:false,error:'SECRET'}}); setTimeout(()=>send({method:'account/login/completed',params:{loginId:'login-1',success:true,error:null}}),20);" : ''}
  }
  if(m.method==='account/login/cancel') send({id:m.id,result:{status:'canceled'}});
}
`;

test('Codex auth status uses read-only account metadata RPC without starting login', async () => {
  await fixture(rpcFixture('signed-out'), async (executable, dir) => {
    const status = await inspectAuth(connection(executable));
    assert.equal(status.state, 'signed-out');
    assert.deepEqual(status.methods, ['browser', 'device-code']);
    const requests = (await readFile(path.join(dir, 'requests.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(requests.map((item) => item.method), ['initialize', 'initialized', 'account/read']);
    assert.deepEqual(requests[2].params, { refreshToken: false });
  });
});

test('Codex browser flow publishes URL, checks completion login ID, rechecks account, then clears URL', async () => {
  await fixture(rpcFixture('success'), async (executable, dir) => {
    const updates: AuthAttempt[] = [];
    const status = await startLogin(connection(executable), { method: 'browser', attemptId: 'attempt-1', onUpdate: (update) => updates.push(update) });
    assert.equal(status.state, 'signed-in');
    assert.equal(status.accountLabel, 'fixture@example.test');
    assert.ok(updates.some((update) => update.authUrl === 'https://auth.openai.com/authorize?state=fixture'));
    assert.equal(updates.at(-1)?.state, 'succeeded');
    assert.equal(updates.at(-1)?.authUrl, undefined);
    assert.ok(!JSON.stringify(updates).includes('SECRET'));
    const log = await readFile(path.join(dir, 'requests.jsonl'), 'utf8');
    assert.match(log, /account\/read/);
    assert.ok(!log.includes('thread/start'));
    assert.ok(!log.includes('account/logout'));
  });
});

test('Codex device flow returns one-time verification UI data and clears it on completion', async () => {
  await fixture(rpcFixture('success'), async (executable) => {
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable), { method: 'device-code', attemptId: 'attempt-2', onUpdate: (update) => updates.push(update) });
    assert.equal(result.state, 'signed-in');
    assert.ok(updates.some((update) => update.userCode === 'ABCD-1234' && update.verificationUrl === 'https://auth.openai.com/codex/device'));
    assert.equal(updates.at(-1)?.userCode, undefined);
  });
});

test('Cancel uses official cancel RPC and never logs out an existing account', async () => {
  await fixture(rpcFixture('cancel'), async (executable, dir) => {
    const controller = new AbortController();
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable), { method: 'browser', attemptId: 'attempt-3', signal: controller.signal, onUpdate: (update) => {
      updates.push(update);
      if (update.state === 'waiting') controller.abort();
    } });
    assert.equal(result.state, 'unknown');
    assert.equal(updates.at(-1)?.state, 'cancelled');
    assert.equal(updates.at(-1)?.authUrl, undefined);
    const log = await readFile(path.join(dir, 'requests.jsonl'), 'utf8');
    assert.match(log, /account\/login\/cancel/);
    assert.ok(!log.includes('account/logout'));
  });
});

test('Untrusted auth URLs are never returned to the frontend', async () => {
  await fixture(rpcFixture('malicious-url'), async (executable) => {
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable), { method: 'browser', attemptId: 'attempt-4', onUpdate: (update) => updates.push(update) });
    assert.equal(result.state, 'failed');
    assert.ok(!JSON.stringify(updates).includes('evil.example'));
  });
  assert.equal(safeAuthUrl('https://auth.openai.com.evil.example/', 'codex'), undefined);
  assert.equal(safeAuthUrl('https://auth.openai.com/?access_token=secret', 'codex'), undefined);
  assert.equal(safeAuthUrl('http://auth.x.ai/', 'grok'), undefined);
});

test('Grok device login publishes only approved URL/code and verifies account after exit zero', async () => {
  await fixture(`
if(process.argv.includes('--version')) { console.log('fake grok'); process.exit(0); }
if(process.argv.at(-1)==='models') { console.log('You are logged in with grok.com.'); process.exit(0); }
if(!process.argv.includes('login') || !process.argv.includes('--device-auth')) process.exit(8);
console.error('NEVER-LOG-THIS-TOKEN');
console.log('Visit https://auth.x.ai/device');
console.log('User code: ABCD-EFGH');
setTimeout(()=>process.exit(0),20);
`, async (executable) => {
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable, 'grok'), { method: 'device-code', attemptId: 'attempt-5', onUpdate: (update) => updates.push(update) });
    assert.equal(result.state, 'signed-in');
    assert.ok(updates.some((update) => update.userCode === 'ABCD-EFGH'));
    assert.ok(updates.some((update) => update.verificationUrl === 'https://auth.x.ai/device'));
    assert.ok(!JSON.stringify(updates).includes('NEVER-LOG'));
    assert.equal(updates.at(-1)?.userCode, undefined);
  });
});

test('Grok failed and cancelled login cannot appear connected or expose diagnostics', async () => {
  await fixture(`console.error('secret-key');process.exit(2);`, async (executable) => {
    const updates: AuthAttempt[] = [];
    const result = await startLogin(connection(executable, 'grok'), { method: 'browser', attemptId: 'attempt-6', onUpdate: (update) => updates.push(update) });
    assert.equal(result.state, 'failed');
    assert.ok(!JSON.stringify(updates).includes('secret-key'));
  });
  await fixture(`setInterval(()=>{},1000);`, async (executable) => {
    const controller = new AbortController();
    const result = await startLogin(connection(executable, 'grok'), { method: 'browser', attemptId: 'attempt-7', signal: controller.signal, onUpdate: (update) => {
      if (update.state === 'waiting') controller.abort();
    } });
    assert.equal(result.state, 'unknown');
  });
});

test('Unsupported Grok metadata and agy inspection report unknown without invoking login', async () => {
  await fixture(`if(process.argv.at(-1)!=='--version')process.exit(9);console.log('fixture');`, async (executable) => {
    assert.equal((await inspectAuth(connection(executable, 'grok'))).state, 'unknown');
    const agy = await inspectAuth(connection(executable, 'antigravity'));
    assert.equal(agy.state, 'unknown');
    assert.deepEqual(agy.methods, ['terminal']);
  });
});

test('Device parser ignores unrelated URLs, tokens, and terminal escape sequences', () => {
  assert.deepEqual(grokAuthProgress('secret refresh_token=abcdef0123456789', 'device-code'), {});
  assert.deepEqual(grokAuthProgress('https://example.test/oauth', 'browser'), {});
  assert.deepEqual(grokAuthProgress('\u001b[32mUser code: ABCD-1234\u001b[0m', 'device-code'), { userCode: 'ABCD-1234' });
});

test('Codex model picker uses inference IDs and advertised efforts with pagination', async () => {
  await fixture(`
import readline from 'node:readline';
const send=(o)=>console.log(JSON.stringify(o));
for await(const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='model/list')send({id:m.id,result:{data:m.params.cursor
   ?[{id:'picker2',model:'actual-model-2',displayName:'Model Two',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]
   :[{id:'picker1',model:'actual-model-1',displayName:'Model One',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]},{id:'hidden',model:'hidden-model',hidden:true}],nextCursor:m.params.cursor?null:'page-2'}});
 else if(m.method!=='initialized')process.exit(8);
}
`, async (executable) => {
    const result = await listModels(connection(executable));
    assert.deepEqual(result.models, [
      { id: 'actual-model-1', name: 'Model One', efforts: ['medium', 'high'], effortSupport: 'known' },
      { id: 'actual-model-2', name: 'Model Two', efforts: ['low'], effortSupport: 'known' },
    ]);
  });
  assert.deepEqual((await listModels({ id: 'a', name: 'a', kind: 'antigravity' })).models, []);
});

const grokModelOutput = 'You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.7-build-fast\n  - grok-4.6\n  - grok-4.5\n';

test('Grok status and model picker use only the official models metadata command', async () => {
  await fixture(`
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
fs.appendFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'calls.jsonl'),JSON.stringify(args)+'\\n');
if(args.length===1&&args[0]==='--version'){console.log('grok 1.0.30');process.exit(0);}
if(args.length!==1||args[0]!=='models')process.exit(7);
console.error('DO-NOT-EXPOSE-ACCOUNT-SECRET');
console.log(${JSON.stringify(grokModelOutput)});
`, async (executable, dir) => {
    const status = await inspectAuth(connection(executable, 'grok'));
    assert.equal(status.state, 'signed-in');
    assert.equal(status.accountLabel, 'Grok');
    const catalog = await listModels(connection(executable, 'grok'));
    assert.deepEqual(catalog.models, ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'].map(id => ({ id, name: id, efforts: [], effortSupport: 'unknown' })));
    assert.ok(!JSON.stringify({ status, catalog }).includes('DO-NOT-EXPOSE'));
    const calls = (await readFile(path.join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls, [['models'], ['models'], ['--version']]);
    assert.equal(catalog.cliVersion, '1.0.30');
  });
});

test('Grok metadata parser accepts exact account evidence and advertised model rows only', () => {
  assert.deepEqual(parseGrokModelsOutput('\u001b[32m' + grokModelOutput + '\u001b[0m').models.map(model => model.id), ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5']);
  assert.equal(parseGrokModelsOutput('Example: You are logged in with grok.com.').signedIn, false);
  assert.equal(parseGrokModelsOutput('You are logged in with grok.com.evil.test.').signedIn, false);
  assert.deepEqual(parseGrokModelsOutput('Default model: grok-not-advertised\n  - grok-outside-section').models, []);
  const parsed = parseGrokModelsOutput('Available models:\n  - grok-4.7\n  - grok-4.7\n  - secret-access-token\n  - grok-not-in-section-anymore\n');
  assert.deepEqual(parsed.models, [{ id: 'grok-4.7', name: 'grok-4.7', efforts: [], effortSupport: 'unknown' }]);
  assert.equal(parsed.signedIn, false);
});

test('Grok zero-exit login without account evidence stays unknown', async () => {
  await fixture(`if(process.argv.includes('login'))process.exit(0);if(process.argv.at(-1)==='models'){console.log('Available models:\\n  - grok-4.7');process.exit(0);}process.exit(9);`, async executable => {
    const updates: AuthAttempt[] = [];
    const status = await startLogin(connection(executable, 'grok'), { method: 'browser', attemptId: 'unverified-grok', onUpdate: update => updates.push(update) });
    assert.equal(status.state, 'unknown');
    assert.equal(updates.at(-1)?.state, 'failed');
    assert.ok(!updates.some(update => update.state === 'succeeded'));
  });
});

test('Grok metadata failures and unrecognized output remain unknown without diagnostics', async () => {
  for (const source of [
    `console.log('You are logged in with grok.com.');console.error('SECRET-FAILURE');process.exit(2);`,
    `console.log('SECRET-UNRECOGNIZED');`,
    `console.log('You are logged in with grok.com.');console.log('SECRET'.repeat(15000));`,
  ]) await fixture(source, async executable => {
    const status = await inspectAuth(connection(executable, 'grok'));
    const catalog = await listModels(connection(executable, 'grok'));
    assert.equal(status.state, 'unknown');
    assert.deepEqual(catalog.models, []);
    assert.ok(!JSON.stringify({ status, catalog }).includes('SECRET'));
  });
});

test('Grok metadata reads honor cancellation and a bounded timeout', async () => {
  await fixture('setInterval(()=>{},1000);', async executable => {
    const limited = { ...connection(executable, 'grok'), timeoutMs: 80 };
    const started = Date.now();
    assert.equal((await inspectAuth(limited)).state, 'unknown');
    assert.deepEqual((await listModels(limited)).models, []);
    assert.ok(Date.now() - started < 5000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 80);
    try { assert.deepEqual((await listModels(connection(executable, 'grok'), controller.signal)).models, []); }
    finally { clearTimeout(timer); }
    assert.equal((await inspectAuth(connection(executable, 'grok'), controller.signal)).state, 'unknown');
  });
});

test('Auth configuration projection preserves credential store without copying unrelated secrets or hooks', () => {
  const overrides = selectCodexAuthOverrides({
    cli_auth_credentials_store: 'keyring',
    chatgpt_base_url: 'https://chatgpt.com/backend-api',
    forced_login_method: 'chatgpt', forced_chatgpt_workspace_id: ['org-fixture'],
    api_key: 'NEVER-COPY', mcp_servers: { evil: { command: 'NEVER-COPY' } },
    hooks: { SessionStart: 'NEVER-COPY' }, developer_instructions: 'NEVER-COPY',
  });
  assert.deepEqual(overrides, ['-c', 'cli_auth_credentials_store="keyring"', '-c', 'chatgpt_base_url="https://chatgpt.com/backend-api"', '-c', 'forced_login_method="chatgpt"', '-c', 'forced_chatgpt_workspace_id=["org-fixture"]']);
  assert.ok(!JSON.stringify(overrides).includes('NEVER-COPY'));
  assert.deepEqual(selectCodexAuthOverrides({}), []);
  assert.throws(() => selectCodexAuthOverrides({ cli_auth_credentials_store: 'ephemeral' }), /공유/);
  assert.throws(() => selectCodexAuthOverrides({ chatgpt_base_url: 'https://chatgpt.com/?access_token=secret' }), /비밀정보/);
});
