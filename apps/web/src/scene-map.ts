import type {Group, SourceUnit} from '@workbench/contracts';
import type {LayoutInputEdge} from './flow-layout.js';

// A collection of UI/document strings is not a narrative scene, even when an
// importer puts it in a group whose broad kind is "scene".
export function isSceneCollection(group:Group, units:SourceUnit[]):boolean {
 return group.kind!=='scene'||(units.length===0&&!(group.graphNodeIds?.length))||(units.length>0&&units.every(unit=>unit.kind==='ui'||unit.kind==='document'));
}

export function sceneNeighborhood(groups:Group[],anchorId:string,limit=Infinity){
 const anchor=groups.find(group=>group.id===anchorId)??groups[0];
 if(!anchor)return {groups:[],edges:[],incoming:[],outgoing:[],hidden:0};
 const incoming=groups.filter(group=>group.id!==anchor.id&&group.nextIds.includes(anchor.id)),outgoing=groups.filter(group=>group.id!==anchor.id&&anchor.nextIds.includes(group.id));
 const visible=new Set([anchor.id,...incoming.slice(0,limit).map(group=>group.id),...outgoing.slice(0,limit).map(group=>group.id)]);
 const selected=groups.filter(group=>visible.has(group.id));
 const edges=selected.flatMap(group=>group.nextIds.filter(to=>visible.has(to)&&(group.id===anchor.id||to===anchor.id)).map(to=>({id:`${group.id}:next:${to}`,from:group.id,to})));
 return {groups:selected,edges,incoming,outgoing,hidden:new Set([...incoming,...outgoing].filter(group=>!visible.has(group.id)).map(group=>group.id)).size};
}

// This is a display-only reduction of REACHABILITY, not a claim about execution
// order or equivalent branch conditions. Every input edge remains available.
// Cycles stay intact; only shortcuts in the SCC condensation DAG are folded.
export function summarizeSceneEdges(ids:string[], edges:LayoutInputEdge[]):LayoutInputEdge[] {
 const allowed=new Set(ids),outgoing=new Map(ids.map(id=>[id,[] as string[]]));
 for(const edge of edges)if(edge.to&&allowed.has(edge.from)&&allowed.has(edge.to))outgoing.get(edge.from)!.push(edge.to);
 let index=0;const indices=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],onStack=new Set<string>(),components:string[][]=[];
 function visit(id:string){
  indices.set(id,index);low.set(id,index++);stack.push(id);onStack.add(id);
  for(const next of outgoing.get(id)??[]){if(!indices.has(next)){visit(next);low.set(id,Math.min(low.get(id)!,low.get(next)!));}else if(onStack.has(next))low.set(id,Math.min(low.get(id)!,indices.get(next)!));}
  if(low.get(id)===indices.get(id)){const component:string[]=[];let member:string;do{member=stack.pop()!;onStack.delete(member);component.push(member);}while(member!==id);components.push(component);}
 }
 for(const id of ids)if(!indices.has(id))visit(id);
 const componentOf=new Map(components.flatMap((members,i)=>members.map(id=>[id,i] as const))),dag=new Map(components.map((_,i)=>[i,new Set<number>()]));
 for(const edge of edges){const a=componentOf.get(edge.from),b=edge.to?componentOf.get(edge.to):undefined;if(a!==undefined&&b!==undefined&&a!==b)dag.get(a)!.add(b);}
 const reachable=new Map<number,Set<number>>();
 function descendants(id:number):Set<number>{const cached=reachable.get(id);if(cached)return cached;const result=new Set<number>();for(const child of dag.get(id)??[]){result.add(child);for(const member of descendants(child))result.add(member);}reachable.set(id,result);return result;}
 return edges.map(edge=>{const from=componentOf.get(edge.from),to=edge.to?componentOf.get(edge.to):undefined;
  const secondary=from!==undefined&&to!==undefined&&from!==to&&[...dag.get(from)!].some(child=>child!==to&&descendants(child).has(to));
  return {...edge,secondary};
 });
}
