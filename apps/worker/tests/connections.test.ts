import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '@workbench/core';
import {Connections} from '../src/connections.ts';
import {CredentialStore} from '../src/credentials.ts';
import type {ProviderRequest,ProviderResult} from '@workbench/providers';

async function fixture(invoke?: (request:ProviderRequest)=>Promise<ProviderResult>){
 const dir=await mkdtemp(join(tmpdir(),'workbench-connections-test-'));
 const codec={protect:async(value:string)=>'fake-encrypted:'+Buffer.from(value).toString('base64'),unprotect:async(value:string)=>Buffer.from(value.slice(15),'base64').toString('utf8')};
 const credentials=new CredentialStore(join(dir,'synthetic-keys.json'),codec);
 const engine=new Engine(dir,{memory:true,autoStart:false,demoDelayMs:0,invoke});
 const validationCalls:unknown[]=[];
 const connections=new Connections(engine,credentials,{validateSettings:value=>{validationCalls.push(value);}});
 return {dir,codec,credentials,engine,connections,validationCalls,cleanup:async()=>{engine.close();await rm(dir,{recursive:true,force:true});}};
}
const conflict=(error:unknown)=>!!error&&typeof error==='object'&&'status' in error&&error.status===409;
const first={name:'Primary API',baseUrl:'https://first.example/v1',apiKey:'synthetic-first-key'};
const second={name:'Review API',baseUrl:'https://second.example/v1',apiKey:'synthetic-second-key'};

test('Mac LAN endpoint supports optional keys, scoped credential storage and editing',async()=>{
 const f=await fixture();try{
  const lan=(await f.connections.create({name:'Mac LLM',baseUrl:'http://192.168.0.36/v1',allowUnauthenticated:true})).connection;
  assert.equal(lan.allowUnauthenticated,true);assert.equal(f.credentials.get(lan),undefined);
  const renamed=(await f.connections.patch(lan.id,{name:'Mac'})).connection;
  assert.equal(renamed.allowUnauthenticated,true);
  const secured=(await f.connections.patch(lan.id,{apiKey:'synthetic-lan-key'})).connection;
  assert.equal(secured.allowUnauthenticated,false);assert.equal(f.credentials.get(secured),'synthetic-lan-key');
  await assert.rejects(f.connections.patch(lan.id,{baseUrl:'http://192.168.0.36.example.com/v1',apiKey:'synthetic-lan-key'}),/HTTPS/);
  const noKey=(await f.connections.patch(lan.id,{allowUnauthenticated:true})).connection;
  assert.equal(f.credentials.get(noKey),undefined);
  await f.connections.remove(lan.id);
 }finally{await f.cleanup();}
});

test('fallback assignments and captured fallback runs protect their endpoint and credential',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create(first)).connection,b=(await f.connections.create(second)).connection;
  const state=f.engine.state(),profile={...state.profiles.translate,connectionId:a.id,model:'primary',fallbacks:[{connectionId:b.id,model:'backup',effort:'',timeoutMs:1000,maxOutputTokens:1000,maxAttempts:1}]};
  f.engine.updateProfile('translate',profile);
  await assert.rejects(f.connections.remove(b.id),conflict);
  const run=f.engine.requestRun({kind:'translate',stage:'translate',unitIds:['S0-01']});
  f.engine.updateProfile('translate',{...profile,fallbacks:[]});
  await assert.rejects(f.connections.patch(b.id,{name:'Cannot change captured endpoint'}),conflict);
  await assert.rejects(f.connections.remove(b.id),conflict);
  assert.equal(f.credentials.get(b),second.apiKey);
  f.engine.control(run.id,'cancel');await f.connections.remove(b.id);
  assert.ok(!f.engine.state().connections.some(c=>c.id===b.id));
 }finally{await f.cleanup();}
});

test('two named endpoints retain independent URLs, keys and per-stage assignments without exposing secrets',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create(first)).connection,b=(await f.connections.create(second)).connection;
  assert.notEqual(a.id,b.id);assert.equal(a.name,first.name);assert.equal(b.name,second.name);
  assert.equal(a.baseUrl,first.baseUrl);assert.equal(b.baseUrl,second.baseUrl);
  assert.equal(f.credentials.get(a),first.apiKey);assert.equal(f.credentials.get(b),second.apiKey);
  const state=f.engine.state();state.profiles.translate={...state.profiles.translate,connectionId:a.id,model:'translator'};state.profiles.review={...state.profiles.review,connectionId:b.id,model:'reviewer'};
  await f.connections.settings({connections:state.connections,profiles:state.profiles});
  assert.equal(f.engine.state().profiles.translate.connectionId,a.id);assert.equal(f.engine.state().profiles.review.connectionId,b.id);
  assert.equal(f.validationCalls.length,1);
  const publicData=JSON.stringify({state:f.engine.state(),export:f.engine.exportProject()});
  for(const key of [first.apiKey,second.apiKey])assert.ok(!publicData.includes(key));
 }finally{await f.cleanup();}
});

test('Claude registration is idempotent metadata only and never writes an API credential',async()=>{
 const f=await fixture();try{
  const before=f.engine.state();
  const [first,second]=await Promise.all([f.connections.create({kind:'claude',name:'Claude Code'}),f.connections.create({kind:'claude',name:'Claude Code'})]);
  assert.equal(first.connection.id,second.connection.id);assert.equal(first.connection.kind,'claude');assert.equal(first.connection.executable,'claude');
  assert.equal(f.engine.state().connections.filter(c=>c.kind==='claude').length,1);
  for(const [stage,profile] of Object.entries(before.profiles))assert.deepEqual({...f.engine.state().profiles[stage as keyof typeof before.profiles],promptVersion:undefined},{...profile,promptVersion:undefined});assert.equal(f.credentials.has(first.connection),false);
  await assert.rejects(f.connections.create({kind:'claude',apiKey:'synthetic-not-allowed'}),/CLI/);
  await assert.rejects(f.connections.create({kind:'claude',baseUrl:'https://not-a-cli.example'}),/CLI/);
 }finally{await f.cleanup();}
});

test('a profile trial leases its captured endpoint until completed or cancelled',async()=>{
 let resolve!:(result:ProviderResult)=>void;
 const pending=new Promise<ProviderResult>(done=>{resolve=done;});
 const f=await fixture(()=>pending);try{
  const c=(await f.connections.create(first)).connection,state=f.engine.state();
  const trial=f.engine.testProfile({stage:'translate',unitIds:[state.units[0].id],profile:{...state.profiles.translate,connectionId:c.id,model:'synthetic',effort:''}});
  assert.equal(trial.capturedProfile.connectionId,c.id);
  await assert.rejects(f.connections.patch(c.id,{name:'Busy'}),conflict);
  await assert.rejects(f.connections.saveKey(c.id,'synthetic-replacement'),conflict);
  await assert.rejects(f.connections.removeKey(c.id),conflict);
  await assert.rejects(f.connections.remove(c.id),conflict);
  assert.equal(f.credentials.get(c),first.apiKey);
  f.engine.cancelTaskTest(trial.id);resolve({data:{translations:[]}});await f.engine.waitForTaskTests();
  await f.connections.remove(c.id);assert.equal(f.credentials.has(c),false);
 }finally{resolve({data:{translations:[]}});await f.engine.waitForTaskTests();await f.cleanup();}
});

test('editing name preserves the key and editing/removing one endpoint leaves the other untouched',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create(first)).connection,b=(await f.connections.create(second)).connection;
  const renamed=(await f.connections.patch(a.id,{name:'Renamed primary'})).connection;
  assert.equal(renamed.id,a.id);assert.equal(renamed.name,'Renamed primary');assert.equal(f.credentials.get(renamed),first.apiKey);
  await f.connections.saveKey(a.id,'synthetic-replacement-key');assert.equal(f.credentials.get(renamed),'synthetic-replacement-key');
  assert.equal(f.credentials.get(b),second.apiKey);
  await f.connections.remove(a.id);
  assert.ok(!f.engine.state().connections.some(c=>c.id===a.id));assert.equal(f.credentials.get(a),undefined);
  assert.deepEqual(f.engine.state().connections.find(c=>c.id===b.id),b);assert.equal(f.credentials.get(b),second.apiKey);
 }finally{await f.cleanup();}
});

test('URL changes require a new key and preserve the old binding on rejection',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create(first)).connection;
  await assert.rejects(f.connections.patch(a.id,{baseUrl:'https://changed.example/v1'}),conflict);
  assert.equal(f.engine.state().connections.find(c=>c.id===a.id)?.baseUrl,a.baseUrl);assert.equal(f.credentials.get(a),first.apiKey);
  const changed=(await f.connections.patch(a.id,{baseUrl:'https://changed.example/v1',apiKey:'synthetic-new-host-key'})).connection;
  assert.equal(changed.id,a.id);assert.equal(f.credentials.get(a),undefined);assert.equal(f.credentials.get(changed),'synthetic-new-host-key');
 }finally{await f.cleanup();}
});

test('an assigned endpoint cannot be deleted, preserving metadata and encrypted credential',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create(first)).connection,state=f.engine.state();
  state.profiles.review={...state.profiles.review,connectionId:a.id};await f.connections.settings({connections:state.connections,profiles:state.profiles});
  await assert.rejects(f.connections.remove(a.id),conflict);assert.ok(f.engine.state().connections.some(c=>c.id===a.id));assert.equal(f.credentials.get(a),first.apiKey);
 }finally{await f.cleanup();}
});

test('an active run retains endpoint protection after current profile assignments change',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create(first)).connection,state=f.engine.state(),original=structuredClone(state.profiles);
  state.profiles.translate={...state.profiles.translate,connectionId:a.id,model:'fake-translator'};await f.connections.settings({connections:state.connections,profiles:state.profiles});
  const run=f.engine.requestRun({kind:'translate'});assert.equal(run.status,'queued');
  await f.connections.settings({connections:f.engine.state().connections,profiles:original});
  await assert.rejects(f.connections.remove(a.id),conflict);
  await assert.rejects(f.connections.patch(a.id,{name:'Cannot change active endpoint'}),conflict);
  await assert.rejects(f.connections.removeKey(a.id),conflict);
  await assert.rejects(f.connections.saveKey(a.id,'synthetic-active-replacement'),conflict);
  assert.equal(f.credentials.get(a),first.apiKey);
  f.engine.control(run.id,'cancel');await f.connections.remove(a.id);assert.equal(f.credentials.get(a),undefined);
 }finally{await f.cleanup();}
});

test('local unauthenticated endpoint policy persists and remote unauthenticated endpoints are rejected',async()=>{
 const f=await fixture();try{
  const local=(await f.connections.create({name:'Local model',baseUrl:'http://127.0.0.1:8080/v1',allowUnauthenticated:true})).connection;
  assert.equal(local.allowUnauthenticated,true);assert.equal(f.engine.state().connections.find(c=>c.id===local.id)?.allowUnauthenticated,true);
  assert.equal(f.credentials.get(local),undefined);
  const renamed=(await f.connections.patch(local.id,{name:'Local renamed'})).connection;assert.equal(renamed.allowUnauthenticated,true);
  await assert.rejects(f.connections.create({name:'Remote',baseUrl:'https://remote.example/v1',allowUnauthenticated:true}),/로컬/);
  await assert.rejects(f.connections.create({name:'Remote missing key',baseUrl:'https://remote.example/v1'}),/API 키/);
  await assert.rejects(f.connections.patch(local.id,{baseUrl:'https://remote.example/v1',allowUnauthenticated:true}),/로컬/);
  assert.equal(f.engine.state().connections.find(c=>c.id===local.id)?.baseUrl,local.baseUrl);
  await assert.rejects(f.connections.patch(local.id,{baseUrl:'https://remote.example/v1'}),conflict);
  const remote=(await f.connections.patch(local.id,{baseUrl:'https://remote.example/v1',apiKey:'synthetic-migration-key'})).connection;
  assert.equal(remote.allowUnauthenticated,false);assert.equal(f.credentials.get(remote),'synthetic-migration-key');
 }finally{await f.cleanup();}
});

test('concurrent additions never lose either endpoint or associate their keys with the wrong ID',async()=>{
 const f=await fixture();try{
  const initial=f.engine.state().connections.length;
  const [a,b]=await Promise.all([f.connections.create(first),f.connections.create(second)]);
  assert.equal(f.engine.state().connections.length,initial+2);
  assert.equal(f.credentials.get(a.connection),first.apiKey);assert.equal(f.credentials.get(b.connection),second.apiKey);
  assert.ok(f.engine.state().connections.some(c=>c.id===a.connection.id));assert.ok(f.engine.state().connections.some(c=>c.id===b.connection.id));
  const reload=new CredentialStore(join(f.dir,'synthetic-keys.json'),f.codec);await reload.load();
  assert.equal(reload.get(a.connection),first.apiKey);assert.equal(reload.get(b.connection),second.apiKey);
 }finally{await f.cleanup();}
});

test('SystemOne CRUD preserves separate encrypted keys, canonical URLs and provider identity',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create({kind:'systemone',name:'TypeSafe review',apiKey:'synthetic-typesafe-a'})).connection;
  const b=(await f.connections.create({kind:'systemone',name:'TypeSafe judgment',baseUrl:'https://api.typesafe.ai/v1/',apiKey:'synthetic-typesafe-b'})).connection;
  const general=(await f.connections.create(first)).connection;
  assert.equal(a.kind,'systemone');assert.equal(a.baseUrl,'https://api.typesafe.ai/v1');assert.equal(a.apiMode,undefined);
  assert.equal(b.baseUrl,a.baseUrl);assert.notEqual(a.id,b.id);
  assert.equal(f.credentials.get(a),'synthetic-typesafe-a');assert.equal(f.credentials.get(b),'synthetic-typesafe-b');assert.equal(f.credentials.get(general),first.apiKey);
  const renamed=(await f.connections.patch(a.id,{name:'Renamed TypeSafe'})).connection;
  assert.equal(renamed.kind,'systemone');assert.equal(f.credentials.get(renamed),'synthetic-typesafe-a');
  await assert.rejects(f.connections.patch(a.id,{kind:'openai'}),conflict);
  await f.connections.saveKey(a.id,'synthetic-typesafe-rotated');assert.equal(f.credentials.get(renamed),'synthetic-typesafe-rotated');
  const reload=new CredentialStore(join(f.dir,'synthetic-keys.json'),f.codec);await reload.load();
  assert.equal(reload.get(renamed),'synthetic-typesafe-rotated');assert.equal(reload.get(b),'synthetic-typesafe-b');
  const publicData=JSON.stringify({state:f.engine.state(),export:f.engine.exportProject()});
  for(const key of ['synthetic-typesafe-a','synthetic-typesafe-b','synthetic-typesafe-rotated'])assert.ok(!publicData.includes(key));
  await f.connections.removeKey(a.id);assert.equal(f.credentials.get(renamed),undefined);assert.equal(f.credentials.get(b),'synthetic-typesafe-b');
  await f.connections.remove(a.id);assert.ok(!f.engine.state().connections.some(c=>c.id===a.id));assert.equal(f.credentials.get(b),'synthetic-typesafe-b');
 }finally{await f.cleanup();}
});

test('SystemOne endpoint changes are guarded and local fake endpoints still require an independent key',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create({kind:'systemone',name:'TypeSafe',apiKey:'synthetic-typesafe-original'})).connection;
  await assert.rejects(f.connections.patch(a.id,{baseUrl:'http://127.0.0.1:9091/fake/v1'}),conflict);
  assert.equal(f.credentials.get(a),'synthetic-typesafe-original');
  for(const baseUrl of ['http://other.example/v1','http://api.typesafe.ai/v1','https://api.typesafe.ai/v1?key=bad','https://user:password@api.typesafe.ai/v1']){
   await assert.rejects(f.connections.patch(a.id,{baseUrl,apiKey:'synthetic-unaccepted-key'}),/HTTPS/);
  }
  await assert.rejects(f.connections.create({kind:'systemone',name:'Missing key'}),/API 키/);
  await assert.rejects(f.connections.create({kind:'systemone',name:'No auth',baseUrl:'http://localhost:9091/v1',allowUnauthenticated:true}),/API 키/);
  const local=(await f.connections.patch(a.id,{baseUrl:'http://127.0.0.1:9091/fake/v1/',apiKey:'synthetic-local-typesafe-key'})).connection;
  assert.equal(local.baseUrl,'http://127.0.0.1:9091/fake/v1');assert.equal(local.kind,'systemone');
  assert.equal(f.credentials.get(a),undefined);assert.equal(f.credentials.get(local),'synthetic-local-typesafe-key');
  await assert.rejects(f.connections.patch(a.id,{baseUrl:'https://custom-systemone.example/api'}),conflict);
  const remote=(await f.connections.patch(a.id,{baseUrl:'https://custom-systemone.example/api/',apiKey:'synthetic-custom-host-key'})).connection;
  assert.equal(remote.baseUrl,'https://custom-systemone.example/api');assert.equal(remote.kind,'systemone');assert.equal(f.credentials.get(local),undefined);assert.equal(f.credentials.get(remote),'synthetic-custom-host-key');
 }finally{await f.cleanup();}
});

test('SystemOne metadata cannot bypass endpoint CRUD and assigned endpoints cannot be removed',async()=>{
 const f=await fixture();try{
  const a=(await f.connections.create({kind:'systemone',name:'TypeSafe',apiKey:'synthetic-typesafe'})).connection;
  const state=f.engine.state();
  for(const altered of [state.connections.filter(c=>c.id!==a.id),state.connections.map(c=>c.id===a.id?{...c,kind:'openai' as const}:c),state.connections.map(c=>c.id===a.id?{...c,baseUrl:'http://localhost:9000/v1'}:c),[...state.connections,{...a,id:'bypass-endpoint'}]]){
   await assert.rejects(f.connections.settings({connections:altered,profiles:state.profiles}),conflict);
  }
  state.profiles.review={...state.profiles.review,connectionId:a.id,model:'synthetic-listed-model'};
  await f.connections.settings({connections:state.connections,profiles:state.profiles});
  await assert.rejects(f.connections.remove(a.id),conflict);assert.equal(f.credentials.get(a),'synthetic-typesafe');
 }finally{await f.cleanup();}
});
