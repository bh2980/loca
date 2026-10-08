import test from 'node:test';
import assert from 'node:assert/strict';
import type {WorkflowDefinitionInput,WorkflowNode} from '../packages/contracts/src/index.ts';
import {layoutWorkflow,layoutWorkflowWithELK,nearestWorkflowPort,workflowFit} from '../apps/web/src/workflow-layout.ts';

test('saved positions are retained and explicit tidy can regenerate them; full fit uses actual viewport bounds',async()=>{
 const input:WorkflowDefinitionInput={name:'two nodes',nodes:[{id:'s',name:'s',type:'start',config:{},position:{x:-500,y:900}},{id:'e',name:'e',type:'end',config:{},position:{x:800,y:-100}}],edges:[{id:'e',from:'s',fromPort:'next',to:'e',toPort:'in'}]};assert.deepEqual(layoutWorkflow(input).nodes,input.nodes);assert.notDeepEqual((await layoutWorkflowWithELK(input,true)).nodes,input.nodes);const fit=workflowFit(input.nodes,700,240,()=>120);for(const node of input.nodes){const position=node.position!,left=position.x*fit.k+fit.x,top=position.y*fit.k+fit.y;assert.ok(left>=0&&top>=0);assert.ok(left+172*fit.k<=700&&top+120*fit.k<=240);}
});

test('overlapping screen-space port hit targets choose the actual nearest output and input at low zoom',()=>{
 const ports=[{id:'next',x:172,y:34},{id:'error',x:172,y:56},{id:'limit',x:172,y:78}];
 for(const scale of [.15,.3,1,2])for(const port of ports)assert.equal(nearestWorkflowPort(ports,port,scale)?.id,port.id);
 const inputs=[{nodeId:'first',x:100,y:20},{nodeId:'second',x:100,y:60}];assert.equal(nearestWorkflowPort(inputs,{x:100,y:58},.2,15)?.nodeId,'second');assert.equal(nearestWorkflowPort(ports,{x:20,y:20},1),undefined);assert.equal(nearestWorkflowPort(ports,ports[0],0),undefined);
});
