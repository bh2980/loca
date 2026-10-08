import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openWorkspace,workspaceRoute} from '../src/workspaces.ts';
import {threeSceneDemo} from '../../../packages/core/src/demo-three-scenes.ts';

test('main and demo use distinct databases and changing demo work never alters main state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workbench-workspace-isolation-')),mainDir=join(dir,'main'),demoDir=join(dir,'demo');
 const main=await openWorkspace(mainDir),demo=await openWorkspace(demoDir,true);
 try{
  assert.notEqual(resolve(main.engine.dataDir),resolve(demo.engine.dataDir));const before=main.engine.state();
  assert.equal(before.project.id,'night-transfer-demo');assert.equal(before.units.length,22);assert.equal(demo.engine.state().project.id,threeSceneDemo.project.id);
  demo.engine.updateUnit('relay-01',{text:'데모에서만 수정한 번역',expectedVersion:0});
  const check=demo.engine.testProfile({stage:'review',unitIds:['relay-01']});await demo.engine.waitForTaskTests();assert.equal(demo.engine.taskTest(check.id).status,'completed');
  assert.deepEqual(main.engine.state(),before);assert.equal(main.engine.state().translations['relay-01'],undefined);
  assert.ok((await readFile(join(mainDir,'workbench.sqlite'))).length>0);assert.ok((await readFile(join(demoDir,'workbench.sqlite'))).length>0);
 }finally{await demo.close();await main.close();await rm(dir,{recursive:true,force:true});}
});

test('reopening an existing demo preserves human edits, locks and version history instead of resetting fixture',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workbench-demo-reopen-'));let workspace=await openWorkspace(dir,true);
 try{
  workspace.engine.updateUnit('relay-01',{text:'재시작 후에도 보존할 문장',expectedVersion:0});const before=workspace.engine.state().translations['relay-01'];
  await workspace.close();workspace=await openWorkspace(dir,true);
  assert.deepEqual(workspace.engine.state().translations['relay-01'],before);assert.equal(before.locked,true);assert.equal(before.version,1);assert.equal(workspace.engine.state().project.id,'relay-three-scenes-demo');
 }finally{await workspace.close();await rm(dir,{recursive:true,force:true});}
});

test('fresh demo retains three scenes, 24 source IDs, 28 graph nodes and non-dialogue conditions/connectors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workbench-demo-graph-')),workspace=await openWorkspace(dir,true);
 try{
  const state=workspace.engine.state();assert.equal(state.groups.length,3);assert.equal(state.units.length,24);assert.equal(state.graph!.nodes.length,28);assert.deepEqual(state.units,threeSceneDemo.units);assert.deepEqual(state.graph,threeSceneDemo.graph);
  const noText=state.graph!.nodes.filter(node=>node.unitIds.length===0);assert.equal(noText.length,4);assert.ok(noText.some(node=>node.kind==='condition'&&node.conditions));assert.ok(noText.some(node=>node.kind==='delay'));assert.ok(noText.some(node=>node.kind==='connector'));
  assert.ok(state.graph!.edges.some(edge=>edge.conditions));assert.equal(state.units.find(unit=>unit.id==='relay-19')!.branch,'archive');assert.equal(state.units.find(unit=>unit.id==='relay-20')!.branch,'shortcut');
  const nodes=new Set(state.graph!.nodes.map(node=>node.id));assert.ok(state.graph!.edges.every(edge=>nodes.has(edge.from)&&!!edge.to&&nodes.has(edge.to)));
 }finally{await workspace.close();await rm(dir,{recursive:true,force:true});}
});

test('demo namespace routing is explicit and preserves all API path segments',()=>{
 assert.deepEqual(workspaceRoute('/api/demo/tasks/tests/test-id/cancel'),{demo:true,path:'/api/tasks/tests/test-id/cancel'});
 assert.deepEqual(workspaceRoute('/api/demo/state'),{demo:true,path:'/api/state'});
 assert.deepEqual(workspaceRoute('/api/state'),{demo:false,path:'/api/state'});
 assert.deepEqual(workspaceRoute('/api/demography/state'),{demo:false,path:'/api/demography/state'});
});
