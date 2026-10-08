import type {WorkflowDefinitionInput,WorkflowNode} from '@workbench/contracts';
import type {ELK} from 'elkjs/lib/elk-api.js';

/** Copy stored editing data without inventing a second layout algorithm. */
export function layoutWorkflow(input:WorkflowDefinitionInput):WorkflowDefinitionInput {
 return structuredClone(input);
}

export const workflowPosition=(node:WorkflowNode,index:number)=>node.position??{x:index*230,y:0};

/** Start reading the chain at normal size; overview fit remains an explicit action. */
export function workflowStartView(nodes:WorkflowNode[]){
 const index=Math.max(0,nodes.findIndex(node=>node.type==='start')),node=nodes[index],position=node?workflowPosition(node,index):{x:0,y:0},k=.9;
 return {x:48-position.x*k,y:100-position.y*k,k};
}

/** ELK owns automatic placement; user coordinates survive normal reloads. */
export async function layoutWorkflowWithELK(input:WorkflowDefinitionInput,force=false,heightOf:(node:WorkflowNode)=>number=()=>110):Promise<WorkflowDefinitionInput>{
 if(!force&&input.nodes.every(node=>node.position))return structuredClone(input);
 const module=await import('elkjs/lib/elk.bundled.js'),Constructor=module.default as unknown as {new():ELK};
 const elk=new Constructor(),validIds=new Set(input.nodes.map(node=>node.id));
 const graph=await elk.layout({id:'workflow',layoutOptions:{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.layered.spacing.nodeNodeBetweenLayers':'85','elk.spacing.nodeNode':'65','elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES'},children:input.nodes.map(node=>({id:node.id,width:172,height:heightOf(node)})),edges:input.edges.filter(edge=>edge.fromPort!=='error'&&validIds.has(edge.from)&&validIds.has(edge.to)).map(edge=>({id:edge.id,sources:[edge.from],targets:[edge.to]}))});
 const positions=new Map(graph.children?.map(node=>[node.id,{x:node.x??0,y:node.y??0}])??[]);
 return {...structuredClone(input),nodes:input.nodes.map(node=>({...structuredClone(node),position:!force&&node.position?{...node.position}:positions.get(node.id)}))};
}
export function workflowFit(nodes:WorkflowNode[],width:number,height:number,heightOf:(node:WorkflowNode)=>number){
 if(!nodes.length||width<=0||height<=0)return {x:40,y:40,k:.8};
 const boxes=nodes.map((node,index)=>({...workflowPosition(node,index),height:heightOf(node)})),minX=Math.min(...boxes.map(box=>box.x)),minY=Math.min(...boxes.map(box=>box.y)),maxX=Math.max(...boxes.map(box=>box.x+172)),maxY=Math.max(...boxes.map(box=>box.y+box.height));
 const k=Math.max(.025,Math.min(1.1,Math.max(1,width-70)/(maxX-minX),Math.max(1,height-90)/(maxY-minY)));
 return {x:(width-(maxX-minX)*k)/2-minX*k,y:45+(height-90-(maxY-minY)*k)/2-minY*k,k};
}

/** Screen-space hit targets can overlap at low zoom. Always choose the nearest
 * visible port rather than whichever output happens to be listed first. */
export function nearestWorkflowPort<T extends {x:number;y:number}>(ports:T[],point:{x:number;y:number},scale:number,radius=12):T|undefined {
 if(!Number.isFinite(scale)||scale<=0)return undefined;
 let selected:T|undefined,distance=radius;
 for(const port of ports){const candidate=Math.hypot(port.x-point.x,port.y-point.y)*scale;if(candidate<=distance){selected=port;distance=candidate;}}
 return selected;
}

