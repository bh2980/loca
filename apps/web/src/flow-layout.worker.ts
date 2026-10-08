import {layoutGraph,type LayoutInputNode,type LayoutInputEdge} from './flow-layout';
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
let active:InstanceType<typeof ELK>|undefined,cancelled=false;
self.onmessage=async(event:MessageEvent<{type?:'cancel';requestId:number;nodes:LayoutInputNode[];edges:LayoutInputEdge[]}>)=>{
 const {requestId,nodes,edges}=event.data;
 if(event.data.type==='cancel'){cancelled=true;active?.terminateWorker();active=undefined;self.postMessage({requestId,cancelled:true});return;}
 cancelled=false;
 // Every source size uses the actual ELK layered library in its own child
 // worker. Weak components are routed separately to bound library work.
 const elk=new ELK({workerFactory:()=>new Worker(elkWorkerUrl)});
 active=elk;
 try{const started=performance.now(),result=await layoutGraph(nodes,edges,elk);elk?.terminateWorker();if(!cancelled)self.postMessage({requestId,result,layoutMs:performance.now()-started});}
 catch(error){if(!cancelled)self.postMessage({requestId,error:error instanceof Error?error.message:'그래프 배치 실패'});}
 finally{elk?.terminateWorker();if(active===elk)active=undefined;}
};
