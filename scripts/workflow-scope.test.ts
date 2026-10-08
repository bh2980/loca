import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../packages/core/src/engine.ts';
import {ensureStudio} from '../packages/core/src/studio.ts';
import {createWorkflow,createWorkflowRun,simulateWorkflow} from '../packages/core/src/workflow.ts';
import {workflowRunSelection,workflowTargets,type WorkflowScope} from '../apps/web/src/workflow-scope.ts';
import type {WorkflowDefinitionInput} from '../packages/contracts/src/index.ts';

function fixture(){const state=initialState(),base=structuredClone(state.translations['S0-01']);delete state.studio;state.project.id='scope-test';state.units=['u1','u2','u3','u4'].map((id,index)=>({id,groupId:index===3?'g2':'g1',source:`Source ${id}`,kind:'dialogue' as const,order:index,branch:'common',termIds:[]}));state.groups=['g1','g2'].map((id,index)=>({id,title:id,description:'',kind:'scene' as const,order:index,branch:'common',nextIds:[]}));state.translations=Object.fromEntries(state.units.map(unit=>[unit.id,{...structuredClone(base),unitId:unit.id}]));state.terms=[];state.knowledge=[];const studio=ensureStudio(state);studio.labels=['a','b'].map(id=>({id,name:id,color:'#abc',version:1}));studio.statuses.push({id:'custom',name:'custom',color:'#abc',role:'custom',version:1});for(const id of ['u1','u4'])Object.assign(studio.progress[id],{statusId:'status:draft',labelIds:['a','b']});Object.assign(studio.progress.u2,{statusId:'status:confirmed',labelIds:['a']});Object.assign(studio.progress.u3,{statusId:'custom',labelIds:['a','b']});return state;}
const definition:WorkflowDefinitionInput={name:'scope',nodes:[{id:'s',name:'s',type:'start',config:{}},{id:'e',name:'e',type:'end',config:{}}],edges:[{id:'edge',from:'s',fromPort:'next',to:'e',toPort:'in'}]};
const scope:WorkflowScope={scope:'scene',groupId:'g1',targetText:'',statusIds:['status:draft','status:confirmed'],labelIds:['a','b']};

test('workflow scope intersects scene/IDs/all with status OR and label AND, retaining every matching ID',()=>{
 const state=fixture(),before=structuredClone(state);assert.deepEqual(workflowTargets(state,scope).unitIds,['u1']);assert.deepEqual(workflowTargets(state,{...scope,scope:'all'}).unitIds,['u1','u4']);assert.deepEqual(workflowTargets(state,{...scope,scope:'ids',targetText:'u4, u1 u4 u2'}).unitIds,['u4','u1']);assert.equal(workflowTargets(state,scope).scopeCount,3);assert.deepEqual(workflowTargets(state,{...scope,statusIds:[],labelIds:[]}).unitIds,['u1','u2','u3']);assert.deepEqual(state,before);
});
test('missing IDs and definitions cannot silently widen selection; zero targets cannot start',()=>{
 const state=fixture(),bad=workflowTargets(state,{...scope,scope:'ids',targetText:'u1 missing'});assert.deepEqual(bad.missingUnitIds,['missing']);assert.equal(bad.valid,false);assert.throws(()=>workflowRunSelection('d',bad,scope),/없는/);const missing=workflowTargets(state,{...scope,statusIds:['missing-status'],labelIds:['missing-label']});assert.deepEqual(missing.missingStatusIds,['missing-status']);assert.deepEqual(missing.missingLabelIds,['missing-label']);assert.throws(()=>workflowRunSelection('d',missing,scope),/없는/);assert.throws(()=>workflowRunSelection('d',workflowTargets(state,{...scope,groupId:'g2',statusIds:['custom']}),scope),/없습니다/);
});
test('preview, mock trial and real run use the same filtered IDs and current progress changes update selection',async()=>{
 const state=fixture(),targets=workflowTargets(state,scope),saved=createWorkflow(state,definition),selection=workflowRunSelection(saved.id,targets,scope),run=createWorkflowRun(structuredClone(state),selection),before=structuredClone(state),trial=await simulateWorkflow(state,{definition,unitIds:selection.unitIds!});assert.deepEqual(run.targetUnitIds,targets.unitIds);assert.deepEqual(trial.run?.targetUnitIds,targets.unitIds);assert.deepEqual(state,before);state.studio!.progress.u1.statusId='custom';assert.deepEqual(workflowTargets(state,scope).unitIds,[]);
});
