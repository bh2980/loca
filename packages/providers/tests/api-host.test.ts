import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiUrl} from '../src/api.ts';
import {systemOneUrl} from '../src/systemone.ts';
import {credentialEndpoint} from '../../../apps/worker/src/credentials.ts';
import {isLocalApiHost} from '@workbench/contracts';

test('private LAN endpoints share the same policy for key storage, models and inference URLs',()=>{
 for(const host of ['localhost','127.0.0.1','[::1]','10.0.0.1','10.255.255.254','172.16.0.1','172.31.255.254','192.168.0.36']){
  assert.equal(isLocalApiHost(host),true,host);
  const connection={id:'lan',name:'LAN',kind:'openai' as const,baseUrl:`http://${host}:8080/v1`};
  assert.equal(credentialEndpoint(connection),connection.baseUrl);
  assert.equal(apiUrl(connection).href,connection.baseUrl+'/chat/completions');
  assert.equal(apiUrl({...connection,apiMode:'responses'}).href,connection.baseUrl+'/responses');
  assert.equal(systemOneUrl({...connection,kind:'systemone'},'models').href,connection.baseUrl+'/models');
 }
});

test('public IPv4, link-local, lookalike domains and embedded credentials do not gain HTTP access',()=>{
 for(const host of ['8.8.8.8','172.15.255.254','172.32.0.1','192.169.0.1','169.254.169.254','192.168.0.36.example.com','localhost.example.com','[2001:db8::1]']){
  assert.equal(isLocalApiHost(host),false,host);
  const connection={id:'public',name:'Public',kind:'openai' as const,baseUrl:`http://${host}/v1`};
  assert.throws(()=>apiUrl(connection));assert.throws(()=>credentialEndpoint(connection));
 }
 for(const baseUrl of ['http://user:secret@192.168.0.36/v1','http://192.168.0.36/v1?key=secret','http://192.168.0.36/v1#fragment','ftp://192.168.0.36/v1']){
  const connection={id:'bad',name:'Bad',kind:'openai' as const,baseUrl};
  assert.throws(()=>apiUrl(connection));assert.throws(()=>credentialEndpoint(connection));
 }
});
