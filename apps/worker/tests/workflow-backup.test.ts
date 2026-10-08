import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '@workbench/core';
import {createWorkflow,createWorkflowRun} from '../../../packages/core/src/workflow.ts';
import {reconcileStudio} from '../../../packages/core/src/studio.ts';
import type {WorkflowExtensionRequest,WorkflowNode,ProjectBackup} from '@workbench/contracts';
import {WorkflowBackups} from '../src/workflow-backup.ts';

function fixture(){const dir=fs.mkdtempSync(join(tmpdir(),'workbench-backup-')),engine=new Engine(dir,{autoStart:false});const original=engine.state();engine.importProject({schemaVersion:1,project:{...original.project,id:'backup-test'},groups:[{id:'s',title:'Scene',description:'',kind:'scene',order:0,branch:'common',nextIds:[]}],units:Array.from({length:230},(_,i)=>({id:`u${i+1}`,groupId:'s',source:`Line ${i+1}`,kind:'dialogue',order:i,branch:'common',termIds:[]}))});const node:Extract<WorkflowNode,{type:'extension'}>={id:'backup',type:'extension',name:'백업',config:{handler:'backup',settings:{every:100,count:'committed',directory:'test'}}};
 const run=engine.studioMutation('backup-test',state=>{const definition=createWorkflow(state,{name:'Backup',nodes:[{id:'start',type:'start',name:'Start',config:{}},node,{id:'end',type:'end',name:'End',config:{}}],edges:[{id:'1',from:'start',fromPort:'next',to:'backup',toPort:'in'},{id:'2',from:'backup',fromPort:'next',to:'end',toPort:'in'}]});return createWorkflowRun(state,{definitionId:definition.id});});
 const request:WorkflowExtensionRequest={runId:run.id,node,executionId:'test',unitIds:['u1'],input:{},signal:new AbortController().signal};
 const commit=(count:number)=>engine.studioMutation('backup-test',state=>{const current=state.workflow!.runs[0];current.committedUnitIds=state.units.slice(0,count).map(item=>item.id);for(const id of current.committedUnitIds){const t=state.translations[id];if(!t.version){t.text=`번역 ${id}`;t.version=1;t.status='draft';t.history.push({text:t.text,version:1,origin:'ai',createdAt:new Date().toISOString(),reason:'시험 대표 번역',termVersions:{}});}}reconcileStudio(state);});
 return {dir,engine,request,commit,cleanup(){engine.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('crossing 95→112 and multiple thresholds writes one consistent snapshot, repeats never count twice',()=>{
 const f=fixture();try{const backups=new WorkflowBackups(f.engine);f.commit(95);assert.equal((backups.execute(f.request).data as {saved:boolean}).saved,false);
  f.commit(112);const revision=f.engine.state().revision,first=backups.execute(f.request).data as {path:string;revision:number;count:number;thresholds:number[]};assert.equal(first.count,112);assert.equal(first.revision,revision);assert.deepEqual(first.thresholds,[100]);
  const file=JSON.parse(fs.readFileSync(first.path,'utf8')) as ProjectBackup&{workflowCheckpoint:{capturedRevision:number}};assert.equal(file.workflowCheckpoint.capturedRevision,revision);assert.equal(file.data.translations.u112.text,'번역 u112');assert.equal(file.data.translations.u113.text,'');assert.equal(file.data.workflow?.runs[0].backups?.backup.nextThreshold,200);assert.equal(file.data.workflow?.runs[0].backups?.backup.lastCount,112);
  assert.equal((backups.execute(f.request).data as {saved:boolean}).saved,false);f.commit(225);const second=backups.execute(f.request).data as {count:number;thresholds:number[]};assert.equal(second.count,225);assert.deepEqual(second.thresholds,[200]);
  const other=fixture();try{other.commit(225);const jumped=new WorkflowBackups(other.engine).execute(other.request).data as {thresholds:number[]};assert.deepEqual(jumped.thresholds,[100,200]);assert.equal(other.engine.state().workflow?.runs[0].backups?.backup.files.length,1);}finally{other.cleanup();}
 }finally{f.cleanup();}
});
test('failed rename recovers exact pending bytes after later commits; final remainder and restore retain counters',()=>{
 const f=fixture();try{let fail=true;const io={...fs,renameSync:(from:fs.PathLike,to:fs.PathLike)=>{if(fail){fail=false;throw new Error('injected disk failure');}fs.renameSync(from,to);}};const backups=new WorkflowBackups(f.engine,io);f.commit(112);const captured=f.engine.state().revision;
  assert.throws(()=>backups.execute(f.request),/disk failure/);assert.ok(f.engine.state().workflow?.runs[0].backups?.backup.pending);f.commit(120);
  const recovered=new WorkflowBackups(f.engine);recovered.recoverPending();let progress=f.engine.state().workflow!.runs[0].backups!.backup;assert.equal(progress.lastCount,112);assert.equal(progress.pending,undefined);assert.equal(progress.files.length,1);
  const exact=JSON.parse(fs.readFileSync(progress.files[0].path,'utf8')) as ProjectBackup&{workflowCheckpoint:{capturedRevision:number}};assert.equal(exact.workflowCheckpoint.capturedRevision,captured);assert.equal(exact.data.translations.u120.text,'');
  const final=recovered.execute(f.request,true).data as {path:string;final:boolean};assert.equal(final.final,true);progress=f.engine.state().workflow!.runs[0].backups!.backup;assert.equal(progress.lastCount,120);assert.equal(progress.files.length,2);
  const target=new Engine('unused',{memory:true,autoStart:false});try{target.restoreProject(JSON.parse(fs.readFileSync(final.path,'utf8')));assert.equal(target.state().workflow?.runs[0].backups?.backup.lastCount,120);assert.equal(target.state().workflow?.runs[0].status,'paused');assert.deepEqual(target.state().workflow?.runs[0].connections,[]);}finally{target.close();}
 }finally{f.cleanup();}
});
test('backup rejects traversal, counts only selected unique primary units and includes no connection secrets',()=>{
 const f=fixture();try{const backups=new WorkflowBackups(f.engine);assert.throws(()=>backups.execute({...f.request,node:{...f.request.node,config:{handler:'backup',settings:{directory:'../../outside'}}}}),/폴더/);
  f.commit(95);f.engine.studioMutation('backup-test',state=>{state.workflow!.runs[0].committedUnitIds.push('u1','u1','unknown');});assert.equal((backups.execute(f.request).data as {count:number}).count,95);
  f.commit(112);const result=backups.execute(f.request).data as {path:string};const file=JSON.parse(fs.readFileSync(result.path,'utf8')) as ProjectBackup;assert.ok(!('connections' in file.data));assert.ok(!('profiles' in file.data));assert.deepEqual(file.data.workflow!.runs[0].connections,[]);
 }finally{f.cleanup();}
});
