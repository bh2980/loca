import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.ts';
import { threeSceneDemo, threeSceneDemoTranslations } from '../src/demo-three-scenes.ts';
import type { ProviderRequest, ProviderResult } from '@workbench/providers';
import type { Term } from '@workbench/contracts';

const termId = 'relay-courier';
const usedA = ['relay-02', 'relay-14'];
const usedB = ['relay-10', 'relay-21'];
function engineWith(invoke?: (request: ProviderRequest) => Promise<ProviderResult>) {
  const engine = new Engine('unused-term-candidate-integration', { memory: true, autoStart: false, demoDelayMs: 0, invoke });
  engine.importProject(threeSceneDemo);
  if (invoke) {
    const s = engine.state(), profiles = structuredClone(s.profiles);
    const connection = { id: 'candidate-test', name: 'Offline candidate fixture', kind: 'openai' as const, baseUrl: 'http://127.0.0.1:1/v1', allowUnauthenticated: true };
    for (const profile of Object.values(profiles)) { profile.connectionId = connection.id; profile.model = 'offline-fixture'; }
    engine.updateSettings({ connections: [...s.connections, connection], profiles });
  }
  return engine;
}
function currentTerm(engine: Engine) { return engine.state().terms.find(term => term.id === termId)!; }
function candidatePayload(term: Term) {
  return term.candidates!.map(({ id, target, guidance, isDefault, enabled }) => ({ id, target, guidance, isDefault, enabled }));
}
function prepare(engine: Engine) {
  const term = currentTerm(engine);
  engine.updateTerm(termId, { expectedVersion: term.version, autoRecheck: false, candidates: [
    { id: `${termId}:default`, target: '운반책', guidance: '', isDefault: true, enabled: true },
    { target: '전달책', guidance: '정보를 전달하는 역할을 강조하는 대사에서 사용', isDefault: false, enabled: true },
  ] });
  for (const uid of [...usedA, ...usedB]) {
    const text = usedB.includes(uid) ? threeSceneDemoTranslations[uid].replaceAll('운반책', '전달책') : threeSceneDemoTranslations[uid];
    engine.updateUnit(uid, { text, expectedVersion: 0 });
    engine.updateUnit(uid, { locked: false, expectedVersion: 1 });
  }
  return currentTerm(engine);
}
function outputUsing(request: ProviderRequest, candidateId: string): ProviderResult {
  const context = request.context as any;
  const term = context.terms.find((entry: any) => entry.id === termId);
  const candidate = term.candidates.find((entry: any) => entry.id === candidateId);
  return { data: { translations: context.targets.map((unit: any) => ({
    unitId: unit.id, text: threeSceneDemoTranslations[unit.id].replaceAll('운반책', candidate.target), issues: [],
    termUsages: [{ termId, candidateId, candidateVersion: candidate.version }],
  })) } };
}

test('candidate use-guidance edits invalidate only the current translations that used that candidate', () => {
  const engine = engineWith();
  try {
    const term = prepare(engine), a = term.candidates!.find(candidate => candidate.isDefault)!;
    const before = engine.state();
    for (const uid of usedA) assert.equal(before.translations[uid].termUsages?.find(usage => usage.termId === termId)?.candidateId, a.id);
    const updated = engine.updateTerm(termId, { expectedVersion: term.version, autoRecheck: false, candidates: candidatePayload(term).map(candidate => candidate.id === a.id ? { ...candidate, guidance: '물건을 운반하는 역할에만 사용' } : candidate) });
    const after = engine.state();
    assert.deepEqual(after.units.filter(unit => after.translations[unit.id].freshness === 'stale').map(unit => unit.id).sort(), [...usedA].sort());
    for (const uid of usedB) assert.deepEqual(after.translations[uid], before.translations[uid]);
    assert.equal(updated.candidates!.find(candidate => candidate.id === a.id)!.version, a.version + 1);
    assert.equal(after.runs.length, before.runs.length, 'saving does not silently call a model');
  } finally { engine.close(); }
});

test('disabled A rechecks only A users with B; a protected line retains text and an attributable proposal', async () => {
  const requests: ProviderRequest[] = [];
  let bId = '';
  const engine = engineWith(async request => { requests.push(request); return outputUsing(request, bId); });
  try {
    const term = prepare(engine), a = term.candidates!.find(candidate => candidate.isDefault)!;
    bId = term.candidates!.find(candidate => candidate.id !== a.id)!.id;
    engine.updateUnit(usedA[0], { locked: true, expectedVersion: 1 });
    const before = engine.state();
    engine.updateTerm(termId, { expectedVersion: term.version, autoRecheck: false, candidates: candidatePayload(term).map(candidate => ({ ...candidate, enabled: candidate.id !== a.id, isDefault: candidate.id === bId })) });
    const stale = Object.values(engine.state().translations).filter(translation => translation.freshness === 'stale').map(translation => translation.unitId);
    const run = engine.requestRun({ kind: 'recheck', unitIds: stale });
    await engine.drain();
    const after = engine.state();
    assert.equal(after.runs.find(item => item.id === run.id)!.status, 'completed');
    assert.deepEqual(requests.flatMap(request => (request.context!.targets as any[]).map(unit => unit.id)).sort(), [...usedA].sort());
    for (const request of requests) assert.ok((request.context!.terms as any[]).find(entry => entry.id === termId).candidates.every((candidate: any) => candidate.id !== a.id));
    for (const uid of usedB) assert.deepEqual(after.translations[uid], before.translations[uid]);
    assert.equal(after.translations[usedA[0]].text, before.translations[usedA[0]].text);
    assert.equal(after.translations[usedA[1]].termUsages!.find(usage => usage.termId === termId)!.candidateId, bId);
    const proposal = after.reviews.find(item => item.unitId === usedA[0] && item.status === 'open')!;
    assert.ok(proposal.proposedText.includes('전달책'));
    engine.resolveReview(proposal.id, 'accept');
    assert.equal(engine.state().translations[usedA[0]].termUsages!.find(usage => usage.termId === termId)!.candidateId, bId);
    assert.equal(engine.state().translations[usedA[0]].locked, true);
  } finally { engine.close(); }
});

test('changing A while a B response is in flight does not discard the unrelated B result', async () => {
  let release!: (result: ProviderResult) => void, request!: ProviderRequest;
  const engine = engineWith(async value => { request = value; return new Promise(resolve => { release = resolve; }); });
  try {
    const term = prepare(engine), a = term.candidates!.find(candidate => candidate.isDefault)!, b = term.candidates!.find(candidate => !candidate.isDefault)!;
    engine.requestRun({ kind: 'translate', stage: 'review', unitIds: [usedB[0]] });
    const pending = engine.tick();
    assert.ok(release);
    engine.updateTerm(termId, { expectedVersion: term.version, autoRecheck: false, candidates: candidatePayload(term).map(candidate => candidate.id === a.id ? { ...candidate, guidance: 'A 변경' } : candidate) });
    release(outputUsing(request, b.id));
    await pending;
    const state = engine.state();
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.translations[usedB[0]].status, 'checked');
    assert.equal(state.translations[usedB[0]].freshness, 'current');
    assert.equal(state.translations[usedB[0]].termUsages!.find(usage => usage.termId === termId)!.candidateId, b.id);
  } finally { engine.close(); }
});

test('original/translation pair extraction retains distinct observed candidates and their exact evidence', async () => {
  const engine = engineWith(async request => ({ data: { terms: (request.context!.targets as any[]).map(unit => ({
    source: 'Courier', target: unit.currentTranslation.includes('전달책') ? '전달책' : '운반책', description: '전달 역할', unitIds: [unit.id],
  })) } }));
  try {
    engine.store.update(state => { state.terms = []; for (const unit of state.units) unit.termIds = []; });
    for (const uid of [usedA[0], usedB[0]]) engine.updateUnit(uid, { text: threeSceneDemoTranslations[uid].replaceAll('운반책', uid === usedB[0] ? '전달책' : '운반책'), expectedVersion: 0 });
    const before = engine.state();
    const run = engine.requestRun({ kind: 'translate', stage: 'glossary', unitIds: [usedA[0], usedB[0]] });
    await engine.drain();
    const after = engine.state(), term = after.terms.find(item => item.source === 'Courier')!;
    assert.equal(after.runs.find(item => item.id === run.id)!.status, 'completed');
    assert.deepEqual(term.candidates!.map(candidate => candidate.target).sort(), ['운반책', '전달책'].sort());
    for (const candidate of term.candidates!) {
      assert.equal(candidate.status, 'provisional');
      const evidence = candidate.evidence![0];
      assert.equal(evidence.sourceText, before.units.find(unit => unit.id === evidence.unitId)!.source);
      assert.equal(evidence.targetText, before.translations[evidence.unitId].text);
      assert.equal(evidence.translationVersion, 1);
      assert.ok(evidence.snapshotId);
    }
    for (const uid of [usedA[0], usedB[0]]) assert.equal(after.translations[uid].text, before.translations[uid].text);
    const backup = engine.backupProject(), restored = engineWith();
    try { restored.restoreProject(backup); assert.deepEqual(restored.state().terms, after.terms); assert.deepEqual(restored.state().translations, after.translations); }
    finally { restored.close(); }
  } finally { engine.close(); }
});

test('glossary extraction cannot register a target phrase absent from its paired translation', async () => {
  const engine = engineWith(async () => ({ data: { terms: [{ source: 'Courier', target: '상상한 번역어', description: '허위 대응', unitIds: [usedA[0]] }] } }));
  try {
    engine.updateUnit(usedA[0], { text: threeSceneDemoTranslations[usedA[0]], expectedVersion: 0 });
    const before = engine.state().terms;
    engine.requestRun({ kind: 'translate', stage: 'glossary', unitIds: [usedA[0]] });
    await engine.drain();
    assert.equal(engine.state().runs[0].status, 'failed');
    assert.deepEqual(engine.state().terms, before);
  } finally { engine.close(); }
});

test('one extraction response can add several observed alternatives to an already existing term', async () => {
  const engine = engineWith(async request => ({ data: { terms: (request.context!.targets as any[]).map(unit => ({
    source: 'Courier', target: unit.id === usedA[0] ? '연락책' : '전령', description: '이 문장에서 관측된 표현', unitIds: [unit.id],
  })) } }));
  try {
    engine.updateUnit(usedA[0], { text: threeSceneDemoTranslations[usedA[0]].replaceAll('운반책', '연락책'), expectedVersion: 0 });
    engine.updateUnit(usedB[0], { text: threeSceneDemoTranslations[usedB[0]].replaceAll('운반책', '전령'), expectedVersion: 0 });
    engine.requestRun({ kind: 'translate', stage: 'glossary', unitIds: [usedA[0], usedB[0]] });
    await engine.drain();
    assert.equal(engine.state().runs[0].status, 'completed');
    assert.deepEqual(currentTerm(engine).candidates!.map(candidate => candidate.target).sort(), ['운반책', '연락책', '전령'].sort());
    assert.equal(currentTerm(engine).target, '운반책', 'observations do not replace the existing default');
  } finally { engine.close(); }
});

test('disabling every alternative keeps old wording unresolved instead of deleting or approving it', async () => {
  const engine = engineWith();
  try {
    const term = prepare(engine), before = engine.state().translations[usedA[0]].text;
    engine.updateTerm(termId, { expectedVersion: term.version, autoRecheck: false, candidates: candidatePayload(term).map(candidate => ({ ...candidate, enabled: false, isDefault: false })) });
    engine.requestRun({ kind: 'recheck', unitIds: [usedA[0]] });
    await engine.drain();
    const state = engine.state();
    assert.equal(state.translations[usedA[0]].text, before);
    assert.equal(state.translations[usedA[0]].freshness, 'stale');
    const unresolved = state.reviews.find(item => item.unitId === usedA[0] && item.status === 'open');
    assert.ok(unresolved, 'missing replacement is a visible review issue');
    assert.ok(unresolved.proposedText.includes('운반책'), 'a blank candidate is never substituted into text');
    assert.throws(() => engine.resolveReview(unresolved.id, 'accept'), /용어|후보|대체/);
  } finally { engine.close(); }
});
