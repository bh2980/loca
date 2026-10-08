import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {ELK,ElkNode} from 'elkjs/lib/elk-api.js';
import ElkModule from 'elkjs/lib/elk.bundled.js';
import {classifyGraphNode,layoutGraph,type LayoutInputNode,type LayoutInputEdge,type LayoutResult} from '../apps/web/src/flow-layout.ts';
import {buildOrwell1Project} from '../packages/adapters/src/orwell1.ts';
const ElkConstructor=ElkModule as unknown as {new():ELK};

function assertPreserved(result:LayoutResult,nodes:LayoutInputNode[],edges:LayoutInputEdge[]){
 const byId=new Map(result.nodes.map(node=>[node.id,node]));
 assert.equal(byId.size,result.nodes.length,'every canvas node has a unique identity');
 assert.deepEqual(new Set(result.nodes.filter(node=>!node.external).map(node=>node.id)),new Set(nodes.map(node=>node.id)));
 assert.deepEqual(new Set(result.edges.map(edge=>edge.id)),new Set(edges.map(edge=>edge.id)));
 assert.equal(result.edges.length,edges.length);assert.equal(result.skippedEdges,0);
 const inputEdges=new Map(edges.map(edge=>[edge.id,edge]));
 for(const edge of result.edges){
  const original=inputEdges.get(edge.id)!,from=byId.get(edge.from)!,to=byId.get(edge.to)!;
  assert.equal(edge.from,original.from);
  if(original.to&&byId.has(original.to))assert.equal(edge.to,original.to);
  else assert.ok(edge.external&&to.external,'unresolved external targets retain a canvas stub');
  const source=from.ports.find(port=>port.id===edge.sourceHandle),target=to.ports.find(port=>port.id===edge.targetHandle);
  assert.ok(source&&target,'all edges retain both exact handles');
  assert.ok(edge.points.length>=2&&edge.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
  assert.deepEqual(edge.points[0],{x:from.x+source.x,y:from.y+source.y});
  assert.deepEqual(edge.points.at(-1),{x:to.x+target.x,y:to.y+target.y});
 }
 // Spatial hashing verifies overlap at realistic volume without a quadratic scan.
 const cells=new Map<string,LayoutResult['nodes']>();
 for(const node of result.nodes){
  assert.ok(Number.isFinite(node.x)&&Number.isFinite(node.y)&&node.width>0&&node.height>0);
  const checked=new Set<string>();
  for(let x=Math.floor(node.x/320);x<=Math.floor((node.x+node.width)/320);x++)for(let y=Math.floor(node.y/200);y<=Math.floor((node.y+node.height)/200);y++){
   const key=`${x}:${y}`,neighbors=cells.get(key)??[];
   for(const other of neighbors)if(!checked.has(other.id)){
    checked.add(other.id);
    assert.ok(node.x+node.width<=other.x||other.x+other.width<=node.x||node.y+node.height<=other.y||other.y+other.height<=node.y,`nodes ${node.id} and ${other.id} overlap`);
   }
   neighbors.push(node);cells.set(key,neighbors);
  }
  assert.ok(result.sections?.some(section=>node.x>=section.x&&node.y>=section.y&&node.x+node.width<=section.x+section.width&&node.y+node.height<=section.y+section.height),'each raw node belongs to a visible section');
 }
}

function fullFixture(count=10000){
 const nodes:LayoutInputNode[]=Array.from({length:count},(_,index)=>({id:`n${index}`,order:index,shape:index%7===0?'condition':index%7===1?'state':'script',layoutGroup:`Chapter ${Math.floor(index/2000)+1}`}));
 const edges:LayoutInputEdge[]=[];
 for(let start=0;start<count;start+=20){
  for(let offset=0;offset<11&&start+offset+1<count;offset++)edges.push({id:`chain:${start+offset}`,from:`n${start+offset}`,to:`n${start+offset+1}`});
  edges.push({id:`cycle:${start}`,from:`n${start+2}`,to:`n${start}`},{id:`parallel:${start}`,from:`n${start}`,to:`n${start+1}`},{id:`self:${start}`,from:`n${start+3}`,to:`n${start+3}`});
 }
 for(let chapter=0;(chapter+1)*2000<count;chapter++)edges.push({id:`cross:${chapter}`,from:`n${chapter*2000+1999}`,to:`n${(chapter+1)*2000}`});
 edges.push({id:'external:one',from:'n0',externalTarget:'outside original scope'},{id:'external:two',from:`n${Math.min(2000,count-1)}`,externalTarget:'outside original scope'});
 return {nodes,edges};
}

test('10,000 source nodes preserve cycles, parallel edges, orphans and crossings using ELK components',{timeout:120000},async context=>{
 const fixture=fullFixture(),before=structuredClone(fixture),started=performance.now();
 const library=new ElkConstructor();let libraryCalls=0;const engine={layout:async (graph:ElkNode)=>{libraryCalls++;return library.layout(graph);}} as unknown as ELK;
 const result=await layoutGraph(fixture.nodes,fixture.edges,engine),elapsed=performance.now()-started;
 context.diagnostic(`10,000 nodes / ${fixture.edges.length} edges laid out in ${elapsed.toFixed(1)} ms`);
 assert.ok(libraryCalls>0,'the real library must place and route connected source graphs');assert.ok(elapsed<60000,'component layout must finish within the full source workload budget');
 assertPreserved(result,fixture.nodes,fixture.edges);assert.deepEqual(fixture,before,'layout never changes original graph records');
 assert.ok(result.sections!.some(section=>section.title.includes('연결 없는 원문')));
 const positions=new Map(result.nodes.map(node=>[node.id,node]));
 const crossingOnly=positions.get('n1999')!;
 assert.ok(result.sections!.some(section=>section.title.includes('원본 연결')&&crossingOnly.x>=section.x&&crossingOnly.x< section.x+section.width&&crossingOnly.y>=section.y&&crossingOnly.y<section.y+section.height),'chapter-crossing nodes are not mislabeled as disconnected');
});

test('raw placement is deterministic when input node and edge arrays are reordered',async()=>{
 const fixture=fullFixture(800),first=await layoutGraph(fixture.nodes,fixture.edges),second=await layoutGraph([...fixture.nodes].reverse(),[...fixture.edges].reverse());
 assert.deepEqual(second,first);
});

test('ELK cycle breaking preserves source cycles while the outward chain progresses downward',async()=>{
 const nodes:LayoutInputNode[]=Array.from({length:350},(_,index)=>({id:`node-${index}`,order:index,shape:'script'}));
 const edges:LayoutInputEdge[]=[{id:'a',from:'node-0',to:'node-1'},{id:'b',from:'node-1',to:'node-2'},{id:'c',from:'node-2',to:'node-0'},{id:'d',from:'node-2',to:'node-3'},{id:'e',from:'node-3',to:'node-4'},{id:'parallel',from:'node-0',to:'node-1'},{id:'self',from:'node-1',to:'node-1'}];
 const result=await layoutGraph(nodes,edges);assertPreserved(result,nodes,edges);
 const byId=new Map(result.nodes.map(node=>[node.id,node]));
 assert.ok(new Set(['node-0','node-1','node-2'].map(id=>byId.get(id)!.y)).size>1,'cycles are routed by ELK rather than forced into one horizontal rank');
 assert.ok(byId.get('node-3')!.y>byId.get('node-2')!.y);assert.ok(byId.get('node-4')!.y>byId.get('node-3')!.y);
 assert.notDeepEqual(result.edges.find(edge=>edge.id==='a')!.points,result.edges.find(edge=>edge.id==='parallel')!.points,'parallel edges use distinct ports');
});

test('10,000-node source chains are placed top-to-bottom by ELK without lost edges',{timeout:120000},async context=>{
 const nodes:LayoutInputNode[]=Array.from({length:10000},(_,index)=>({id:String(index),order:index,shape:'state'})),edges=nodes.slice(1).map((node,index)=>({id:`edge:${index}`,from:String(index),to:node.id}));
 const started=performance.now(),result=await layoutGraph(nodes,edges);context.diagnostic(`10,000-node chain: ${(performance.now()-started).toFixed(1)} ms`);
 assertPreserved(result,nodes,edges);assert.ok(result.nodes.at(-1)!.y>result.nodes[0].y);
});

test('unconnected text is an explicit vertical inventory and external stub IDs cannot collide',async()=>{
 const nodes:LayoutInputNode[]=Array.from({length:350},(_,index)=>({id:index===0?'__canvas_external__0':index===1?'__section_0:__canvas_external__0x':`text-${index}`,order:index,shape:'script',layoutGroup:index<175?'A':'B'}));
 const edges=[{id:'external-a',from:'text-2',externalTarget:'outside'},{id:'external-b',from:'text-200',externalTarget:'outside'}];
 const result=await layoutGraph(nodes,edges);assertPreserved(result,nodes,edges);
 assert.equal(result.nodes.filter(node=>node.external).length,1);
 const isolated=result.sections!.filter(section=>section.title.includes('연결 없는 원문'));
 assert.equal(isolated.reduce((sum,section)=>sum+section.nodeCount,0),348);
 assert.ok(isolated.every(section=>section.width>280&&section.height>118));
});

test('both small and large source graphs use the actual ELK library',async()=>{
 let calls=0;
 const library=new ElkConstructor(),engine={layout:async (graph:ElkNode)=>{calls++;return library.layout(graph);}} as unknown as ELK;
 await layoutGraph([{id:'small',shape:'script'}],[],engine);
 const nodes=Array.from({length:301},(_,index)=>({id:'scene-'+index,shape:'scene' as const})),edges=nodes.slice(1).map((node,index)=>({id:'e'+index,from:nodes[index].id,to:node.id}));
 assertPreserved(await layoutGraph(nodes,edges,engine),nodes,edges);assert.equal(calls,2);
});

test('ELK width-bounded layering routes wide branches over height without inventing edges',{timeout:30000},async()=>{
 const nodes:LayoutInputNode[]=[{id:'start',shape:'condition'},...Array.from({length:350},(_,index)=>({id:'branch-'+index,order:index,shape:'script' as const})),{id:'join',shape:'connector'}];
 const edges:LayoutInputEdge[]=nodes.slice(1,-1).flatMap(node=>[{id:'out-'+node.id,from:'start',to:node.id},{id:'in-'+node.id,from:node.id,to:'join'}]);
 const result=await layoutGraph(nodes,edges);assertPreserved(result,nodes,edges);
 const p=new Map(result.nodes.map(node=>[node.id,node])),layers=new Map<number,number>();for(const node of nodes.slice(1,-1)){const y=p.get(node.id)!.y;layers.set(y,(layers.get(y)??0)+1);}assert.ok(layers.size>1);assert.ok(Math.max(...layers.values())<=5,'ELK bounds source-node count in each layer');
 assert.ok(p.get('start')!.y<p.get('branch-0')!.y&&p.get('branch-0')!.y<p.get('join')!.y);
});

const orwellSource=fileURLToPath(new URL('../../orwell_1_reorder',import.meta.url));
test('published Orwell graph retains every raw relationship and unrepresented text node',{skip:!existsSync(orwellSource),timeout:120000},async context=>{
 const {input}=await buildOrwell1Project(orwellSource),graph=input.graph!,groups=new Map(input.groups.map(group=>[group.id,group])),represented=new Set(graph.nodes.flatMap(node=>node.unitIds));
 const chapter=(groupId:string)=>groups.get(groupId)?.graphFlowIds?.[0]??'기타 자료';
 const nodes:LayoutInputNode[]=[...graph.nodes.map((node,order)=>({id:node.id,order,shape:classifyGraphNode(node),layoutGroup:chapter(node.groupIds[0])})),...input.units.filter(unit=>!represented.has(unit.id)).map((unit,index)=>({id:`unit:${unit.id}`,order:graph.nodes.length+index,shape:'script' as const,layoutGroup:chapter(unit.groupId)}))];
 const started=performance.now(),result=await layoutGraph(nodes,graph.edges),elapsed=performance.now()-started;
 context.diagnostic(`Orwell: ${nodes.length} nodes / ${graph.edges.length} edges / ${result.sections?.length} sections in ${elapsed.toFixed(1)} ms`);
 assert.equal(nodes.length,9815);assert.equal(graph.edges.length,5932);assertPreserved(result,nodes,graph.edges);
 assert.ok(elapsed<60000);
});
