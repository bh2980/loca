import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {CredentialStore,windowsCodec,credentialEndpoint} from '../src/credentials.ts';
import type {Connection} from '@workbench/contracts';

const connection:Connection={id:'api',kind:'openai',name:'Test',baseUrl:'https://example.com/v1'};
test('SystemOne credential binding supports explicit HTTPS hosts and local HTTP test endpoints',()=>{
 const systemone:Connection={id:'typesafe',kind:'systemone',name:'TypeSafe',baseUrl:'https://api.typesafe.ai/v1/'};
 assert.equal(credentialEndpoint(systemone),'https://api.typesafe.ai/v1');
 for(const baseUrl of ['http://127.0.0.1:9000/v1/','https://localhost:9000/fake/v1/','http://[::1]:9000/v1/','https://custom-systemone.example/api/','https://api.typesafe.ai:9443/v1/'])assert.equal(credentialEndpoint({...systemone,baseUrl}),baseUrl.slice(0,-1));
 for(const baseUrl of ['http://remote.example/v1','http://api.typesafe.ai/v1','https://api.typesafe.ai/v1?key=secret','https://api.typesafe.ai/v1#secret','https://user:secret@api.typesafe.ai/v1'])assert.throws(()=>credentialEndpoint({...systemone,baseUrl}));
});
test('API keys persist encrypted, are scoped to endpoint and never attached to connection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workbench-credential-test-'));
 const codec={protect:async(value:string)=>'encrypted:'+Buffer.from(value).toString('base64'),unprotect:async(value:string)=>Buffer.from(value.slice(10),'base64').toString('utf8')};
 try{
  const file=join(directory,'credentials.json'),store=new CredentialStore(file,codec);await store.load();await store.save(connection,'secret-for-test');
  assert.equal(store.get(connection),'secret-for-test');assert.equal(store.get({...connection,baseUrl:'https://different.example/v1'}),undefined);
  assert.equal((await readFile(file,'utf8')).includes('secret-for-test'),false);assert.equal(JSON.stringify(connection).includes('secret-for-test'),false);
  const reloaded=new CredentialStore(file,codec);await reloaded.load();assert.equal(reloaded.get(connection),'secret-for-test');
  await reloaded.remove(connection.id);assert.equal(reloaded.get(connection),undefined);
  const removed=new CredentialStore(file,codec);await removed.load();assert.equal(removed.get(connection),undefined);
  await assert.rejects(()=>store.save({...connection,baseUrl:'http://remote.example/v1'},'key'));
  await assert.rejects(()=>store.save(connection,'bad\r\nkey'));
 }finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep+'workbench-credential-test-'));await rm(directory,{recursive:true,force:true});}
});
test('Windows DPAPI round trip with a synthetic key',{skip:process.platform!=='win32'},async()=>{
 const value='synthetic-workbench-test-key';const encrypted=await windowsCodec.protect(value);
 assert.notEqual(encrypted,value);assert.equal(encrypted.includes(value),false);assert.equal(await windowsCodec.unprotect(encrypted),value);
});

test('removal queued behind slow encryption wins and survives reload',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workbench-credential-order-test-'));
 let release!:(value:string)=>void;let started!:(value:void)=>void;
 const protecting=new Promise<void>(resolve=>{started=resolve;});
 const encrypted=new Promise<string>(resolve=>{release=resolve;});
 const codec={protect:async()=>{started();return encrypted;},unprotect:async()=> 'synthetic-only-key'};
 try{
  const file=join(directory,'credentials.json'),store=new CredentialStore(file,codec);
  const saving=store.save(connection,'synthetic-only-key');await protecting;
  let removed=false;const removing=store.remove(connection.id).then(()=>{removed=true;});
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(removed,false,'delete waits for earlier save including encryption');
  release('synthetic-encrypted-value');await saving;await removing;
  assert.equal(store.get(connection),undefined);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),[]);
  const reloaded=new CredentialStore(file,codec);await reloaded.load();assert.equal(reloaded.get(connection),undefined);
 }finally{await rm(directory,{recursive:true,force:true});}
});
