import {randomUUID} from 'node:crypto';
import {Engine,WorkbenchError,initialState} from '@workbench/core';
import {isLocalApiHost,profileUsesConnection,type Connection,type WorkspaceState} from '@workbench/contracts';
import {CredentialStore,credentialEndpoint} from './credentials.ts';
import type {Accounts} from './accounts.ts';

interface EndpointInput {name?:unknown;kind?:unknown;baseUrl?:unknown;apiKey?:unknown;apiMode?:unknown;allowUnauthenticated?:unknown}
const isEndpoint=(connection:Connection)=>connection.kind==='openai'||connection.kind==='systemone';
/** Serialize endpoint/settings changes across the metadata and encrypted key stores. */
export class Connections {
 private pending:Promise<unknown>=Promise.resolve();
 constructor(private engine:Engine,private credentials:CredentialStore,private accounts:Pick<Accounts,'validateSettings'>){}
 private queue<T>(action:()=>Promise<T>|T):Promise<T>{const work=this.pending.then(action);this.pending=work.catch(()=>{});return work;}
 settings(settings:{connections:Connection[];profiles:WorkspaceState['profiles']}){return this.queue(()=>{
  if(!settings||!Array.isArray(settings.connections))throw new WorkbenchError('연결 설정이 필요합니다.');
  this.accounts.validateSettings(settings.connections);const previous=this.engine.state().connections;
  for(const old of previous.filter(isEndpoint)){
   const next=settings.connections.find(c=>c.id===old.id);
   if(!next||next.kind!==old.kind)throw new WorkbenchError('API 엔드포인트 목록의 삭제 기능을 사용해 주세요.',409);
   if(old.baseUrl?.replace(/\/$/,'')!==next.baseUrl?.replace(/\/$/,''))throw new WorkbenchError('주소는 API 엔드포인트의 편집 창에서 변경해 주세요.',409);
   if(JSON.stringify({...old,name:''})!==JSON.stringify({...next,name:''}))this.guardRunning(old.id);
  }
  if(settings.connections.some(c=>isEndpoint(c)&&!previous.some(p=>p.id===c.id&&p.kind===c.kind)))throw new WorkbenchError('API 엔드포인트 추가 기능을 사용해 주세요.',409);
  return this.engine.updateSettings(settings);
 });}
 create(input:EndpointInput){return this.queue(async()=>{
  const kind=input.kind??'openai';
  if(kind==='claude'||kind==='codex'||kind==='grok'||kind==='antigravity'){
   if(input.apiKey!==undefined||input.baseUrl!==undefined||input.allowUnauthenticated!==undefined)throw new WorkbenchError('CLI 연결은 CLI가 관리하는 계정 로그인을 사용합니다.');
   const state=this.engine.state();
   const existing=state.connections.find(connection=>connection.kind===kind);
   if(existing)return {connection:existing,state};
   if(state.connections.length>=30)throw new WorkbenchError('연결은 최대 30개까지 등록할 수 있습니다.');
   const defaultConnection=initialState().connections.find(connection=>connection.kind===kind);
   const name=input.name??defaultConnection?.name??'Claude Code';if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw new WorkbenchError('연결 이름을 1~80자로 입력해 주세요.');
   const connection:Connection={id:state.connections.some(c=>c.id===kind)?`${kind}-${randomUUID()}`:kind,name:name.trim(),kind,executable:defaultConnection?.executable??'claude'};
   return {connection,state:this.engine.updateSettings({connections:[...state.connections,connection],profiles:state.profiles})};
  }
  if(kind!=='openai'&&kind!=='systemone')throw new WorkbenchError('지원하지 않는 API 연결 종류입니다.');
  const connection=this.endpoint(input,{id:`api-${randomUUID()}`,name:'',kind,...(kind==='systemone'?{baseUrl:'https://api.typesafe.ai/v1'}:{apiMode:'chat' as const})});
  const state=this.engine.state();if(state.connections.length>=30)throw new WorkbenchError('연결은 최대 30개까지 등록할 수 있습니다.');
  const key=this.key(input);if(!key&&!input.allowUnauthenticated)throw new WorkbenchError('이 엔드포인트의 API 키를 입력해 주세요.');
  if(key)await this.credentials.save(connection,key);
  try{const next=this.engine.state();const saved=this.engine.updateSettings({connections:[...next.connections,connection],profiles:next.profiles});return {connection,state:saved};}
  catch(error){await this.credentials.remove(connection.id);throw error;}
 });}
 patch(id:string,input:EndpointInput){return this.queue(async()=>{
  const before=this.find(id),connection=this.endpoint(input,before),key=this.key(input);
  const changed=credentialEndpoint(before)!==credentialEndpoint(connection);
  if(changed&&!key&&!input.allowUnauthenticated)throw new WorkbenchError('주소를 변경하려면 새 엔드포인트의 API 키를 입력해 주세요.',409);
  this.guardRunning(id);
  if(input.allowUnauthenticated){await this.credentials.remove(id);connection.envKey=undefined;}
  else if(key)await this.credentials.save(connection,key);
  const current=this.engine.state();const state=this.engine.updateSettings({connections:current.connections.map(c=>c.id===id?connection:c),profiles:current.profiles});return {connection,state};
 });}
 remove(id:string){return this.queue(async()=>{
  this.find(id);const before=this.engine.state();const assigned=Object.values(before.profiles).some(profile=>profileUsesConnection(profile,id));
  if(assigned)throw new WorkbenchError('작업별 모델에서 이 엔드포인트의 배정을 변경한 뒤 삭제해 주세요.',409);
  this.guardRunning(id);await this.credentials.remove(id);
  const current=this.engine.state();return {state:this.engine.updateSettings({connections:current.connections.filter(c=>c.id!==id),profiles:current.profiles})};
 });}
 saveKey(id:string,value:unknown){return this.queue(async()=>{const connection=this.find(id);this.guardRunning(id);await this.credentials.save(connection,value);if(connection.allowUnauthenticated){const current=this.engine.state();this.engine.updateSettings({connections:current.connections.map(c=>c.id===id?{...c,allowUnauthenticated:false}:c),profiles:current.profiles});}});}
 removeKey(id:string){return this.queue(()=>{this.find(id);this.guardRunning(id);return this.credentials.remove(id);});}
 private find(id:string){const connection=this.engine.state().connections.find(c=>c.id===id);if(!connection||!isEndpoint(connection))throw new WorkbenchError('API 엔드포인트를 찾을 수 없습니다.',404);return connection;}
 private guardRunning(id:string){const state=this.engine.state();if(state.runs.some(run=>['queued','running','paused'].includes(run.status)&&run.steps.some(step=>step.status!=='completed'&&profileUsesConnection(run.profiles[step.stage],id)))||state.taskTests?.some(test=>['queued','running'].includes(test.status)&&test.capturedProfile.connectionId===id))throw new WorkbenchError('이 엔드포인트를 사용하는 실행·시험을 마치거나 취소한 뒤 변경해 주세요.',409);}
 private key(input:EndpointInput){if(input.apiKey===undefined||input.apiKey==='')return undefined;if(typeof input.apiKey!=='string')throw new WorkbenchError('API 키는 문자열이어야 합니다.');return input.apiKey.trim()||undefined;}
 private endpoint(input:EndpointInput,previous:Connection):Connection{
  if(input.kind!==undefined&&input.kind!==previous.kind)throw new WorkbenchError('연결 종류를 바꾸려면 새 API 엔드포인트를 추가해 주세요.',409);
  const name=input.name??previous.name,baseUrl=input.baseUrl??previous.baseUrl,apiMode=input.apiMode??previous.apiMode??'chat';
  if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw new WorkbenchError('연결 이름을 1~80자로 입력해 주세요.');
  if(typeof baseUrl!=='string'||!baseUrl.trim())throw new WorkbenchError('API 주소를 입력해 주세요.');
  if(!['chat','responses'].includes(String(apiMode)))throw new WorkbenchError('지원하지 않는 API 규격입니다.');
  if(input.allowUnauthenticated!==undefined&&typeof input.allowUnauthenticated!=='boolean')throw new WorkbenchError('로컬 서버 설정을 확인해 주세요.');
  if(previous.kind==='systemone'&&input.allowUnauthenticated)throw new WorkbenchError('SystemOne 연결에는 API 키가 필요합니다.');
  const connection:Connection={...previous,name:name.trim(),baseUrl:baseUrl.trim(),apiMode:previous.kind==='systemone'?undefined:apiMode as 'chat'|'responses',allowUnauthenticated:input.allowUnauthenticated===undefined?(this.key(input)?false:previous.allowUnauthenticated):input.allowUnauthenticated as boolean};
  try{connection.baseUrl=credentialEndpoint(connection);}catch{throw new WorkbenchError('HTTPS 또는 로컬·사설망 HTTP 주소를 입력해 주세요.');}
  if(input.allowUnauthenticated&&!isLocalApiHost(new URL(connection.baseUrl).hostname))throw new WorkbenchError('키 없는 연결은 로컬·사설망 서버에서만 지원합니다.');
  if(input.allowUnauthenticated&&this.key(input))throw new WorkbenchError('키 없는 연결을 선택했으면 API 키를 비워 주세요.');
  return connection;
 }
}
