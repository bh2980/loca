import type {GraphEdge,GraphNode,WorkspaceState} from '@workbench/contracts';
import {graphNodeHasRuntimeGuard,graphNodeSourceLabel,isGraphControlNode} from '@workbench/contracts';

export interface SceneProjection {kind:'scene-segment'|'shared-content'|'control'|'unlinked-group';groupId?:string;sourceNodeIds:string[];internalEdges:GraphEdge[];sourceRecords?:GraphNode[]}
export interface SceneProjectionNode extends GraphNode {projection:SceneProjection;order:number;sourceLabel?:string;boundary?:boolean;synthetic?:boolean}
export interface SceneProjectionQuery {flowId?:string;groupId?:string}
const nonempty=(value:unknown)=>value!==undefined&&value!==null&&(Array.isArray(value)?value.length>0:typeof value==='object'?Object.keys(value).length>0:value!=='');

/** Lossless endpoint projection. Only non-branching, unconditional, acyclic
 * content chains of ONE group with matching source-flow memberships may contract. Disconnected fragments, shared
 * content and all original controls stay separate. Ordering is never evaluated.
 * The source graph remains authoritative; group.nextIds cannot bypass controls. */
export function projectSceneGraphView(state:WorkspaceState,query:SceneProjectionQuery={}){
 const graph=state.graph,groups=new Map(state.groups.map(group=>[group.id,group]));
 if(query.groupId&&!groups.has(query.groupId))throw new Error('장면을 찾을 수 없습니다.');
 const flow=query.flowId?graph?.flows.find(item=>item.id===query.flowId):undefined;if(query.flowId&&graph&&!flow)throw new Error('원본 흐름을 찾을 수 없습니다.');
 const original=(graph?.nodes??[]).map(node=>({...node,unitIds:[...node.unitIds],groupIds:[...node.groupIds]})),byOriginal=new Map(original.map(node=>[node.id,node]));
 for(const unit of state.units)for(const id of unit.graphNodeIds??[]){const node=byOriginal.get(id);if(node){if(!node.unitIds.includes(unit.id))node.unitIds.push(unit.id);if(!node.groupIds.includes(unit.groupId))node.groupIds.push(unit.groupId);}}
 const outgoing=new Map<string,GraphEdge[]>(),incoming=new Map<string,GraphEdge[]>();
 for(const edge of graph?.edges??[]){const out=outgoing.get(edge.from)??[];out.push(edge);outgoing.set(edge.from,out);if(edge.to){const into=incoming.get(edge.to)??[];into.push(edge);incoming.set(edge.to,into);}}
 const flowMembership=new Map<string,string[]>();for(const item of graph?.flows??[])for(const id of item.nodeIds){const list=flowMembership.get(id)??[];list.push(item.id);flowMembership.set(id,list);}const flowBoundary=new Map([...flowMembership].map(([id,ids])=>[id,JSON.stringify(ids.sort())]));
 const candidate=(node:GraphNode)=>node.unitIds.length>0&&node.groupIds.length===1&&!graphNodeHasRuntimeGuard(node)&&!isGraphControlNode(node);
 const next=new Map<string,string>(),previous=new Map<string,string>();
 for(const node of original){const edges=outgoing.get(node.id)??[],edge=edges[0],target=edge?.to?byOriginal.get(edge.to):undefined;
  if(candidate(node)&&edges.length===1&&target&&candidate(target)&&(incoming.get(target.id)?.length??0)===1&&node.groupIds[0]===target.groupIds[0]&&flowBoundary.get(node.id)===flowBoundary.get(target.id)&&!nonempty(edge.conditions)&&!(/event|document|reference|secondary/i.test(edge.kind??''))&&edge.from!==edge.to){next.set(node.id,target.id);previous.set(target.id,node.id);}
 }
 // Functional-chain cycle detection is iterative and linear, including a long
 // original script loop. Cycles retain every original node and edge unchanged.
 const completed=new Set<string>(),cyclic=new Set<string>();
 for(const node of original){if(completed.has(node.id))continue;const path:string[]=[],seen=new Map<string,number>();let current:string|undefined=node.id;
  while(current&&!completed.has(current)&&!seen.has(current)){seen.set(current,path.length);path.push(current);current=next.get(current);}
  if(current&&seen.has(current))for(const id of path.slice(seen.get(current)!))cyclic.add(id);for(const id of path)completed.add(id);
 }
 for(const id of cyclic){const target=next.get(id);next.delete(id);if(target)previous.delete(target);}
 const nodes:SceneProjectionNode[]=[],endpoint=new Map<string,string>(),coveredUnits=new Set<string>(),hiddenEdges=new Set<string>(),reserved=new Set([...original.map(node=>node.id),...(graph?.edges??[]).flatMap(edge=>edge.to?[edge.from,edge.to]:[edge.from])]);
 const uniqueId=(base:string)=>{let id=base;while(reserved.has(id))id+='~';reserved.add(id);return id;};
 const create=(members:GraphNode[],order:number)=>{
  const first=members[0],unitIds=[...new Set(members.flatMap(node=>node.unitIds))],groupIds=[...new Set(members.flatMap(node=>node.groupIds))],groupId=unitIds.length&&groupIds.length===1?groupIds[0]:undefined;
  const id=members.length===1?first.id:uniqueId(`scene:segment:${encodeURIComponent(first.id)}`),sourceNodeIds=members.map(node=>node.id),memberIds=new Set(sourceNodeIds);
  const internalEdges=members.length>1?members.flatMap(member=>outgoing.get(member.id)??[]).filter(edge=>!!edge.to&&memberIds.has(edge.to)):[];for(const edge of internalEdges)hiddenEdges.add(edge.id);
  const kind:SceneProjection['kind']=isGraphControlNode(first)||!unitIds.length?'control':groupId?'scene-segment':'shared-content';
  const group=groupId?groups.get(groupId):undefined,rawLabel=graphNodeSourceLabel(first);
  nodes.push({...first,id,unitIds,groupIds,order,sourceLabel:kind==='control'?(rawLabel??first.kind):group?.title??rawLabel,projection:{kind,groupId:kind==='control'?undefined:groupId,sourceNodeIds,internalEdges,...(members.length>1?{sourceRecords:members}: {})}});
  for(const member of members)endpoint.set(member.id,id);for(const id of unitIds)coveredUnits.add(id);
 };
 const consumed=new Set<string>();
 for(let order=0;order<original.length;order++){
  const node=original[order];if(consumed.has(node.id)||previous.has(node.id))continue;const members:GraphNode[]=[];let current:GraphNode|undefined=node;
  while(current&&!consumed.has(current.id)){consumed.add(current.id);members.push(current);current=byOriginal.get(next.get(current.id)??'');}create(members,order);
 }
 for(let order=0;order<original.length;order++)if(!consumed.has(original[order].id)){consumed.add(original[order].id);create([original[order]],order);}
 for(const group of state.groups){const unlinked=state.units.filter(unit=>unit.groupId===group.id&&!coveredUnits.has(unit.id));
  if(!unlinked.length&&nodes.some(node=>node.groupIds.includes(group.id)))continue;
  nodes.push({id:uniqueId(`scene:unlinked:${encodeURIComponent(group.id)}`),unitIds:unlinked.map(unit=>unit.id),groupIds:[group.id],kind:'unlinked-group',order:original.length+group.order,sourceLabel:group.title,synthetic:true,projection:{kind:'unlinked-group',groupId:group.id,sourceNodeIds:[],internalEdges:[]}});
 }
 const edges:GraphEdge[]=(graph?.edges??[]).flatMap(edge=>{
  const from=endpoint.get(edge.from),to=edge.to?(endpoint.get(edge.to)??edge.to):undefined;if(!from)return [];
  if(hiddenEdges.has(edge.id))return [];
  return [{...edge,from,to,metadata:{...edge.metadata,projection:{kind:'source-endpoints',sourceFrom:edge.from,sourceTo:edge.to,sourceEdgeId:edge.id}}}];
 });
 if(!graph){const groupNode=new Map(nodes.flatMap(node=>node.projection.groupId?[[node.projection.groupId,node.id] as const]:[]));
  for(const group of state.groups)for(const target of group.nextIds){const to=groupNode.get(target);if(to)edges.push({id:`scene:group-reference:${encodeURIComponent(group.id)}:${encodeURIComponent(target)}`,from:groupNode.get(group.id)!,to,kind:'derived-group-reference',metadata:{projection:{kind:'group-reference',sourceGroupId:group.id,targetGroupId:target,basis:'stored Group.nextIds; execution order unverified'}}});}
 }
 const sourceFlowIds=new Set(flow?.nodeIds??[]),allIds=new Set(nodes.map(node=>node.id)),primary=new Set(nodes.filter(node=>!flow||node.projection.sourceNodeIds.some(id=>sourceFlowIds.has(id))||node.synthetic&&node.groupIds.some(id=>groups.get(id)?.graphFlowIds?.includes(query.flowId!))).map(node=>node.id));
 let wanted=new Set(primary);
 if(flow)for(const edge of edges)if(primary.has(edge.from)||!!edge.to&&primary.has(edge.to)){if(allIds.has(edge.from))wanted.add(edge.from);if(edge.to&&allIds.has(edge.to))wanted.add(edge.to);}
 if(query.groupId){const adjacency=new Map<string,string[]>();for(const edge of edges)if(edge.to){const a=adjacency.get(edge.from)??[],b=adjacency.get(edge.to)??[];a.push(edge.to);b.push(edge.from);adjacency.set(edge.from,a);adjacency.set(edge.to,b);}
  const seeds=nodes.filter(node=>wanted.has(node.id)&&node.groupIds.includes(query.groupId!)).map(node=>node.id),selected=new Set(seeds),queue=[...seeds],lookup=new Map(nodes.map(node=>[node.id,node]));
  for(let index=0;index<queue.length;index++)for(const id of adjacency.get(queue[index])??[]){if(selected.has(id)||!wanted.has(id))continue;selected.add(id);const node=lookup.get(id)!;if(node.projection.kind==='control'||node.groupIds.includes(query.groupId))queue.push(id);}wanted=selected;
 }
 const visible=nodes.filter(node=>wanted.has(node.id)).map(node=>({...node,boundary:!primary.has(node.id)})),visibleEdges=edges.filter(edge=>wanted.has(edge.from)&&(!edge.to||!allIds.has(edge.to)||wanted.has(edge.to))),visibleSourceIds=new Set(visible.flatMap(node=>node.projection.sourceNodeIds));
 const representedEdges=new Set([...visibleEdges.map(edge=>edge.id),...visible.flatMap(node=>node.projection.internalEdges.map(edge=>edge.id))]);
 return {scope:'scenes' as const,complete:true,flowId:query.flowId,groupId:query.groupId,nodeOffset:0,nextOffset:null,orderingNote:graph?.orderingNote??'저장된 묶음 참조이며 원본 실행 경로는 확인되지 않았습니다.',nodes:visible,edges:visibleEdges,
  totalNodes:original.length,totalEdges:graph?.edges.length??edges.length,matchingNodes:visible.length,totalGroups:state.groups.length,sourceNodes:visibleSourceIds.size,sourceEdges:representedEdges.size,collapsedNodes:visible.reduce((sum,node)=>sum+Math.max(0,node.projection.sourceNodeIds.length-1),0),
  omittedNodes:original.length-visibleSourceIds.size,omittedEdges:(graph?.edges.length??edges.length)-representedEdges.size,
  projectionNote:'같은 묶음·원본 흐름 범위의 무조건·단일 입출력·비순환 연속 본문만 축약합니다. 공유 원문과 분리된 경로 조각은 합치지 않으며, 원본 조건·제어 노드와 연결 ID를 보존합니다.'};
}
