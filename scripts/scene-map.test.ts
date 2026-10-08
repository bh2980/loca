import test from 'node:test';
import assert from 'node:assert/strict';
import {isSceneCollection,sceneNeighborhood,summarizeSceneEdges} from '../apps/web/src/scene-map.ts';
import {layoutGraph} from '../apps/web/src/flow-layout.ts';
import type {Group,SourceUnit} from '@workbench/contracts';

const group=(id:string,nextIds:string[]=[]):Group=>({id,title:id,kind:'scene',description:'',order:0,branch:'unknown',nextIds});
const edge=(from:string,to:string)=>({id:`${from}:${to}`,from,to});
test('display reduction retains every source relation and preserves forks and cycles',()=>{
 const input=[edge('a','b'),edge('b','c'),edge('a','c'),edge('c','d'),edge('d','c'),edge('a','e')];
 const before=structuredClone(input),result=summarizeSceneEdges(['a','b','c','d','e'],input);
 assert.deepEqual(input,before);assert.equal(result.length,input.length);
 assert.deepEqual(result.filter(e=>e.secondary).map(e=>e.id),['a:c']);
 assert.ok(result.filter(e=>['c:d','d:c','a:e'].includes(e.id)).every(e=>!e.secondary));
});
test('folded shortcut routes do not stretch or move the primary layout',async()=>{
 const nodes=['a','b','c'].map((id,order)=>({id,order})),primary=[edge('a','b'),edge('b','c')];
 const first=await layoutGraph(nodes,primary),second=await layoutGraph(nodes,[...primary,{...edge('a','c'),secondary:true}]);
 assert.deepEqual(first.nodes.map(({id,x,y})=>({id,x,y})),second.nodes.map(({id,x,y})=>({id,x,y})));
 assert.equal(second.edges.length,3);assert.ok(second.edges.every(e=>e.points.length>=2));
});
test('nearby view bounds fanout and keeps only actual incident relations',()=>{
 const groups=[group('center',['a','b','c','d']),group('before',['center','a']),...['a','b','c','d','isolated'].map(id=>group(id))];
 const before=structuredClone(groups),small=sceneNeighborhood(groups,'center',2),expanded=sceneNeighborhood(groups,'center',4);
 assert.deepEqual(small.groups.map(g=>g.id),['center','before','a','b']);assert.equal(small.hidden,2);assert.equal(expanded.hidden,0);
 assert.equal(small.edges.length,3);assert.ok(small.edges.every(e=>e.from==='center'||e.to==='center'));
 assert.deepEqual(groups,before);assert.deepEqual(sceneNeighborhood(groups,'isolated').groups.map(g=>g.id),['isolated']);
 assert.deepEqual(sceneNeighborhood(groups,'center').groups.map(g=>g.id),['center','before','a','b','c','d']);
 assert.equal(sceneNeighborhood(groups,'center').hidden,0);
});
test('UI and document-only collections stay outside narrative scene maps',()=>{
 const units=(kind:SourceUnit['kind'])=>[{kind}] as SourceUnit[];
 assert.equal(isSceneCollection(group('materials'),units('ui')),true);
 assert.equal(isSceneCollection(group('chat'),units('dialogue')),false);
 assert.equal(isSceneCollection(group('empty-unassigned'),[]),true);
 assert.equal(isSceneCollection({...group('empty-control'),graphNodeIds:['control-state']},[]),false);
 assert.equal(isSceneCollection({...group('document'),kind:'document'},units('document')),true);
});
