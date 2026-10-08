import test from 'node:test';
import assert from 'node:assert/strict';
import {routeObstacles,type RouteGeometry,type RoutePoint} from '../apps/web/src/obstacle-routing.ts';
import {layoutWorkflowWithELK} from '../apps/web/src/workflow-layout.ts';
import type {WorkflowDefinitionInput} from '../packages/contracts/src/index.ts';

const fixture=(dy=0,reverse=false):RouteGeometry=>({nodes:[{id:'a',x:reverse?350:0,y:0,width:172,height:110},{id:'b',x:reverse?0:350,y:dy,width:172,height:110},{id:'far',x:800,y:2000,width:172,height:110}],edges:[{id:'a:next->b:in',from:'a',to:'b',fromPort:'next',toPort:'in',source:{x:(reverse?350:0)+172,y:34},target:{x:reverse?0:350,y:34+dy}}]});
const orthogonal=(points:RoutePoint[])=>{for(let index=1;index<points.length;index++)assert.ok(points[index].x===points[index-1].x||points[index].y===points[index-1].y);};
test('actual libavoid keeps small vertical changes local and preserves edge IDs and port endpoints',async()=>{
 for(const dy of [0,9,11,44,46]){const input=fixture(dy),before=structuredClone(input),[edge]=await routeObstacles(input);assert.equal(edge.id,input.edges[0].id);assert.deepEqual(edge.points[0],input.edges[0].source);assert.deepEqual(edge.points.at(-1),input.edges[0].target);assert.ok(Math.max(...edge.points.map(point=>point.y))<200);orthogonal(edge.points);assert.deepEqual(input,before);assert.deepEqual(await routeObstacles(input),[edge]);}
});
test('actual libavoid routes reverse and error ports locally and avoids an intervening node',async()=>{
 const reverse=fixture(11,true);reverse.edges[0].fromPort='error';const [back]=await routeObstacles(reverse);orthogonal(back.points);assert.ok(Math.max(...back.points.map(point=>point.y))<300);
 const input=fixture();input.nodes.push({id:'obstacle',x:220,y:-20,width:80,height:150});const [edge]=await routeObstacles(input);orthogonal(edge.points);
 for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i];if(a.y===b.y)assert.ok(!(a.y>-20&&a.y<130&&Math.max(a.x,b.x)>220&&Math.min(a.x,b.x)<300));else assert.ok(!(a.x>220&&a.x<300&&Math.max(a.y,b.y)>-20&&Math.min(a.y,b.y)<130));}
});
test('native router lifetime repeatedly creates/releases without invalid handles',async()=>{for(let index=0;index<40;index++)assert.equal((await routeObstacles(fixture(index%47))).length,1);});
test('ELK places the primary workflow left to right and keeps persisted manual positions',async()=>{
 const input:WorkflowDefinitionInput={name:'chain',nodes:[{id:'start',name:'start',type:'start',config:{}},{id:'middle',name:'middle',type:'query',config:{terms:true,knowledge:true}},{id:'end',name:'end',type:'end',config:{}}],edges:[{id:'one',from:'start',fromPort:'next',to:'middle',toPort:'in'},{id:'two',from:'middle',fromPort:'next',to:'end',toPort:'in'}]};
 const laid=await layoutWorkflowWithELK(input,true);assert.ok(laid.nodes[0].position!.x<laid.nodes[1].position!.x&&laid.nodes[1].position!.x<laid.nodes[2].position!.x);assert.deepEqual(laid.edges,input.edges);assert.deepEqual(await layoutWorkflowWithELK(laid),laid);assert.ok(input.nodes.every(node=>!node.position));
});
