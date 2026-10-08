/** Isolated local UI fixture. Never opens .workbench or a real model endpoint. */
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Engine} from '@workbench/core';
import {threeSceneDemo} from '../packages/core/src/demo-three-scenes.ts';
import {createAIProfile,ensureStudio} from '../packages/core/src/studio.ts';

const dataDir=process.env.WORKBENCH_FIXTURE_DIR??mkdtempSync(join(tmpdir(),'workbench-v2-ui-'));
if(!resolve(dataDir).startsWith(resolve(tmpdir(),'workbench-v2-ui-')))throw new Error('Only a temporary fixture directory can be resumed.');
const fresh=!existsSync(join(dataDir,'workbench.sqlite'));
if(fresh){const engine=new Engine(dataDir);engine.importProject(threeSceneDemo);
engine.studioMutation(engine.state().project.id,state=>{
 state.connections.push({id:'ui-fixture',name:'검증용 모의 API',kind:'openai',baseUrl:'http://127.0.0.1:4331/v1',apiMode:'chat',allowUnauthenticated:true});
 const profile=ensureStudio(state).profiles[0];
 createAIProfile(state,{...profile,id:'ui-fixture-chat',name:'검증용 채팅',connectionId:'ui-fixture',model:'fixture-model',effort:'',prompt:'프로젝트 원문을 조회하고 인물과 관계 초안을 제안하세요.',fallbacks:[],maxAttempts:1,timeoutMs:10000});
});engine.close();}
const mock=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'fixture-model',object:'model'}]}));return;}
 if(req.url!=='/v1/chat/completions'){res.statusCode=404;res.end('{}');return;}
 let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body),messages=request.messages as Array<Record<string,any>>;
 const after=messages.slice(messages.findLastIndex(message=>message.role==='user')+1),tools=after.filter(message=>message.role==='tool');
 const prefix=`fixture-${randomUUID()}`,call=(name:string,args:unknown)=>({id:prefix+'-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}});
 let message:Record<string,unknown>;
 if(!tools.length)message={role:'assistant',content:null,tool_calls:[call('read_script',{unitIds:['relay-01','relay-02']})]};
 else if(tools.length===1)message={role:'assistant',content:null,tool_calls:[call('draft_proposal',{title:'미라·준 인물 및 관계 초안',operations:[
  {kind:'knowledge.create',item:{id:prefix+'-profile',kind:'character',title:'미라 프로필',content:'미라는 자정에 중계소가 조용해졌다고 보고한다. 현재 원문만으로 동기나 직업은 확정하지 않는다.',evidenceIds:['relay-01'],branch:'common',visibility:'translator'}},
  {kind:'character.create',item:{id:prefix+'-mira',name:'미라',aliases:['Mira'],profileKnowledgeId:prefix+'-profile',evidenceIds:['relay-01']}},
  {kind:'character.create',item:{id:prefix+'-jun',name:'준',aliases:['Jun'],evidenceIds:['relay-02']}},
  {kind:'relationship.create',item:{id:prefix+'-relation',fromCharacterId:prefix+'-mira',toCharacterId:prefix+'-jun',direction:'mutual',kind:'정보 교환',description:'중계소의 침묵과 마지막 방문자에 대한 정보를 교환한다.',branch:'common',certainty:'inferred',evidenceIds:['relay-01','relay-02']}}
 ]})]};
 else message={role:'assistant',content:'원문 두 문장을 근거로 인물과 관계 초안을 만들었어. 수락하면 작품 자료의 인물·관계에서 볼 수 있어.'};
 if(request.stream===true){
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache');res.flushHeaders();
  const write=(delta:unknown,finish_reason:string|null=null)=>{if(res.destroyed)return false;res.write(`data: ${JSON.stringify({id:prefix,object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason}]})}\n\n`);return true;};
  write({role:'assistant'});
  const text=String(message.content??'원문을 읽으며 인물과 관계의 근거를 확인하고 있어.');
  // Delays belong only to this fake endpoint so browser stop/poll paths can be inspected.
  for(let offset=0;offset<text.length;offset+=4){if(!write({content:text.slice(offset,offset+4)}))return;await new Promise(resolve=>setTimeout(resolve,180));}
  for(const [index,tool] of ((message.tool_calls??[]) as Array<{id:string;type:string;function:{name:string;arguments:string}}>).entries()){
   write({tool_calls:[{index,id:tool.id,type:tool.type,function:{name:tool.function.name,arguments:''}}]});
   for(let offset=0;offset<tool.function.arguments.length;offset+=128){if(!write({tool_calls:[{index,function:{arguments:tool.function.arguments.slice(offset,offset+128)}}]}))return;await new Promise(resolve=>setTimeout(resolve,30));}
  }
  write({},message.tool_calls?'tool_calls':'stop');
  if(!res.destroyed)res.end(`data: ${JSON.stringify({model:'fixture-model',choices:[],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})}\n\ndata: [DONE]\n\n`);
  return;
 }
 res.end(JSON.stringify({id:prefix,object:'chat.completion',model:'fixture-model',choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
});
await new Promise<void>(done=>mock.listen(4331,'127.0.0.1',done));
process.env.WORKBENCH_DATA_DIR=dataDir;process.env.WORKBENCH_PORT='4330';
console.log(JSON.stringify({fixtureUrl:'http://127.0.0.1:4330',dataDir,projectId:threeSceneDemo.project.id,source:resolve('scripts/studio-browser-fixture.ts')}));
await import('../apps/worker/src/server.ts');
process.on('SIGINT',()=>mock.close());process.on('SIGTERM',()=>mock.close());
