import test from 'node:test';
import assert from 'node:assert/strict';
import {boundsIntersect,polylineBounds,indexNodes,queryVisibleNodes,hitTestNode,hitTestEdge,indexEdges,queryVisibleEdges,polylineIntersects} from '../apps/web/src/canvas-geometry.ts';
import {containsShape,portBoundary} from '../apps/web/src/graph-shapes.ts';
import type {LayoutNode} from '../apps/web/src/flow-layout.ts';
const node=(id:string,x:number,y:number,width=280,height=118):LayoutNode=>({id,x,y,width,height,ports:[]});

test('viewport culling retains crossing nodes once, including negative coordinates and cell boundaries',()=>{
 const nodes=[node('negative',-30,-20),node('boundary',1010,1000),node('far',5000,5000)];
 const cells=indexNodes(nodes);
 assert.deepEqual(queryVisibleNodes(nodes,cells,{left:1015,top:1005,right:1030,bottom:1030}).map(n=>n.id),['boundary']);
 assert.equal(queryVisibleNodes(nodes,cells,{left:-40,top:-40,right:500,bottom:500})[0].id,'negative');
 assert.equal(queryVisibleNodes(nodes,cells,{left:-100,top:-100,right:6000,bottom:6000}).length,3);
});

test('edge culling follows routed segments instead of endpoints or the empty interior of a loop',()=>{
 const make=(id:string,points:{x:number;y:number}[])=>({id,from:'a',to:'b',sourceHandle:'a',targetHandle:'b',points});
 const crossing=make('crossing',[{x:-100,y:50},{x:200,y:50}]),loop=make('loop',[{x:-100,y:-100},{x:-100,y:200},{x:200,y:200}]),long=make('long',[{x:-1000000,y:70},{x:1000000,y:70}]);
 const edges=[crossing,loop,long],bounds={left:0,top:0,right:100,bottom:100};
 assert.equal(polylineIntersects(loop,bounds),false);
 assert.deepEqual(queryVisibleEdges(edges,indexEdges(edges),bounds).map(edge=>edge.id),['crossing','long']);
 assert.deepEqual(queryVisibleEdges(edges,indexEdges(edges),{left:-101,top:0,right:-99,bottom:100}).map(edge=>edge.id),['crossing','loop','long']);
});
test('shape picking rejects transparent corners and uses the same boundaries as rendering',()=>{
 for(const shape of ['condition','event','state','unknown','wait','connector'] as const){
  const n={...node(shape,0,0,100,100),shape};
  assert.equal(hitTestNode([n],1,1)?.id,shape==='wait'?shape:undefined);
  assert.equal(hitTestNode([n],50,50)?.id,shape);
 }
 assert.equal(containsShape('wait',.1,.5),false);
 assert.equal(containsShape('script',.01,.01),true);
 assert.equal(portBoundary('condition',.25,false),.25);
 assert.equal(portBoundary('condition',.25,true),.75);
 assert.equal(portBoundary('event',.5,false),0);
 assert.equal(portBoundary('event',.5,true),1);
});
test('relationship picking uses nearest segment and screen-space tolerance after zoom',()=>{
 const edges=[0,20].map((y,index)=>({id:'edge'+index,from:'a',to:'b',sourceHandle:'a',targetHandle:'b',points:[{x:0,y},{x:200,y}]}));
 assert.equal(hitTestEdge(edges,80,18,7)?.id,'edge1');assert.equal(hitTestEdge(edges,80,10,7),undefined);
 const transform={x:100,y:-50,k:2},screen={x:260,y:-8};
 assert.equal(hitTestEdge(edges,(screen.x-transform.x)/transform.k,(screen.y-transform.y)/transform.k,7/transform.k)?.id,'edge1');
 assert.equal(hitTestEdge(edges,-40,20,7),undefined,'line extensions are not selectable paths');
});
test('connection remains drawable when both endpoints are outside the viewport',()=>{
 const bounds=polylineBounds({id:'edge',from:'a',to:'b',sourceHandle:'a',targetHandle:'b',points:[{x:-100,y:50},{x:200,y:50}]});
 assert.ok(boundsIntersect(bounds,{left:0,top:0,right:100,bottom:100}));
 assert.ok(!boundsIntersect(bounds,{left:0,top:100,right:100,bottom:200}));
});
test('hit testing honors world coordinates and does not select external stubs',()=>{
 const n=node('a',1020,1040),stub={...node('external',1020,1040),external:true};
 const cells=indexNodes([n,stub]);
 assert.equal(hitTestNode(cells.get('1:1')!,1060,1080)?.id,'a');
 assert.equal(hitTestNode([n],5000,5000),undefined);
 // Screen to world conversion after panning/zooming must select the same node.
 const transform={x:-1600,y:-1800,k:2};
 assert.equal(hitTestNode([n],(520-transform.x)/transform.k,(360-transform.y)/transform.k)?.id,'a');
});
