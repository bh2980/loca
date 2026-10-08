import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import {isTransientProviderFailure} from '../src/fallback.ts';
import {demoTranslations} from '../src/fixture.ts';
import {ProviderError,type ProviderRequest,type ProviderResult} from '@workbench/providers';
import type {ExecutionProfile,ModelRoute} from '@workbench/contracts';

const route=(connectionId:string,model=connectionId,maxAttempts=1):ModelRoute=>({connectionId,model,effort:'',timeoutMs:1000,maxOutputTokens:1000,maxAttempts});
const response=():ProviderResult=>({data:{translations:[{unitId:'S0-01',text:demoTranslations['S0-01'],issues:[]}]},reportedModel:'reported-alternative'});
function configure(engine:Engine){
 const s=engine.state();
 engine.updateSettings({connections:[...s.connections,...['primary','second','third'].map(id=>({id,name:id,kind:'openai' as const,baseUrl:'http://127.0.0.1:1/v1',allowUnauthenticated:true}))],profiles:{...s.profiles,translate:{...route('primary','primary',2),fallbacks:[route('second'),route('third')],prompt:'Keep the saved stage instruction.'}}});
}
const run=(engine:Engine)=>engine.requestRun({kind:'translate',stage:'translate',unitIds:['S0-01']});

test('ordered fallback exhausts each retry budget and records actual model, source and snapshots',async()=>{
 const calls:ProviderRequest[]=[];
 const engine=new Engine('unused',{memory:true,autoStart:false,invoke:async request=>{
  calls.push(request);
  if(request.profile.model==='primary')throw new ProviderError('api-http-error','API HTTP 429');
  if(request.profile.model==='second')throw new ProviderError('timeout','제한 시간 초과');
  return response();
 }});
 try{
  configure(engine);const queued=run(engine);
  // A settings edit cannot replace the chain captured by a queued run.
  engine.updateProfile('translate',{...route('primary','changed'),fallbacks:[]});
  await engine.drain();const s=engine.state(),step=s.runs[0].steps[0];
  assert.equal(s.runs[0].id,queued.id);assert.equal(s.runs[0].status,'completed');
  assert.deepEqual(calls.map(c=>c.profile.model),['primary','primary','second','third']);
  assert.ok(calls.every(c=>c.prompt.includes('Keep the saved stage instruction.')));
  assert.equal(step.attempts,4);assert.equal(step.routeIndex,2);assert.equal(step.attemptHistory?.length,4);
  assert.deepEqual(step.attemptHistory?.map(a=>a.status),['failed','failed','failed','completed']);
  for(const [index,attempt] of step.attemptHistory!.entries()){
   const snapshot=engine.taskSnapshot(attempt.snapshotId!);assert.equal(snapshot.connection.id,calls[index].connection.id);
   assert.equal(snapshot.capturedProfile.model,calls[index].profile.model);assert.deepEqual(snapshot.unitIds,['S0-01']);
  }
  assert.equal(s.translations['S0-01'].execution?.model,'third');
  assert.equal(s.translations['S0-01'].execution?.connectionId,'third');
  assert.equal(s.translations['S0-01'].execution?.reportedModel,'reported-alternative');
  assert.equal(s.translations['S0-01'].version,1);
  assert.ok(s.changes?.some(c=>c.kind==='translation-created'&&c.model==='third'));
 }finally{engine.close();}
});

test('primary success never calls fallback; a trial tests only the explicitly selected primary',async()=>{
 let calls=0;const engine=new Engine('unused',{memory:true,autoStart:false,invoke:async()=>{calls++;return response();}});
 try{configure(engine);run(engine);await engine.drain();assert.equal(calls,1);assert.equal(engine.state().runs[0].steps[0].attemptHistory?.[0].routeIndex,0);}finally{engine.close();}
 const trialEngine=new Engine('unused',{memory:true,autoStart:false,invoke:async()=>{calls++;throw new ProviderError('timeout','timeout');}});
 try{configure(trialEngine);const before=trialEngine.state().translations;const trial=trialEngine.testProfile({stage:'translate',unitIds:['S0-01']});await trialEngine.waitForTaskTests();assert.equal(calls,2);assert.equal(trialEngine.taskTest(trial.id).status,'failed');assert.deepEqual(trialEngine.state().translations,before);}finally{trialEngine.close();}
});

test('authentication, cancellation, unknown CLI failure and invalid output do not trigger fallback',async()=>{
 for(const failure of [new ProviderError('api-http-error','API HTTP 401'),new ProviderError('cancelled','cancelled'),new ProviderError('cli-failed','CLI exit 1'),new ProviderError('invalid-json','invalid model text: HTTP 429'),new ProviderError('unsupported-effort','unsupported')]){
  let calls=0;const engine=new Engine('unused',{memory:true,autoStart:false,invoke:async()=>{calls++;throw failure;}});
  try{configure(engine);run(engine);await engine.drain();assert.equal(calls,1,failure.code);assert.equal(engine.state().runs[0].status,'failed');assert.equal(engine.state().translations['S0-01'].text,'');}finally{engine.close();}
 }
 let calls=0;const engine=new Engine('unused',{memory:true,autoStart:false,invoke:async()=>{calls++;return {data:{translations:[{unitId:'wrong',text:'wrong',issues:[]}]}};}});
 try{configure(engine);run(engine);await engine.drain();assert.equal(calls,1);assert.equal(engine.state().runs[0].status,'failed');}finally{engine.close();}
});

test('all alternatives failing stop finitely without applying translations',async()=>{
 let calls=0;const engine=new Engine('unused',{memory:true,autoStart:false,invoke:async()=>{calls++;throw new ProviderError('timeout','timeout');}});
 try{configure(engine);run(engine);await engine.drain();assert.equal(calls,4);assert.equal(engine.state().runs[0].status,'failed');assert.equal(engine.state().translations['S0-01'].version,0);}finally{engine.close();}
});

test('pause and restart preserve next route, while cancel prevents another attempt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-fallback-test-'));let engine:Engine|undefined;
 try{
  engine=new Engine(dir,{autoStart:false,invoke:async()=>{throw new ProviderError('timeout','timeout');}});configure(engine);
  const queued=run(engine);await engine.tick();await engine.tick();engine.control(queued.id,'pause');await engine.tick();
  assert.equal(engine.state().runs[0].steps[0].routeIndex,1);engine.close();
  const called:string[]=[];engine=new Engine(dir,{autoStart:false,invoke:async request=>{called.push(request.profile.model);return response();}});
  assert.equal(engine.state().runs[0].status,'paused');engine.control(queued.id,'resume');await engine.drain();assert.deepEqual(called,['second']);
  const next=run(engine);engine.control(next.id,'cancel');await engine.tick();assert.deepEqual(called,['second']);
 }finally{engine?.close();rmSync(dir,{recursive:true,force:true});}
});

test('in-flight cancellation never starts fallback or applies a late response',async()=>{
 let reject!:(e:Error)=>void,calls=0;
 const engine=new Engine('unused',{memory:true,autoStart:false,invoke:()=>{calls++;return new Promise((_,no)=>{reject=no;});}});
 try{configure(engine);const queued=run(engine),pending=engine.tick();engine.control(queued.id,'cancel');reject(new ProviderError('timeout','timeout'));await pending;await engine.tick();assert.equal(calls,1);assert.equal(engine.state().runs[0].status,'cancelled');assert.equal(engine.state().runs[0].steps[0].attemptHistory?.[0].status,'cancelled');assert.equal(engine.state().translations['S0-01'].version,0);}finally{engine.close();}
});

test('fallback validation rejects unknown, duplicate, nested, mock and wrong-stage evaluator routes',()=>{
 const engine=new Engine('unused',{memory:true,autoStart:false});try{
  configure(engine);const original=engine.state().profiles.translate;
  for(const fallbacks of [[route('missing')],[route('primary')],[{...route('second'),fallbacks:[route('third')]}],[route('mock')],Array.from({length:4},(_,i)=>route('second',String(i)))]){
   assert.throws(()=>engine.updateProfile('translate',{...original,fallbacks} as ExecutionProfile));
  }
  assert.throws(()=>engine.updateProfile('translate',{...original,fallbacks:[{...route('second'),timeoutMs:0}]}));
  const s=engine.state();engine.updateSettings({connections:[...s.connections,{id:'judge',name:'Judge',kind:'systemone'}],profiles:s.profiles});
  assert.throws(()=>engine.updateProfile('translate',{...original,fallbacks:[route('judge')]}));
  assert.deepEqual(engine.state().profiles.translate,original);
 }finally{engine.close();}
 assert.equal(isTransientProviderFailure(new ProviderError('model-list-http-error','HTTP 503')),true);
 assert.equal(isTransientProviderFailure(new ProviderError('api-http-error','HTTP 403')),false);
});
