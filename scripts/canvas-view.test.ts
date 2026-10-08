import test from 'node:test';
import assert from 'node:assert/strict';
import {validViewport,compatibleViewport,focusAfterLayout,readCanvasView,saveCanvasView} from '../apps/web/src/canvas-view.ts';

test('reload persistence stores compact transform only and rejects a different topology',()=>{
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 const view={x:321,y:-654,k:.00014};saveCanvasView('project:scope','topology',view);
 assert.deepEqual(readCanvasView('project:scope','topology'),view);
 assert.equal(readCanvasView('project:scope','changed topology'),undefined);
 assert.ok([...values.values()][0].length<200,'no graph layout/labels are serialized per viewport change');
 for(let i=0;i<40;i++)saveCanvasView('scope'+i,'signature',{x:i,y:0,k:1});
 assert.equal(Object.keys(JSON.parse([...values.values()][0])).length,30,'persistent scopes are bounded');
});
test('invalid transforms and unavailable storage do not block graph navigation',()=>{
 assert.equal(validViewport({x:NaN,y:0,k:1}),false);assert.equal(validViewport({x:0,y:0,k:0}),false);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get:()=>{throw new Error('private mode');}});
 assert.doesNotThrow(()=>saveCanvasView('scope','sig',{x:0,y:0,k:1}));assert.equal(readCanvasView('scope','sig'),undefined);
});
test('legacy navigation coordinates cannot override ELK geometry; same-version Back/Forward preserves the exact pan',()=>{
 const current='cfg-v9-elk-down:complete',legacy={x:12000,y:-45000,k:.85},old={...legacy,layoutSignature:'cfg-v8:complete'},saved={x:-320,y:-2500,k:.72,layoutSignature:current};
 assert.equal(compatibleViewport(legacy,current),false,'old unsigned navigation snapshots cannot bypass layout cache invalidation');
 assert.equal(compatibleViewport(old,current),false,'previous layout coordinates must not be restored');
 const restored=JSON.parse(JSON.stringify({viewport:saved})).viewport;
 assert.equal(compatibleViewport(restored,current),true);assert.deepEqual(restored,saved,'navigation history retains exact current geometry and transform');
 assert.equal(compatibleViewport(restored,current+':different-scope'),false);
 const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 saveCanvasView('source-full',current,saved);assert.deepEqual(readCanvasView('source-full',current),saved);
 assert.equal(compatibleViewport(readCanvasView('source-full',current),current),true);
});
test('locating a scene while the source worker runs wins over its captured viewport without breaking ordinary restore',()=>{
 assert.equal(focusAfterLayout(undefined,0,false,false,true),false,'ordinary reload restores the saved viewport');
 assert.equal(focusAfterLayout('Commentary Introduction',1,true,false,true),true,'new explicit selection after worker start must be located on the completed layout');
 assert.equal(focusAfterLayout('Commentary Introduction',1,true,true,true),false,'reordering after handling the same request preserves subsequent panning');
 assert.equal(focusAfterLayout('Commentary Introduction',undefined,true,false,true),false,'passive focus does not overwrite a history viewport');
 assert.equal(focusAfterLayout('Commentary Introduction',2,true,false,true),true,'a repeated explicit locate with a new token wins');
 assert.equal(focusAfterLayout('outside scope',2,false,false,true),false,'an absent target cannot redirect the restored view');
 assert.equal(focusAfterLayout('Commentary Introduction',undefined,true,false,false),true,'initial navigation without a saved viewport locates its target');
});
