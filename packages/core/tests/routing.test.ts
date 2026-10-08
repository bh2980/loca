import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { STAGES, type ExecutionProfile, type SourceUnit, type Stage, type Term } from '@workbench/contracts';
import { Engine } from '../src/engine.ts';
import { demoFixture, demoTranslations } from '../src/fixture.ts';
import {invokeApi} from '../../providers/src/api.ts';

interface RequestBody {
  model: string;
  reasoning_effort: string;
  max_completion_tokens: number;
  messages: { role: string; content: string }[];
  response_format: {
    type: string;
    json_schema: { strict: boolean; schema: { properties: Record<string, unknown> } };
  };
}

test('full pipeline sends each stage model/effort through a local compatible API and records execution metadata', async () => {
  const assignments: Record<Stage, { model: string; effort: string }> = {
    analyze: { model: 'analysis-model', effort: 'high' },
    glossary: { model: 'cheap-model', effort: 'medium' },
    characters: { model: 'profile-model', effort: 'low' },
    translate: { model: 'translator-model', effort: 'high' },
    review: { model: 'reviewer-model', effort: 'medium' },
    recheck: { model: 'editor-model', effort: 'low' },
  };
  const requests: { path: string; stage: Stage; targetIds: string[]; body: RequestBody }[] = [];
  const serverErrors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization,'Bearer synthetic-routing-test-key');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RequestBody;
      const prompt = body.messages.find(message => message.role === 'user')?.content;
      assert.ok(prompt);
      // The engine places a separate JSON context object after its instructions.
      const boundary = prompt.lastIndexOf('\n\n{');
      assert.ok(boundary >= 0, 'request contains the structured target context');
      const context = JSON.parse(prompt.slice(boundary + 2)) as { stage: Stage; targets: (SourceUnit & {currentTranslation:string})[]; terms: Term[] };
      assert.ok(STAGES.includes(context.stage));
      requests.push({ path: request.url ?? '', stage: context.stage, targetIds: context.targets.map(unit => unit.id), body });
      const properties = body.response_format.json_schema.schema.properties;
      let output: unknown;
      if ('knowledge' in properties) {
        output = { knowledge: (demoFixture.knowledge ?? [])
          .filter(item => context.stage === 'characters' ? item.kind === 'character' : item.kind !== 'character')
          .map(({ id: _id, ...fields }) => fields) };
      } else if ('terms' in properties) {
        output = { terms: context.terms.flatMap(term => term.unitIds.map(unitId => ({
          source: term.source, target: context.targets.find(unit => unit.id === unitId)?.currentTranslation.includes(term.target) ? term.target : '', description: term.description, unitIds: [unitId],
        }))) };
      } else {
        assert.ok('translations' in properties);
        output = { translations: context.targets.map(unit => ({
          unitId: unit.id, text: demoTranslations[unit.id], issues: [],
        })) };
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        model: `served-${body.model}`,
        reasoning: { effort: body.reasoning_effort },
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
    } catch (error) {
      serverErrors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Invalid fake-server request' }));
    }
  });
  // This fixture proves captured stage settings reach the API wire. Metadata
  // validation is tested independently: compatible /models has no effort schema.
  const engine = new Engine('unused-routing-test-directory', { memory: true, autoStart: false, demoDelayMs: 0,credential:()=> 'synthetic-routing-test-key',invoke:invokeApi });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const profiles = Object.fromEntries(STAGES.map(stage => [stage, {
      connectionId: 'local-fake-api', ...assignments[stage],
      timeoutMs: 3000, maxOutputTokens: 4000, maxAttempts: 1,
    }])) as Record<Stage, ExecutionProfile>;
    engine.updateSettings({
      connections: [{ id: 'local-fake-api', name: 'Test-only local fake API', kind: 'openai',
        baseUrl: `http://127.0.0.1:${address.port}/v1`, apiMode: 'chat',
        supportedEfforts: ['low', 'medium', 'high'] }],
      profiles,
    });
    const run = engine.requestRun({ kind: 'pipeline' });
    await engine.drain();
    assert.deepEqual(serverErrors, []);
    const state = engine.state();
    assert.equal(JSON.stringify(state).includes('synthetic-routing-test-key'),false);
    assert.equal(JSON.stringify(engine.exportProject()).includes('synthetic-routing-test-key'),false);
    const completed = state.runs.find(item => item.id === run.id)!;
    assert.equal(completed.status, 'completed', completed.error ?? 'pipeline must finish successfully');
    assert.equal(completed.mode, 'live');
    assert.equal(requests.length, completed.steps.length);
    assert.deepEqual(requests.map(item => item.stage), completed.steps.map(step => step.stage));
    for (const [index, request] of requests.entries()) {
      assert.equal(request.path, '/v1/chat/completions');
      assert.equal(request.body.model, assignments[request.stage].model);
      assert.equal(request.body.reasoning_effort, assignments[request.stage].effort);
      assert.equal(request.body.max_completion_tokens, 4000);
      assert.equal(request.body.response_format.type, 'json_schema');
      assert.equal(request.body.response_format.json_schema.strict, true);
      assert.deepEqual(request.targetIds, completed.steps[index].unitIds);
    }
    assert.deepEqual([...new Set(requests.map(item => item.stage))], ['analyze', 'glossary', 'characters', 'translate', 'review']);
    assert.equal(Object.keys(state.translations).length, 22);
    for (const translation of Object.values(state.translations)) {
      assert.equal(translation.status, 'checked');
      assert.equal(translation.text, demoTranslations[translation.unitId]);
      assert.deepEqual(translation.qa, []);
      const draft = translation.history.find(version => version.execution?.stage === 'translate')!;
      assert.ok(draft, `${translation.unitId} retains translation execution provenance`);
      assert.equal(draft.execution?.connectionId, 'local-fake-api');
      assert.equal(draft.execution?.model, 'translator-model');
      assert.equal(draft.execution?.effort, 'high');
      assert.equal(draft.execution?.reportedModel, 'served-translator-model');
      assert.equal(draft.execution?.reportedEffort, 'high');
      assert.equal(draft.execution?.demo, false);
      assert.equal(translation.execution?.stage, 'review');
      assert.equal(translation.execution?.model, 'reviewer-model');
      assert.equal(translation.execution?.effort, 'medium');
      assert.equal(translation.execution?.reportedModel, 'served-reviewer-model');
      assert.equal(translation.execution?.reportedEffort, 'medium');
    }
    assert.equal(state.reviews.length, 0);
    assert.equal(completed.usage.inputTokens, requests.length * 10);
    assert.equal(completed.usage.outputTokens, requests.length * 5);
  } finally {
    engine.close();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
