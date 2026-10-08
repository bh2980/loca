import {createHash,randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import {resolve,join,sep,isAbsolute} from 'node:path';
import type {Engine} from '@workbench/core';
import {WorkbenchError} from '@workbench/core';
import type {ProjectBackup,WorkflowBackupProgress,WorkflowExtensionRequest,WorkflowRun,WorkspaceState} from '@workbench/contracts';

type BackupSettings={every:number;count:'committed'|'confirmed';directory:string};
type BackupIO=Pick<typeof fs,'existsSync'|'mkdirSync'|'readFileSync'|'writeFileSync'|'renameSync'>;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const safeName=(value:string)=>hash(value).slice(0,12);
function settings(value:Record<string,unknown>):BackupSettings{
 const every=value.every??100,count=value.count??'committed',directory=value.directory??'';
 if(!Number.isSafeInteger(every)||Number(every)<1||Number(every)>20000||!['committed','confirmed'].includes(String(count))||typeof directory!=='string'||isAbsolute(directory)||directory.split(/[\\/]/).includes('..'))throw new WorkbenchError('백업 간격·집계 기준·저장 폴더를 확인하세요.');
 return {every:Number(every),count:count as BackupSettings['count'],directory};
}
export const validateWorkflowBackupSettings=settings;
function snapshot(state:WorkspaceState):ProjectBackup{
 const {connections:_connections,profiles:_profiles,revision:_revision,graphSummary:_graphSummary,...data}=structuredClone(state);
 for(const run of data.runs)run.connections=[];for(const run of data.workflow?.runs??[])run.connections=[];
 for(const item of data.taskSnapshots??[])item.connection={id:item.connection.id,name:item.connection.name,kind:item.connection.kind};
 return {format:'translation-workbench-backup',version:1,savedAt:new Date().toISOString(),data};
}

/** The immutable spool is written before recording pending work. Once pending
 * exists, every retry uses those exact bytes, regardless of later translations. */
export class WorkflowBackups {
 private readonly root:string;
 constructor(private engine:Engine,private io:BackupIO=fs){this.root=resolve(engine.dataDir,'backups');}
 private inside(path:string){const resolved=resolve(path);if(resolved!==this.root&&!resolved.startsWith(this.root+sep))throw new WorkbenchError('백업 경로가 지정 폴더 밖입니다.');return resolved;}
 private run(state:WorkspaceState,id:string){const run=state.workflow?.runs.find(item=>item.id===id);if(!run)throw new WorkbenchError('백업 실행을 찾을 수 없습니다.',404);return run;}
 private count(run:WorkflowRun,config:BackupSettings){return new Set((config.count==='confirmed'?run.confirmedUnitIds:run.committedUnitIds).filter(id=>run.targetUnitIds.includes(id))).size;}
 private finishPending(projectId:string,runId:string,nodeId:string,progress:WorkflowBackupProgress){
  const pending=progress.pending;if(!pending)return;
  const destination=this.inside(pending.path),spool=this.inside(pending.spoolPath),existing=this.io.existsSync(destination);
  const path=existing?destination:spool;
  if(!this.io.existsSync(path))throw new WorkbenchError('대기 중인 백업 파일을 찾을 수 없습니다.');
  if(hash(this.io.readFileSync(path))!==pending.digest)throw new WorkbenchError('대기 중인 백업 파일의 내용이 변경되었습니다.');
  if(!existing)this.io.renameSync(spool,destination);
  return this.engine.studioMutation(projectId,state=>{
   const current=this.run(state,runId).backups?.[nodeId];if(!current?.pending||current.pending.digest!==pending.digest)throw new WorkbenchError('백업 집계가 변경되었습니다.',409);
   const record={path:destination,revision:pending.revision,count:pending.count,thresholds:pending.thresholds,final:pending.final,createdAt:new Date().toISOString()};
   if(!current.files.some(file=>file.path===destination))current.files.push(record);
   current.lastCount=Math.max(current.lastCount,pending.count);current.nextThreshold=pending.nextThreshold;delete current.pending;return record;
  });
 }
 execute(request:WorkflowExtensionRequest,final=false):{data:unknown}{
  if(request.signal.aborted)throw new WorkbenchError('백업이 취소되었습니다.');
  const config=settings(request.node.config.settings);let state=this.engine.state(),run=this.run(state,request.runId),progress=run.backups?.[request.node.id];
  if(progress?.pending){this.finishPending(state.project.id,run.id,request.node.id,progress);state=this.engine.state();run=this.run(state,request.runId);progress=run.backups?.[request.node.id];}
  const count=this.count(run,config),current=progress??{nextThreshold:config.every,lastCount:0,files:[]};
  if(count<=current.lastCount||(!final&&count<current.nextThreshold))return {data:{saved:false,count,nextThreshold:current.nextThreshold}};
  const thresholds:number[]=[];let nextThreshold=current.nextThreshold;while(nextThreshold<=count){thresholds.push(nextThreshold);nextThreshold+=config.every;}
  const directory=this.inside(join(this.root,config.directory));this.io.mkdirSync(directory,{recursive:true});
  const filename=`${safeName(state.project.id)}-${safeName(run.id)}-${safeName(request.node.id)}-${count}-r${state.revision}.json`;
  const path=this.inside(join(directory,filename)),spoolPath=this.inside(join(directory,`.pending-${randomUUID()}.json`)),createdAt=new Date().toISOString();
  const record={path,revision:state.revision,count,thresholds,final,createdAt};
  const backup=snapshot(state),savedRun=backup.data.workflow!.runs.find(item=>item.id===run.id)!;
  // The checkpoint itself restores the counters for exactly the primary texts it includes.
  (savedRun.backups??={})[request.node.id]={lastCount:count,nextThreshold,files:[...current.files,record]};
  const payload=JSON.stringify({...backup,workflowCheckpoint:{runId:run.id,nodeId:request.node.id,capturedRevision:state.revision,count,thresholds,final}}),digest=hash(payload);
  this.io.writeFileSync(spoolPath,payload,{encoding:'utf8',flag:'wx'});
  this.engine.studioMutation(state.project.id,latest=>{
   const item=this.run(latest,run.id),stored=(item.backups??={})[request.node.id]??=structuredClone(current);
   if(stored.pending||stored.lastCount!==current.lastCount)throw new WorkbenchError('백업 집계가 변경되었습니다.',409);
   stored.pending={spoolPath,path,digest,revision:state.revision,count,thresholds,final,nextThreshold};
  });
  const result=this.finishPending(state.project.id,run.id,request.node.id,{...current,pending:{spoolPath,path,digest,revision:state.revision,count,thresholds,final,nextThreshold}});
  return {data:{saved:true,...result}};
 }
 finalize(runId:string){
  const run=this.run(this.engine.state(),runId);
  for(const node of run.definition.nodes)if(node.type==='extension'&&node.config.handler==='backup'&&run.executions.some(execution=>execution.nodeId===node.id))this.execute({runId,node,executionId:'final-remainder',unitIds:[],input:{},signal:new AbortController().signal},true);
 }
 recoverPending(){
  const state=this.engine.state();for(const run of state.workflow?.runs??[])for(const [nodeId,progress] of Object.entries(run.backups??{}))if(progress.pending)this.finishPending(state.project.id,run.id,nodeId,progress);
 }
}
