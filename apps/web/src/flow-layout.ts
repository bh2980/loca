import type {ElkNode,ELK} from 'elkjs/lib/elk-api.js';
import {portBoundary} from './graph-shapes.js';
import {graphNodeSemantics,type GraphSemanticNode} from '@workbench/contracts';

export const NODE_WIDTH=280,NODE_HEIGHT=118;
export type NodeShape='scene'|'script'|'condition'|'wait'|'event'|'state'|'connector'|'unknown'|'person';
export interface LayoutInputNode {id:string;order?:number;shape?:NodeShape;layoutGroup?:string}
export function classifyGraphNode(node:GraphSemanticNode):NodeShape{return graphNodeSemantics(node).shape;}
export function nodeDimensions(shape?:NodeShape){return shape==='condition'?{width:180,height:144}:shape==='connector'?{width:24,height:24}:shape==='wait'?{width:140,height:120}:shape==='event'||shape==='person'?{width:132,height:132}:shape==='state'||shape==='unknown'?{width:200,height:86}:{width:NODE_WIDTH,height:NODE_HEIGHT};}
export interface LayoutInputEdge {id:string;from:string;to?:string;externalTarget?:string;secondary?:boolean}
export interface LayoutPoint {x:number;y:number}
export interface LayoutNode {id:string;x:number;y:number;width:number;height:number;shape?:NodeShape;external?:boolean;ports:{id:string;type:'source'|'target';x:number;y:number}[]}
export interface LayoutEdge {id:string;from:string;to:string;sourceHandle:string;targetHandle:string;points:LayoutPoint[];external?:boolean;secondary?:boolean}
export interface LayoutSection {id:string;title:string;x:number;y:number;width:number;height:number;nodeCount:number}
export interface LayoutResult {nodes:LayoutNode[];edges:LayoutEdge[];skippedEdges:number;sections?:LayoutSection[]}
export function graphStructureSignature(nodes:LayoutInputNode[],edges:LayoutInputEdge[]):string{
 // File metadata is deliberately absent: changing provenance cannot change CFG
 // placement. Hashing retains a small persistence key instead of a graph JSON.
 const value=JSON.stringify([nodes.map(n=>[n.id,n.order??0,n.shape??'scene']).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),edges.map(e=>[e.id,e.from,e.to??null,e.externalTarget??null,!!e.secondary]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
 let a=2166136261,b=5381;for(let index=0;index<value.length;index++){const code=value.charCodeAt(index);a=Math.imul(a^code,16777619);b=Math.imul(b,33)^code;}return `cfg-v9-elk-down:${nodes.length}:${edges.length}:${(a>>>0).toString(36)}:${(b>>>0).toString(36)}`;
}
export async function layoutGraph(nodes:LayoutInputNode[],edges:LayoutInputEdge[],engine?:ELK,forceFast=false,linkedOutside?:ReadonlySet<string>):Promise<LayoutResult>{
 if(nodes.length&&nodes.every(node=>node.shape==='person'))return layoutRelationships(nodes,edges,engine);
 // The compatibility arguments no longer select a custom/grid layout.
 const separateComponents=forceFast||nodes.length>300;
 const originalIds=new Set(nodes.map(n=>n.id)),ids=new Set(originalIds),external=new Map<string,string>();let skippedEdges=0;
 const routed:LayoutEdge[]=[];
 for(const edge of [...edges].sort((a,b)=>a.id.localeCompare(b.id))){
  if(!ids.has(edge.from)){skippedEdges++;continue;}
  let target=edge.to;
  if(!target||!ids.has(target)){
   if(!edge.externalTarget){skippedEdges++;continue;}
   let stub=external.get(edge.externalTarget);if(!stub){stub=`__canvas_external__${external.size}`;while(ids.has(stub))stub+='x';external.set(edge.externalTarget,stub);ids.add(stub);}target=stub;
  }
  routed.push({id:edge.id,from:edge.from,to:target,sourceHandle:`out:${edge.id}`,targetHandle:`in:${edge.id}`,points:[],external:!originalIds.has(target),secondary:edge.secondary});
 }
 const ordered=[...nodes].sort((a,b)=>(a.order??0)-(b.order??0)||a.id.localeCompare(b.id));
 const primary=routed.filter(edge=>!edge.secondary);
 const portsByNode=new Map<string,NonNullable<ElkNode['ports']>>();
 for(const edge of primary)for(const [id,handle,side] of [[edge.from,edge.sourceHandle,'SOUTH'],[edge.to,edge.targetHandle,'NORTH']] as const){const ports=portsByNode.get(id)??[];ports.push({id:handle,width:2,height:2,layoutOptions:{'elk.port.side':side}});portsByNode.set(id,ports);}
 const children=[...ordered.map(n=>({id:n.id,external:false,shape:n.shape})),...[...external.values()].map(id=>({id,external:true,shape:undefined}))].map(n=>({id:n.id,...(n.external?{width:NODE_WIDTH,height:70}:nodeDimensions(n.shape)),layoutOptions:{'elk.portConstraints':'FIXED_ORDER'},ports:portsByNode.get(n.id)??[]}));
 if(!children.length)return {nodes:[],edges:[],skippedEdges};
 // Browser workers inject elk-api with a native workerFactory. The bundled
 // fake-worker fallback is safe in Node, but detects `self` in a browser worker.
 let elk=engine;
 if(!elk){const module=await import('elkjs/lib/elk.bundled.js');const ElkConstructor=module.default as unknown as {new():ELK};elk=new ElkConstructor();}
 const result:ElkNode&{sourceSections?:LayoutSection[]}=separateComponents?await layoutSourceComponents(children,primary,elk,shapeOfInput(nodes),linkedOutside):await elk.layout({id:'root',layoutOptions:SOURCE_LAYOUT_OPTIONS,children,edges:primary.map(e=>({id:e.id,sources:[e.sourceHandle],targets:[e.targetHandle]}))});
 const externalIds=new Set(external.values());
 const shapeOf=new Map(nodes.map(node=>[node.id,node.shape]));
 const placed:LayoutNode[]=(result.children??[]).map(n=>({id:n.id,shape:shapeOf.get(n.id),x:n.x??0,y:n.y??0,width:n.width??NODE_WIDTH,height:n.height??NODE_HEIGHT,external:externalIds.has(n.id),ports:(n.ports??[]).map(p=>({id:p.id,type:p.id.startsWith('out:')?'source':'target',x:(p.x??0)+1,y:(p.y??0)+1}))}));
 const resultEdges=new Map((result.edges??[]).map(e=>[e.id,e]));
 const positions=new Map(placed.map(node=>[node.id,node]));
 for(const edge of routed){
  if(edge.secondary){
   const from=positions.get(edge.from)!,to=positions.get(edge.to)!;
   from.ports.push({id:edge.sourceHandle,type:'source',x:from.width/2,y:from.height});to.ports.push({id:edge.targetHandle,type:'target',x:to.width/2,y:0});
   edge.points=[{x:from.x+from.width/2,y:from.y+from.height},{x:to.x+to.width/2,y:to.y}];
  }else{const sections=resultEdges.get(edge.id)?.sections??[];edge.points=sections.flatMap((s,index)=>[...(index===0?[s.startPoint]:[]),...(s.bendPoints??[]),s.endPoint]);}
 }
 for(const node of placed)for(const port of node.ports){port.y=node.height*portBoundary(node.shape,port.x/node.width,port.type==='source');}
 for(const edge of routed){const from=positions.get(edge.from)!,to=positions.get(edge.to)!,a=from.ports.find(port=>port.id===edge.sourceHandle)!,b=to.ports.find(port=>port.id===edge.targetHandle)!;if(edge.points.length){edge.points[0]={x:from.x+a.x,y:from.y+a.y};edge.points[edge.points.length-1]={x:to.x+b.x,y:to.y+b.y};}}
 const section=placed.length?{id:'source-connected',title:primary.length?'원문 흐름':'연결 없는 원문',x:Math.min(...placed.map(node=>node.x))-32,y:Math.min(...placed.map(node=>node.y))-40,width:Math.max(...placed.map(node=>node.x+node.width))-Math.min(...placed.map(node=>node.x))+64,height:Math.max(...placed.map(node=>node.y+node.height))-Math.min(...placed.map(node=>node.y))+80,nodeCount:nodes.length}:undefined;
 return {nodes:placed,edges:routed,skippedEdges,sections:result.sourceSections??(section?[section]:[])};
}

/** ELK chooses layers, feedback edges and orthogonal channels for every source
 * graph size. A bounded-width layerer uses height instead of spreading whole
 * frontiers into one enormous row. Layout layers are not execution chronology. */
export const SOURCE_LAYOUT_OPTIONS={
 'elk.algorithm':'layered','elk.direction':'DOWN','elk.edgeRouting':'ORTHOGONAL',
 'elk.layered.layering.strategy':'COFFMAN_GRAHAM',
 'elk.layered.layering.coffmanGraham.layerBound':'5',
 'elk.spacing.nodeNode':'70','elk.layered.spacing.nodeNodeBetweenLayers':'140',
 'elk.layered.spacing.edgeEdgeBetweenLayers':'20','elk.spacing.edgeNode':'24',
 'elk.layered.spacing.edgeNodeBetweenLayers':'32',
 'elk.layered.thoroughness':'1','elk.randomSeed':'1',
};
const shapeOfInput=(nodes:LayoutInputNode[])=>new Map(nodes.map(node=>[node.id,node.shape]));
/** ELK's cycle preprocessor recurses on a 10,000-node chain. A proven simple
 * chain can instead be laid out hierarchically: the library places/routes each
 * batch and then places/routes the batch boxes. All bridge IDs stay original. */
async function layoutSourceComponent(id:string,children:ElkNode[],edges:LayoutEdge[],elk:ELK):Promise<ElkNode>{
 const plain=()=>elk.layout({id,layoutOptions:SOURCE_LAYOUT_OPTIONS,children,edges:edges.map(edge=>({id:edge.id,sources:[edge.sourceHandle],targets:[edge.targetHandle]}))} as ElkNode);
 if(children.length<1500||edges.length!==children.length-1)return plain();
 const outgoing=new Map<string,LayoutEdge>(),incoming=new Set<string>();
 for(const edge of edges){if(edge.from===edge.to||outgoing.has(edge.from)||incoming.has(edge.to))return plain();outgoing.set(edge.from,edge);incoming.add(edge.to);}
 const first=children.find(node=>!incoming.has(node.id));if(!first)return plain();
 const byId=new Map(children.map(node=>[node.id,node])),ordered:ElkNode[]=[],seen=new Set<string>();let current:ElkNode|undefined=first;
 while(current&&!seen.has(current.id)){seen.add(current.id);ordered.push(current);current=byId.get(outgoing.get(current.id)?.to??'');}
 if(ordered.length!==children.length)return plain();
 const batches:ElkNode[]=[],batchOf=new Map<string,number>();for(let index=0;index<ordered.length;index++)batchOf.set(ordered[index].id,Math.floor(index/500));
 const bridges=edges.filter(edge=>batchOf.get(edge.from)!==batchOf.get(edge.to)),inside=Array.from({length:Math.ceil(ordered.length/500)},()=>[] as LayoutEdge[]);
 for(const edge of edges)if(batchOf.get(edge.from)===batchOf.get(edge.to))inside[batchOf.get(edge.from)!].push(edge);
 for(let index=0;index<inside.length;index++)batches.push(await elk.layout({id:`${id}:batch:${index}`,layoutOptions:SOURCE_LAYOUT_OPTIONS,children:ordered.slice(index*500,(index+1)*500),edges:inside[index].map(edge=>({id:edge.id,sources:[edge.sourceHandle],targets:[edge.targetHandle]}))} as ElkNode));
 const childPositions=new Map(batches.flatMap((batch,index)=>(batch.children??[]).map(node=>[node.id,{node,index}] as const)));
 const parentChildren:ElkNode[]=batches.map((batch,index)=>({id:`batch:${index}`,width:batch.width,height:batch.height,ports:[],layoutOptions:{'elk.portConstraints':'FIXED_POS'}}));
 for(const edge of bridges)for(const [endpoint,handle,side,type] of [[edge.from,edge.sourceHandle,'SOUTH','out'],[edge.to,edge.targetHandle,'NORTH','in']] as const){
  const {node,index}=childPositions.get(endpoint)!,port=node.ports!.find(port=>port.id===handle)!;
  parentChildren[index].ports!.push({id:`${type}:${edge.id}`,x:(node.x??0)+(port.x??0),y:side==='SOUTH'?(batches[index].height??0):0,width:2,height:2,layoutOptions:{'elk.port.side':side}});
 }
 const parent:ElkNode=await elk.layout({id:`${id}:hierarchy`,layoutOptions:SOURCE_LAYOUT_OPTIONS,children:parentChildren,edges:bridges.map(edge=>({id:edge.id,sources:[`out:${edge.id}`],targets:[`in:${edge.id}`]}))});
 const offsets=new Map((parent.children??[]).map((node,index)=>[index,{x:node.x??0,y:node.y??0}]));
 const placed=batches.flatMap((batch,index)=>(batch.children??[]).map(node=>({...node,x:(node.x??0)+offsets.get(index)!.x,y:(node.y??0)+offsets.get(index)!.y}))),byPlaced=new Map(placed.map(node=>[node.id,node]));
 const routed:NonNullable<ElkNode['edges']>=batches.flatMap((batch,index)=>(batch.edges??[]).map(edge=>({...edge,sections:edge.sections?.map(section=>({...section,startPoint:{x:section.startPoint.x+offsets.get(index)!.x,y:section.startPoint.y+offsets.get(index)!.y},endPoint:{x:section.endPoint.x+offsets.get(index)!.x,y:section.endPoint.y+offsets.get(index)!.y},bendPoints:section.bendPoints?.map(point=>({x:point.x+offsets.get(index)!.x,y:point.y+offsets.get(index)!.y}))}))})));
 const bridgeById=new Map(bridges.map(edge=>[edge.id,edge]));
 for(const edge of parent.edges??[]){const original=bridgeById.get(edge.id)!,from=byPlaced.get(original.from)!,to=byPlaced.get(original.to)!,a=from.ports!.find(port=>port.id===original.sourceHandle)!,b=to.ports!.find(port=>port.id===original.targetHandle)!;
  routed.push({...edge,sources:[original.sourceHandle],targets:[original.targetHandle],sections:edge.sections?.map((section,index,all)=>({...section,startPoint:index===0?{x:(from.x??0)+(a.x??0)+1,y:(from.y??0)+(a.y??0)+1}:section.startPoint,endPoint:index===all.length-1?{x:(to.x??0)+(b.x??0)+1,y:(to.y??0)+(b.y??0)+1}:section.endPoint}))});
 }
 return {...parent,id,children:placed,edges:routed};
}
/** Weak components are independent actual subgraphs, not file partitions.
 * Stack complete independently-routed components top-to-bottom; no source edge
 * is added between them. Unconnected records have an explicitly separate list. */
async function layoutSourceComponents(children:ElkNode[],edges:LayoutEdge[],elk:ELK,shapes:Map<string,NodeShape|undefined>,linkedOutside?:ReadonlySet<string>):Promise<ElkNode&{sourceSections:LayoutSection[]}>{
 const byId=new Map(children.map(child=>[child.id,child])),adjacency=new Map(children.map(child=>[child.id,[] as string[]]));
 for(const edge of edges){adjacency.get(edge.from)!.push(edge.to);adjacency.get(edge.to)!.push(edge.from);}
 const visited=new Set<string>(),components:string[][]=[],isolatedScripts:ElkNode[]=[],isolatedControls:ElkNode[]=[];
 for(const child of children){
  if(visited.has(child.id))continue;visited.add(child.id);
  if(!adjacency.get(child.id)!.length&&!linkedOutside?.has(child.id)){(shapes.get(child.id)==='script'?isolatedScripts:isolatedControls).push(child);continue;}
  const members=[child.id];for(let index=0;index<members.length;index++)for(const next of adjacency.get(members[index])!)if(!visited.has(next)){visited.add(next);members.push(next);}components.push(members);
 }
 const membership=new Map(components.flatMap((members,index)=>members.map(id=>[id,index] as const))),componentEdges=components.map(()=>[] as LayoutEdge[]);
 for(const edge of edges)componentEdges[membership.get(edge.from)!].push(edge);
 const placed:ElkNode[]=[],routed:NonNullable<ElkNode['edges']>=[],sourceSections:LayoutSection[]=[];let y=0,width=0;
 for(let index=0;index<components.length;index++){
  const members=components[index],result=await layoutSourceComponent(`source-component-${index}`,members.map(id=>byId.get(id)!),componentEdges[index],elk);
  const componentWidth=(result.width??Math.max(1,...(result.children??[]).map(node=>(node.x??0)+(node.width??0))))+64,componentHeight=(result.height??Math.max(1,...(result.children??[]).map(node=>(node.y??0)+(node.height??0))))+108;
  for(const node of result.children??[])placed.push({...node,x:(node.x??0)+32,y:(node.y??0)+y+68});
  for(const edge of result.edges??[])routed.push({...edge,sections:edge.sections?.map(section=>({...section,startPoint:{x:section.startPoint.x+32,y:section.startPoint.y+y+68},endPoint:{x:section.endPoint.x+32,y:section.endPoint.y+y+68},bendPoints:section.bendPoints?.map(point=>({x:point.x+32,y:point.y+y+68}))}))});
  sourceSections.push({id:`source-component-${index}`,title:`원본 연결 · ${index+1}`,x:0,y,width:componentWidth,height:componentHeight,nodeCount:members.filter(id=>shapes.has(id)).length});
  width=Math.max(width,componentWidth);y+=componentHeight+180;
 }
 // A vertical inventory is honest for records with no source relationships.
 // There is no grid, serpentine sequence or fabricated execution connection.
 for(const [id,title,members] of [['unlinked-text','연결 없는 원문',isolatedScripts],['unlinked-controls','연결 없는 상태·조건',isolatedControls]] as const){
  if(!members.length)continue;const top=y,sectionWidth=Math.max(...members.map(node=>node.width??NODE_WIDTH))+64;y+=68;
  for(const node of members){placed.push({...node,x:32,y});y+=(node.height??NODE_HEIGHT)+70;}
  const height=y-top+40;sourceSections.push({id,title,x:0,y:top,width:sectionWidth,height,nodeCount:members.length});width=Math.max(width,sectionWidth);y+=220;
 }
 return {id:'source-components',width,height:y,children:placed,edges:routed,sourceSections};
}

/** People have relationships, not execution ranks. A static stress layout uses
 * only the persisted endpoints; it does not invent co-occurrence relationships. */
async function layoutRelationships(input:LayoutInputNode[],edges:LayoutInputEdge[],engine?:ELK):Promise<LayoutResult>{
 const ordered=[...input].sort((a,b)=>(a.order??0)-(b.order??0)||a.id.localeCompare(b.id)),ids=new Set(ordered.map(node=>node.id));
 const valid=edges.filter(edge=>ids.has(edge.from)&&!!edge.to&&ids.has(edge.to)),skippedEdges=edges.length-valid.length;
 let elk=engine;if(!elk){const module=await import('elkjs/lib/elk.bundled.js');const Constructor=module.default as unknown as {new():ELK};elk=new Constructor();}
 const graph=await elk.layout({id:'relationships',layoutOptions:{'elk.algorithm':'stress','elk.stress.desiredEdgeLength':'260','elk.spacing.nodeNode':'70','elk.randomSeed':'1'},children:ordered.map(node=>({id:node.id,...nodeDimensions('person')})),edges:valid.filter(edge=>edge.from!==edge.to).map(edge=>({id:edge.id,sources:[edge.from],targets:[edge.to!]}))});
 const nodes:LayoutNode[]=(graph.children??[]).map(node=>({id:node.id,x:node.x??0,y:node.y??0,width:node.width??132,height:node.height??132,shape:'person',ports:[]})),byId=new Map(nodes.map(node=>[node.id,node]));
 const groups=new Map<string,LayoutInputEdge[]>();for(const edge of [...valid].sort((a,b)=>a.id.localeCompare(b.id))){const key=[edge.from,edge.to!].sort().join('\0'),list=groups.get(key)??[];list.push(edge);groups.set(key,list);}
 const routed:LayoutEdge[]=[];
 for(const list of groups.values())list.forEach((edge,index)=>{
  const a=byId.get(edge.from)!,b=byId.get(edge.to!)!,sourceHandle=`out:${edge.id}`,targetHandle=`in:${edge.id}`;
  const ac={x:a.x+a.width/2,y:a.y+a.height/2},bc={x:b.x+b.width/2,y:b.y+b.height/2},dx=bc.x-ac.x,dy=bc.y-ac.y,length=Math.hypot(dx,dy)||1;
  let points:LayoutPoint[];
  if(a===b){const gap=38+index*16;points=[{x:a.x+a.width,y:ac.y},{x:a.x+a.width+gap,y:ac.y},{x:a.x+a.width+gap,y:a.y-gap},{x:ac.x,y:a.y-gap},{x:ac.x,y:a.y}];}
  else{const sign=edge.from<edge.to!?1:-1,offset=(index-(list.length-1)/2)*38*sign,mid={x:(ac.x+bc.x)/2-dy/length*offset,y:(ac.y+bc.y)/2+dx/length*offset};
   const boundary=(node:LayoutNode,center:LayoutPoint)=>{const vx=mid.x-center.x,vy=mid.y-center.y,scale=1/Math.sqrt((vx/(node.width/2))**2+(vy/(node.height/2))**2);return {x:center.x+vx*scale,y:center.y+vy*scale};};
   points=[boundary(a,ac),mid,boundary(b,bc)];}
  a.ports.push({id:sourceHandle,type:'source',x:points[0].x-a.x,y:points[0].y-a.y});const end=points.at(-1)!;b.ports.push({id:targetHandle,type:'target',x:end.x-b.x,y:end.y-b.y});
  routed.push({id:edge.id,from:edge.from,to:edge.to!,sourceHandle,targetHandle,points,secondary:edge.secondary});
 });
 return {nodes,edges:routed,skippedEdges};
}
