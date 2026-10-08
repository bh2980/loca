import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IncomingMessage} from 'node:http';
import {Engine} from '@workbench/core';
import {studioApi} from '../src/studio-api.ts';
import {translationWorkflowTemplate} from '../../../packages/core/src/workflow.ts';
import {validateRunnableWorkflow} from '../src/workflow-validation.ts';
import {queryProject} from '../../../packages/core/src/project-query.ts';

test('candidate API supplies exact source baseline omitted from UI polling; human assignment stays scoped and atomic',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-studio-api-')),engine=new Engine(dir);
 try{
  const state=engine.state(),projectId=state.project.id,unitId=state.units[0].id;
  engine.studioMutation(projectId,state=>{state.units[0].sourceRef={fixture:'source provenance'};});
  const invoke=(path:string,method='GET',input:Record<string,unknown>={})=>studioApi({engine,chat:{start(){throw new Error('unexpected AI');},stop(){}},path,method,url:new URL(`http://localhost${path}?projectId=${projectId}&unitId=${unitId}`),req:{} as IncomingMessage,body:async()=>input});
  const payload=(await invoke('/api/studio/candidates'))!.data as {sourceSnapshot:string;translationVersion:number;progress:{version:number}};
  assert.equal(payload.sourceSnapshot,JSON.stringify(engine.state().units[0]));
  const op={kind:'label.create',item:{id:'checked-source',name:'근거 확인',color:'#123456'}};
  await invoke('/api/studio/apply','POST',{operations:[op,{kind:'unit.assign',unitId,expectedVersion:payload.progress.version,labelIds:['checked-source']}],baseVersions:[{kind:'source',id:unitId,snapshot:payload.sourceSnapshot}]});
  assert.deepEqual(engine.state().studio!.progress[unitId].labelIds,['checked-source']);
  const before=engine.state();await assert.rejects(invoke('/api/studio/apply','POST',{operations:[{...op,item:{...op.item,id:'stale-label'}},{kind:'unit.assign',unitId,expectedVersion:payload.progress.version,labelIds:['stale-label']}]}));
  assert.deepEqual(engine.state().studio,before.studio);
 }finally{engine.close();rmSync(dir,{recursive:true,force:true});}
});

test('runtime validation checks external HTTP connections before execution; progress query reads custom workflows',()=>{
 const dir=mkdtempSync(join(tmpdir(),'workbench-run-validation-')),engine=new Engine(dir);
 try{
  const state=engine.state(),definition=translationWorkflowTemplate(state);
  const query=definition.nodes.find(node=>node.type==='query')!;
  definition.nodes=definition.nodes.map(node=>node.id===query.id?{...node,type:'extension',config:{handler:'http',settings:{connectionId:'missing',method:'GET',path:'/',mode:'individual',responseFields:{value:'value'}}}}:node);
  const result=validateRunnableWorkflow(state,definition);assert.equal(result.ok,false);assert.ok(result.issues.some(issue=>issue.code==='extension'&&issue.nodeId===query.id));
  const empty=queryProject(state,'run_progress',{}) as {total:number};assert.equal(empty.total,0);
 }finally{engine.close();rmSync(dir,{recursive:true,force:true});}
});
