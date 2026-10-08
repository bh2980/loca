import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {graphNodeSemantics,graphNodeHasRuntimeGuard,graphNodeSourceLabel,isGraphControlNode,type GraphNode,type ProjectInput} from '@workbench/contracts';
import {classifyGraphNode} from '../apps/web/src/flow-layout.ts';
import {projectSceneGraphView} from '../packages/core/src/scene-projection.ts';
import {Engine} from '../packages/core/src/engine.ts';

const node=(kind?:string,unitIds:string[]=[]):GraphNode=>({id:kind??'unknown',kind,unitIds,groupIds:[],conditions:{_priority:1,_ignoreSaveGameLoadingOrder:0}});
test('screenshot classes have verified behavior even without source text; person merging is an action',()=>{
 const roles={EmptyState:'connector',ToolUnlockedState:'state',NewCommentaryState:'state',NewPersonState:'state',NewTargetPersonState:'state',DocumentViewedState:'condition',MergePersonsState:'state'} as const;
 for(const [kind,shape] of Object.entries(roles))for(const units of [[],['linked-text']]){
  const original=node(kind,units),before=structuredClone(original),meaning=graphNodeSemantics(original);
  assert.equal(classifyGraphNode(original),shape);assert.equal(meaning.verified,true);assert.ok(meaning.summary);assert.match(meaning.evidence!,/all_methods\.il\.txt/);
  assert.equal(isGraphControlNode(original),true);assert.deepEqual(original,before);
 }
});
test('scheduling fields do not claim conditions; genuine checks and completion waits do',()=>{
 for(const kind of ['EmptyState','ToolUnlockedState','NewPersonState','NewTargetPersonState'])assert.equal(graphNodeHasRuntimeGuard(node(kind)),false);
 for(const kind of ['DocumentViewedState','OrState','AtLeastState','IfElseState','NewCommentaryState','AtClockTimeState','WaitState'])assert.equal(graphNodeHasRuntimeGuard(node(kind)),true);
 assert.equal(graphNodeHasRuntimeGuard({...node('UnmappedState'),conditions:{conditions:[],priority:1,_ignoreSaveGameLoadingOrder:0}}),false);
 assert.equal(graphNodeHasRuntimeGuard({...node('UnmappedState'),conditions:{expression:'flag'}}),true);
});
test('unknown controls disclose missing semantic mapping and cannot borrow substring roles',()=>{
 for(const kind of [undefined,'UnmappedState','ResettingUnmappedState','ToolUnlockedStateVariant','SpecialMergeState']){
  const original=node(kind),meaning=graphNodeSemantics(original);assert.equal(meaning.shape,'unknown');assert.equal(meaning.verified,false);assert.ok(meaning.summary);assert.equal(meaning.evidence,undefined);
 }
 const linked=node('UnmappedState',['line']);assert.equal(classifyGraphNode(linked),'script');assert.equal(graphNodeSemantics(linked).verified,false);assert.equal(isGraphControlNode(linked),true,'linked text must not turn an unknown control into contractible content');
});
test('explicit lowercase schema roles retain their shapes without claiming binary verification',()=>{
 for(const kind of ['condition','wait','event','state','connector','script'] as const){const original=node(kind),meaning=graphNodeSemantics(original);assert.equal(meaning.shape,kind);assert.equal(meaning.verified,false);assert.equal(meaning.evidence,undefined);}
});
test('original import envelopes recover the state name without replacing class identity',()=>{
 const original={...node('ToolUnlockedState'),metadata:{sourceNodes:[{flowId:'day-one',rawNode:{class:'ToolUnlockedState',context:{m_Name:'ToolUnlockedState (Reader)',_stateName:'Tool unlocked: Reader'}}}]}},before=structuredClone(original);
 assert.equal(graphNodeSourceLabel(original),'Tool unlocked: Reader');assert.equal(graphNodeSemantics(original).sourceType,'ToolUnlockedState');assert.deepEqual(original,before);
 assert.equal(graphNodeSourceLabel({...node('EmptyState'),metadata:{rawNode:{context:{_stateName:'',m_Name:'Join A'}}}}),'Join A');
});
const imported=new URL('../artifacts/orwell2-en-2026-10-08T16-08-46-865Z/workbench-input-orwell2-en.json',import.meta.url);
const ilPath=new URL('../../analysis/binary/managed/Assembly-CSharp.dll/all_methods.il.txt',import.meta.url);
test('read-only full Orwell mapping has source IL evidence and retains every graph identity',{skip:!existsSync(imported)||!existsSync(ilPath)},context=>{
 const p=JSON.parse(readFileSync(imported,'utf8')) as ProjectInput,il=readFileSync(ilPath,'utf8'),before=JSON.stringify(p);
 const types=[...new Set(p.graph!.nodes.map(n=>n.kind))];assert.equal(types.length,42);
 for(const kind of types){const meaning=graphNodeSemantics(node(kind));assert.equal(meaning.verified,true,`missing type ${kind}`);assert.notEqual(meaning.shape,'unknown');
  for(const witness of meaning.evidence!.split(' · ')[1].split('; ')){const method=witness.split(' → ')[0];assert.ok(il.includes('.method '+method),`missing source method ${method}`);}
 }
 const decisive={EmptyState:'FlowState::Execute',ToolUnlockedState:'ApplicationManager::UnlockApplication',NewPersonState:'Profile::UnlockPerson',NewTargetPersonState:'Profile::SetTargetPerson',DocumentViewedState:'Document::get_WasViewed',NewCommentaryState:'OrwellFlowFSM::Init'};
 for(const [kind,call] of Object.entries(decisive)){const method=kind==='DocumentViewedState'?'EvaluateConditions':'Execute',block=il.split('.method '+kind+'::'+method)[1]?.split('.method ')[0];assert.ok(block?.includes(call),`${kind} source behavior changed`);}
 assert.equal(p.graph!.nodes.filter(n=>graphNodeSemantics(n).shape==='unknown').length,0);
 const engine=new Engine('semantic-audit',{memory:true,autoStart:false});try{
  engine.importProject(p);const view=projectSceneGraphView(engine.state());
  assert.deepEqual(new Set(view.nodes.flatMap(n=>n.projection.sourceNodeIds)),new Set(p.graph!.nodes.map(n=>n.id)));
  assert.deepEqual(new Set([...view.edges.map(e=>e.id),...view.nodes.flatMap(n=>n.projection.internalEdges.map(e=>e.id))]),new Set(p.graph!.edges.map(e=>e.id)));
  for(const n of p.graph!.nodes.filter(isGraphControlNode))assert.ok(view.nodes.some(actual=>actual.id===n.id&&actual.projection.kind==='control'),`control ${n.id} was collapsed`);
  assert.equal(view.nodes.find(n=>n.kind==='ToolUnlockedState')!.sourceLabel,'Tool unlocked: Reader');
  context.diagnostic(`42 source types mapped; all ${p.graph!.nodes.length} nodes / ${p.graph!.edges.length} edges retained; unknown source roles: 0`);
 }finally{engine.close();}assert.equal(JSON.stringify(p),before);
});
