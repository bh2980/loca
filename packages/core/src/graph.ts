import type {GraphNode,ProjectInput,WorkspaceState} from '@workbench/contracts';

export interface ProjectGraphQuery {offset?:number;limit?:number;flowId?:string;groupId?:string;nodeId?:string;unitId?:string;complete?:boolean}
/** All source units remain reachable; unlinked units are canvas-only, edgeless records. */
export function projectGraphView(state:WorkspaceState,query:ProjectGraphQuery={}){
 const graph=state.graph,group=query.groupId?state.groups.find(g=>g.id===query.groupId):undefined;
 if(query.groupId&&!group)throw new Error('장면을 찾을 수 없습니다.');
 const flow=query.flowId?graph?.flows.find(f=>f.id===query.flowId):undefined;
 if(query.flowId&&!flow)throw new Error('원본 흐름을 찾을 수 없습니다.');
 const sourceIds=new Set(state.units.map(u=>u.id));
 const nodes: (GraphNode&{synthetic?:boolean})[]=(graph?.nodes??[]).map(n=>({...n,unitIds:[...n.unitIds],groupIds:[...n.groupIds]}));
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const unitNodes=new Map<string,string[]>();
 for(const n of nodes)for(const uid of n.unitIds){const list=unitNodes.get(uid)??[];list.push(n.id);unitNodes.set(uid,list);}
 for(const u of state.units){
  for(const nodeId of u.graphNodeIds??[]){const n=byId.get(nodeId);if(!n)continue;if(!n.unitIds.includes(u.id))n.unitIds.push(u.id);if(!n.groupIds.includes(u.groupId))n.groupIds.push(u.groupId);const list=unitNodes.get(u.id)??[];if(!list.includes(nodeId))list.push(nodeId);unitNodes.set(u.id,list);}
  if(!unitNodes.get(u.id)?.length){let id=`canvas:unit:${encodeURIComponent(u.id)}`;while(byId.has(id))id+='~';const n={id,kind:'unlinked-script',unitIds:[u.id],groupIds:[u.groupId],synthetic:true};nodes.push(n);byId.set(id,n);unitNodes.set(u.id,[id]);}
 }
 const groupNodeIds=new Set(group?[...(group.graphNodeIds??[]),...nodes.filter(n=>n.groupIds.includes(group.id)).map(n=>n.id),...state.units.filter(u=>u.groupId===group.id).flatMap(u=>unitNodes.get(u.id)??[])]:[]);
 const flowNodeIds=flow?new Set(flow.nodeIds):undefined;
 const flowGroups=new Set(query.flowId?state.groups.filter(g=>g.graphFlowIds?.includes(query.flowId!)).map(g=>g.id):[]);
 const membership=nodes.filter(n=>(!group||groupNodeIds.has(n.id))&&(!flowNodeIds||flowNodeIds.has(n.id)||(n.synthetic&&n.groupIds.some(id=>flowGroups.has(id)))));
 if(query.unitId&&!sourceIds.has(query.unitId))throw new Error('원문을 찾을 수 없습니다.');
 const focusNodeId=query.nodeId??(query.unitId?unitNodes.get(query.unitId)?.[0]:undefined);
 if(focusNodeId&&!byId.has(focusNodeId))throw new Error('그래프 노드를 찾을 수 없습니다.');
 const limit=Math.max(1,Math.min(120,Math.floor(Number.isFinite(query.limit)?query.limit!:120))),start=Math.max(0,Math.floor(Number.isFinite(query.offset)?query.offset!:0));
 const complete=query.complete===true;
 const primary=complete?membership.map(n=>n.id):focusNodeId?[focusNodeId]:membership.slice(start,start+limit).map(n=>n.id),primaryIds=new Set(primary),wanted=new Set(primary);
 const incident=(graph?.edges??[]).filter(e=>primaryIds.has(e.from)||!!e.to&&primaryIds.has(e.to));
 for(const edge of incident){for(const id of [edge.from,edge.to])if(id&&byId.has(id)&&(complete||wanted.size<Math.min(160,limit+40)))wanted.add(id);}
 const visible=nodes.filter(n=>wanted.has(n.id)),visibleIds=new Set(visible.map(n=>n.id));
 const eligible=(complete?graph?.edges??[]:incident).filter(e=>visibleIds.has(e.from)&&(!e.to||visibleIds.has(e.to)));
 const edges=complete?eligible:eligible.slice(0,320);
 const groupsById=new Map(state.groups.map(group=>[group.id,group]));
 const nodeFlowIds=new Map<string,string[]>();for(const flow of graph?.flows??[])for(const nodeId of flow.nodeIds){const ids=nodeFlowIds.get(nodeId)??[];ids.push(flow.id);nodeFlowIds.set(nodeId,ids);}
 const nodeLabels=(node:GraphNode)=>{
  const associated=node.groupIds.flatMap(id=>groupsById.get(id)??[]);
  const flowIds=[...new Set([...(nodeFlowIds.get(node.id)??[]),...associated.flatMap(group=>group.graphFlowIds??[])])];
  const raw=node.metadata?.rawNode as {context?:{_stateName?:unknown;m_Name?:unknown};review_rank?:unknown;source_graph_rank?:unknown}|undefined;
  const label=raw?.context?._stateName??raw?.context?.m_Name??associated[0]?.title;
  const order=typeof raw?.review_rank==='number'&&Number.isFinite(raw.review_rank)?raw.review_rank:typeof raw?.source_graph_rank==='number'&&Number.isFinite(raw.source_graph_rank)?raw.source_graph_rank:undefined;
  return {flowIds,layoutGroup:flowIds[0]??(associated[0]?.kind==='document'?'문서 자료':associated[0]?.kind==='ui'?'UI 자료':associated.length?'장면 자료':'연결 미확정'),...(typeof label==='string'?{sourceLabel:label.slice(0,240)}:{}),...(order!==undefined?{order}:{}),boundary:!primaryIds.has(node.id)};
 };
 const brief=(value:unknown)=>{if(value===undefined)return undefined;const text=JSON.stringify(value);return text.length<=12000?value:{truncated:true,preview:text.slice(0,12000),originalCharacters:text.length};};
 return {scope:group?'scene' as const:'all' as const,complete,groupId:group?.id,flowId:query.flowId,focusNodeId,orderingNote:graph?.orderingNote??'원본 노드가 없는 원문은 연결 없는 표시용 노드입니다. 원문 순서는 실행 경로를 의미하지 않습니다.',
  totalNodes:nodes.length,totalEdges:graph?.edges.length??0,matchingNodes:membership.length,nodeOffset:complete?0:start,nextOffset:!complete&&!focusNodeId&&start+limit<membership.length?start+limit:null,
  nodes:visible.map(n=>({id:n.id,kind:n.kind,unitIds:n.unitIds,groupIds:n.groupIds,conditions:complete?n.conditions:brief(n.conditions),...nodeLabels(n),...(n.synthetic?{synthetic:true}:{})})),
  edges:edges.map(e=>({id:e.id,from:e.from,to:e.to,externalTarget:e.externalTarget,kind:e.kind,direction:e.direction,conditions:complete?e.conditions:brief(e.conditions),...(complete?{metadata:e.metadata}:{})})),
  omittedNodes:Math.max(0,new Set([...membership.map(n=>n.id),...incident.flatMap(e=>[e.from,...(e.to?[e.to]:[])])]).size-visibleIds.size),omittedEdges:Math.max(0,incident.length-edges.length)};
}

/** A bounded neighborhood for visualization. Neither ordering nor conditions are evaluated. */
export function graphView(state:WorkspaceState,groupId:string,nodeId?:string,offset=0){
 const graph=state.graph,group=state.groups.find(g=>g.id===groupId);
 if(!group)throw new Error('장면을 찾을 수 없습니다.');
 const empty={groupId,orderingNote:graph?.orderingNote??'원본 상태 그래프가 없습니다. 묶음 연결은 탐색용입니다.',totalNodes:graph?.nodes.length??0,totalEdges:graph?.edges.length??0,nodes:[],edges:[],omittedNodes:0,omittedEdges:0,matchingNodes:0,nodeOffset:0,nextOffset:null as number|null};
 if(!graph)return empty;
 const associated=new Set([...(group.graphNodeIds??[]),...state.units.filter(u=>u.groupId===groupId).flatMap(u=>u.graphNodeIds??[])]);
 for(const n of graph.nodes)if(n.groupIds.includes(groupId))associated.add(n.id);
 if(nodeId&&!graph.nodes.some(n=>n.id===nodeId))throw new Error('그래프 노드를 찾을 수 없습니다.');
 const membership=graph.nodes.filter(n=>associated.has(n.id));
 const start=Math.max(0,Math.floor(offset));
 const primary=nodeId?[nodeId]:membership.slice(start,start+60).map(n=>n.id);
 const wanted=new Set(primary),incident=graph.edges.filter(e=>wanted.has(e.from)||!!e.to&&wanted.has(e.to));
 for(const e of incident){if(wanted.size>=80)break;wanted.add(e.from);if(e.to&&wanted.size<80)wanted.add(e.to);}
 const selected=graph.nodes.filter(n=>wanted.has(n.id)),visibleIds=new Set(selected.map(n=>n.id));
 const visibleEdges=incident.filter(e=>visibleIds.has(e.from)&&(!e.to||visibleIds.has(e.to))).slice(0,160);
 const brief=(value:unknown)=>{if(value===undefined)return undefined;const text=JSON.stringify(value);return text.length<=12000?value:{truncated:true,preview:text.slice(0,12000),originalCharacters:text.length};};
 return {...empty,nodes:selected.map(n=>({id:n.id,kind:n.kind,unitIds:n.unitIds,groupIds:n.groupIds,conditions:brief(n.conditions)})),edges:visibleEdges.map(e=>({id:e.id,from:e.from,to:e.to,externalTarget:e.externalTarget,kind:e.kind,direction:e.direction,conditions:brief(e.conditions)})),omittedNodes:Math.max(0,new Set([...associated,...incident.flatMap(e=>[e.from,...(e.to?[e.to]:[])])]).size-visibleIds.size),omittedEdges:incident.length-visibleEdges.length,matchingNodes:membership.length,nodeOffset:start,nextOffset:!nodeId&&start+60<membership.length?start+60:null};
}

export function validateGraph(p:ProjectInput){
 const graph=p.graph;if(!graph)return;
 const error=(message:string):never=>{throw new Error(`그래프 입력 오류: ${message}`);};
 if(graph.version!==1||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges)||!Array.isArray(graph.flows)||typeof graph.orderingNote!=='string')error('version, nodes, edges, flows, orderingNote가 필요합니다.');
 if(graph.nodes.length>100000||graph.edges.length>200000)error('노드 또는 연결 수 한도를 초과했습니다.');
 const units=new Set(p.units.map(u=>u.id)),groups=new Set(p.groups.map(g=>g.id)),nodes=new Set<string>(),edges=new Set<string>(),flows=new Set<string>();
 for(const n of graph.nodes){if(!n||typeof n.id!=='string'||!n.id||nodes.has(n.id)||!Array.isArray(n.unitIds)||!Array.isArray(n.groupIds)||n.unitIds.some(id=>!units.has(id))||n.groupIds.some(id=>!groups.has(id)))error('노드 ID 또는 원문/묶음 참조가 잘못되었습니다.');nodes.add(n.id);}
 for(const e of graph.edges){if(!e||typeof e.id!=='string'||!e.id||edges.has(e.id)||!nodes.has(e.from)||(!e.to&&!e.externalTarget)||(e.to!==undefined&&!nodes.has(e.to)))error('연결 ID 또는 끝점이 잘못되었습니다.');edges.add(e.id);}
 for(const f of graph.flows){if(!f||typeof f.id!=='string'||!f.id||flows.has(f.id)||typeof f.title!=='string'||!Array.isArray(f.rootIds)||!Array.isArray(f.nodeIds)||[...f.rootIds,...f.nodeIds].some(id=>!nodes.has(id)))error('흐름 ID 또는 노드 참조가 잘못되었습니다.');flows.add(f.id);}
 for(const u of p.units)if(u.graphNodeIds&&(!Array.isArray(u.graphNodeIds)||u.graphNodeIds.some(id=>!nodes.has(id))))error(`원문 노드 참조: ${u.id}`);
 for(const g of p.groups)if(g.graphNodeIds&&(!Array.isArray(g.graphNodeIds)||g.graphNodeIds.some(id=>!nodes.has(id)))||g.graphFlowIds&&(!Array.isArray(g.graphFlowIds)||g.graphFlowIds.some(id=>!flows.has(id))))error(`묶음 그래프 참조: ${g.id}`);
}
