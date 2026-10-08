import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyGraphNode,graphStructureSignature,layoutGraph,nodeDimensions,NODE_HEIGHT,type LayoutInputNode,type LayoutInputEdge} from '../apps/web/src/flow-layout.ts';
import {validateProject} from '../packages/core/src/engine.ts';
import type {ProjectInput} from '@workbench/contracts';

type Layout=Awaited<ReturnType<typeof layoutGraph>>;
const nodes=(count:number):LayoutInputNode[]=>Array.from({length:count},(_,i)=>({id:`n${i}`,order:i}));
const edge=(id:string,from:number,to:number):LayoutInputEdge=>({id,from:`n${from}`,to:`n${to}`});

function assertUsable(layout:Layout,expected:LayoutInputNode[]){
 const byId=new Map(layout.nodes.map(node=>[node.id,node]));
 assert.equal(byId.size,layout.nodes.length,'canvas node IDs must be unique');
 for(const node of expected){assert.ok(byId.has(node.id),`missing original node ${node.id}`);assert.notEqual(byId.get(node.id)!.external,true);}
 for(const node of layout.nodes){
  for(const value of [node.x,node.y,node.width,node.height])assert.ok(Number.isFinite(value),`non-finite box for ${node.id}`);
  assert.ok(node.width>0&&node.height>0,`empty box for ${node.id}`);
  if(!node.external){const size=nodeDimensions(expected.find(item=>item.id===node.id)?.shape);assert.equal(node.width,size.width);assert.equal(node.height,size.height);}
  for(const port of node.ports)assert.ok(Number.isFinite(port.x)&&Number.isFinite(port.y));
 }
 for(let i=0;i<layout.nodes.length;i++)for(let j=i+1;j<layout.nodes.length;j++){
  const a=layout.nodes[i],b=layout.nodes[j];
  const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
  const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
  assert.ok(overlapX<=0.01||overlapY<=0.01,`node boxes overlap: ${a.id} / ${b.id}`);
 }
 assert.equal(new Set(layout.edges.map(e=>e.id)).size,layout.edges.length,'parallel edge identities must remain unique');
 for(const e of layout.edges){
  const source=byId.get(e.from),target=byId.get(e.to);
  assert.ok(source&&target,`edge ${e.id} has an invented/unavailable endpoint`);
  assert.ok(source.ports.some(p=>p.id===e.sourceHandle&&p.type==='source'),`missing source handle for ${e.id}`);
  assert.ok(target.ports.some(p=>p.id===e.targetHandle&&p.type==='target'),`missing target handle for ${e.id}`);
  assert.ok(e.points.length>=2,`edge ${e.id} has no usable route`);
  assert.ok(e.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),`edge ${e.id} has a non-finite route`);
 }
 return byId;
}

test('top-to-bottom chain keeps every source node and lays out successive layers below one another',async()=>{
 const input=nodes(5),edges=Array.from({length:4},(_,i)=>edge(`e${i}`,i,i+1)),layout=await layoutGraph(input,edges);
 const positions=assertUsable(layout,input);
 assert.deepEqual(new Set(layout.edges.map(e=>e.id)),new Set(edges.map(e=>e.id)));
 for(let i=0;i<4;i++)assert.ok(positions.get(`n${i}`)!.y+NODE_HEIGHT<=positions.get(`n${i+1}`)!.y,`chain layer ${i} does not point down`);
});

test('fork and join retain both alternatives without placing their cards on top of each other',async()=>{
 const input=nodes(4),edges=[edge('fork-left',0,1),edge('fork-right',0,2),edge('join-left',1,3),edge('join-right',2,3)];
 const layout=await layoutGraph(input,edges),p=assertUsable(layout,input);
 assert.equal(layout.edges.length,4);
 for(const id of ['n1','n2']){assert.ok(p.get('n0')!.y+NODE_HEIGHT<=p.get(id)!.y);assert.ok(p.get(id)!.y+NODE_HEIGHT<=p.get('n3')!.y);}
 assert.notEqual(p.get('n1')!.x,p.get('n2')!.x);
});

test('cycles, self-loops and parallel transitions remain explicit and fully routed',async()=>{
 const input=nodes(4),edges=[edge('cycle-a',0,1),edge('cycle-b',1,2),edge('cycle-c',2,0),edge('self-loop',1,1),edge('parallel-a',2,3),edge('parallel-b',2,3)];
 const before=structuredClone({input,edges}),layout=await layoutGraph(input,edges);
 assertUsable(layout,input);assert.equal(layout.skippedEdges,0);
 assert.deepEqual(new Set(layout.edges.map(e=>e.id)),new Set(edges.map(e=>e.id)));
 for(const expected of edges){const actual=layout.edges.find(e=>e.id===expected.id)!;assert.equal(actual.from,expected.from);assert.equal(actual.to,expected.to);}
 assert.deepEqual({input,edges},before,'layout must not rewrite source graph data');
});

test('unresolved references use explicitly external canvas stubs and never invent story nodes',async()=>{
 const input=nodes(2),edges:LayoutInputEdge[]=[edge('normal',0,1),{id:'external',from:'n1',externalTarget:'unresolved:next-scene'},
  {id:'missing-target',from:'n0',to:'not-in-input'},{id:'missing-source',from:'not-in-input',to:'n1'}];
 const layout=await layoutGraph(input,edges);assertUsable(layout,input);
 assert.equal(layout.skippedEdges,2);
 assert.deepEqual(layout.nodes.filter(n=>!n.external).map(n=>n.id).sort(),['n0','n1']);
 assert.ok(layout.nodes.filter(n=>n.external).length>=1);
 assert.ok(!layout.nodes.some(n=>n.id==='not-in-input'));
 const external=layout.edges.find(e=>e.id==='external');assert.ok(external?.external);assert.equal(external.from,'n1');
 assert.ok(layout.nodes.some(n=>n.id===external.to&&n.external));
 assert.ok(!layout.edges.some(e=>e.id.startsWith('missing-')));
});

for(const count of [120,300])test(`${count} synthetic layered nodes have finite non-overlapping boxes and complete routes`,{timeout:30000},async()=>{
 const input=nodes(count),edges:LayoutInputEdge[]=[];
 // Ten nodes per layer, plus periodic diagonal branches/joins. No real game data.
 for(let i=0;i<count-10;i++){
  edges.push(edge(`straight-${i}`,i,i+10));
  if(i%3===0&&i%10<9)edges.push(edge(`diagonal-${i}`,i,i+11));
 }
 const layout=await layoutGraph(input,edges);assertUsable(layout,input);
 assert.equal(layout.nodes.length,count);assert.equal(layout.edges.length,edges.length);assert.equal(layout.skippedEdges,0);
});

test('structural signature ignores status, text and selection updates but responds to topology changes',async()=>{
 const input=nodes(4),edges=[edge('a',0,1),edge('b',1,2),edge('c',2,3)],signature=graphStructureSignature(input,edges);
 const decorated=input.map(node=>({...node,status:'checked',selected:true,active:true,title:'A changed translation preview',data:{progress:100}}));
 const decoratedEdges=edges.map(item=>({...item,selected:true,animated:true,status:'running'}));
 assert.equal(graphStructureSignature(decorated,decoratedEdges),signature);
 assert.notEqual(graphStructureSignature(input,[...edges,edge('new-branch',0,3)]),signature);
 assert.notEqual(graphStructureSignature([...input,{id:'added-node',order:4}],edges),signature);
 assert.notEqual(graphStructureSignature(input,edges.map(item=>item.id==='b'?{...item,to:'n3'}:item)),signature);
 assert.notEqual(graphStructureSignature(input.map(item=>item.id==='n1'?{...item,shape:'condition'}:item),edges),signature);
 const before=await layoutGraph(input,edges),after=await layoutGraph(decorated,decoratedEdges);
 assert.deepEqual(after.nodes.map(({id,x,y})=>({id,x,y})),before.nodes.map(({id,x,y})=>({id,x,y})));
});

test('explicit original controls retain semantic shapes even with linked translation units',()=>{
 assert.equal(classifyGraphNode({kind:'ConditionState',unitIds:['line-1']}),'condition');
 assert.equal(classifyGraphNode({kind:'IfElseState',unitIds:['line-1']}),'condition');
 assert.equal(classifyGraphNode({kind:'DelayState',unitIds:['line-1']}),'wait');
 assert.equal(classifyGraphNode({kind:'EventState',unitIds:['line-1']}),'event');
 assert.equal(classifyGraphNode({kind:'ScriptState',unitIds:['line-1']}),'script');
 assert.equal(classifyGraphNode({kind:'UnrecognizedRawState',unitIds:['line-1']}),'script');
 assert.equal(classifyGraphNode({kind:'ConditionState',unitIds:[]}),'condition');
 assert.equal(classifyGraphNode({kind:'JoinState',unitIds:[]}),'connector');
 assert.equal(classifyGraphNode({kind:'IfElseState',unitIds:[]}),'condition');
 assert.equal(classifyGraphNode({kind:'EventState',unitIds:[]}),'event');
 assert.equal(classifyGraphNode({kind:'SetFlagState',unitIds:[]}),'state');
 assert.equal(classifyGraphNode({kind:'DelayState',unitIds:[]}),'wait');
 assert.equal(classifyGraphNode({kind:'UnrecognizedRawState',unitIds:[]}),'unknown');
 assert.equal(classifyGraphNode({unitIds:[]}),'unknown');
});

test('mixed script, condition, state and connector shapes retain their boxes and routes',async()=>{
 const input:LayoutInputNode[]=[{id:'n0',shape:'script'},{id:'n1',shape:'condition'},{id:'n2',shape:'state'},{id:'n3',shape:'connector'},{id:'n4',shape:'script'}];
 const edges=[edge('to-condition',0,1),edge('true',1,2),edge('false',1,3),edge('merge',2,3),edge('continue',3,4)];
 const layout=await layoutGraph(input,edges);assertUsable(layout,input);
 assert.equal(layout.edges.length,edges.length);assert.equal(layout.skippedEdges,0);
});

test('wait, event and unknown outlines retain exact source IDs and do not increase text records',async()=>{
 const input:LayoutInputNode[]=['script','condition','wait','event','state','connector','unknown'].map((shape,index)=>({id:'n'+index,shape:shape as LayoutInputNode['shape']}));
 const edges=input.slice(1).map((_,index)=>edge('e'+index,index,index+1)),layout=await layoutGraph(input,edges);
 assertUsable(layout,input);assert.equal(layout.nodes.length,input.length);assert.equal(layout.edges.length,edges.length);
 assert.deepEqual(layout.nodes.map(node=>node.shape),input.map(node=>node.shape));
});

test('people relationships keep parallel, reciprocal, self-loop and isolated identities in a static relationship layout',async()=>{
 const input:LayoutInputNode[]=[{id:'alice',shape:'person',layoutGroup:'Earlier scene'},{id:'bob',shape:'person',layoutGroup:'Later scene'},{id:'carol',shape:'person'},{id:'isolated',shape:'person'}];
 const edges:LayoutInputEdge[]=[{id:'friend',from:'alice',to:'bob'},{id:'suspect',from:'alice',to:'bob'},{id:'reply',from:'bob',to:'alice'},{id:'family',from:'bob',to:'carol'},{id:'self',from:'carol',to:'carol'}];
 const before=structuredClone({input,edges}),layout=await layoutGraph(input,edges);assertUsable(layout,input);
 assert.equal(layout.nodes.length,4);assert.deepEqual(new Set(layout.edges.map(edge=>edge.id)),new Set(edges.map(edge=>edge.id)));assert.equal(layout.skippedEdges,0);
 assert.notDeepEqual(layout.edges.find(edge=>edge.id==='friend')!.points,layout.edges.find(edge=>edge.id==='suspect')!.points);
 assert.deepEqual({input,edges},before);assert.equal(layout.sections,undefined,'relationships do not receive narrative sections/ranks');
});

test('file metadata is not a layout boundary and a cross-file chain progresses downward',async()=>{
 const input:LayoutInputNode[]=[{id:'n0',order:0,layoutGroup:'Day 2'},{id:'n1',order:1,layoutGroup:'Day 1'},{id:'n2',order:2,layoutGroup:'Day 2'},{id:'n3',order:3,layoutGroup:'Day 1'}];
 const edges=[edge('cross-first',0,1),edge('cross-second',1,2),edge('cross-third',2,3)];
 const before=structuredClone({input,edges}),layout=await layoutGraph(input,edges),plain=await layoutGraph(input.map(({layoutGroup,...node})=>node),edges),positions=assertUsable(layout,input);
 assert.deepEqual(layout,plain);assert.equal(layout.edges.length,3);
 for(let index=0;index<3;index++)assert.ok(positions.get('n'+index)!.y+NODE_HEIGHT<=positions.get('n'+(index+1))!.y);
 assert.equal(graphStructureSignature(input,edges),graphStructureSignature(input.map(node=>({...node,layoutGroup:'Other file'})),edges));
 assert.deepEqual({input,edges},before);
});

test('chapter-local unresolved targets do not collide with another chapter stub',async()=>{
 const input:LayoutInputNode[]=[{id:'a',layoutGroup:'A'},{id:'b',layoutGroup:'B'}];
 const layout=await layoutGraph(input,[{id:'ea',from:'a',externalTarget:'outside-a'},{id:'eb',from:'b',externalTarget:'outside-b'}]);
 assertUsable(layout,input);assert.equal(layout.nodes.length,4);assert.equal(new Set(layout.edges.map(e=>e.to)).size,2);
});

test('disconnected file fragments preserve their exact edges without imposing chapter order',async()=>{
 const input:LayoutInputNode[]=Array.from({length:15},(_,i)=>({id:'n'+i,order:i,layoutGroup:'Day '+(Math.floor(i/3)+1)}));
 const edges=input.flatMap((node,i)=>i%3<2?[edge('e'+i,i,i+1)]:[]),layout=await layoutGraph(input,edges);
 assertUsable(layout,input);assert.equal(layout.nodes.length,15);assert.equal(layout.edges.length,10);
 assert.deepEqual(layout,await layoutGraph(input.map(({layoutGroup,...node})=>node),edges));
});

test('offline browser fixture is an importable synthetic project with all supported graph shapes',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/graph-demo.json',import.meta.url),'utf8')) as ProjectInput;
 assert.doesNotThrow(()=>validateProject(fixture));
 const graph=fixture.graph!;
 assert.equal(graph.metadata?.synthetic,true);assert.ok(graph.nodes.length>=12&&graph.nodes.length<=20);
 assert.ok(graph.edges.some(e=>e.from===e.to));assert.ok(graph.edges.some(e=>e.externalTarget&&!e.to));
 assert.ok(graph.edges.some((e,index)=>graph.edges.slice(index+1).some(other=>e.from===other.from&&e.to===other.to)));
 const layout=await layoutGraph(graph.nodes.map((n,order)=>({id:n.id,order})),graph.edges);
 assertUsable(layout,graph.nodes);assert.equal(layout.skippedEdges,0);
});
