import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.ts';
import {demoFixture,demoTranslations} from '../src/fixture.ts';
import {ProviderError,type ProviderRequest,type ProviderResult} from '@workbench/providers';
import type {ExecutionProfile} from '@workbench/contracts';
import {threeSceneDemo,threeSceneDemoTranslations} from '../src/demo-three-scenes.ts';
const create=(invoke?:(request:ProviderRequest)=>Promise<ProviderResult>)=>new Engine('unused-task-test',{memory:true,autoStart:false,demoDelayMs:0,invoke});
function live(engine:Engine){const s=engine.state();const connection={id:'fake',name:'offline fake provider',kind:'openai' as const,baseUrl:'http://127.0.0.1:1/v1',allowUnauthenticated:true};const profiles=structuredClone(s.profiles);for(const p of Object.values(profiles)){p.connectionId=connection.id;p.model='offline-model';}engine.updateSettings({connections:[...s.connections,connection],profiles});}
function translated(request:ProviderRequest){const targets=request.context!.targets as {id:string;currentTranslation:string}[];return {data:{translations:targets.map(t=>({unitId:t.id,text:t.currentTranslation||demoTranslations[t.id],issues:[]}))},reportedModel:'offline-reported',reportedEffort:'low',usage:{inputTokens:12,outputTokens:8}};}

test('editable stage prompts use project languages, version changes and context switches without mutating preview state',()=>{
 const engine=create();try{
  const project=structuredClone(demoFixture);project.project.sourceLanguage='de';project.project.targetLanguage='fr';engine.importProject(project);
  engine.store.update(s=>{s.knowledge=[{id:'current',kind:'rule',title:'Current',content:'current only',evidenceIds:['S0-01'],branch:'common',visibility:'translator',version:2},{id:'archived',kind:'rule',title:'Archived',content:'old secret',evidenceIds:['S0-01'],branch:'common',visibility:'translator',archived:true}];});
  const before=engine.state(),profile:ExecutionProfile={...before.profiles.translate,prompt:'Translate {{sourceLanguage}} into {{targetLanguage}} for {{stage}}. Keep formal voice.',promptVersion:4,contextPolicy:{terms:false,knowledge:true,previous:false}};
  const preview=engine.previewTask({stage:'translate',unitIds:['S0-01'],profile});
  assert.match(preview.prompt,/de-to-fr/);assert.match(preview.prompt,/Translate de into fr for translate/);assert.equal(preview.capturedProfile.promptVersion,4);assert.deepEqual(preview.context.terms,[]);assert.deepEqual(preview.context.previousTranslations,[]);assert.deepEqual((preview.context.knowledge as any[]).map(k=>k.id),['current']);assert.equal(preview.knowledgeVersions.current,2);assert.deepEqual(engine.state(),before);
  const profiles=structuredClone(before.profiles);profiles.translate.prompt=profile.prompt;engine.updateSettings({connections:before.connections,profiles});assert.equal(engine.state().profiles.translate.promptVersion,2);
  const unchanged=engine.state();engine.updateSettings({connections:unchanged.connections,profiles:unchanged.profiles});assert.equal(engine.state().profiles.translate.promptVersion,2);
  const candidate=engine.previewTask({stage:'translate',unitIds:['S0-01'],profile:{...engine.state().profiles.translate,prompt:'New unsaved instruction'}});assert.equal(candidate.capturedProfile.promptVersion,3);assert.equal(engine.state().profiles.translate.promptVersion,2);assert.match(candidate.prompt,/Mark claims as claims/);
 }finally{engine.close();}
});

test('queued profile tests retain response, usage and captured inputs but never apply production changes',async()=>{
 const requests:ProviderRequest[]=[],engine=create(async request=>{requests.push(request);return translated(request);});try{
  live(engine);const before=engine.state(),profile={...before.profiles.translate,effort:'low',prompt:'Offline test instruction',promptVersion:7};
  const queued=engine.testProfile({stage:'translate',unitIds:['S0-01'],profile});assert.equal(queued.status,'queued');await engine.waitForTaskTests();
  const result=engine.taskTest(queued.id);assert.equal(result.status,'completed');assert.equal(result.validation?.ok,true);assert.equal(result.reportedModel,'offline-reported');assert.deepEqual(result.usage,{inputTokens:12,outputTokens:8});assert.ok(result.durationMs!>=0);assert.ok(result.rawResponse);assert.equal(result.requestedEffort,'low');
  const after=engine.state();assert.deepEqual(after.translations,before.translations);assert.deepEqual(after.terms,before.terms);assert.deepEqual(after.knowledge,before.knowledge);assert.deepEqual(after.changes,before.changes);
  const snapshot=engine.taskSnapshot(queued.snapshotId);assert.equal(snapshot.prompt,requests[0].prompt);assert.deepEqual(snapshot.context,requests[0].context);assert.deepEqual(snapshot.schema,requests[0].schema);assert.deepEqual(snapshot.capturedProfile,requests[0].profile);assert.equal(snapshot.capturedProfile.promptVersion,7);
  const ui=engine.uiState() as any;assert.equal(ui.taskSnapshots,undefined);assert.equal(ui.taskTests[0].rawResponse,undefined);
 }finally{engine.close();}
});

test('isolated tests reject wrong IDs, duplicates and token loss with machine-readable issues',async()=>{
 const engine=create(async()=>({data:{translations:[{unitId:'not-a-source',text:'bad',issues:[]}]}}));try{
  live(engine);const wrong=engine.testProfile({stage:'translate',unitIds:['S0-01']});await engine.waitForTaskTests();assert.equal(engine.taskTest(wrong.id).status,'failed');assert.ok(engine.taskTest(wrong.id).validation!.issues.some(i=>i.code==='schema-enum'));assert.ok(engine.taskTest(wrong.id).rawResponse);
  const malformed=create(async()=>({data:{translations:[{unitId:'U01',text:'tokens removed',issues:[]}]}}));try{live(malformed);const check=malformed.testProfile({stage:'translate',unitIds:['U01']});await malformed.waitForTaskTests();assert.equal(malformed.taskTest(check.id).validation?.ok,false);assert.ok(malformed.taskTest(check.id).validation!.issues.some(i=>i.unitId==='U01'));assert.equal(malformed.state().translations.U01.text,'');}finally{malformed.close();}
 }finally{engine.close();}
});

test('every real work step records the exact task snapshot and structured changes including unchanged reviews',async()=>{
 const engine=create();try{
  const run=engine.requestRun({kind:'pipeline'});await engine.drain();const state=engine.state(),finished=state.runs.find(r=>r.id===run.id)!;
  assert.equal(finished.status,'completed');assert.equal(engine.taskSnapshots({runId:run.id}).length,finished.steps.length);
  for(const step of finished.steps){const snapshot=engine.taskSnapshot(step.snapshotId!);assert.equal(snapshot.stepId,step.id);assert.equal(snapshot.stage,step.stage);assert.deepEqual(snapshot.unitIds,step.unitIds);assert.ok(snapshot.prompt);assert.ok(snapshot.schema);}
  const changes=engine.changeLedger({unitId:'S0-01',runId:run.id}).items;assert.ok(changes.some(c=>c.kind==='translation-created'));assert.ok(changes.some(c=>c.kind==='translation-reviewed'));assert.ok(changes.every(c=>c.snapshotId&&c.stepId&&c.model&&c.promptVersion));
  const t=state.translations['S0-01'];engine.updateUnit('S0-01',{text:t.text+'!',expectedVersion:t.version});assert.ok(engine.changeLedger({unitId:'S0-01',kind:'translation-manual'}).items.length);
 }finally{engine.close();}
});

test('knowledge revisions and rollback preserve history and invalidate actual consumers beyond evidence IDs',async()=>{
 const engine=create();try{
  engine.requestRun({kind:'pipeline'});await engine.drain();let state=engine.state();const item=state.knowledge.find(k=>!k.archived&&k.usedUnitIds?.some(uid=>!k.evidenceIds.includes(uid)))!;assert.ok(item,'knowledge used by a target outside its evidence');const consumer=item.usedUnitIds!.find(uid=>!item.evidenceIds.includes(uid))!,oldContent=item.content;
  const revision=engine.updateKnowledge(item.id,{content:'Revised context',expectedVersion:1});assert.equal(revision.version,2);state=engine.state();assert.equal(state.translations[consumer].freshness,'stale');assert.equal(state.translations[consumer].text,demoTranslations[consumer]);assert.equal(revision.history!.length,2);
  assert.throws(()=>engine.updateKnowledge(item.id,{content:'lost race',expectedVersion:1}),/이미 변경/);
  const rollback=engine.rollbackKnowledge(item.id,{version:1,expectedVersion:2});assert.equal(rollback.version,3);assert.equal(rollback.content,oldContent);assert.equal(rollback.history!.length,3);assert.ok(engine.changeLedger({kind:'knowledge-revised'}).items.some(c=>c.knowledgeId===item.id));
  engine.requestRun({kind:'pipeline'});await engine.drain();assert.equal(engine.state().knowledge.find(k=>k.id===item.id)?.archived,true);assert.ok(engine.state().knowledge.some(k=>!k.archived));const preview=engine.previewTask({stage:'review',unitIds:[consumer]});assert.ok(!(preview.context.knowledge as any[]).some(k=>k.id===item.id));
 }finally{engine.close();}
});

test('a knowledge edit during a provider call prevents an obsolete response from becoming current',async()=>{
 let release!:(value:ProviderResult)=>void,request!:ProviderRequest;
 const engine=create(async r=>{request=r;return new Promise(resolve=>{release=resolve;});});try{
  live(engine);engine.store.update(s=>{s.knowledge=[{id:'rule',kind:'rule',title:'Rule',content:'first',evidenceIds:['S0-01'],branch:'common',visibility:'translator'}];});
  engine.requestRun({kind:'translate',groupId:'S0'});const pending=engine.tick();assert.ok(release);engine.updateKnowledge('rule',{content:'changed while running',expectedVersion:1});release(translated(request));await pending;
  assert.equal(engine.state().translations['S0-01'].text,'');assert.equal(engine.state().translations['S0-01'].freshness,'stale');assert.ok(engine.state().runs[0].logs.some(log=>log.includes('작품 자료 버전 변경')));
 }finally{engine.close();}
});

test('the separate three-scene synthetic fixture runs all stages and keeps every branch and source identity',async()=>{
 const engine=create();try{engine.importProject(threeSceneDemo);const run=engine.requestRun({kind:'pipeline'});await engine.drain();const state=engine.state();assert.equal(state.runs.find(r=>r.id===run.id)?.status,'completed');assert.equal(state.units.length,24);for(const unit of state.units){assert.equal(state.translations[unit.id].text,threeSceneDemoTranslations[unit.id]);assert.equal(state.translations[unit.id].status,'checked');}assert.equal(state.units.find(u=>u.id==='relay-20')!.branch,'shortcut');assert.equal(state.units.find(u=>u.id==='relay-19')!.branch,'archive');const check=engine.testProfile({stage:'analyze',unitIds:['relay-01']});await engine.waitForTaskTests();assert.equal(engine.taskTest(check.id).validation?.ok,true);}finally{engine.close();}
});

test('profile test cancellation preserves source data and active tests block destructive project replacement',async()=>{
 let release!:(value:ProviderResult)=>void;
 const engine=create(async()=>new Promise(resolve=>{release=resolve;}));try{
  live(engine);const before=engine.state();const queued=engine.testProfile({stage:'translate',unitIds:['S0-01']});
  assert.throws(()=>engine.importProject(threeSceneDemo),/진행 중/);await Promise.resolve();assert.ok(release);
  engine.cancelTaskTest(queued.id);release({data:{translations:[{unitId:'S0-01',text:'never applied',issues:[]}]}});await engine.waitForTaskTests();assert.equal(engine.taskTest(queued.id).status,'cancelled');assert.equal(engine.taskTest(queued.id).rawResponse,undefined);assert.deepEqual(engine.state().translations,before.translations);
  engine.importProject(threeSceneDemo);assert.equal(engine.state().project.id,threeSceneDemo.project.id);
 }finally{engine.close();}
});

test('legacy archived knowledge without a history array can be restored as a new audited version',()=>{
 const engine=create();try{engine.store.update(s=>{s.knowledge=[{id:'legacy',kind:'rule',title:'Original rule',content:'Original archived content',evidenceIds:['S0-01'],branch:'common',visibility:'translator',archived:true}];});const restored=engine.rollbackKnowledge('legacy',{version:1,expectedVersion:1});assert.equal(restored.archived,false);assert.equal(restored.version,2);assert.equal(restored.history!.length,2);assert.equal(restored.content,'Original archived content');assert.deepEqual((engine.previewTask({stage:'translate',unitIds:['S0-01']}).context.knowledge as any[]).map(k=>k.id),['legacy']);}finally{engine.close();}
});

test('mixed-scope dialogue in one common group keeps branch knowledge and earlier translations target-specific',async()=>{
 const engine=create();try{engine.importProject(threeSceneDemo);engine.requestRun({kind:'pipeline'});await engine.drain();
  const shortcut=engine.previewTask({stage:'review',groupId:'demo-report',unitIds:['relay-20']});assert.ok(!(shortcut.context.previousTranslations as any[]).some(item=>item.unitId==='relay-19'));assert.ok(!(shortcut.context.knowledge as any[]).some(item=>item.title==='기록실에서 확인한 증거'));
  const archive=engine.previewTask({stage:'review',groupId:'demo-report',unitIds:['relay-19']});const evidence=(archive.context.knowledge as any[]).find(item=>item.title==='기록실에서 확인한 증거');assert.ok(evidence);assert.deepEqual(evidence.applicableUnitIds,['relay-19']);assert.ok((archive.context.previousTranslations as any[]).some(item=>item.branch==='archive'));
  const join=engine.previewTask({stage:'review',groupId:'demo-report',unitIds:['relay-21']});assert.ok((join.context.previousTranslations as any[]).every(item=>item.branch==='common'));
  const mixed=engine.previewTask({stage:'review',groupId:'demo-report',unitIds:['relay-19','relay-20']});assert.deepEqual((mixed.context.knowledge as any[]).find(item=>item.title==='기록실에서 확인한 증거').applicableUnitIds,['relay-19']);assert.deepEqual(mixed.context.targetBranches,['archive','shortcut']);
 }finally{engine.close();}
});

test('provider-side schema rejection remains a failed machine validation in the isolated test record',async()=>{
 const engine=create(async()=>{throw new ProviderError('schema-mismatch','Synthetic schema mismatch');});try{live(engine);const task=engine.testProfile({stage:'translate',unitIds:['S0-01']});await engine.waitForTaskTests();const result=engine.taskTest(task.id);assert.equal(result.status,'failed');assert.deepEqual(result.validation,{ok:false,issues:[{code:'schema-mismatch',message:'Synthetic schema mismatch'}]});assert.equal(engine.state().translations['S0-01'].text,'');}finally{engine.close();}
});

test('archive-scoped knowledge records only matching consumers and never stales the shortcut through usage',async()=>{
 const engine=create();try{engine.importProject(threeSceneDemo);engine.requestRun({kind:'pipeline'});await engine.drain();const before=engine.state(),evidence=before.knowledge.find(item=>!item.archived&&item.title==='기록실에서 확인한 증거')!;assert.ok(evidence.usedUnitIds!.includes('relay-19'));assert.ok(!evidence.usedUnitIds!.includes('relay-20'));assert.ok(evidence.usedUnitIds!.every(uid=>before.units.find(unit=>unit.id===uid)?.branch==='archive'));
  engine.updateKnowledge(evidence.id,{content:'녹음의 화자는 여전히 미확인이다.',expectedVersion:evidence.version??1});const after=engine.state();assert.equal(after.translations['relay-19'].freshness,'stale');assert.deepEqual(after.translations['relay-20'],before.translations['relay-20']);
 }finally{engine.close();}
});

test('an in-flight archive knowledge change discards only matching branch responses in a mixed batch',async()=>{
 let release!:(value:ProviderResult)=>void,request!:ProviderRequest;const engine=create(async value=>{request=value;return new Promise(resolve=>{release=resolve;});});
 try{engine.importProject(threeSceneDemo);live(engine);engine.requestRun({kind:'translate',groupId:'demo-report'});const pending=engine.tick();assert.ok(release);engine.updateKnowledge('relay-recording',{content:'수정된 기록실 근거',expectedVersion:1});release({data:{translations:(request.context!.targets as {id:string}[]).map(unit=>({unitId:unit.id,text:threeSceneDemoTranslations[unit.id],issues:[]}))}});await pending;const state=engine.state();assert.equal(state.translations['relay-19'].text,'');assert.equal(state.translations['relay-19'].freshness,'stale');assert.equal(state.translations['relay-20'].text,threeSceneDemoTranslations['relay-20']);assert.equal(state.translations['relay-20'].freshness,'current');}finally{engine.close();}
});
