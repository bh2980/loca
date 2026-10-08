import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {WorkflowBinding,WorkflowExtensionRequest,WorkflowJson,WorkflowNode,WorkflowRun} from '@workbench/contracts';
import {initialState} from '../../../packages/core/src/engine.ts';
import {executeWorkflowHttp,validateWorkflowHttpSettings,validateWorkflowToolConnection} from '../src/workflow-http.ts';

const field=(path:string):WorkflowBinding=>({kind:'field',path});
const constant=(value:WorkflowJson):WorkflowBinding=>({kind:'constant',value});
function setup(overrides:Record<string,WorkflowJson>={},count=2){
 const state=initialState(),ids=state.units.slice(0,count).map(unit=>unit.id),now=new Date().toISOString();
 const node:Extract<WorkflowNode,{type:'extension'}>={id:'http',name:'사전',type:'extension',config:{handler:'http',settings:{connectionId:'dictionary',method:'POST',path:'/spell',mode:'individual',body:{text:field('data.text'),original:field('source')},responseFields:{text:'output.text'},...overrides}}};
 const input={items:ids.map(unitId=>({unitId,data:{text:`draft-${unitId}`},mapped:{label:'mapped'},translationVersion:state.translations[unitId].version,revisionCounts:{}}))};
 const tool={id:'dictionary',name:'Dictionary',baseUrl:'http://192.168.1.20:9000/api',version:1,auth:'none' as const};
 const run:WorkflowRun={id:'run',projectId:state.project.id,definitionId:'definition',definitionVersion:1,definition:{id:'definition',projectId:state.project.id,name:'Tool',version:1,nodes:[node],edges:[],maxNodeVisits:10,createdAt:now,updatedAt:now},profiles:{},connections:[],toolConnections:[structuredClone(tool)],targetUnitIds:ids,items:ids.map(unitId=>({unitId,nodeId:node.id,status:'running',sourceSnapshot:JSON.stringify(state.units.find(unit=>unit.id===unitId)),translationVersion:state.translations[unitId].version,progressVersion:1,revisionCounts:{},nodeVisits:{},data:{text:'untrusted newer item data'},contextVersions:[],batchKey:'selection',executionId:'execution',path:[]})),executions:[{id:'execution',runId:'run',nodeId:node.id,unitIds:ids,status:'running',startedAt:now,input:structuredClone(input),attempts:[],routeIndex:0,routeAttempts:0,resultRefs:[]}],status:'running',createdAt:now,updatedAt:now,startedBy:'user',committedUnitIds:[],confirmedUnitIds:[]};
 state.workflow={version:1,projectId:state.project.id,definitions:[],runs:[run],toolConnections:[tool]};const controller=new AbortController();
 const request:WorkflowExtensionRequest={runId:run.id,executionId:'execution',node:structuredClone(node),unitIds:ids,input:structuredClone(input),signal:controller.signal};return {state,request,run,controller,ids,tool};
}
function fake(fn:(url:URL,init:RequestInit)=>Response|Promise<Response>):typeof fetch{return (async(url,init)=>fn(new URL(String(url)),init??{})) as typeof fetch;}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('individual POST maps pinned source/input, owns ids, and never applies or mutates results',async()=>{
 const {state,request,ids}=setup({body:{unitId:constant('forged'),text:field('data.text'),original:field('source'),current:field('currentTranslation'),label:field('mapped.label')}});const before=structuredClone(state);let sent=0;
 const result=await executeWorkflowHttp({state,request,fetch:fake((url,init)=>{
  assert.equal(url.href,'http://192.168.1.20:9000/spell');assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.equal((init.headers as Record<string,string>).Authorization,undefined);
  const body=JSON.parse(init.body as string),unitId=ids[sent++];assert.equal(body.unitId,unitId);assert.equal(body.text,`draft-${unitId}`);assert.equal(body.original,state.units.find(unit=>unit.id===unitId)!.source);assert.equal(body.current,state.translations[unitId].text);assert.equal(body.label,'mapped');return json({output:{text:'corrected'}});
 })});
 assert.equal(sent,2);assert.deepEqual(result.data.items,ids.map(unitId=>({unitId,result:{text:'corrected'}})));assert.deepEqual(state,before);
});
test('GET query values use JSON serialization and batch ids are matched despite response reorder',async()=>{
 const {state,request,ids}=setup({method:'GET',mode:'batch',body:undefined as unknown as WorkflowJson,query:{items:field('items'),flag:constant(true)},responseItemsPath:'results',responseIdField:'meta.id',responseFields:{suggestions:'suggestions'}});
 delete request.node.config.settings.body;delete (state.workflow!.runs[0].definition.nodes[0] as Extract<WorkflowNode,{type:'extension'}>).config.settings.body;
 const result=await executeWorkflowHttp({state,request,fetch:fake((url,init)=>{
  assert.equal(init.body,undefined);assert.equal(JSON.parse(url.searchParams.get('flag')!),true);assert.deepEqual(JSON.parse(url.searchParams.get('items')!).map((row:{unitId:string})=>row.unitId),ids);return json({results:[...ids].reverse().map(unitId=>({meta:{id:unitId},suggestions:[unitId]}))});
 })});assert.deepEqual(result.data.items,ids.map(unitId=>({unitId,result:{suggestions:[unitId]}})));
});
test('batch POST maps per unit body and overwrites caller unitId with original ids',async()=>{
 const {state,request,ids}=setup({mode:'batch',body:{unitId:constant('forged'),text:field('data.text')}});
 const result=await executeWorkflowHttp({state,request,fetch:fake((_url,init)=>{const body=JSON.parse(init.body as string);assert.deepEqual(body,{items:ids.map(unitId=>({unitId,text:`draft-${unitId}`}))});return json({items:ids.map(unitId=>({unitId,output:{text:unitId}}))});})});assert.equal(result.data.items.length,2);
});
test('batch rejects missing, duplicate, nonstring and cross-unit response ids without partial output',async()=>{
 for(const build of [(ids:string[])=>[ids[0]],(ids:string[])=>[ids[0],ids[0]],()=>['another-project','other'],()=>[1,2]]){
  const {state,request,ids}=setup({mode:'batch'});await assert.rejects(executeWorkflowHttp({state,request,fetch:fake(()=>json({items:build(ids).map(unitId=>({unitId,output:{text:'bad'}}))}))}),/ID|대사 수/);
 }
});
test('only explicit bounded retries retry 429/503; malformed JSON and permanent errors are never retried',async()=>{
 for(const status of [429,503]){
  const {state,request}=setup({maxAttempts:2},1);let calls=0;const result=await executeWorkflowHttp({state,request,fetch:fake(()=>++calls===1?json({secret:'discard'},status):json({output:{text:'ok'}}))});assert.equal(calls,2);assert.equal(result.data.attempts,2);
 }
 for(const response of [json({},429),json({},400),new Response('{bad',{headers:{'Content-Type':'application/json'}})]){
  const {state,request}=setup({},1);let calls=0;await assert.rejects(executeWorkflowHttp({state,request,fetch:fake(()=>{calls++;return response;})}));assert.equal(calls,1);
 }
 const {state,request}=setup({maxAttempts:3},1);let calls=0;await assert.rejects(executeWorkflowHttp({state,request,fetch:fake(()=>{calls++;return new Response('{bad');})}),/JSON/);assert.equal(calls,1);
});
test('tool auth is isolated, pinned to run connection, and redacted recursively including encoded echoes',async()=>{
 const {state,request,run,tool}=setup({responseFields:{result:'echo'}},1);const secret='tool-only-secret/+!';run.toolConnections![0].auth='bearer';tool.baseUrl='https://new-address.invalid';let resolved=0;
 const result=await executeWorkflowHttp({state,request,credential:connection=>{resolved++;assert.equal(connection.baseUrl,'http://192.168.1.20:9000/api');return secret;},fetch:fake((url,init)=>{assert.equal(url.hostname,'192.168.1.20');assert.equal((init.headers as Record<string,string>).Authorization,`Bearer ${secret}`);return json({echo:{raw:secret,nested:[`Bearer ${secret}`,encodeURIComponent(secret),Buffer.from(secret).toString('base64')], [secret]:'key'}});})});
 assert.equal(resolved,1);assert.doesNotMatch(JSON.stringify(result),/tool-only-secret/);assert.ok(JSON.stringify(result).includes('[REDACTED]'));
 await assert.rejects(executeWorkflowHttp({state,request,credential:()=>secret,fetch:fake(()=>{throw new Error(`server leaked ${secret}`);})}),error=>error instanceof Error&&!error.message.includes(secret));
});
test('header auth uses safe dedicated header and none never resolves credentials',async()=>{
 const {state,request,run}=setup({},1);run.toolConnections![0].auth='header';run.toolConnections![0].headerName='X-API-Key';
 await executeWorkflowHttp({state,request,credential:()=> 'test-tool-key',fetch:fake((_url,init)=>{assert.equal((init.headers as Record<string,string>)['X-API-Key'],'test-tool-key');return json({output:{text:'ok'}});})});
 run.toolConnections![0].auth='none';await executeWorkflowHttp({state,request,credential:()=>{throw new Error('must not resolve');},fetch:fake(()=>json({output:{text:'ok'}}))});
 for(const headerName of ['Authorization','Host','Content-Type','Cookie','X-Forwarded-For','X-HTTP-Method-Override','X-Authorization','X-Real-IP','X-Key\r\nBad'])assert.throws(()=>validateWorkflowToolConnection({...run.toolConnections![0],auth:'header',headerName}),/헤더/);
});
test('numeric authentication echoes are redacted even when service serializes them as JSON numbers',async()=>{
 const {state,request,run}=setup({responseFields:{echo:'echo'}},1);run.toolConnections![0].auth='bearer';const result=await executeWorkflowHttp({state,request,credential:()=> '123456',fetch:fake(()=>json({echo:{numeric:123456,nested:[123456]}}))});assert.doesNotMatch(JSON.stringify(result),/123456/);assert.equal((result.data.items[0].result.echo as Record<string,unknown>).numeric,'[REDACTED]');
});
test('rejects foreign unit/config/input/project or stale source/translation before network',async()=>{
 const mutations=[(s:ReturnType<typeof setup>)=>{s.request.unitIds=['foreign'];},(s:ReturnType<typeof setup>)=>{s.request.input.items=[];},(s:ReturnType<typeof setup>)=>{s.request.node.config.settings.path='/changed';},(s:ReturnType<typeof setup>)=>{s.run.projectId='other';},(s:ReturnType<typeof setup>)=>{s.state.units.find(unit=>unit.id===s.ids[0])!.source='changed';},(s:ReturnType<typeof setup>)=>{s.state.translations[s.ids[0]].version++;}];
 for(const mutate of mutations){const s=setup();mutate(s);let calls=0;await assert.rejects(executeWorkflowHttp({...s,fetch:fake(()=>{calls++;return json({});})}));assert.equal(calls,0);}
});
test('validates URL policy, schemas and safe field paths without network',()=>{
 const {state,request,tool}=setup(),valid=request.node.config.settings;
 for(const path of ['https://evil.invalid/','//evil.invalid/','\\\\evil.invalid/','/test?auth=secret','/test#hash'])assert.throws(()=>validateWorkflowHttpSettings(state,{...valid,path}));
 for(const baseUrl of ['http://public.example/api','https://user:pass@server.invalid','ftp://localhost','https://server.invalid?key=bad']){tool.baseUrl=baseUrl;assert.throws(()=>validateWorkflowHttpSettings(state,valid));}tool.baseUrl='https://dictionary.example/api';assert.doesNotThrow(()=>validateWorkflowHttpSettings(state,valid));
 for(const responseFields of [{text:'__proto__.secret'},{text:'data.constructor.name'},{text:'items[0].value'}])assert.throws(()=>validateWorkflowHttpSettings(state,{...valid,responseFields}));
 for(const maxAttempts of [0,4,1.5])assert.throws(()=>validateWorkflowHttpSettings(state,{...valid,maxAttempts}));assert.throws(()=>validateWorkflowHttpSettings(state,{...valid,method:'DELETE'}));assert.throws(()=>validateWorkflowHttpSettings(state,{...valid,query:{text:{kind:'javascript',path:'eval()'}}}));
});
test('pre-cancellation, timeout and cancellation abort even signal-ignoring fetch/body',async()=>{
 const first=setup({},1);first.controller.abort();let calls=0;await assert.rejects(executeWorkflowHttp({...first,fetch:fake(()=>{calls++;return json({});})}),/중지/);assert.equal(calls,0);
 for(const kind of ['timeout','stop','body']){
  const s=setup({timeoutMs:25},1);const started=Date.now();const promise=executeWorkflowHttp({...s,fetch:fake((_url,init)=>{assert.ok(init.signal);if(kind==='body')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}}));return new Promise<Response>(()=>{});})});if(kind==='stop')setTimeout(()=>s.controller.abort(),5);await assert.rejects(promise,/중지|제한 시간/);assert.ok(Date.now()-started<1000);
 }
});
test('oversized/unsafe JSON and redirects are rejected without mapping or applying',async()=>{
 for(const response of [json({output:{text:'x'.repeat(2*1024*1024)}}),new Response('{"__proto__":{"polluted":true}}',{headers:{'Content-Type':'application/json'}}),new Response('',{status:302,headers:{Location:'https://elsewhere.invalid'}}),new Response('not-json',{headers:{'Content-Type':'text/html'}})]){
  const s=setup({},1),before=structuredClone(s.state);await assert.rejects(executeWorkflowHttp({...s,fetch:fake(()=>response)}));assert.deepEqual(s.state,before);
 }
});
test('duplicated response mappings and aggregate individual payloads cannot expand past execution size budget',async()=>{
 const s=setup({responseFields:{one:'text',two:'text',three:'text'}},1);await assert.rejects(executeWorkflowHttp({...s,fetch:fake(()=>json({text:'x'.repeat(800000)}))}),/2MiB/);
 const t=setup({body:{large:constant('x'.repeat(1200000))}});let calls=0;await assert.rejects(executeWorkflowHttp({...t,fetch:fake(()=>{calls++;return json({});})}),/2MiB/);assert.equal(calls,0);
});
