import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceState } from '@workbench/contracts';
import { invokeChat, ProviderError, type ChatRequest, type ChatResult } from '@workbench/providers';
import { initialState } from '../../../packages/core/src/engine.ts';
import { acceptProposal, appendChatMessage, createSession, ensureStudio, getSession, sessionDetail, updateSession } from '../../../packages/core/src/studio.ts';
import { ProjectChat, type ProjectChatEngine, type ProjectChatOptions } from '../src/project-chat.ts';
import { createProjectWeb, publicWebUrl, type ProjectWeb } from '../src/project-web.ts';

class MemoryEngine implements ProjectChatEngine {
 current=initialState();
 state(){return structuredClone(this.current);}
 studioMutation<T>(projectId:string,fn:(state:WorkspaceState)=>T):T{assert.equal(projectId,this.current.project.id);const next=structuredClone(this.current);const result=fn(next);next.revision++;this.current=next;return result;}
}
function setup(options:ProjectChatOptions={}){
 const engine=new MemoryEngine(),studio=ensureStudio(engine.current),profile=studio.profiles.find(item=>item.id==='profile:translate')!;
 Object.assign(profile,{connectionId:'openai',model:'fake-model',effort:'',maxOutputTokens:100,timeoutMs:1000});
 const session=createSession(engine.current,{profileId:profile.id});
 const chat=new ProjectChat(engine,options);return {engine,chat,session,projectId:engine.current.project.id,profile};
}
const turn=(message:string,toolCalls:ChatResult['toolCalls']=[]):ChatResult=>({message,toolCalls,usage:{inputTokens:5,outputTokens:3,totalTokens:8},reportedModel:'fake-reported'});
const call=(id:string,name:string,args:Record<string,unknown>)=>({id,name,arguments:args});
const label=(id='proposed-label')=>({kind:'label.create',item:{id,name:'조사 필요',color:'#aabbcc'}});
function sequence(results:ChatResult[],inspect?:(request:ChatRequest,index:number)=>void){let count=0;return async(request:ChatRequest)=>{inspect?.(request,count);const result=results[count++];assert.ok(result,'unexpected extra model call');return result;};}

test('tool loop saves draft-only proposals, traces, reported model and usage without applying content',async()=>{
 const invoke=sequence([turn('',[call('p1','draft_proposal',{title:'라벨 초안',operations:[label()]})]),turn('수락 대기 라벨 초안을 만들었습니다.')]);
 const {engine,chat,session,projectId}=setup({invoke});
 const before=structuredClone({units:engine.current.units,knowledge:engine.current.knowledge,terms:engine.current.terms,translations:engine.current.translations});
 assert.equal(chat.start(projectId,session.id,{content:'라벨 초안을 만들어 주세요.'}).session.status,'running');await chat.drain();
 const detail=sessionDetail(engine.current,session.id);
 assert.equal(detail.session.status,'idle');assert.equal(detail.proposals.length,1);assert.equal(detail.proposals[0].status,'draft');assert.equal(engine.current.studio!.labels.length,0);
 assert.deepEqual({units:engine.current.units,knowledge:engine.current.knowledge,terms:engine.current.terms,translations:engine.current.translations},before);
 assert.equal(detail.toolCalls[0].providerCallId,'p1');assert.equal(detail.toolCalls[0].status,'completed');
 assert.equal(detail.messages.filter(message=>message.role==='assistant')[0].content,'');
 assert.deepEqual(detail.messages.filter(message=>message.role==='assistant')[0].proposalIds,[detail.proposals[0].id]);
 assert.equal(detail.messages.at(-1)?.reportedModel,'fake-reported');assert.equal(detail.messages.at(-1)?.usage?.totalTokens,8);
 await chat.close();
});

test('read-time source and translation bases stay stale when project changes before proposal generation',async()=>{
 let engine:MemoryEngine;const invoke=sequence([
  turn('',[call('r1','read_script',{unitIds:['S0-01']})]),
  turn('',[call('p1','draft_proposal',{title:'작품 자료 초안',operations:[{kind:'knowledge.create',item:{id:'new-fact',kind:'fact',title:'관측',content:'감시국에서 왔다.',evidenceIds:['S0-01'],branch:'common',visibility:'translator'}}]})]),
  turn('이 초안은 읽었던 원문과 현재 원문의 차이를 확인해야 합니다.'),
 ],(_request,index)=>{if(index===1){engine.current.translations['S0-01'].version++;engine.current.units.find(unit=>unit.id==='S0-01')!.source='Changed source after read.';}});
 const setupResult=setup({invoke});engine=setupResult.engine;const {chat,session,projectId}=setupResult;
 const original=JSON.stringify(engine.current.units.find(unit=>unit.id==='S0-01'));
 chat.start(projectId,session.id,{content:'이 원문 근거로 작품 자료를 만들어 주세요.'});await chat.drain();
 const proposal=engine.current.studio!.proposals[0];assert.ok(proposal);
 const sourceBasis=proposal.baseVersions.find(ref=>ref.kind==='source'&&ref.id==='S0-01'),translationBasis=proposal.baseVersions.find(ref=>ref.kind==='translation'&&ref.id==='S0-01');
 assert.ok(sourceBasis?.kind==='source');assert.equal(sourceBasis.snapshot,original);
 assert.ok(translationBasis&&translationBasis.kind!=='source');assert.equal(translationBasis.version,0);
 const tool=engine.current.studio!.toolCalls.find(call=>call.name==='draft_proposal')!;
 assert.equal((tool.output as {validation:{ok:boolean}}).validation.ok,false);
 assert.throws(()=>acceptProposal(engine.current,proposal.id,{expectedVersion:1,actor:'user'}),/오래된/);
 assert.equal(engine.current.knowledge.length,0);await chat.close();
});

test('proposal update requires a prior read and tool schema cannot contain direct/apply operations',async()=>{
 const {engine,chat,session,projectId}=setup({invoke:sequence([
  turn('',[call('p1','draft_proposal',{title:'읽지 않은 수정',operations:[{kind:'knowledge.update',id:'existing',expectedVersion:1,patch:{content:'new'}}]})]),turn('수정 대상을 먼저 읽어야 합니다.'),
 ],request=>{
  assert.equal(request.tools?.some(tool=>/accept|apply|http/.test(tool.name)),false);
  assert.doesNotMatch(JSON.stringify(request.tools?.find(tool=>tool.name==='draft_proposal')?.parameters),/translation\.select|unit\.assign|autoRecheck/);
 })});
 engine.current.knowledge.push({id:'existing',kind:'fact',title:'saved',content:'old',evidenceIds:[],branch:'common',visibility:'translator',version:1});
 chat.start(projectId,session.id,{content:'수정해 주세요.'});await chat.drain();
 assert.equal(engine.current.knowledge[0].content,'old');assert.equal(engine.current.studio!.proposals.length,0);
 assert.equal(engine.current.studio!.toolCalls[0].status,'failed');assert.match(engine.current.studio!.toolCalls[0].error!,/먼저 읽어/);await chat.close();
});

test('web OFF and restricted profile prevent external requests even when injected model asks for web',async()=>{
 let searches=0,pages=0;const web:ProjectWeb={search:async()=>{searches++;throw new Error('unexpected');},readPage:async()=>{pages++;throw new Error('unexpected');}};
 const {engine,chat,session,projectId,profile}=setup({web,invoke:async request=>{
  assert.equal(request.tools?.some(tool=>tool.name.startsWith('web_')),false);
  return turn('',[call('w1','web_search',{query:'private story'})]);
 }});
 engine.current.studio!.webSearch={kind:'searxng',baseUrl:'http://127.0.0.1:8888'};
 chat.start(projectId,session.id,{content:'조사'});await chat.drain();assert.equal(searches,0);assert.equal(pages,0);assert.equal(getSession(engine.current,session.id).status,'failed');
 updateSession(engine.current,session.id,{webEnabled:true});profile.toolPolicy={web:false,allowedTools:['read_script','web_search']};
 chat.start(projectId,session.id,{content:'다시 조사'});await chat.drain();assert.equal(searches,0);assert.equal(pages,0);await chat.close();
});

test('web search and pages save retrieval evidence; changing web toggle before execution blocks next request',async()=>{
 let searches=0,pages=0;const url='https://example.com/story';const web:ProjectWeb={
  search:async(_settings,args)=>{searches++;return {query:args.query,results:[{url,title:'Story',excerpt:'source excerpt'}],returned:1,available:1,retrievedAt:'2026-10-09T00:00:00Z',truncated:false,service:'searxng'};},
  readPage:async value=>{pages++;return {url:value,text:'page content',retrievedAt:'2026-10-09T00:00:01Z',truncated:false};},
 };
 const {engine,chat,session,projectId}=setup({web,invoke:sequence([turn('',[call('w1','web_search',{query:'story'})]),turn('',[call('w2','web_read_page',{url})]),turn('검색 출처를 읽었습니다.')])});
 engine.current.studio!.webSearch={kind:'searxng',baseUrl:'http://127.0.0.1:8888'};updateSession(engine.current,session.id,{webEnabled:true});
 chat.start(projectId,session.id,{content:'웹으로 확인'});await chat.drain();assert.equal(searches,1);assert.equal(pages,1);
 assert.match(JSON.stringify(sessionDetail(engine.current,session.id).toolCalls),/2026-10-09T00:00:01Z/);await chat.close();
 let blockedSearches=0;const second=setup({web:{search:async()=>{blockedSearches++;throw new Error('unexpected');}},invoke:sequence([
  turn('',[call('r1','read_script',{unitIds:['S0-01']}),call('w1','web_search',{query:'story'})]),turn('웹이 꺼져 있어 로컬 자료만 읽었습니다.'),
 ])});second.engine.current.studio!.webSearch={kind:'searxng',baseUrl:'http://127.0.0.1:8888'};updateSession(second.engine.current,second.session.id,{webEnabled:true});
 const mutation=second.engine.studioMutation.bind(second.engine);second.engine.studioMutation=(projectId,fn)=>mutation(projectId,state=>{const result=fn(state);if(state.studio!.toolCalls.some(call=>call.name==='read_script'&&call.status==='completed'))updateSession(state,second.session.id,{webEnabled:false});return result;});
 second.chat.start(second.projectId,second.session.id,{content:'읽고 웹 조사'});await second.chat.drain();assert.equal(blockedSearches,0);await second.chat.close();
});

test('turn/tool/web/token budgets stop without losing completed results or pending call outcomes',async()=>{
 const first=setup({invoke:sequence([turn('',[call('r1','read_script',{unitIds:['S0-01']})])])});updateSession(first.engine.current,first.session.id,{maxTurns:1});
 first.chat.start(first.projectId,first.session.id,{content:'조회'});await first.chat.drain();assert.equal(getSession(first.engine.current,first.session.id).status,'stopped');assert.equal(first.engine.current.studio!.toolCalls[0].status,'completed');await first.chat.close();
 const second=setup({invoke:sequence([turn('',[call('r1','read_script',{unitIds:['S0-01']}),call('r2','read_script',{unitIds:['S0-02']})])])});updateSession(second.engine.current,second.session.id,{maxToolCalls:1});
 second.chat.start(second.projectId,second.session.id,{content:'두 개 조회'});await second.chat.drain();assert.deepEqual(second.engine.current.studio!.toolCalls.map(call=>call.status),['completed','stopped']);assert.equal(second.engine.current.studio!.messages.filter(message=>message.role==='tool').length,2);await second.chat.close();
 const third=setup({maxTotalTokens:4,invoke:sequence([turn('완료')])});third.chat.start(third.projectId,third.session.id,{content:'조회'});await third.chat.drain();assert.equal(getSession(third.engine.current,third.session.id).status,'stopped');await third.chat.close();
 let searches=0;const fourth=setup({maxWebCalls:1,web:{search:async(_settings,args)=>{searches++;return {query:args.query,results:[],returned:0,available:0,truncated:false,retrievedAt:new Date().toISOString(),service:'searxng'};}},invoke:sequence([turn('',[call('w1','web_search',{query:'first'}),call('w2','web_search',{query:'second'})])])});
 fourth.engine.current.studio!.webSearch={kind:'searxng',baseUrl:'http://127.0.0.1:8888'};updateSession(fourth.engine.current,fourth.session.id,{webEnabled:true});
 fourth.chat.start(fourth.projectId,fourth.session.id,{content:'조사'});await fourth.chat.drain();assert.equal(searches,1);assert.equal(getSession(fourth.engine.current,fourth.session.id).status,'stopped');await fourth.chat.close();
});

test('typed web evidence gets actual server retrieval provenance and remains a proposal until acceptance',async()=>{
 const url='https://example.com/story',retrievedAt='2026-10-09T01:02:03Z';const web:ProjectWeb={search:async(_settings,args)=>({query:args.query,results:[{url,title:'Actual source',excerpt:'The actual excerpt'}],returned:1,available:1,truncated:false,retrievedAt,service:'searxng'})};
 const {engine,chat,session,projectId}=setup({web,invoke:sequence([
  turn('',[call('w1','web_search',{query:'story'})]),
  turn('',[call('p1','draft_proposal',{title:'웹 근거와 작품 자료',operations:[{kind:'evidence.create',item:{id:'ev1',kind:'web',url,excerpt:'actual excerpt'}},{kind:'knowledge.create',item:{id:'new-fact',kind:'fact',title:'자료',content:'근거로 작성한 초안',evidenceIds:['ev1'],branch:'unknown',visibility:'translator'}}]})]),
  turn('웹 근거를 포함한 초안을 만들었습니다.'),
 ])});engine.current.studio!.webSearch={kind:'searxng',baseUrl:'http://127.0.0.1:8888'};updateSession(engine.current,session.id,{webEnabled:true});
 chat.start(projectId,session.id,{content:'근거 자료 초안'});await chat.drain();
 const proposal=engine.current.studio!.proposals[0];assert.ok(proposal);const evidence=proposal.operations[0];assert.ok(evidence.kind==='evidence.create');assert.equal(evidence.item.retrievedAt,retrievedAt);assert.equal(evidence.item.title,'Actual source');
 assert.equal(engine.current.studio!.evidence.length,0);assert.equal(engine.current.knowledge.length,0);
 assert.equal((engine.current.studio!.toolCalls[1].output as {validation:{ok:boolean}}).validation.ok,true);await chat.close();
});

test('stop cancels partial tool batches and next turn replays matched call IDs through real provider serialization',async()=>{
 let webStarted!:()=>void;const started=new Promise<void>(resolve=>{webStarted=resolve;});let turnIndex=0;
 const calls=[call('provider_read','read_script',{unitIds:['S0-01']}),call('provider_web','web_search',{query:'story'})];
 const {engine,chat,session,projectId}=setup({web:{search:async()=>{webStarted();return new Promise(()=>{});}},invoke:async request=>{
  if(turnIndex++===0)return turn('',calls);
  return invokeChat(request,{fetch:(async(_url,init)=>{
   const body=JSON.parse(init!.body as string),history=body.messages;
   const tools=history.filter((item:{role:string})=>item.role==='tool');assert.equal(tools.length,2);assert.deepEqual(tools.map((item:{tool_call_id:string})=>item.tool_call_id),calls.map(call=>call.id));
   assert.match(tools[1].content,/중단/);
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'이전 결과에서 계속합니다.'}}]}));
  }) as typeof fetch});
 }});engine.current.connections.find(item=>item.id==='openai')!.envKey=undefined;
 engine.current.studio!.webSearch={kind:'searxng',baseUrl:'http://127.0.0.1:8888'};updateSession(engine.current,session.id,{webEnabled:true});
 chat.start(projectId,session.id,{content:'원문과 웹 조사'});await started;chat.stop(projectId,session.id);await chat.drain();
 assert.deepEqual(engine.current.studio!.toolCalls.map(call=>call.status),['completed','stopped']);
 chat.start(projectId,session.id,{content:'저장한 결과에서 계속'});await chat.drain();assert.equal(getSession(engine.current,session.id).status,'idle');await chat.close();
});

test('restart recovery finalizes unfinished tool calls without rerunning tools and preserves Responses items',async()=>{
 const {engine,chat,session,projectId}=setup({invoke:async request=>{
  const assistant=request.messages.find(item=>item.role==='assistant');assert.ok(assistant&&assistant.role==='assistant');assert.equal(assistant.responseItems?.[0].encrypted_content,'encrypted');
  assert.ok(request.messages.some(item=>item.role==='tool'&&item.toolCallId==='provider_1'));
  return turn('완료한 기록을 보존했습니다.');
 }});
 engine.current.connections.find(connection=>connection.id==='openai')!.apiMode='responses';
 const stamp=new Date().toISOString(),recordId='record_1';engine.current.studio!.messages.push(
  {id:'m0',projectId,sessionId:session.id,role:'user',content:'기존 메시지',createdAt:stamp},
  {id:'m1',projectId,sessionId:session.id,role:'assistant',content:'',toolCallIds:[recordId],providerRoute:{connectionId:'openai',model:'fake-model',apiMode:'responses',baseUrl:engine.current.connections.find(connection=>connection.id==='openai')!.baseUrl},responseItems:[{type:'reasoning',summary:[],encrypted_content:'encrypted'},{type:'function_call',call_id:'provider_1',name:'read_script',arguments:'{"unitIds":["S0-01"]}'}],createdAt:stamp});
 engine.current.studio!.toolCalls.push({id:recordId,providerCallId:'provider_1',projectId,sessionId:session.id,messageId:'m1',name:'read_script',input:{unitIds:['S0-01']},status:'running',web:false,startedAt:stamp});updateSession(engine.current,session.id,{status:'running'});
 assert.deepEqual(chat.recover(projectId),[session.id]);assert.equal(engine.current.studio!.toolCalls[0].status,'stopped');
 chat.start(projectId,session.id,{content:'계속'});await chat.drain();assert.equal(getSession(engine.current,session.id).status,'idle');await chat.close();
});

function addFallback(engine:MemoryEngine,mode:'chat'|'responses'='chat'){
 const primary=engine.current.connections.find(connection=>connection.id==='openai')!;
 engine.current.connections.push({...primary,id:'fallback-api',name:'Fallback',baseUrl:'https://fallback.invalid/v1',apiMode:mode,envKey:undefined});
 const profile=engine.current.studio!.profiles.find(profile=>profile.id==='profile:translate')!;
 profile.fallbacks=[{connectionId:'fallback-api',model:'fallback-model',effort:'',timeoutMs:1000,maxOutputTokens:100,maxAttempts:1}];return profile;
}
test('transport retries and explicit fallback keep a sticky route, isolated credentials and exact Responses continuation',async()=>{
 let count=0;const {engine,chat,session,projectId}=setup({credential:connection=>`${connection.id}-key`,invoke:async request=>{
  assert.equal(request.credential,`${request.connection.id}-key`);
  if(count++<2){assert.equal(request.connection.id,'openai');throw new ProviderError('api-http-error','HTTP 503');}
  assert.equal(request.connection.id,'fallback-api');assert.equal(request.profile.model,'fallback-model');
  if(count===3)return {...turn('',[call('fallback_read','read_script',{unitIds:['S0-01']})]),responseItems:[{type:'reasoning',summary:[],encrypted_content:'fallback-encrypted'},{type:'function_call',call_id:'fallback_read',name:'read_script',arguments:'{"unitIds":["S0-01"]}'}]};
  const assistant=request.messages.find(message=>message.role==='assistant');assert.ok(assistant?.role==='assistant');assert.equal(assistant.responseItems?.[0].encrypted_content,'fallback-encrypted');assert.equal(request.messages.filter(message=>message.role==='tool').length,1);return turn('대체 모델로 이어서 완료했습니다.');
 }});const profile=addFallback(engine,'responses');profile.maxAttempts=2;
 chat.start(projectId,session.id,{content:'원문 읽기'});await chat.drain();assert.equal(count,4);const detail=sessionDetail(engine.current,session.id);assert.equal(detail.session.status,'idle');assert.equal(detail.toolCalls.length,1);
 const assistant=detail.messages.filter(message=>message.role==='assistant');assert.deepEqual(assistant[0].providerAttempts?.map(attempt=>[attempt.routeIndex,attempt.number,attempt.status]),[[0,1,'failed'],[0,2,'failed'],[1,1,'completed']]);assert.deepEqual(assistant[0].providerRoute,{connectionId:'fallback-api',model:'fallback-model',apiMode:'responses',baseUrl:'https://fallback.invalid/v1'});assert.equal(assistant[1].providerAttempts?.length,1);await chat.close();
});
test('Responses to Chat fallback preserves completed tool IDs and discards other-route opaque reasoning',async()=>{
 let count=0;const {engine,chat,session,projectId}=setup({invoke:async request=>{
  count++;
  if(count===1)return {...turn('',[call('original_read','read_script',{unitIds:['S0-01']})]),responseItems:[{type:'reasoning',summary:[],encrypted_content:'original-secret-reasoning'},{type:'function_call',call_id:'original_read',name:'read_script',arguments:'{"unitIds":["S0-01"]}'}]};
  if(count===2)throw new ProviderError('api-network-error','채팅 API 연결 실패');
  assert.equal(request.connection.id,'fallback-api');const assistant=request.messages.find(message=>message.role==='assistant');assert.ok(assistant?.role==='assistant');assert.equal(assistant.responseItems,undefined);
  return invokeChat(request,{fetch:(async(_url,init)=>{const body=JSON.parse(init!.body as string);assert.doesNotMatch(JSON.stringify(body),/original-secret-reasoning/);assert.equal(body.messages.find((message:{role:string})=>message.role==='assistant').tool_calls[0].id,'original_read');assert.equal(body.messages.find((message:{role:string})=>message.role==='tool').tool_call_id,'original_read');return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'기록에서 계속했습니다.'}}]}));}) as typeof fetch});
 }});engine.current.connections.find(connection=>connection.id==='openai')!.apiMode='responses';addFallback(engine);
 chat.start(projectId,session.id,{content:'원문 읽기'});await chat.drain();assert.equal(count,3);assert.equal(getSession(engine.current,session.id).status,'idle');assert.equal(engine.current.studio!.toolCalls.length,1);assert.equal(engine.current.studio!.messages.find(message=>message.role==='assistant')?.responseItems?.[0].encrypted_content,'original-secret-reasoning');await chat.close();
});
test('fallback does not refresh proposal read bases or automatically apply stale drafts',async()=>{
 let count=0;let engine:MemoryEngine;
 const result=setup({invoke:async request=>{
  count++;if(count===1)return turn('',[call('read_basis','read_script',{unitIds:['S0-01']})]);
  if(count===2){engine.current.units.find(unit=>unit.id==='S0-01')!.source='Changed during transport failure';engine.current.translations['S0-01'].version++;throw new ProviderError('timeout','제한 시간');}
  assert.equal(request.connection.id,'fallback-api');if(count===3)return turn('',[call('draft_basis','draft_proposal',{title:'오래된 근거 초안',operations:[{kind:'knowledge.create',item:{id:'stale-fallback-fact',kind:'fact',title:'자료',content:'초안',evidenceIds:['S0-01'],branch:'common',visibility:'translator'}}]})]);return turn('원문 변경으로 검토가 필요합니다.');
 }});engine=result.engine;const {chat,session,projectId}=result;addFallback(engine);const snapshot=JSON.stringify(engine.current.units.find(unit=>unit.id==='S0-01'));
 chat.start(projectId,session.id,{content:'근거 초안'});await chat.drain();assert.equal(count,4);const proposal=engine.current.studio!.proposals[0],source=proposal.baseVersions.find(base=>base.kind==='source'&&base.id==='S0-01');assert.ok(source?.kind==='source');assert.equal(source.snapshot,snapshot);assert.equal((engine.current.studio!.toolCalls[1].output as {validation:{ok:boolean}}).validation.ok,false);assert.equal(engine.current.knowledge.length,0);await chat.close();
});
test('all transport attempts share maxTurns and stop before another retry or fallback exceeds it',async()=>{
 let count=0;const {engine,chat,session,projectId}=setup({invoke:async()=>{count++;throw new ProviderError('api-http-error','HTTP 429');}});const profile=addFallback(engine);profile.maxAttempts=3;updateSession(engine.current,session.id,{maxTurns:2});
 chat.start(projectId,session.id,{content:'제한 확인'});await chat.drain();assert.equal(count,2);assert.equal(getSession(engine.current,session.id).status,'stopped');assert.match(getSession(engine.current,session.id).error!,/같은 한도/);await chat.close();
});
test('refusal, invalid output, credential failure and unsupported fallback never retry or invoke CLI',async()=>{
 for(const failure of [new ProviderError('refusal','모델 거절'),new ProviderError('invalid-tool-arguments','잘못된 도구'),new ProviderError('api-http-error','HTTP 403')]){
  let count=0;const {engine,chat,session,projectId}=setup({invoke:async()=>{count++;throw failure;}});addFallback(engine).maxAttempts=3;
  chat.start(projectId,session.id,{content:'실패 확인'});await chat.drain();assert.equal(count,1);assert.equal(getSession(engine.current,session.id).status,'failed');await chat.close();
 }
 let count=0;const {engine,chat,session,projectId}=setup({invoke:async()=>{count++;throw new ProviderError('api-network-error','연결 실패');}});addFallback(engine).fallbacks![0].connectionId='codex';
 chat.start(projectId,session.id,{content:'대체 연결 확인'});await chat.drain();assert.equal(count,1);assert.match(getSession(engine.current,session.id).error!,/구현되지/);await chat.close();
});
test('stop during retry prevents further model calls and route attempt errors cannot echo a supplied key',async()=>{
 let notified!:()=>void;const failed=new Promise<void>(resolve=>{notified=resolve;});let count=0;
 const {engine,chat,session,projectId}=setup({credential:()=> 'memory-secret',invoke:async()=>{count++;notified();throw new ProviderError('api-network-error','연결 실패 memory-secret');}});addFallback(engine).maxAttempts=3;
 chat.start(projectId,session.id,{content:'중지 확인'});await failed;chat.stop(projectId,session.id);await chat.drain();assert.equal(count,1);assert.equal(getSession(engine.current,session.id).status,'stopped');assert.doesNotMatch(JSON.stringify(engine.current.studio),/memory-secret/);await chat.close();
});
test('provider routing metadata survives storage and refuses credential-shaped unknown fields',async()=>{
 const {engine,chat,session}=setup();const route={connectionId:'openai',model:'fake-model',apiMode:'responses' as const,baseUrl:'https://model.invalid/v1'},attempts=[{connectionId:'openai',model:'fake-model',routeIndex:0,number:1,status:'completed' as const}];
 const message=appendChatMessage(engine.current,{sessionId:session.id,role:'assistant',content:'응답',providerRoute:route,providerAttempts:attempts});const restored=JSON.parse(JSON.stringify(engine.current));assert.deepEqual(restored.studio.messages.find((row:{id:string})=>row.id===message.id).providerRoute,route);assert.deepEqual(restored.studio.messages[0].providerAttempts,attempts);
 const input={sessionId:session.id,role:'assistant' as const,content:'bad',providerRoute:{...route,apiKey:'private'}};assert.throws(()=>appendChatMessage(engine.current,input),/경로 기록/);assert.equal(engine.current.studio!.messages.length,1);void chat.close();
});

test('scope, active session, unsupported providers, and shutdown are checked before model invocation',async()=>{
 let invoked=0;const {engine,chat,session,projectId}=setup({invoke:async()=>{invoked++;return new Promise(()=>{});}});
 assert.throws(()=>chat.start('other-project',session.id,{content:'x'}),/다른 프로젝트/);
 assert.throws(()=>chat.start(projectId,'other-session',{content:'x'}),/찾을 수/);
 engine.current.studio!.profiles.find(item=>item.id==='profile:translate')!.connectionId='codex';assert.throws(()=>chat.start(projectId,session.id,{content:'x'}),/구현되지/);assert.equal(invoked,0);
 engine.current.studio!.profiles.find(item=>item.id==='profile:translate')!.connectionId='openai';
 chat.start(projectId,session.id,{content:'x'});assert.throws(()=>chat.start(projectId,session.id,{content:'second'}),/실행 중/);
 await Promise.resolve();await chat.close();assert.equal(getSession(engine.current,session.id).status,'stopped');assert.throws(()=>chat.start(projectId,session.id,{content:'x'}),/종료 중/);
});

test('model timeout terminates an injected stalled turn and preserves the user message',async()=>{
 const {engine,chat,session,projectId}=setup({invoke:async()=>new Promise(()=>{})});engine.current.studio!.profiles.find(item=>item.id==='profile:translate')!.timeoutMs=15;
 const keepAlive=setTimeout(()=>{},1000);
 try{chat.start(projectId,session.id,{content:'시간 제한 확인'});await chat.drain();assert.equal(getSession(engine.current,session.id).status,'failed');assert.match(getSession(engine.current,session.id).error!,/제한 시간/);assert.equal(sessionDetail(engine.current,session.id).messages[0].content,'시간 제한 확인');}
 finally{clearTimeout(keepAlive);await chat.close();}
});

test('SearXNG uses configured service, bounded JSON results and independent credentials, with no redirects',async()=>{
 let requests=0;const web=createProjectWeb({credential:id=>{assert.equal(id,'search-secret');return 'web-only-key';},fetch:(async(input,init)=>{
  requests++;const url=new URL(String(input));assert.equal(url.origin,'http://127.0.0.1:8888');assert.equal(url.pathname,'/searx/search');assert.equal(url.searchParams.get('q'),'story');assert.equal(url.searchParams.get('format'),'json');
  assert.equal(init!.redirect,'error');assert.equal((init!.headers as Record<string,string>).Authorization,'Bearer web-only-key');
  return new Response(JSON.stringify({results:[{url:'https://example.com/a',title:'A',content:'first'},{url:'http://127.0.0.1/private',title:'blocked'},{url:'https://example.com/b',title:'B',content:'second'}]}));
 }) as typeof fetch});
 const result=await web.search({kind:'searxng',baseUrl:'http://127.0.0.1:8888/searx',credentialId:'search-secret',maxResults:1},{query:'story'},new AbortController().signal);
 assert.equal(requests,1);assert.equal(result.results.length,1);assert.equal(result.available,2);assert.equal(result.truncated,true);assert.ok(result.retrievedAt);
 for(const url of ['http://example.com','https://127.0.0.1/a','https://169.254.169.254/a','https://192.168.0.1/a','https://localhost.example.local/a','https://secret@example.com/a','https://example.com:8888/a'])assert.throws(()=>publicWebUrl(url));
 await assert.rejects(web.search({kind:'searxng',baseUrl:'http://8.8.8.8'},{query:'story'},new AbortController().signal));assert.equal(requests,1);
});
