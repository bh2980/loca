import test from 'node:test';
import assert from 'node:assert/strict';
import type {GraphEdge,WorkspaceState} from '@workbench/contracts';
import {initialState} from '../src/engine.ts';
import {graphView} from '../src/graph.ts';

function fixture(count=100):WorkspaceState {
 const state=initialState();
 state.schemaVersion=2;
 state.groups=[{id:'scene',title:'Synthetic scene',description:'',order:0,branch:'unknown',kind:'scene',nextIds:[]}];
 state.units=[{id:'line',groupId:'scene',order:0,source:'Synthetic line.',kind:'dialogue',branch:'unknown',termIds:[]}];
 state.graph={version:1,orderingNote:'Source order only; conditions have not been evaluated.',
  nodes:Array.from({length:count},(_,i)=>({id:`n${i}`,groupIds:['scene'],unitIds:i===0?['line']:[],kind:'state',metadata:{rawNode:'PRIVATE NODE PAYLOAD'}})),
  edges:[],flows:[{id:'flow',title:'Synthetic flow',rootIds:['n0'],nodeIds:['n0'],metadata:{rawFlow:'PRIVATE FLOW PAYLOAD'}}],metadata:{rawGraph:'PRIVATE GRAPH PAYLOAD'}};
 return state;
}

test('missing original graph returns an explicit empty view without inventing execution order',()=>{
 const state=fixture();delete state.graph;
 const result=graphView(state,'scene');
 assert.deepEqual(result.nodes,[]);assert.deepEqual(result.edges,[]);
 assert.equal(result.totalNodes,0);assert.equal(result.matchingNodes,0);assert.equal(result.nextOffset,null);
 assert.match(result.orderingNote,/원본 상태 그래프가 없습니다/);
});

test('default group membership combines group links, source links and node links',()=>{
 const state=fixture(6),graph=state.graph!;
 for(const node of graph.nodes)node.groupIds=[];
 state.groups[0].graphNodeIds=['n0'];state.units[0].graphNodeIds=['n1'];graph.nodes[2].groupIds=['scene'];
 graph.edges=[{id:'outward',from:'n2',to:'n3'},{id:'unrelated',from:'n4',to:'n5'}];
 const before=structuredClone(state),result=graphView(state,'scene');
 assert.deepEqual(result.nodes.map(n=>n.id),['n0','n1','n2','n3']);
 assert.deepEqual(result.edges.map(e=>e.id),['outward']);assert.equal(result.matchingNodes,3);
 assert.equal(result.totalNodes,6);assert.equal(result.totalEdges,2);assert.equal(result.orderingNote,graph.orderingNote);
 assert.deepEqual(state,before,'view construction must not mutate persisted graph data');
});

test('selected node shows incident neighbors and preserves self-loops, parallel and external edges',()=>{
 const state=fixture(6);
 const edges:GraphEdge[]=[
  {id:'self',from:'n1',to:'n1',kind:'loop',direction:'outbound',conditions:{retry:true}},
  {id:'parallel-a',from:'n1',to:'n2',kind:'choice',conditions:{answer:'yes'}},
  {id:'parallel-b',from:'n1',to:'n2',kind:'choice',conditions:{answer:'no'}},
  {id:'incoming',from:'n0',to:'n1',direction:{sourcePort:'exit',targetPort:'entry'}},
  {id:'external',from:'n1',externalTarget:'unresolved-original-target',kind:'external'},
  {id:'neighbor-only',from:'n2',to:'n3'},
 ];
 state.graph!.edges=edges;
 const result=graphView(state,'scene','n1',60);
 assert.deepEqual(result.nodes.map(n=>n.id),['n0','n1','n2']);
 assert.deepEqual(result.edges.map(e=>e.id),['self','parallel-a','parallel-b','incoming','external']);
 for(const expected of edges.slice(0,5)){
  const actual=result.edges.find(e=>e.id===expected.id)!;
  for(const key of ['id','from','to','externalTarget','kind','direction','conditions'] as const)assert.deepEqual(actual[key],expected[key]);
 }
 assert.equal(result.nextOffset,null,'a node neighborhood is not group pagination');
 assert.equal(result.omittedEdges,0);
});

test('large incident neighborhoods respect both limits and report omissions',()=>{
 const state=fixture();
 state.graph!.edges=Array.from({length:99},(_,i)=>({id:`fan-${i+1}`,from:'n0',to:`n${i+1}`}));
 const result=graphView(state,'scene','n0');
 assert.equal(result.nodes.length,80);assert.equal(result.edges.length,79);
 assert.equal(result.omittedNodes,20);assert.equal(result.omittedEdges,20);
 const ids=new Set(result.nodes.map(n=>n.id));
 assert.ok(result.edges.every(edge=>ids.has(edge.from)&&(!edge.to||ids.has(edge.to))));

 state.graph!.edges=Array.from({length:200},(_,i)=>({id:`parallel-${i}`,from:'n0',to:'n1',conditions:{alternative:i}}));
 const parallel=graphView(state,'scene','n0');
 assert.equal(parallel.nodes.length,2);assert.equal(parallel.edges.length,160);assert.equal(parallel.omittedEdges,40);
 assert.equal(new Set(parallel.edges.map(edge=>edge.id)).size,160,'parallel transitions must not collapse');
 assert.ok(parallel.nodes.length<=80&&parallel.edges.length<=160);
});

test('group pagination covers all 100 members and has a terminating nextOffset',()=>{
 const state=fixture(),first=graphView(state,'scene');
 assert.equal(first.nodes.length,60);assert.equal(first.matchingNodes,100);assert.equal(first.nodeOffset,0);assert.equal(first.nextOffset,60);assert.equal(first.omittedNodes,40);
 const second=graphView(state,'scene',undefined,first.nextOffset!);
 assert.equal(second.nodes.length,40);assert.equal(second.nodeOffset,60);assert.equal(second.nextOffset,null);
 assert.equal(new Set([...first.nodes,...second.nodes].map(n=>n.id)).size,100);
 const end=graphView(state,'scene',undefined,100);
 assert.deepEqual(end.nodes,[]);assert.equal(end.nextOffset,null);
 assert.equal(graphView(state,'scene',undefined,-10).nodeOffset,0);
 assert.equal(graphView(state,'scene',undefined,60.9).nodeOffset,60);
});

test('raw extraction metadata stays hidden and long conditions explicitly report truncation',()=>{
 const state=fixture(2),long={condition:'x'.repeat(12500)};
 state.graph!.nodes[0].conditions=long;
 state.graph!.nodes[1].conditions={flag:'unchanged'};
 state.graph!.edges=[{id:'long-edge',from:'n0',to:'n1',conditions:long,metadata:{rawEdge:'PRIVATE EDGE PAYLOAD'}}];
 const result=graphView(state,'scene');
 const expected={truncated:true,preview:JSON.stringify(long).slice(0,12000),originalCharacters:JSON.stringify(long).length};
 assert.deepEqual(result.nodes[0].conditions,expected);assert.deepEqual(result.edges[0].conditions,expected);
 assert.deepEqual(result.nodes[1].conditions,{flag:'unchanged'});
 assert.ok(!Object.hasOwn(result,'metadata')&&!Object.hasOwn(result,'flows'));
 assert.ok(result.nodes.every(n=>!Object.hasOwn(n,'metadata')));assert.ok(result.edges.every(e=>!Object.hasOwn(e,'metadata')));
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 assert.deepEqual(state.graph!.nodes[0].conditions,long,'truncation is view-only');
});

test('missing groups and unknown node IDs fail explicitly',()=>{
 const state=fixture();
 assert.throws(()=>graphView(state,'absent'),/장면을 찾을 수 없습니다/);
 assert.throws(()=>graphView(state,'scene','absent-node'),/그래프 노드를 찾을 수 없습니다/);
});
