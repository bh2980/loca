import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Connection} from '@workbench/contracts';
import type {AuthState,LoginOptions} from '@workbench/providers';
import {Accounts} from '../src/accounts.ts';
import {CredentialStore} from '../src/credentials.ts';
import type {TerminalLoginRequest} from '../src/terminal-login.ts';

function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let i=0;i<100&&!check();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(check(),'expected fake operation to start');}
const connection=(kind:Connection['kind']='grok',id='cli'):Connection=>({id,kind,name:kind});
const auth=(c:Connection,state:AuthState['state']='signed-in'):AuthState=>({connectionId:c.id,state,detail:'synthetic auth result',checkedAt:'2000-01-01T00:00:00Z',methods:c.kind==='antigravity'?['terminal']:['browser','device-code']});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'workbench-account-test-'));
 const jobs:{connection:Connection;options:LoginOptions;done:ReturnType<typeof deferred<AuthState>>}[]=[];
 const terminals:{request:TerminalLoginRequest;done:ReturnType<typeof deferred<void>>}[]=[];
 const inspected:Connection[]=[];
 const store=new CredentialStore(join(dir,'unused-credentials.json'),{protect:async()=>{throw new Error('No keys expected');},unprotect:async()=>{throw new Error('No keys expected');}});
 const accounts=new Accounts(store,dir,{
  inspectAuth:async c=>{inspected.push(c);return auth(c,'unknown');},
  startLogin:(c,options)=>{const done=deferred<AuthState>();jobs.push({connection:c as Connection,options,done});options.onUpdate({id:options.attemptId,connectionId:c.id,state:'waiting',message:'fake waiting',authUrl:'https://grok.com/fake-login'});return done.promise;},
  resolveCli:async()=>({executable:'C:\\fake\\agy.exe',prefixArgs:[]}),
  runTerminalLogin:request=>{const done=deferred<void>();terminals.push({request,done});request.onOpened(12345);return done.promise;},
 });
 return {accounts,jobs,terminals,inspected,cleanup:async()=>{for(const job of jobs)job.done.resolve(auth(job.connection));for(const terminal of terminals)terminal.done.resolve();await accounts.close();await rm(dir,{recursive:true,force:true});}};
}

test('same provider stays leased during asynchronous cancellation, then can start again',async()=>{
 const f=await fixture();try{
  const c=connection();f.accounts.start(c,'browser');
  let completed=false;const cancellation=f.accounts.cancel(c.id).then(()=>{completed=true;});
  assert.equal(f.jobs[0].options.signal?.aborted,true);
  assert.throws(()=>f.accounts.start(connection('grok','another'),'browser'),/종료되기를/);
  assert.throws(()=>f.accounts.start(c,'browser'),/종료되기를/);
  await tick();assert.equal(completed,false,'cancel waits for actual fake process completion');
  f.jobs[0].done.resolve(auth(c,'unknown'));await cancellation;
  assert.equal(f.accounts.get(c)?.state,'cancelled');
  const next=f.accounts.start(c,'browser');assert.notEqual(next.id,f.jobs[0].options.attemptId);
  assert.equal(f.jobs.length,2);
 }finally{await f.cleanup();}
});

test('Claude uses browser authentication and shares the same cancellation lease protection',async()=>{
 const f=await fixture();try{
  const c=connection('claude');
  assert.throws(()=>f.accounts.start(c,'device-code'),/지원하지/);assert.throws(()=>f.accounts.start(c,'terminal'),/지원하지/);
  f.accounts.start(c,'browser');assert.equal(f.jobs[0].connection.kind,'claude');
  assert.equal((await f.accounts.status(c)).state,'pending');
  const cancellation=f.accounts.cancel(c.id);assert.equal(f.jobs[0].options.signal?.aborted,true);
  assert.throws(()=>f.accounts.start(connection('claude','other'),'browser'),/종료되기를/);
  f.jobs[0].done.resolve(auth(c,'unknown'));await cancellation;
  assert.equal(f.accounts.get(c)?.state,'cancelled');assert.equal(f.terminals.length,0);
 }finally{await f.cleanup();}
});

test('running login blocks deletion or identity changes, but allows unrelated settings',async()=>{
 const f=await fixture();try{
  const c=connection('codex');f.accounts.start(c,'browser');
  assert.throws(()=>f.accounts.validateSettings([]),/로그인 창을 닫은 뒤/);
  assert.throws(()=>f.accounts.validateSettings([{...c,kind:'grok'}]),/로그인 창을 닫은 뒤/);
  assert.throws(()=>f.accounts.validateSettings([{...c,executable:'C:\\other.exe'}]),/로그인 창을 닫은 뒤/);
  assert.doesNotThrow(()=>f.accounts.validateSettings([{...c,name:'new label'},connection('grok','other')]));
  const cancelling=f.accounts.cancel(c.id);
  assert.throws(()=>f.accounts.validateSettings([]),/로그인 창을 닫은 뒤/);
  f.jobs[0].done.resolve(auth(c,'unknown'));await cancelling;
  assert.doesNotThrow(()=>f.accounts.validateSettings([]));
  assert.equal(f.accounts.get({...c,kind:'grok'}),null);
  assert.equal(f.accounts.get({...c,executable:'C:\\other.exe'}),null);
 }finally{await f.cleanup();}
});

test('Grok cache only describes the matching login identity, never a reused Codex ID',async()=>{
 const f=await fixture();try{
  const codex=connection('codex');f.accounts.start(codex,'browser');f.jobs[0].done.resolve(auth(codex));await tick();
  const grok=connection('grok');assert.equal((await f.accounts.status(grok)).state,'unknown');
  assert.equal(f.inspected.length,1);assert.equal(f.accounts.get(grok),null);
  f.accounts.start(grok,'browser');f.jobs[1].done.resolve(auth(grok));await tick();
  assert.equal((await f.accounts.status(grok)).state,'signed-in');assert.equal(f.inspected.length,1);
  assert.equal((await f.accounts.status({...grok,executable:'C:\\different.exe'})).state,'unknown');
  assert.equal(f.inspected.length,2);
 }finally{await f.cleanup();}
});

test('shutdown aborts pending operations and waits for every owned process to settle',async()=>{
 const f=await fixture();try{
  f.accounts.start(connection('codex','one'),'browser');f.accounts.start(connection('grok','two'),'browser');
  let closed=false;const closing=f.accounts.close().then(()=>{closed=true;});
  assert.ok(f.jobs.every(job=>job.options.signal?.aborted));
  f.jobs[0].done.resolve(auth(f.jobs[0].connection,'unknown'));await tick();assert.equal(closed,false);
  f.jobs[1].done.resolve(auth(f.jobs[1].connection,'unknown'));await closing;assert.equal(closed,true);
 }finally{await f.cleanup();}
});

test('Antigravity window closure stays finished and unknown, never authenticated',async()=>{
 const f=await fixture();try{
  const c=connection('antigravity');f.accounts.start(c,'terminal');await until(()=>f.terminals.length===1);
  assert.equal(f.accounts.get(c)?.state,'waiting');
  f.terminals[0].done.resolve();await tick();
  assert.equal(f.accounts.get(c)?.state,'finished');assert.equal((await f.accounts.status(c)).state,'unknown');
  assert.equal(f.accounts.get({...c,kind:'grok'}),null);
 }finally{await f.cleanup();}
});

test('unconfirmed terminal cancellation keeps its service lease instead of opening another window',async()=>{
 const f=await fixture();try{
  const c=connection('antigravity');f.accounts.start(c,'terminal');await until(()=>f.terminals.length===1);
  const cancellation=f.accounts.cancel(c.id);assert.equal(f.terminals[0].request.signal?.aborted,true);
  f.terminals[0].done.reject(new Error('synthetic tree kill failure'));await cancellation;
  assert.equal(f.accounts.get(c)?.state,'failed');
  assert.throws(()=>f.accounts.start(connection('antigravity','another'),'terminal'),/종료되기를/);
  assert.throws(()=>f.accounts.validateSettings([]),/로그인 창을 닫은 뒤/);
 }finally{await f.cleanup();}
});

test('SystemOne account status describes saved keys without calling login, auth inspection or exposing credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workbench-systemone-account-test-'));
 const c:Connection={id:'typesafe',kind:'systemone',name:'TypeSafe',baseUrl:'https://api.typesafe.ai/v1'};
 const key='synthetic-typesafe-account-secret';
 const codec={protect:async(value:string)=>'fake:'+Buffer.from(value).toString('base64'),unprotect:async(value:string)=>Buffer.from(value.slice(5),'base64').toString('utf8')};
 const store=new CredentialStore(join(dir,'synthetic-keys.json'),codec);
 const accounts=new Accounts(store,dir,{inspectAuth:async()=>{throw new Error('API keys must not use CLI auth');},startLogin:async()=>{throw new Error('API keys must not launch login');}});
 try{
  const missing=await accounts.status(c);assert.equal(missing.state,'signed-out');assert.deepEqual(missing.methods,[]);
  await store.save(c,key);const configured=await accounts.status(c);
  assert.equal(configured.state,'configured');assert.deepEqual(configured.methods,[]);assert.ok(!JSON.stringify(configured).includes(key));
  assert.throws(()=>accounts.start(c,'browser'),/API 키/);assert.equal(accounts.get(c),null);
  await store.remove(c.id);assert.equal((await accounts.status(c)).state,'signed-out');
 }finally{await accounts.close();await rm(dir,{recursive:true,force:true});}
});
