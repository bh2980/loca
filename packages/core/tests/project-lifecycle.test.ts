import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import {demoFixture} from '../src/fixture.ts';
import {threeSceneDemo} from '../src/demo-three-scenes.ts';

const create=()=>new Engine('unused-lifecycle',{memory:true,autoStart:false,demoDelayMs:0});
test('project switching persists complete work and survives reopening the SQLite store',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-projects-'));let engine=new Engine(dir,{autoStart:false,demoDelayMs:0});try{
  engine.requestRun({kind:'translate',unitIds:['S0-01']});await engine.drain();engine.updateUnit('S0-01',{text:'보관할 수동 번역',expectedVersion:engine.state().translations['S0-01'].version});
  const original=engine.state();const other=structuredClone(demoFixture);other.project.id='other-project';other.project.title='Other';engine.importProject(other);
  assert.equal(engine.state().translations['S0-01'].text,'');assert.deepEqual(engine.state().changes,[]);assert.equal(engine.state().events.some(event=>event.message.includes('S0-01')),false);assert.ok(engine.projects().some(p=>p.id===original.project.id&&!p.current));engine.close();engine=new Engine(dir,{autoStart:false,demoDelayMs:0});
  engine.openProject(original.project.id);const restored=engine.state();assert.deepEqual(restored.translations,original.translations);assert.deepEqual(restored.taskSnapshots,original.taskSnapshots);assert.deepEqual(restored.runs,original.runs);assert.deepEqual(restored.changes,original.changes);assert.equal(engine.projects().filter(p=>p.current).length,1);
  engine.openProject(other.project.id);assert.equal(engine.state().project.id,other.project.id);
 }finally{engine.close();rmSync(dir,{recursive:true,force:true});}
});
test('backup roundtrip retains work, reviews, histories and exact context without restoring endpoint configuration',async()=>{
 const a=create(),b=create();try{
  a.requestRun({kind:'translate',unitIds:['S0-01']});await a.drain();a.updateUnit('S0-01',{text:'완전한 백업',expectedVersion:a.state().translations['S0-01'].version});
  a.store.update(s=>{s.runs[0].connections.push({id:'secret-config',kind:'openai',name:'private',baseUrl:'https://private.invalid',envKey:'PRIVATE_TOKEN',executable:'private.exe'});s.taskSnapshots![0].connection={id:'private',kind:'openai',name:'Private',baseUrl:'https://private.invalid',envKey:'PRIVATE_TOKEN'};});
  const original=a.state(),backup=a.backupProject(),json=JSON.stringify(backup);assert.doesNotMatch(json,/PRIVATE_TOKEN|private\.invalid|private\.exe/);assert.equal('connections' in backup.data,false);assert.equal('profiles' in backup.data,false);
  const settings=b.state();b.restoreProject(JSON.parse(json));const restored=b.state();assert.deepEqual(restored.translations,original.translations);assert.deepEqual(restored.reviews,original.reviews);assert.deepEqual(restored.changes,original.changes);assert.deepEqual(restored.taskSnapshots![0].context,original.taskSnapshots![0].context);assert.deepEqual(restored.connections,settings.connections);assert.deepEqual(restored.profiles,settings.profiles);assert.deepEqual(restored.runs[0].connections,[]);
  assert.throws(()=>b.restoreProject(b.exportProject()),/백업 형식/);
  const invalid=structuredClone(backup);delete invalid.data.translations['S0-01'];const before=b.state();assert.throws(()=>b.restoreProject(invalid),/백업의 번역/);assert.deepEqual(b.state(),before);
 }finally{a.close();b.close();}
});
test('same-project source refresh keeps manual edits and locks while marking changed source stale',()=>{
 const e=create();try{e.updateUnit('S0-01',{text:'수동 보존',expectedVersion:0});const before=e.state().translations['S0-01'];const input=structuredClone(demoFixture);input.units.find(u=>u.id==='S0-01')!.source+=' Changed.';e.importProject(input);const after=e.state().translations['S0-01'];assert.equal(after.text,before.text);assert.equal(after.locked,true);assert.deepEqual(after.history,before.history);assert.equal(after.freshness,'stale');}finally{e.close();}
});
test('opening a project without a graph removes the previously active project graph',()=>{
 const e=create();try{const original=e.state().project.id;e.importProject(threeSceneDemo);assert.equal(e.state().graph?.nodes.length,28);e.openProject(original);assert.equal(e.state().graph,undefined);e.openProject(threeSceneDemo.project.id);assert.equal(e.state().graph?.nodes.length,28);}finally{e.close();}
});
test('review acceptance rejects changed applicable knowledge but accepts unaffected scope',()=>{
 const e=create();try{
  e.store.update(s=>{s.knowledge=[{id:'rule',kind:'rule',title:'Rule',content:'Old rule',evidenceIds:['S0-01'],branch:'common',visibility:'translator',version:1}];});const snapshot=e.previewTask({stage:'review',unitIds:['S0-01']});
  e.store.update(s=>{(s.taskSnapshots??=[]).push(snapshot);s.reviews.push({id:'proposal',unitId:'S0-01',jobId:'offline',kind:'semantic',status:'open',currentText:'',proposedText:'새 번역',reason:'offline',baseVersion:0,termVersions:Object.fromEntries(s.terms.filter(t=>t.unitIds.includes('S0-01')).map(t=>[t.id,t.version])),createdAt:new Date().toISOString(),execution:{connectionId:'mock',connectionKind:'mock',model:'fixture',effort:'',stage:'review',demo:true,snapshotId:snapshot.id}});});
  e.updateKnowledge('rule',{content:'New rule',expectedVersion:1});assert.throws(()=>e.resolveReview('proposal','accept'),/작품 자료가 바뀌었습니다/);assert.equal(e.state().reviews[0].status,'open');assert.equal(e.state().translations['S0-01'].text,'');
  e.store.update(s=>{(s.taskSnapshots![0].context.knowledge as any[])[0].applicableUnitIds=['S0-02'];});e.resolveReview('proposal','accept');assert.equal(e.state().translations['S0-01'].text,'새 번역');assert.equal(e.state().translations['S0-01'].locked,true);
 }finally{e.close();}
});
test('scoped stale runs and explicit stages never widen the requested unit set; retry uses current profiles and only remaining steps',()=>{
 const e=create();try{
  e.updateUnit('S0-01',{text:'첫 문장',expectedVersion:0});e.updateUnit('S0-02',{text:'둘째 문장',expectedVersion:0});e.store.update(s=>{s.translations['S0-01'].freshness='stale';s.translations['S0-02'].freshness='stale';});
  const scoped=e.requestRun({kind:'recheck',unitIds:['S0-01']});assert.deepEqual(scoped.steps.flatMap(st=>st.unitIds),['S0-01']);e.control(scoped.id,'cancel');
  const original=e.requestRun({kind:'translate',unitIds:['S0-01','S0-02']});e.store.update(s=>{const run=s.runs.find(r=>r.id===original.id)!;run.status='failed';run.steps[0].status='completed';run.steps[1].status='failed';});
  const state=e.state(),profile={...state.profiles.review,model:'new-fixture',prompt:'new instruction'};e.updateProfile('review',profile);const retry=e.retryCurrent(original.id);assert.equal(retry.profiles.review.model,'new-fixture');assert.equal(retry.steps.length,1);assert.equal(retry.steps[0].stage,'review');assert.deepEqual(retry.steps[0].unitIds,['S0-01','S0-02']);assert.equal(e.state().runs.find(r=>r.id===original.id)!.steps[0].status,'completed');e.control(retry.id,'cancel');
  const stage=e.requestRun({kind:'translate',unitIds:['S0-02'],stage:'review'});assert.equal(stage.steps.length,1);assert.equal(stage.steps[0].stage,'review');assert.deepEqual(stage.steps[0].unitIds,['S0-02']);
  assert.throws(()=>e.requestRun({kind:'translate',unitIds:['missing']}),/실행 원문/);assert.throws(()=>e.requestRun({kind:'translate',unitIds:['S0-01','S0-01']}),/실행 원문/);
 }finally{e.close();}
});
test('duplicate queued trials are rejected and draft profiles do not change saved settings',async()=>{
 const e=new Engine('unused-trial-dedupe',{memory:true,autoStart:false,demoDelayMs:30});try{const saved=e.state().profiles.translate,profile={...saved,prompt:'draft only'};const first=e.testProfile({stage:'translate',unitIds:['S0-01'],profile});assert.throws(()=>e.testProfile({stage:'translate',unitIds:['S0-01'],profile}),/既|이미 진행/);assert.deepEqual(e.state().profiles.translate,saved);assert.throws(()=>e.importProject(demoFixture),/진행 중/);e.cancelTaskTest(first.id);await e.waitForTaskTests();e.testProfile({stage:'translate',unitIds:['S0-01'],profile});await e.waitForTaskTests();assert.equal(e.taskTests().filter(t=>t.status==='completed').length,1);}finally{e.close();}
});

test('saving a glossary draft only marks its uses stale until the user selects a recheck scope',async()=>{
 const e=create();try{
  e.requestRun({kind:'pipeline'});await e.drain();const before=e.state(),term=before.terms[0];
  e.updateTerm(term.id,{target:'수정된 용어',expectedVersion:term.version,autoRecheck:false});
  const after=e.state();assert.equal(after.runs.length,before.runs.length);assert.ok(term.unitIds.every(id=>after.translations[id].freshness==='stale'));
  assert.ok(term.unitIds.every(id=>after.translations[id].text===before.translations[id].text));
  const recheck=e.requestRun({kind:'recheck',stage:'recheck',unitIds:[term.unitIds[0]]});assert.deepEqual(recheck.steps.flatMap(step=>step.unitIds),[term.unitIds[0]]);
 }finally{e.close();}
});

test('explicit translation stages retain scene boundaries and archived project imports cannot replace saved work',()=>{
 const e=create();try{
  const original=e.state().project.id;e.updateUnit('S0-01',{text:'기존 작업 보존',expectedVersion:0});e.importProject(threeSceneDemo);
  assert.throws(()=>e.importProject(demoFixture),/이미 보관된 프로젝트/);assert.equal(e.state().project.id,threeSceneDemo.project.id);
  const run=e.requestRun({kind:'translate',stage:'translate',unitIds:['relay-02','relay-10','relay-19']});
  assert.deepEqual(run.steps.map(step=>step.groupId),['demo-briefing','demo-archive','demo-report']);assert.ok(run.steps.every(step=>step.unitIds.length===1));
  e.control(run.id,'cancel');e.openProject(original);assert.equal(e.state().translations['S0-01'].text,'기존 작업 보존');
 }finally{e.close();}
});
