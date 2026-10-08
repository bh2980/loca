import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {Engine} from '../packages/core/src/engine.ts';
import {projectSceneGraphView} from '../packages/core/src/scene-projection.ts';
import type {GraphEdge,GraphNode,ProjectInput} from '@workbench/contracts';
function fixture(nodes:GraphNode[],edges:GraphEdge[]){
 const groups=['A','B','doc','isolated'].map((id,order)=>({id,title:id,description:'',order,branch:'unknown' as const,kind:id==='doc'?'document' as const:'scene' as const,nextIds:id==='A'?['B']:[]}));
 const units=['a0','a1','a2','b','d','orphan'].map((id,order)=>({id,groupId:id.startsWith('a')?'A':id==='b'?'B':id==='d'?'doc':'isolated',order,source:id,sourceLanguage:'en',speaker:'Speaker',kind:id==='d'?'document' as const:'dialogue' as const,branch:'unknown' as const,termIds:[]}));
 return {schemaVersion:2 as const,project:{id:'projection-fixture',title:'Fixture',description:'',sourceLanguage:'en',targetLanguage:'ko'},groups,units,graph:{version:1 as const,orderingNote:'Original connections only',nodes,edges,flows:[{id:'first',title:'First file',rootIds:['start'],nodeIds:['start','a0','a1','condition','a2']},{id:'other',title:'Other file',rootIds:['b'],nodeIds:['b','doc']}]}} satisfies ProjectInput;
}
const sourceNodes:GraphNode[]=[{id:'start',kind:'EventState',unitIds:[],groupIds:[]},{id:'a0',kind:'Script',unitIds:['a0'],groupIds:['A']},{id:'a1',kind:'Script',unitIds:['a1'],groupIds:['A']},{id:'condition',kind:'IfElseState',conditions:{key:'branch'},unitIds:[],groupIds:[]},{id:'a2',kind:'Script',unitIds:['a2'],groupIds:['A']},{id:'b',kind:'Script',unitIds:['b'],groupIds:['B']},{id:'doc',kind:'Script',unitIds:['d'],groupIds:['doc']}];
const edge=(id:string,from:string,to:string,conditions?:unknown):GraphEdge=>({id,from,to,conditions,direction:'original',metadata:{evidence:id}});
const sourceEdges=[edge('entry','start','a0'),edge('inside','a0','a1'),edge('check','a1','condition'),edge('true','condition','a2',{value:true}),edge('false','condition','b',{value:false}),edge('after-a','a2','b'),edge('open-doc','b','doc')];
function input(){return fixture(structuredClone(sourceNodes),structuredClone(sourceEdges));}
function state(p:ProjectInput=input()){const engine=new Engine('scene-projection-test',{memory:true,autoStart:false});try{engine.importProject(p);return engine.state();}finally{engine.close();}}
function assertCoverage(view:ReturnType<typeof projectSceneGraphView>,p:ProjectInput){
 const sourceIds=view.nodes.flatMap(node=>node.projection.sourceNodeIds),edgeIds=[...view.edges.map(edge=>edge.id),...view.nodes.flatMap(node=>node.projection.internalEdges.map(edge=>edge.id))];
 assert.deepEqual(new Set(sourceIds),new Set(p.graph!.nodes.map(node=>node.id)));assert.equal(sourceIds.length,p.graph!.nodes.length);
 assert.deepEqual(new Set(edgeIds),new Set(p.graph!.edges.map(edge=>edge.id)));assert.equal(edgeIds.length,p.graph!.edges.length);
 assert.equal(view.omittedNodes,0);assert.equal(view.omittedEdges,0);
}
test('linear content contracts losslessly while intermediate conditions, events and documents remain visible',()=>{
 const p=input(),s=state(p),before=structuredClone(s),view=projectSceneGraphView(s);assertCoverage(view,p);
 const a=view.nodes.find(node=>node.projection.sourceNodeIds.includes('a0'))!;
 assert.deepEqual(a.projection.sourceNodeIds,['a0','a1']);assert.deepEqual(a.projection.internalEdges,s.graph!.edges.filter(edge=>edge.id==='inside'));
 assert.ok(view.nodes.some(node=>node.id==='condition'&&node.kind==='IfElseState'));
 assert.ok(view.nodes.some(node=>node.id==='start'));assert.ok(view.nodes.some(node=>node.groupIds.includes('doc')));
 assert.ok(view.nodes.some(node=>node.synthetic&&node.unitIds.includes('orphan')));
 assert.equal(view.nodes.filter(node=>node.projection.groupId==='A').length,2,'content on opposite sides of a condition must never merge');
 assert.ok(!view.edges.some(edge=>edge.kind==='derived-group-reference'),'group.nextIds cannot bypass an original control');assert.deepEqual(s,before);
 const from=view.edges.find(edge=>edge.id==='check')!;assert.equal(from.from,a.id);assert.equal(from.to,'condition');assert.deepEqual(from.conditions,p.graph!.edges.find(edge=>edge.id==='check')!.conditions);
});
test('branching, joins, parallel transitions, conditional content and script cycles cannot become one group hub',()=>{
 const p=input();p.graph!.edges.push(edge('back','a2','a0'),edge('parallel','a0','a1'));p.graph!.nodes.find(node=>node.id==='a1')!.conditions={originalFlag:true};
 const view=projectSceneGraphView(state(p));assertCoverage(view,p);assert.equal(view.collapsedNodes,0);
 assert.deepEqual(view.nodes.filter(node=>node.unitIds.some(id=>id.startsWith('a'))).flatMap(node=>node.projection.sourceNodeIds).sort(),['a0','a1','a2']);
});
test('a pure content cycle retains all source vertices and loop edges, not a fictitious scene self-loop',()=>{
 const p=input();p.graph!.nodes=p.graph!.nodes.filter(node=>['a0','a1','a2'].includes(node.id));p.graph!.edges=[edge('cycle0','a0','a1'),edge('cycle1','a1','a2'),edge('cycle2','a2','a0')];p.graph!.flows=[];
 const view=projectSceneGraphView(state(p));assertCoverage(view,p);assert.equal(view.collapsedNodes,0);assert.ok(view.edges.every(edge=>edge.from!==edge.to));
});
test('shared content keeps its original identity and associations without a cross-product of group edges',()=>{
 const p=input();p.graph!.nodes.find(node=>node.id==='a1')!.groupIds.push('B');const view=projectSceneGraphView(state(p));assertCoverage(view,p);
 const shared=view.nodes.find(node=>node.id==='a1')!;assert.equal(shared.projection.kind,'shared-content');assert.deepEqual(shared.groupIds,['A','B']);assert.equal(view.collapsedNodes,0);
});
test('flow filtering preserves exact cross-file boundary transitions and nearby follows control corridors to next content',()=>{
 const s=state(),flow=projectSceneGraphView(s,{flowId:'first'});assert.ok(flow.nodes.some(node=>node.id==='b'&&node.boundary));assert.ok(flow.edges.some(edge=>edge.id==='false'));
 assert.ok(!flow.nodes.some(node=>node.id==='doc'));assert.ok(flow.omittedNodes>0);
 const near=projectSceneGraphView(s,{groupId:'A'});assert.ok(near.nodes.some(node=>node.id==='condition'));assert.ok(near.nodes.some(node=>node.id==='b'));assert.ok(near.nodes.some(node=>node.id==='start'));assert.ok(!near.nodes.some(node=>node.id==='doc'));
});
test('projects without a raw graph label stored group references as derived and preserve isolated groups',()=>{
 const p:ProjectInput=input();delete p.graph;const view=projectSceneGraphView(state(p));assert.equal(view.nodes.length,p.groups.length);assert.equal(view.edges.length,1);assert.equal(view.edges[0].kind,'derived-group-reference');assert.match(JSON.stringify(view.edges[0].metadata),/Group.nextIds/);
});
const orwell=new URL('../artifacts/orwell2-en-2026-10-08T16-08-46-865Z/workbench-input-orwell2-en.json',import.meta.url);
test('read-only Orwell 2 projection retains all 5,146 original nodes, 5,121 edges, documents and IfElse controls',{skip:!existsSync(orwell)},context=>{
 const p=JSON.parse(readFileSync(orwell,'utf8')) as ProjectInput,started=performance.now(),view=projectSceneGraphView(state(p));assertCoverage(view,p);
 assert.equal(p.graph!.nodes.length,5146);assert.equal(p.graph!.edges.length,5121);assert.equal(view.nodes.filter(node=>node.kind==='IfElseState').length,284);
 assert.ok(view.nodes.some(node=>node.groupIds.some(id=>p.groups.some(group=>group.id===id&&group.kind==='document'))));
 assert.deepEqual(new Set(view.nodes.flatMap(node=>node.unitIds)),new Set(p.units.map(unit=>unit.id)));
 context.diagnostic(`Orwell 2 scene projection: ${view.nodes.length} displayed nodes / ${view.edges.length} edges / ${view.collapsedNodes} safe contractions; ${(performance.now()-started).toFixed(1)} ms including temporary DB import`);
});


test('content contraction stops at an addressable source-flow boundary',()=>{
 const p=input();p.graph.flows[0].nodeIds=p.graph.flows[0].nodeIds.filter(id=>id!=='a1');p.graph.flows[1].nodeIds.push('a1');const all=projectSceneGraphView(state(p));assert.equal(all.collapsedNodes,0);const filtered=projectSceneGraphView(state(p),{flowId:'first'});assert.ok(filtered.nodes.some(node=>node.id==='a1'&&node.boundary));assert.ok(filtered.edges.some(edge=>edge.id==='inside'));
});

test('unresolved original targets survive as unresolved routes and cannot collide with summary IDs',()=>{
 const p=input(),s=state(p);const unresolvedEdge=edge('external','b','scene:unlinked:isolated');p.graph.edges.push(unresolvedEdge);s.graph!.edges.push(unresolvedEdge);const view=projectSceneGraphView(s);assertCoverage(view,p);const unresolved=view.edges.find(edge=>edge.id==='external')!;assert.equal(unresolved.to,'scene:unlinked:isolated');assert.ok(!view.nodes.some(node=>node.id===unresolved.to));assert.equal(unresolved.metadata?.projection&&typeof unresolved.metadata.projection==='object'?(unresolved.metadata.projection as {sourceTo:string}).sourceTo:undefined,'scene:unlinked:isolated');
});

test('a control with linked content retains its original control identity and all editable unit IDs',()=>{
 const p=input();p.graph.nodes.find(node=>node.id==='condition')!.unitIds=['a1'];p.graph.nodes.find(node=>node.id==='condition')!.groupIds=['A'];const view=projectSceneGraphView(state(p)),node=view.nodes.find(node=>node.id==='condition')!;assert.equal(node.projection.kind,'control');assert.equal(node.projection.groupId,undefined);assert.deepEqual(node.unitIds,['a1']);assert.deepEqual(node.groupIds,['A']);assert.equal(node.kind,'IfElseState');assertCoverage(view,p);
});
