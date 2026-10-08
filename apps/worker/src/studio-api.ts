import type {IncomingMessage} from 'node:http';
import type {Engine} from '@workbench/core';
import {WorkbenchError} from '@workbench/core';
import {isLocalApiHost,type WorkspaceState} from '@workbench/contracts';
import {chatCapability} from '@workbench/providers';
import {ensureStudio,createSession,updateSession,sessionDetail,createProposal,editProposal,feedbackProposal,acceptProposal,rejectProposal,validateProposal,createAIProfile,updateAIProfile,applyStudioOperations} from '../../../packages/core/src/studio.ts';
import {queryProject} from '../../../packages/core/src/project-query.ts';

export interface ChatActions {
 start(projectId:string,sessionId:string,input:{content:string}):unknown;
 stop(projectId:string,sessionId:string):unknown;
}
export interface StudioResponse {status:number;data:unknown}
type Body=Record<string,any>;
function error(message:string,status=400):never {throw new WorkbenchError(message,status);}
function allowed(input:Body,keys:string[]){if(Object.keys(input).some(key=>!keys.includes(key)))error('지원하지 않는 입력 필드입니다.');}
const sessionSettings=['title','webEnabled','unitIds','profileId','maxTurns','maxToolCalls'];
const profileFields=['id','name','legacyStage','connectionId','model','effort','timeoutMs','maxOutputTokens','maxAttempts','fallbacks','prompt','promptVersion','contextPolicy','outputFormat','toolPolicy'];
function profileInput(input:Body,editing=false){allowed(input,editing?[...profileFields.filter(key=>key!=='id'),'expectedVersion']:profileFields);if(input.toolPolicy!==undefined&&(!input.toolPolicy||typeof input.toolPolicy.web!=='boolean'||!Array.isArray(input.toolPolicy.allowedTools)||input.toolPolicy.allowedTools.some((name:unknown)=>typeof name!=='string')))error('도구 권한 설정을 확인하세요.');if(input.outputFormat!==undefined&&!['text','json'].includes(input.outputFormat))error('출력 형식을 확인하세요.');}
function numberParam(url:URL,key:string,fallback:number){const value=Number(url.searchParams.get(key)??fallback);if(!Number.isSafeInteger(value)||value<0)error('조회 위치를 확인하세요.');return value;}
function sourceScope(engine:Engine,url:URL){const state=engine.state();if(url.searchParams.get('projectId')!==state.project.id)error('요청한 프로젝트가 현재 프로젝트와 다릅니다.',409);return state;}

/** Human HTTP surface. Model tool dispatch never calls this router. */
export async function studioApi({engine,chat,path,method,url,req,body}:{engine:Engine;chat:ChatActions;path:string;method:string;url:URL;req:IncomingMessage;body:(req:IncomingMessage)=>Promise<Body>}):Promise<StudioResponse|undefined>{
 if(!path.startsWith('/api/studio'))return undefined;
 const state=sourceScope(engine,url),projectId=state.project.id,studio=ensureStudio(state);
 const mutate=<T>(fn:(state:WorkspaceState)=>T)=>engine.studioMutation(projectId,fn);
 const result=(data:unknown,status=200)=>({status,data});
 if(method==='GET'&&path==='/api/studio')return result({projectId,revision:state.revision,statuses:studio.statuses,labels:studio.labels,profiles:studio.profiles,characters:studio.characters,relationships:studio.relationships,webSearch:studio.webSearch,capabilities:state.connections.map(connection=>({connectionId:connection.id,...chatCapability(connection)}))});
 if(method==='GET'&&path==='/api/studio/people')return result({projectId,revision:state.revision,characters:studio.characters,relationships:studio.relationships,evidence:studio.evidence});
 if(method==='POST'&&path==='/api/studio/query'){const input=await body(req);allowed(input,['name','args']);return result(queryProject(state,input.name,input.args??{},projectId));}
 if(path==='/api/studio/sessions'){
  if(method==='GET')return result(studio.sessions.map(({draft:_draft,...session})=>session).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
  if(method==='POST'){const input=await body(req);allowed(input,sessionSettings);return result(mutate(state=>createSession(state,input)),201);}
 }
 const sessionMatch=path.match(/^\/api\/studio\/sessions\/([^/]+)(?:\/(messages|stop))?$/);
 if(sessionMatch){
  const id=decodeURIComponent(sessionMatch[1]),action=sessionMatch[2];
  if(method==='GET'&&!action){
   const detail=sessionDetail(state,id),limit=Math.min(100,Math.max(1,numberParam(url,'limit',50))),offset=url.searchParams.has('offset')?numberParam(url,'offset',0):Math.max(0,detail.messages.length-limit);
   const messages=detail.messages.slice(offset,offset+limit),toolIds=new Set(messages.flatMap(message=>message.toolCallIds??[])),proposalIds=new Set(messages.flatMap(message=>message.proposalIds??[]));
   return result({session:detail.session,messages:messages.map(({responseItems:_responseItems,...message})=>message),toolCalls:detail.toolCalls.filter(call=>toolIds.has(call.id)||call.status==='running'),proposals:detail.proposals.filter(proposal=>proposalIds.has(proposal.id)||proposal.status==='draft'),totalMessages:detail.messages.length,offset,nextOffset:offset+limit<detail.messages.length?offset+limit:null});
  }
  if(method==='PATCH'&&!action){const input=await body(req);allowed(input,[...sessionSettings,'draft','expectedVersion']);const current=studio.sessions.find(item=>item.id===id);if(current?.status==='running'&&Object.keys(input).some(key=>!['webEnabled','draft','expectedVersion'].includes(key)))error('응답 중에는 연결과 조사 범위를 변경할 수 없습니다.',409);if(typeof input.webEnabled!=='undefined'&&typeof input.webEnabled!=='boolean')error('웹 설정을 확인하세요.');return result(mutate(state=>updateSession(state,id,input)));}
  if(method==='POST'&&action==='messages'){const input=await body(req);allowed(input,['content']);return result(await chat.start(projectId,id,{content:input.content}),202);}
  if(method==='POST'&&action==='stop')return result(await chat.stop(projectId,id));
 }
 if(path==='/api/studio/proposals'&&method==='POST'){const input=await body(req);allowed(input,['sessionId','title','operations','baseVersions','evidenceIds','idempotencyKey']);return result(mutate(state=>createProposal(state,input as Parameters<typeof createProposal>[1])),201);}
 const proposalMatch=path.match(/^\/api\/studio\/proposals\/([^/]+)(?:\/(accept|reject|feedback|validate))?$/);
 if(proposalMatch){
  const id=decodeURIComponent(proposalMatch[1]),action=proposalMatch[2];
  const proposal=studio.proposals.find(item=>item.id===id);if(!proposal)error('제안을 찾을 수 없습니다.',404);
  if(method==='GET'&&!action)return result({proposal,validation:validateProposal(state,id),current:{knowledge:state.knowledge,characters:studio.characters,relationships:studio.relationships}});
  if(method==='GET'&&action==='validate')return result(validateProposal(state,id));
  if(method==='PATCH'&&!action){const input=await body(req);allowed(input,['expectedVersion','title','operations','baseVersions','evidenceIds','reason']);return result(mutate(state=>editProposal(state,id,input as Parameters<typeof editProposal>[2])));}
  if(method==='POST'&&(action==='accept'||action==='reject')){const input=await body(req);allowed(input,['expectedVersion','sessionId','reason']);const decision={...input,actor:'user' as const,expectedVersion:input.expectedVersion};return result(mutate(state=>action==='accept'?acceptProposal(state,id,decision):rejectProposal(state,id,decision)));}
  if(method==='POST'&&action==='feedback'){const input=await body(req);allowed(input,['expectedVersion','content','sessionId']);return result(mutate(state=>feedbackProposal(state,id,input as Parameters<typeof feedbackProposal>[2])));}
 }
 if(path==='/api/studio/profiles'&&method==='POST'){const input=await body(req);profileInput(input);engine.validateAIProfile(input as Parameters<Engine['validateAIProfile']>[0]);return result(mutate(state=>createAIProfile(state,input as Parameters<typeof createAIProfile>[1])),201);}
 const profileMatch=path.match(/^\/api\/studio\/profiles\/([^/]+)$/);
 if(profileMatch&&method==='PATCH'){const input=await body(req),id=decodeURIComponent(profileMatch[1]),profile=studio.profiles.find(item=>item.id===id);profileInput(input,true);if(!profile)error('프로필을 찾을 수 없습니다.',404);engine.validateAIProfile({...profile,...input});return result(mutate(state=>updateAIProfile(state,id,input as Parameters<typeof updateAIProfile>[2])));}
 if(path==='/api/studio/apply'&&method==='POST'){const input=await body(req);allowed(input,['operations','baseVersions']);return result(mutate(state=>applyStudioOperations(state,input.operations,{kind:'direct',actor:'user'},input.baseVersions)));}
 if(path==='/api/studio/web-search'&&method==='PUT'){
  const input=await body(req);allowed(input,['baseUrl','maxResults','credentialId']);let endpoint:URL;
  try{endpoint=new URL(input.baseUrl);}catch{error('검색 API 주소를 확인하세요.');}
  if(endpoint.username||endpoint.password||endpoint.hash||endpoint.search||!['http:','https:'].includes(endpoint.protocol)||(endpoint.protocol==='http:'&&!isLocalApiHost(endpoint.hostname)))error('HTTPS 또는 로컬 검색 API 주소를 입력하세요.');
  if(input.maxResults!==undefined&&(!Number.isInteger(input.maxResults)||input.maxResults<1||input.maxResults>20))error('검색 결과 수는 1~20이어야 합니다.');
  if(input.credentialId&&!state.workflow?.toolConnections?.some(tool=>tool.id===input.credentialId&&tool.baseUrl.replace(/\/$/,'')===endpoint.toString().replace(/\/$/,'')))error('검색 API와 주소가 같은 도구 연결을 선택하세요.');
  return result(mutate(state=>{const value={kind:'searxng' as const,baseUrl:endpoint.toString(),maxResults:input.maxResults??5,...(input.credentialId?{credentialId:String(input.credentialId)}:{})};ensureStudio(state).webSearch=value;return value;}));
 }
 if(path==='/api/studio/candidates'&&method==='GET'){
  const unitId=url.searchParams.get('unitId');if(!unitId||!state.units.some(unit=>unit.id===unitId))error('현재 프로젝트의 원문을 선택하세요.');
  const candidates=studio.candidates.filter(item=>item.unitId===unitId),offset=numberParam(url,'offset',0),limit=Math.min(100,Math.max(1,numberParam(url,'limit',30)));
  return result({total:candidates.length,items:candidates.slice(offset,offset+limit),selectedId:studio.selectedCandidateIds[unitId],progress:studio.progress[unitId],sourceSnapshot:JSON.stringify(state.units.find(item=>item.id===unitId)),translationVersion:state.translations[unitId].version});
 }
 return result({error:'Studio API를 찾을 수 없습니다.'},404);
}
