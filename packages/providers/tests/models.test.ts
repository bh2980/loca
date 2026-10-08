import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { invokeProvider, listModels, validateCatalogProfile, validateModelProfile, type ModelCatalog, type ProviderConnection, type ProviderProfile, ProviderError } from '../src/index.js';

const connection: ProviderConnection = { id: 'a', name: 'fixture', kind: 'codex' };
const profile: ProviderProfile = { connectionId: 'a', model: 'selected-model', effort: '', timeoutMs: 1500, maxOutputTokens: 50, maxAttempts: 1 };
const catalog = (effortSupport: 'known' | 'unsupported' | 'unknown', efforts: string[] = []): ModelCatalog => ({
  models: [{ id: profile.model, name: 'Selected model', effortSupport, efforts }], source: 'cli', checkedAt: new Date().toISOString(), modelListStatus: 'available', complete: true,
});
const code = (expected: string) => (error: unknown) => error instanceof ProviderError && error.code === expected;
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>, run: (baseUrl: string) => Promise<void>) {
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/v1`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('per-model effort evidence overrides client hints; unavailable and unsupported stay distinct', () => {
  assert.equal(validateCatalogProfile(connection, { ...profile, effort: 'high' }, catalog('known', ['high'])).status, 'verified');
  assert.throws(() => validateCatalogProfile({ ...connection, supportedEfforts: ['medium'] }, { ...profile, effort: 'medium', supportedEfforts: ['medium'] }, catalog('known', ['high'])), code('unsupported-effort'));
  assert.throws(() => validateCatalogProfile(connection, { ...profile, effort: 'low' }, catalog('unsupported')), code('unsupported-effort'));
  assert.throws(() => validateCatalogProfile(connection, { ...profile, effort: 'low' }, catalog('unknown')), code('unverified-effort'));
  assert.match(validateCatalogProfile(connection, profile, catalog('unknown')).detail, /미확인/);
  const noList: ModelCatalog = { ...catalog('known'), models: [], modelListStatus: 'unavailable', complete: false };
  assert.equal(validateCatalogProfile(connection, profile, noList).status, 'unverified');
  assert.throws(() => validateCatalogProfile(connection, { ...profile, effort: 'high' }, noList), code('unverified-effort'));
});

test('only complete catalogs reject an absent model, and connection mismatch always fails', async () => {
  const absent: ModelCatalog = { ...catalog('known'), models: [] };
  assert.throws(() => validateCatalogProfile(connection, profile, absent), code('model-not-listed'));
  assert.equal(validateCatalogProfile(connection, profile, { ...absent, complete: false }).status, 'unverified');
  await assert.rejects(validateModelProfile({ ...connection, id: 'other', executable: 'NEVER-RUN' }, profile), code('profile-connection-mismatch'));
});

test('compatible API discovery is an authenticated GET and never invents effort support', async () => {
  const calls: string[] = [];
  await serve((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    assert.equal(req.headers.authorization, 'Bearer synthetic-memory-only-key');
    res.end(JSON.stringify({ data: [{ id: 'model-one', owned_by: 'owner' }, { id: 'model-two' }] }));
  }, async baseUrl => {
    const result = await listModels({ id: 'api', name: 'test', kind: 'openai', baseUrl }, undefined, 'synthetic-memory-only-key');
    assert.equal(result.source, 'api'); assert.equal(result.complete, true); assert.equal(result.modelListStatus, 'available');
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.deepEqual(result.models, ['model-one', 'model-two'].map(id => ({ id, name: id, efforts: [], effortSupport: 'unknown' })));
    assert.ok(!JSON.stringify(result).includes('synthetic-memory-only-key'));
  });
  assert.deepEqual(calls, ['GET /v1/models']);
});

test('API partial catalogs, unsupported endpoints and malformed data do not claim completeness', async () => {
  await serve((_req, res) => { res.end('{"data":[{"id":"one"}],"has_more":true}'); }, async baseUrl => {
    const result = await listModels({ ...connection, kind: 'openai', baseUrl }); assert.equal(result.complete, false);
  });
  await serve((_req, res) => { res.statusCode = 404; res.end('SECRET'); }, async baseUrl => {
    const result = await listModels({ ...connection, kind: 'openai', baseUrl }); assert.equal(result.modelListStatus, 'unsupported'); assert.ok(!JSON.stringify(result).includes('SECRET'));
  });
  await serve((_req, res) => { res.end('{"data":[{"wrong":"SECRET"}]}'); }, async baseUrl => {
    const result = await listModels({ ...connection, kind: 'openai', baseUrl }); assert.equal(result.modelListStatus, 'unavailable'); assert.ok(!JSON.stringify(result).includes('SECRET'));
  });
});

test('actual invoke gates model and effort before POST; default preserves requested/reported distinction', async () => {
  const calls: string[] = [];
  await serve(async (req, res) => {
    calls.push(req.method!);
    if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: profile.model }] })); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(body.reasoning_effort, undefined); assert.equal(body.model, profile.model);
    res.end(JSON.stringify({ model: 'server-resolved-model', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }));
  }, async baseUrl => {
    const request = { connection: { ...connection, kind: 'openai' as const, baseUrl }, profile, prompt: 'synthetic', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
    await assert.rejects(invokeProvider({ ...request, profile: { ...profile, effort: 'high' } }), code('unverified-effort'));
    await assert.rejects(invokeProvider({ ...request, profile: { ...profile, model: 'absent-model' } }), code('model-not-listed'));
    assert.deepEqual(calls, ['GET', 'GET']);
    const result = await invokeProvider(request);
    assert.deepEqual(result.data, { ok: true }); assert.equal(result.reportedModel, 'server-resolved-model'); assert.equal(result.reportedEffort, undefined); assert.match(result.diagnostics!, /미확인/);
    assert.deepEqual(calls, ['GET', 'GET', 'GET', 'POST']);
  });
});

test('metadata discovery obeys the overall invocation time budget and cancellation', async () => {
  await serve(() => {}, async baseUrl => {
    const request = { connection: { ...connection, kind: 'openai' as const, baseUrl }, profile: { ...profile, timeoutMs: 40 }, prompt: 'synthetic', schema: {} };
    const started = Date.now(); await assert.rejects(invokeProvider(request), code('timeout')); assert.ok(Date.now() - started < 2000);
    const controller = new AbortController(); controller.abort(); await assert.rejects(invokeProvider({ ...request, signal: controller.signal }), code('cancelled'));
  });
});
