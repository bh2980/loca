import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Engine } from '../src/engine.ts';
import { demoFixture } from '../src/fixture.ts';

function memoryEngine(delay = 0) {
  return new Engine('unused-test-directory', { memory: true, autoStart: false, demoDelayMs: delay });
}

async function completedDemo(engine: Engine) {
  const run = engine.requestRun({ kind: 'pipeline' });
  await engine.drain();
  assert.equal(engine.state().runs.find(item => item.id === run.id)?.status, 'completed');
}

test('full demo retains 22 original IDs and produces checked mock results with evidence', async () => {
  const engine = memoryEngine();
  try {
    await completedDemo(engine);
    const state = engine.state();
    assert.equal(state.units.length, 22);
    assert.deepEqual(Object.keys(state.translations).sort(), demoFixture.units.map(unit => unit.id).sort());
    for (const translation of Object.values(state.translations)) {
      assert.equal(translation.status, 'checked');
      assert.equal(translation.origin, 'demo');
      assert.ok(translation.text.trim());
      assert.deepEqual(translation.qa, []);
      assert.equal(translation.execution?.demo, true);
    }
    assert.equal(state.knowledge.filter(item => item.kind === 'character').length, 3);
    assert.ok(state.knowledge.every(item => item.evidenceIds.every(id => state.units.some(unit => unit.id === id))));
    assert.equal(state.reviews.length, 0);
  } finally { engine.close(); }
});

test('glossary change processes exactly four institutional uses and leaves verb Watch alone', async () => {
  const engine = memoryEngine();
  try {
    await completedDemo(engine);
    const before = engine.state();
    engine.updateTerm('watch-office', { target: '관측국', expectedVersion: 1 });
    const queued = engine.state().runs.find(run => run.kind === 'recheck')!;
    assert.deepEqual(queued.steps.flatMap(step => step.unitIds).sort(), ['S0-01', 'S3-03', 'D01', 'U02'].sort());
    await engine.drain();
    const after = engine.state();
    for (const unit of after.units) {
      if (['S0-01', 'S3-03', 'D01', 'U02'].includes(unit.id)) {
        assert.ok(after.translations[unit.id].text.includes('관측국'));
        assert.equal(after.translations[unit.id].termVersions['watch-office'], 2);
        assert.equal(after.translations[unit.id].freshness, 'current');
      } else assert.deepEqual(after.translations[unit.id], before.translations[unit.id]);
    }
    assert.deepEqual(after.translations['B-03'], before.translations['B-03']);
  } finally { engine.close(); }
});

test('locked manual translation gets a proposal without losing the user text', async () => {
  const engine = memoryEngine();
  try {
    await completedDemo(engine);
    const current = engine.state().translations['S3-03'];
    engine.updateUnit('S3-03', { text: '감시국이 그 사람들을 없앤 건가요?', expectedVersion: current.version });
    const protectedVersion = engine.state().translations['S3-03'].version;
    engine.updateTerm('watch-office', { target: '관측국', expectedVersion: 1 });
    await engine.drain();
    const state = engine.state();
    assert.equal(state.translations['S3-03'].text, '감시국이 그 사람들을 없앤 건가요?');
    assert.equal(state.translations['S3-03'].version, protectedVersion);
    assert.equal(state.translations['S3-03'].locked, true);
    const proposal = state.reviews.find(item => item.unitId === 'S3-03' && item.status === 'open');
    assert.equal(proposal?.kind, 'locked');
    assert.ok(proposal?.proposedText.includes('관측국'));
    assert.equal(proposal?.currentText, state.translations['S3-03'].text);
    assert.ok(state.translations['S0-01'].text.includes('관측국'));
  } finally { engine.close(); }
});

test('in-flight AI result cannot overwrite a newer manual edit', async () => {
  const engine = memoryEngine(10);
  try {
    const run = engine.requestRun({ kind: 'translate', groupId: 'S0' });
    const pending = engine.tick();
    assert.equal(engine.state().runs.find(item => item.id === run.id)?.steps[0].status, 'running');
    engine.updateUnit('S0-01', { text: '사람이 직접 확정한 문장', expectedVersion: 0 });
    await pending;
    await engine.drain();
    const state = engine.state();
    assert.equal(state.translations['S0-01'].text, '사람이 직접 확정한 문장');
    assert.equal(state.translations['S0-01'].version, 1);
    assert.ok(state.reviews.some(item => item.unitId === 'S0-01' && item.kind === 'conflict'));
    assert.throws(() => engine.updateUnit('S0-01', { text: 'stale editor', expectedVersion: 0 }), /변경/);
  } finally { engine.close(); }
});

test('rapid glossary updates discard the older response and converge on latest term version', async () => {
  const engine = memoryEngine(5);
  try {
    await completedDemo(engine);
    engine.updateTerm('watch-office', { target: '관측국', expectedVersion: 1 });
    const pending = engine.tick();
    engine.updateTerm('watch-office', { target: '관찰국', expectedVersion: 2 });
    await pending;
    await engine.drain();
    const state = engine.state();
    for (const uid of ['S0-01', 'S3-03', 'D01', 'U02']) {
      assert.ok(state.translations[uid].text.includes('관찰국'));
      assert.equal(state.translations[uid].termVersions['watch-office'], 3);
      assert.equal(state.translations[uid].freshness, 'current');
      assert.ok(!state.translations[uid].history.some(version => version.termVersions['watch-office'] === 2));
    }
    assert.equal(state.reviews.filter(item => item.status === 'open').length, 0);
  } finally { engine.close(); }
});

test('pause waits at a stage boundary, resume continues, cancel preserves completed outputs', async () => {
  const engine = memoryEngine(5);
  try {
    const run = engine.requestRun({ kind: 'translate', groupId: 'S0' });
    const pending = engine.tick();
    engine.control(run.id, 'pause');
    await pending;
    assert.equal(engine.state().runs.find(item => item.id === run.id)?.status, 'paused');
    const pausedText = engine.state().translations['S0-01'].text;
    assert.ok(pausedText);
    await engine.drain();
    assert.equal(engine.state().translations['S0-01'].text, pausedText);
    engine.control(run.id, 'resume');
    await engine.drain();
    assert.equal(engine.state().runs.find(item => item.id === run.id)?.status, 'completed');

    const cancelled = engine.requestRun({ kind: 'translate', groupId: 'S1A' });
    await engine.tick();
    const beforeCancel = structuredClone(engine.state().translations['A-01']);
    const cancelling = engine.tick();
    engine.control(cancelled.id, 'cancel');
    await cancelling;
    await engine.drain();
    assert.equal(engine.state().runs.find(item => item.id === cancelled.id)?.status, 'cancelled');
    assert.deepEqual(engine.state().translations['A-01'], beforeCancel);
  } finally { engine.close(); }
});

test('persistent restart recovers interrupted job without repeating completed translation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workbench-engine-test-'));
  let engine: Engine | undefined;
  try {
    engine = new Engine(directory, { autoStart: false, demoDelayMs: 5 });
    const run = engine.requestRun({ kind: 'translate', groupId: 'S0' });
    await engine.tick();
    const completedVersion = engine.state().translations['S0-01'].version;
    const interrupted = engine.tick();
    engine.close();
    await interrupted;
    engine = new Engine(directory, { autoStart: false, demoDelayMs: 0 });
    const recovered = engine.state().runs.find(item => item.id === run.id)!;
    assert.equal(recovered.status, 'paused');
    assert.equal(recovered.steps[0].status, 'completed');
    assert.equal(recovered.steps[1].status, 'queued');
    engine.control(run.id, 'resume');
    await engine.drain();
    assert.equal(engine.state().runs.find(item => item.id === run.id)?.status, 'completed');
    assert.equal(engine.state().translations['S0-01'].version, completedVersion);
    assert.equal(engine.state().translations['S0-01'].status, 'checked');
  } finally {
    engine?.close();
    const safeDirectory = resolve(directory);
    assert.equal(dirname(safeDirectory), resolve(tmpdir()));
    assert.ok(basename(safeDirectory).startsWith('workbench-engine-test-'));
    rmSync(safeDirectory, { recursive: true, force: true });
  }
});

test('same-input reimport preserves manual edits, lock, and history without duplicate IDs', () => {
  const engine = memoryEngine();
  try {
    engine.updateUnit('S0-01', { text: '직접 번역', expectedVersion: 0 });
    const before = engine.state().translations['S0-01'];
    engine.importProject(structuredClone(demoFixture));
    const state = engine.state();
    assert.deepEqual(state.translations['S0-01'], before);
    assert.equal(state.units.length, 22);
    assert.equal(new Set(state.units.map(unit => unit.id)).size, 22);
  } finally { engine.close(); }
});

test('invalid duplicate IDs and unresolved group/term/evidence references are rejected atomically', () => {
  const engine = memoryEngine();
  try {
    const before = engine.state();
    const mutations = [
      (input: typeof demoFixture) => { input.units.push(structuredClone(input.units[0])); },
      (input: typeof demoFixture) => { input.groups[0].nextIds.push('missing-group'); },
      (input: typeof demoFixture) => { input.units[0].termIds.push('missing-term'); },
      (input: typeof demoFixture) => { input.knowledge![0].evidenceIds.push('missing-source'); },
    ];
    for (const mutate of mutations) {
      const input = structuredClone(demoFixture);
      mutate(input);
      assert.throws(() => engine.importProject(input));
      assert.deepEqual(engine.state(), before);
    }
  } finally { engine.close(); }
});

test('export preserves source mapping and labels mock provenance and unresolved proposals', async () => {
  const engine = memoryEngine();
  try {
    await completedDemo(engine);
    const source = engine.state().translations['S3-03'];
    engine.updateUnit('S3-03', { text: '감시국이 그 사람들을 없앴나요?', expectedVersion: source.version });
    engine.updateTerm('watch-office', { target: '관측국', expectedVersion: 1 });
    await engine.drain();
    const exported = engine.exportProject();
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.translations.length, 22);
    assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
    for (const row of exported.translations) assert.equal(row.source, demoFixture.units.find(unit => unit.id === row.unitId)?.source);
    const ordinary = exported.translations.find(row => row.unitId === 'S0-01')!;
    assert.equal(ordinary.origin, 'demo');
    assert.equal(ordinary.execution?.demo, true);
    assert.equal(ordinary.termVersions['watch-office'], 2);
    const protectedRow = exported.translations.find(row => row.unitId === 'S3-03')!;
    assert.equal(protectedRow.origin, 'manual');
    assert.equal(protectedRow.locked, true);
    assert.equal(protectedRow.freshness, 'stale');
    assert.equal(protectedRow.unresolved, 1);
  } finally { engine.close(); }
});
