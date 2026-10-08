import {validateRunnableWorkflow,requireRunnableWorkflow} from './workflow-validation.ts';
import type {IncomingMessage} from 'node:http';
import type {Engine} from '@workbench/core';
import {WorkbenchError} from '@workbench/core';
import {WORKFLOW_NODE_TYPES,ensureWorkflow,createWorkflow,updateWorkflow,translationWorkflowTemplate,simulateWorkflow} from '../../../packages/core/src/workflow.ts';
import type {WorkflowService} from './workflow-service.ts';
import type {StudioResponse} from './studio-api.ts';

export async function workflowApi({engine,workflow,path,method,url,req,body}:{engine:Engine;workflow:WorkflowService;path:string;method:string;url:URL;req:IncomingMessage;body:(req:IncomingMessage)=>Promise<Record<string,any>>}):Promise<StudioResponse|undefined>{
 if(!path.startsWith('/api/studio/workflow'))return;
 const state=engine.state(),projectId=url.searchParams.get('projectId');if(projectId!==state.project.id)throw new WorkbenchError('다른 프로젝트의 요청입니다.',409);
 const storage=ensureWorkflow(state),result=(data:unknown,status=200)=>({status,data});
 if(path==='/api/studio/workflows/validate'&&method==='POST'){const input=await body(req);return result(validateRunnableWorkflow(state,input.definition));}
 if(path==='/api/studio/workflows'){
  if(method==='GET')return result({definitions:storage.definitions,nodeTypes:WORKFLOW_NODE_TYPES.map(type=>({...type,implemented:true})),template:translationWorkflowTemplate(state)});
  if(method==='POST'){const input=await body(req);requireRunnableWorkflow(state,input as Parameters<typeof requireRunnableWorkflow>[1]);return result(engine.studioMutation(projectId,state=>createWorkflow(state,input as Parameters<typeof createWorkflow>[1])),201);}
 }
 const match=path.match(/^\/api\/studio\/workflows\/([^/]+)(?:\/(validate))?$/);
 if(match){const id=decodeURIComponent(match[1]),definition=storage.definitions.find(item=>item.id===id);if(!definition)throw new WorkbenchError('프로세스를 찾을 수 없습니다.',404);
  if(method==='GET')return result(match[2]?validateRunnableWorkflow(state,definition):definition);
  if(method==='PATCH'){const input=await body(req);requireRunnableWorkflow(state,{...definition,...input});return result(engine.studioMutation(projectId,state=>updateWorkflow(state,id,input as Parameters<typeof updateWorkflow>[2])));}
  if(method==='POST'&&match[2])return result(validateRunnableWorkflow(state,await body(req) as Parameters<typeof validateRunnableWorkflow>[1]));
 }
 if(path==='/api/studio/workflow-trial'&&method==='POST'){const input=await body(req);return result(await simulateWorkflow(state,input as Parameters<typeof simulateWorkflow>[1]));}
 if(path==='/api/studio/workflow-runs'){
  if(method==='GET')return result({runs:storage.runs.map(({items,executions,profiles:_profiles,connections:_connections,definition:_definition,...run})=>({...run,counts:Object.fromEntries(['queued','running','waiting','completed','failed','cancelled'].map(status=>[status,items.filter(item=>item.status===status).length])),activeNodes:[...new Set(items.filter(item=>item.status==='running').map(item=>item.nodeId))],executions:executions.length}))});
  if(method==='POST'){const input=await body(req);if(!input.unitIds&&!input.groupId&&input.wholeProject!==true)throw new WorkbenchError('실행할 대사나 장면을 선택하세요.');const {wholeProject:_wholeProject,...scope}=input;return result(workflow.start(projectId,scope as Parameters<WorkflowService['start']>[1]),201);}
 }
 const runMatch=path.match(/^\/api\/studio\/workflow-runs\/([^/]+)(?:\/(pause|resume|cancel|human))?$/);
 if(runMatch){const id=decodeURIComponent(runMatch[1]),action=runMatch[2],run=storage.runs.find(item=>item.id===id);if(!run)throw new WorkbenchError('실행을 찾을 수 없습니다.',404);
  if(method==='GET')return result(run);
  if(method==='POST'&&action){const input=await body(req);return result(action==='human'?workflow.human(projectId,id,input as Parameters<WorkflowService['human']>[2]):workflow.control(projectId,id,action as 'pause'|'resume'|'cancel',input));}
 }
 return result({error:'프로세스 API를 찾을 수 없습니다.'},404);
}
