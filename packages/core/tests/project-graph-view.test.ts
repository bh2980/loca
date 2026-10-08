import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/engine.ts';
import {projectGraphView} from '../src/graph.ts';

function fixture(){
 const state=initialState();state.groups=[{id:'g',title:'Scene',description:'',order:0,branch:'unknown',kind:'scene',nextIds:[],graphFlowIds:['flow']}];
 state.units=Array.from({length:255},(_,i)=>({id:`u${i}`,groupId:'g',source:`Line ${i}`,order:i,kind:'dialogue' as const,branch:'unknown',termIds:[],graphNodeIds:i<250?[`n${i}`]:undefined}));
 state.graph={version:1,orderingNote:'Not an execution trace',nodes:Array.from({length:250},(_,i)=>({id:`n${i}`,kind:i%2?'Dialogue':'DelayState',unitIds:[`u${i}`],groupIds:['g']})),edges:Array.from({length:249},(_,i)=>({id:`e${i}`,from:`n${i}`,to:`n${i+1}`,conditions:{known:false}})),flows:[{id:'flow',title:'flow',rootIds:['n0'],nodeIds:Array.from({length:250},(_,i)=>`n${i}`)}]};return state;
}
test('project graph paging keeps every source reachable without invented links and does not mutate storage',()=>{
 const state=fixture(),before=structuredClone(state),seen=new Set<string>();let offset:number|null=0;
 while(offset!==null){const view=projectGraphView(state,{offset,limit:120});assert.ok(view.nodes.length<=160);assert.ok(view.edges.length<=320);for(const node of view.nodes)for(const uid of node.unitIds)seen.add(uid);offset=view.nextOffset;}
 assert.deepEqual([...seen].sort(),state.units.map(u=>u.id).sort());assert.deepEqual(state,before);
 const unlinked=projectGraphView(state,{unitId:'u254'});assert.equal(unlinked.nodes.length,1);assert.equal(unlinked.nodes[0].synthetic,true);assert.equal(unlinked.nodes[0].id,unlinked.focusNodeId);assert.deepEqual(unlinked.edges,[]);
});
test('global and scene filters retain source conditions and node focus remains bounded',()=>{
 const state=fixture();const view=projectGraphView(state,{groupId:'g',flowId:'flow',nodeId:'n200'});
 assert.equal(view.scope,'scene');assert.equal(view.matchingNodes,255);assert.equal(view.focusNodeId,'n200');assert.ok(view.nodes.some(n=>n.id==='n200'));assert.deepEqual(view.edges.map(e=>e.id),['e199','e200']);assert.deepEqual(view.edges[0].conditions,{known:false});
 assert.throws(()=>projectGraphView(state,{unitId:'missing'}),/원문/);assert.throws(()=>projectGraphView(state,{flowId:'missing'}),/흐름/);assert.throws(()=>projectGraphView(state,{groupId:'missing'}),/장면/);
});
test('projects without a raw graph still expose all dialogue and UI units as unlinked canvas records',()=>{
 const state=fixture();delete state.graph;const result=projectGraphView(state,{groupId:'g'});
 assert.equal(result.matchingNodes,255);assert.equal(result.nodes.length,120);assert.equal(result.nextOffset,120);assert.ok(result.nodes.every(n=>n.synthetic));assert.deepEqual(result.edges,[]);
});

test('complete mode returns all source nodes and edges without focus, offset or page truncation',()=>{
 const state=fixture();state.units[253].kind='document';state.units[254].kind='ui';
 state.graph!.nodes[0].metadata={rawNode:{context:{_stateName:'Original state label'},review_rank:17,source_graph_rank:99}};
 state.graph!.nodes[1].metadata={rawNode:{source_graph_rank:24}};
 state.graph!.nodes[0].conditions={expression:'x'.repeat(15000)};
 for(let i=0;i<400;i++)state.graph!.edges.push({id:`extra${i}`,from:'n0',to:`n${i%250}`,conditions:{index:i},metadata:{pin:i%2}});
 state.graph!.edges.push({id:'external',from:'n249',externalTarget:'outside:original',kind:'source-boundary'});
 const before=structuredClone(state),view=projectGraphView(state,{complete:true,nodeId:'n200',offset:120,limit:1});
 assert.equal(view.complete,true);assert.equal(view.nodes.length,255);assert.equal(view.matchingNodes,255);assert.equal(view.edges.length,650);
 assert.equal(view.nodeOffset,0);assert.equal(view.nextOffset,null);assert.equal(view.omittedNodes,0);assert.equal(view.omittedEdges,0);
 assert.equal(view.focusNodeId,'n200');assert.ok(view.nodes.every(node=>!node.boundary&&node.flowIds.includes('flow')&&node.layoutGroup==='flow'));
 assert.equal(view.nodes.find(node=>node.id==='n0')!.sourceLabel,'Original state label');
 assert.equal(view.nodes.find(node=>node.id==='n0')!.order,17);
 assert.equal(view.nodes.find(node=>node.id==='n1')!.order,24);
 assert.deepEqual(view.nodes.find(node=>node.id==='n0')!.conditions,state.graph!.nodes[0].conditions);
 for(const id of ['u253','u254'])assert.ok(view.nodes.some(node=>node.synthetic&&node.unitIds.includes(id)));
 assert.deepEqual(view.edges.find(edge=>edge.id==='external')!.externalTarget,'outside:original');
 assert.deepEqual(view.edges.find(edge=>edge.id==='extra1')!.metadata,{pin:1});assert.deepEqual(state,before);
});

test('complete scene and flow scopes include exact boundary neighbors and internal/external edges',()=>{
 const state=fixture();state.groups.push({id:'other',title:'Other document',description:'',order:1,branch:'unknown',kind:'document',nextIds:[],graphFlowIds:['other-flow']});
 state.units.push({id:'other-unit',groupId:'other',source:'Document',order:0,kind:'document',branch:'unknown',termIds:[],graphNodeIds:['other-node']});
 state.graph!.nodes.push({id:'other-node',kind:'DocumentState',unitIds:['other-unit'],groupIds:['other']},{id:'distant',kind:'OtherControl',unitIds:[],groupIds:['other']});
 state.graph!.flows.push({id:'other-flow',title:'Other',rootIds:['other-node'],nodeIds:['other-node','distant']});
 state.graph!.edges.push({id:'boundary',from:'n249',to:'other-node'},{id:'external',from:'n0',externalTarget:'outside'}, {id:'beyond-boundary',from:'other-node',to:'distant'});
 for(const scope of [{groupId:'g'},{flowId:'flow'},{groupId:'g',flowId:'flow'}]){
  const view=projectGraphView(state,{...scope,complete:true});
  assert.equal(view.matchingNodes,255);assert.equal(view.nodes.length,256);assert.equal(view.edges.length,251);
  assert.equal(view.nodes.find(node=>node.id==='other-node')!.boundary,true);assert.deepEqual(view.nodes.find(node=>node.id==='other-node')!.flowIds,['other-flow']);
  assert.ok(!view.nodes.some(node=>node.id==='distant'));assert.ok(view.edges.some(edge=>edge.id==='boundary'));assert.ok(view.edges.some(edge=>edge.id==='external'));
  assert.equal(view.omittedNodes,0);assert.equal(view.omittedEdges,0);
 }
 const all=projectGraphView(state,{complete:true});assert.equal(all.nodes.length,257);assert.equal(all.edges.length,252);
});

test('complete graphless work retains document/UI/isolated fallback nodes and source label partitions',()=>{
 const state=fixture();delete state.graph;
 state.groups.push({id:'docs',title:'Document collection',description:'',order:1,branch:'unknown',kind:'document',nextIds:[]},{id:'ui',title:'UI collection',description:'',order:2,branch:'unknown',kind:'ui',nextIds:[]});
 state.units[253].groupId='docs';state.units[253].kind='document';state.units[254].groupId='ui';state.units[254].kind='ui';
 const view=projectGraphView(state,{complete:true});assert.equal(view.nodes.length,255);assert.ok(view.nodes.every(node=>node.synthetic));assert.equal(view.nextOffset,null);assert.deepEqual(view.edges,[]);
 assert.equal(view.nodes.find(node=>node.unitIds.includes('u253'))!.layoutGroup,'문서 자료');
 assert.equal(view.nodes.find(node=>node.unitIds.includes('u254'))!.layoutGroup,'UI 자료');
 assert.equal(view.nodes.find(node=>node.unitIds.includes('u254'))!.sourceLabel,'UI collection');
});
