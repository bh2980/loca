import {requireRunnableWorkflow} from './workflow-validation.ts';
import type {Engine} from '@workbench/core';
import {WorkbenchError} from '@workbench/core';
import type {Connection,WorkflowAIRequest,WorkflowAIResult,WorkflowExtensionRequest,WorkflowRunInput,WorkflowHumanInput} from '@workbench/contracts';
import {invokeProvider} from '@workbench/providers';
import {WorkflowRunner,createWorkflowRun,pauseWorkflowRun,resumeWorkflowRun,resolveWorkflowHuman,recoverWorkflowRuns} from '../../../packages/core/src/workflow.ts';
import {demoTranslations} from '../../../packages/core/src/fixture.ts';
import {threeSceneDemoTranslations} from '../../../packages/core/src/demo-three-scenes.ts';

export interface WorkflowServiceOptions {credential?:(connection:Connection)=>string|undefined;invoke?:(request:WorkflowAIRequest)=>Promise<WorkflowAIResult>;extension?:(request:WorkflowExtensionRequest)=>Promise<{data:unknown}>;finalize?:(runId:string)=>Promise<void>;autoStart?:boolean}
export class WorkflowService {
 readonly runner:WorkflowRunner;private timer?:ReturnType<typeof setInterval>;private pending?:Promise<void>;private closed=false;private terminal=new Set<string>();private finalizeRetry=new Map<string,{attempt:number;nextAt:number}>();
 constructor(private engine:Engine,private options:WorkflowServiceOptions={}){
  this.runner=new WorkflowRunner({read:()=>engine.state(),update:fn=>engine.studioMutation(engine.state().project.id,fn),invoke:options.invoke??(request=>this.invoke(request)),extension:options.extension});
  if(options.autoStart!==false)this.timer=setInterval(()=>{if(!this.pending&&!this.closed){this.pending=this.tick().catch(()=>{}).finally(()=>{this.pending=undefined;});}},100);
 }
 private scope(projectId:string){const state=this.engine.state();if(state.project.id!==projectId)throw new WorkbenchError('프로세스 요청이 다른 프로젝트에 속합니다.',409);return state;}
 start(projectId:string,input:WorkflowRunInput){
  const state=this.scope(projectId),definition=state.workflow?.definitions.find(item=>item.id===input.definitionId);if(!definition)throw new WorkbenchError('프로세스를 찾을 수 없습니다.',404);
  requireRunnableWorkflow(state,definition);
  for(const node of definition.nodes)if(node.type==='ai'){const profile=state.studio?.profiles.find(item=>item.id===node.config.profileId);if(!profile)throw new WorkbenchError('프로필을 찾을 수 없습니다.');this.engine.validateAIProfile(profile);for(const route of [profile,...profile.fallbacks??[]])if(state.connections.find(item=>item.id===route.connectionId)?.kind==='mock'&&!['night-transfer-demo','relay-three-scenes-demo'].includes(state.project.id))throw new WorkbenchError('모의 모델로 원본 프로젝트를 변경할 수 없습니다. 모의 시험을 사용하세요.');}
  return this.engine.studioMutation(projectId,state=>createWorkflowRun(state,input));
 }
 async tick(){
  await this.runner.tick();
  if(this.options.finalize)for(const run of this.engine.state().workflow?.runs??[])if(['completed','failed','cancelled'].includes(run.status)&&!this.terminal.has(run.id)&&Date.now()>=(this.finalizeRetry.get(run.id)?.nextAt??0)){
   try{await this.options.finalize(run.id);this.terminal.add(run.id);this.finalizeRetry.delete(run.id);}catch(error){const attempt=(this.finalizeRetry.get(run.id)?.attempt??0)+1;this.finalizeRetry.set(run.id,{attempt,nextAt:Date.now()+Math.min(60000,1000*2**Math.min(attempt,6))});this.engine.studioMutation(run.projectId,state=>{const current=state.workflow?.runs.find(item=>item.id===run.id);if(current)current.error=`종료 백업: ${(error as Error).message}`;});}
  }
 }
 control(projectId:string,id:string,action:'pause'|'resume'|'cancel',input:{interrupted?:'retry'|'hold'}={}){
  this.scope(projectId);if(action==='cancel')return this.runner.cancel(id);
  return this.engine.studioMutation(projectId,state=>action==='pause'?pauseWorkflowRun(state,id):resumeWorkflowRun(state,id,input));
 }
 human(projectId:string,id:string,input:WorkflowHumanInput){this.scope(projectId);return this.engine.studioMutation(projectId,state=>resolveWorkflowHuman(state,id,input));}
 private async invoke(request:WorkflowAIRequest):Promise<WorkflowAIResult>{
  const state=this.engine.state(),run=state.workflow?.runs.find(item=>item.id===request.runId),connection=run?.connections.find(item=>item.id===request.profile.connectionId);
  if(!run||!connection)throw new WorkbenchError('실행에 저장된 AI 연결을 찾을 수 없습니다. 새 실행에서 연결을 선택하세요.');
  if(connection.kind==='mock'){
   const translations=state.project.id==='relay-three-scenes-demo'?threeSceneDemoTranslations:state.project.id==='night-transfer-demo'?demoTranslations:undefined;
   if(!translations)throw new WorkbenchError('이 프로젝트에는 저장된 모의 번역이 없습니다.');
   const targetRows=request.context.targets as Array<{id:string;text?:string}>;
   return {data:{items:request.unitIds.map(unitId=>({unitId,text:targetRows.find(item=>item.id===unitId)?.text??translations[unitId]??'',passed:true,issues:[]}))},reportedModel:'fixture-workflow-v1'};
  }
  return invokeProvider({connection,profile:request.profile,prompt:`${request.prompt}\n\nProject context and exact target IDs:\n${JSON.stringify(request.context)}`,schema:request.schema,context:request.context,signal:request.signal,credential:this.options.credential?.(connection),workspaceDir:this.engine.dataDir});
 }
 async close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.runner.interruptAll();this.engine.studioMutation(this.engine.state().project.id,state=>recoverWorkflowRuns(state));await this.pending;}
}
