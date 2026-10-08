import {readFile,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {ProjectInput,GraphNode,GraphEdge,GraphFlow,Group,SourceUnit} from '../../contracts/src/index.ts';

type Raw=Record<string,any>;
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const unique=<T>(values:T[])=>[...new Set(values)];
export interface OrwellConversion {input:ProjectInput;report:Raw;manifest:{relativePath:string;bytes:number;sha256:string}[]}
/** Six real source records and a bounded original graph neighborhood; never a simulated branch. */
export function buildOrwellSample(input:ProjectInput):ProjectInput{
 const graph=input.graph;if(!graph)throw new Error('Sample requires the original graph.');
 const group=input.groups.find(group=>group.id.startsWith('conversation:')&&group.id.endsWith('::1349')&&group.title==='Commentary: Datachunks');
 if(!group)throw new Error('Datachunks source conversation not found.');
 const originalUnits=input.units.filter(unit=>unit.groupId===group.id).sort((a,b)=>a.order-b.order);
 if(originalUnits.length!==6)throw new Error(`Datachunks expected six original records, found ${originalUnits.length}.`);
 const unitIds=new Set(originalUnits.map(unit=>unit.id)),nodeIds=new Set([...(group.graphNodeIds??[]),...originalUnits.flatMap(unit=>unit.graphNodeIds??[])]);
 if(nodeIds.size>60)throw new Error('Primary sample graph exceeds the explicit 60-node budget.');
 let frontier=[...nodeIds];
 for(let hop=0;hop<2;hop++){
  const neighbors=new Set<string>();
  for(const edge of graph.edges)if(edge.to){if(frontier.includes(edge.from))neighbors.add(edge.to);if(frontier.includes(edge.to))neighbors.add(edge.from);}
  const next:string[]=[];for(const id of neighbors){if(nodeIds.has(id))continue;if(nodeIds.size>=60)break;nodeIds.add(id);next.push(id);}frontier=next;
 }
 const nodes=graph.nodes.filter(node=>nodeIds.has(node.id)).map(node=>({...node,unitIds:node.unitIds.filter(id=>unitIds.has(id)),groupIds:node.groupIds.filter(id=>id===group.id)}));
 const edges=graph.edges.filter(edge=>nodeIds.has(edge.from)).map(edge=>{if(!edge.to||nodeIds.has(edge.to))return {...edge};const {to,...rest}=edge;return {...rest,externalTarget:to};});
 const flows=graph.flows.filter(flow=>flow.nodeIds.some(id=>nodeIds.has(id))).map(flow=>({...flow,nodeIds:flow.nodeIds.filter(id=>nodeIds.has(id)),rootIds:flow.rootIds.filter(id=>nodeIds.has(id))}));
 const flowIds=new Set(flows.map(flow=>flow.id));
 const note=`검증용 표본: Commentary: Datachunks의 원본 6개 문장과 인접 2-hop 그래프(최대 60노드). 전체 ${input.units.length}개 원문 중 ${input.units.length-6}개, ${graph.nodes.length}개 노드 중 ${graph.nodes.length-nodes.length}개를 생략했습니다. 표본 밖 outgoing 대상은 externalTarget으로 보존했습니다. 원본 metadata/sourceRef에는 전체 자료의 참조가 남습니다. 분기와 조건을 실행하거나 추정하지 않습니다.`;
 return {schemaVersion:2,project:{...input.project,id:'orwell2-sample-datachunks',title:'Orwell · Datachunks 검증본 (6개 원문)',description:note},units:originalUnits.map(unit=>({...unit,graphNodeIds:(unit.graphNodeIds??[]).filter(id=>nodeIds.has(id))})),groups:[{...group,nextIds:[],graphNodeIds:(group.graphNodeIds??[]).filter(id=>nodeIds.has(id)),graphFlowIds:(group.graphFlowIds??[]).filter(id=>flowIds.has(id))}],terms:[],knowledge:[],graph:{...graph,nodes,edges,flows,orderingNote:`${note}\n${graph.orderingNote}`,metadata:{sample:true,sourceProjectId:input.project.id,hops:2,maxNodes:60,omittedUnits:input.units.length-6,omittedNodes:graph.nodes.length-nodes.length,omittedEdges:graph.edges.length-edges.length,originalOrderingNote:graph.orderingNote}}};
}
/** Reads published extraction files only. No provider, original game, or workspace DB writes. */
export async function buildOrwellProject(workspaceRoot:string):Promise<OrwellConversion>{
 const manifest:OrwellConversion['manifest']=[];
 const read=async(relativePath:string)=>{const data=await readFile(path.join(workspaceRoot,relativePath));manifest.push({relativePath,bytes:data.length,sha256:hash(data)});return data;};
 const json=async(relativePath:string)=>JSON.parse((await read(relativePath)).toString('utf8'));
 const records:Raw[]=(await read('extracted/catalog.jsonl')).toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const recordById=new Map(records.map(record=>[record.record_id,record]));
 if(recordById.size!==records.length)throw new Error('Duplicate extraction record_id; conversion stopped.');
 const extractionReport=await json('analysis/scenes/report.json');
 const memberships:Raw[]=(await read('analysis/scenes/object_membership.jsonl')).toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const membershipByObject=new Map(memberships.map(row=>[row.object_key,row.memberships]));
 const nodes=new Map<string,GraphNode>(),edges=new Map<string,GraphEdge>(),flows:GraphFlow[]=[],groups=new Map<string,Group>();
 const flowOrder=new Map<string,number>(),nodeFlows=new Map<string,string[]>(),nodeConversationGroups=new Map<string,string[]>();
 const conversationOrder=new Map<string,Map<string,number>>();
 const nodeReadingOrder=new Map<string,number>(),flowFiles=new Map<string,string>();
 const addGroup=(id:string,title:string,kind:Group['kind'],order:number,nodeIds:string[]=[],flowIds:string[]=[])=>{
  let group=groups.get(id);if(!group){group={id,title,kind,order,branch:'unknown',description:'Extracted review order only; conditions and runtime path remain in the graph. Unknown branch is not common.',nextIds:[],graphNodeIds:[],graphFlowIds:[]};groups.set(id,group);}
  group.graphNodeIds=unique([...(group.graphNodeIds??[]),...nodeIds]);group.graphFlowIds=unique([...(group.graphFlowIds??[]),...flowIds]);return group;
 };
 for(const file of (await readdir(path.join(workspaceRoot,'analysis/scenes'))).filter(file=>file.endsWith('.json')).sort()){
  const raw=JSON.parse((await readFile(path.join(workspaceRoot,'analysis/scenes',file))).toString('utf8'));if(!Array.isArray(raw.graph))continue;
  const scene=await json(`analysis/scenes/${file}`),flowId=String(scene.scene_key||`flow:${file}`),position=flows.length;
  flowOrder.set(flowId,position);flowFiles.set(file,flowId);
  const {graph:_rawGraph,...rawFlow}=scene;
  flows.push({id:flowId,title:scene.scene_id||file,rootIds:[...(scene.roots??[])],nodeIds:scene.graph.map((node:Raw)=>node.object_key),metadata:{rawFlow,sourceFile:`analysis/scenes/${file}`}});
  for(const rawNode of scene.graph){
   const nodeId=String(rawNode.object_key);let node=nodes.get(nodeId);
   if(!node){node={id:nodeId,unitIds:[],groupIds:[],kind:rawNode.class,conditions:rawNode.conditions,metadata:{sourceNodes:[]}};nodes.set(nodeId,node);}
   (node.metadata!.sourceNodes as Raw[]).push({flowId,rawNode});nodeFlows.set(nodeId,unique([...(nodeFlows.get(nodeId)??[]),flowId]));
   nodeReadingOrder.set(nodeId,Math.min(nodeReadingOrder.get(nodeId)??Infinity,position*100000+(rawNode.review_rank??0)));
   for(const [index,rawEdge] of (rawNode.outgoing??[]).entries()){
    const edgeId=`${nodeId}::outgoing:${index}`,target=String(rawEdge.target);let edge=edges.get(edgeId);
    if(!edge){edge={id:edgeId,from:nodeId,to:target,kind:rawEdge.kind,direction:rawEdge.direction,metadata:{sourceEdges:[]}};edges.set(edgeId,edge);}
    if(edge.to!==target)throw new Error(`Conflicting outgoing target for stable edge ${edgeId}`);
    (edge.metadata!.sourceEdges as Raw[]).push({flowId,index,rawEdge});
   }
  }
  for(const conversation of scene.conversations??[]){
   const convId=`conversation:${conversation.object_key}`,memberIds=unique<string>([conversation.object_key,...(conversation.declared_children??[]),...(conversation.message_review_order??[]),...(conversation.first_states??[])]).filter(id=>nodes.has(id));
   addGroup(convId,conversation.context?._stateName||conversation.context?.m_Name||`Conversation ${conversation.state_id}`,'scene',nodeReadingOrder.get(conversation.object_key)??position*100000,memberIds,[flowId]);
   conversationOrder.set(convId,new Map((conversation.message_review_order??[]).map((id:string,index:number)=>[id,index])));
   for(const memberId of memberIds)nodeConversationGroups.set(memberId,unique([...(nodeConversationGroups.get(memberId)??[]),convId]));
  }
 }
 // Preserve the nine extracted orphan states without inventing executable edges.
 const orphanIds=new Set<string>(extractionReport.states_without_flow??[]),orphanRows=new Map<string,Raw>();
 const objectFile=path.join(workspaceRoot,'analysis/assets/objects.jsonl');const stream=createReadStream(objectFile);const digest=createHash('sha256');stream.on('data',chunk=>digest.update(chunk));
 for await(const line of createInterface({input:stream,crlfDelay:Infinity})){if(!line.includes('"key"'))continue;const key=/^\{"key":"([^"]+)"/.exec(line)?.[1];if(key&&orphanIds.has(key))orphanRows.set(key,JSON.parse(line));}
 manifest.push({relativePath:'analysis/assets/objects.jsonl',bytes:(await stat(objectFile)).size,sha256:digest.digest('hex')});
 for(const orphanId of orphanIds){const rawObject=orphanRows.get(orphanId);if(!rawObject)throw new Error(`Missing orphan snapshot ${orphanId}`);nodes.set(orphanId,{id:orphanId,unitIds:[],groupIds:[],kind:rawObject.class,metadata:{rawObject,flowMembership:'none',outgoingEvidence:'No scene graph available; raw serialized references preserved without inventing edges.'}});}
 for(const edge of edges.values())if(edge.to&&!nodes.has(edge.to)){edge.externalTarget=edge.to;delete edge.to;}

 const documents=await json('extracted/documents/index.json');
 const documentMembership=new Map<string,string[]>(),documentById=new Map<string,string[]>(),documentOrder=new Map<string,Map<string,number>>();
 for(const [index,document] of documents.entries()){
  const payload=await json(`extracted/${document.path}`),groupId=`document:${document.language}:${document.document_id}`;
  addGroup(groupId,`${document.document_id} [${document.language}]`,'document',1000000+index);
  documentById.set(document.document_id,unique([...(documentById.get(document.document_id)??[]),groupId]));
  const entries:Raw[]=payload.records??payload.entries??[];documentOrder.set(groupId,new Map(entries.map((record,i)=>[record.record_id,i])));
  for(const record of entries)if(recordById.has(record.record_id))documentMembership.set(record.record_id,unique([...(documentMembership.get(record.record_id)??[]),groupId]));
 }
 const readingByRecord=new Map<string,Raw[]>(),documentNodeAssociations=new Map<string,Set<string>>();
 for(const file of (await readdir(path.join(workspaceRoot,'extracted/scenes'))).filter(file=>file.endsWith('.json')).sort()){
  const relativePath=`extracted/scenes/${file}`,scene=await json(relativePath);if(!Array.isArray(scene.entries))continue;
  const flowId=flowFiles.get(file);
  for(const [index,record] of scene.entries.entries())if(recordById.has(record.record_id))readingByRecord.set(record.record_id,[...(readingByRecord.get(record.record_id)??[]),{sourceFile:relativePath,index,flowId:flowId??null,sceneReviewRank:record.scene_review_rank??null}]);
  for(const reference of scene.document_references??[]){const nodeId=reference.object_key??reference.evidence?.object_key;if(!nodeId||!nodes.has(nodeId))continue;for(const docGroup of documentById.get(reference.document_id)??[]){const set=documentNodeAssociations.get(docGroup)??new Set<string>();set.add(nodeId);documentNodeAssociations.set(docGroup,set);}}
  for(const block of scene.document_blocks??[]){const nodeId=block.first_review_reference?.evidence?.object_key;if(!nodeId||!nodes.has(nodeId))continue;for(const docGroup of documentById.get(block.document_id)??[]){const set=documentNodeAssociations.get(docGroup)??new Set<string>();set.add(nodeId);documentNodeAssociations.set(docGroup,set);}}
 }
 const uiRecords=new Set((await read('extracted/ui/asset_ui.jsonl')).toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line).record_id));
 addGroup('ui:assets','Shared UI and resources','ui',2000000);addGroup('unassigned:source','Unassigned extracted source','document',3000000);
 const units:SourceUnit[]=records.map((record,catalogIndex)=>{
  const directNodes=nodes.has(record.object_key)?[record.object_key]:[];
  const conversations=unique(directNodes.flatMap(id=>nodeConversationGroups.get(id)??[]));
  const docGroups=documentMembership.get(record.record_id)??[];
  const sceneFlowIds=unique([...(membershipByObject.get(record.object_key)??[]).map((item:Raw)=>item.scene_key),...directNodes.flatMap(id=>nodeFlows.get(id)??[])]).filter(id=>flowOrder.has(id));
  const otherSceneGroups=sceneFlowIds.map(flowId=>{const groupId=`scene-material:${flowId}`;addGroup(groupId,`${flows.find(flow=>flow.id===flowId)!.title} · scene material`,'scene',(flowOrder.get(flowId)??0)*100000+99999,directNodes,[flowId]);return groupId;});
  const possibleGroups=unique([...conversations,...docGroups,...otherSceneGroups,...(uiRecords.has(record.record_id)?['ui:assets']:[])]);
  const groupId=possibleGroups[0]??'unassigned:source';
  const graphNodeIds=unique([...directNodes,...docGroups.flatMap(group=>[...(documentNodeAssociations.get(group)??[])])]);
  for(const associatedGroup of unique([groupId,...possibleGroups])){const group=groups.get(associatedGroup)!;group.graphNodeIds=unique([...(group.graphNodeIds??[]),...graphNodeIds]);group.graphFlowIds=unique([...(group.graphFlowIds??[]),...graphNodeIds.flatMap(id=>nodeFlows.get(id)??[])]);}
  for(const nodeId of graphNodeIds){const node=nodes.get(nodeId)!;node.unitIds=unique([...node.unitIds,record.record_id]);node.groupIds=unique([...node.groupIds,...possibleGroups,groupId]);}
  const convOrder=groupId===`conversation:${record.object_key}`?-1:conversationOrder.get(groupId)?.get(record.object_key),docOrder=documentOrder.get(groupId)?.get(record.record_id),reading=readingByRecord.get(record.record_id)??[];
  const localOrder=convOrder??docOrder??(reading.find(item=>item.flowId===sceneFlowIds[0])?.index)??record.document_edit_order??record.scene_review_rank??catalogIndex;
  const speaker=directNodes.flatMap(id=>(nodes.get(id)!.metadata!.sourceNodes as Raw[]|undefined)??[]).map(item=>item.rawNode.context?._speakerId||item.rawNode.context?._speaker).find(value=>typeof value==='string'&&value.length>0);
  return {id:record.record_id,groupId,order:localOrder*10000+catalogIndex,source:record.source,sourceLanguage:record.language,speaker,kind:conversations.length?'dialogue':groups.get(groupId)!.kind==='ui'?'ui':'document',branch:'unknown',termIds:[],graphNodeIds,sourceRef:{rawRecord:record,catalogIndex,groupMemberships:unique([groupId,...possibleGroups]),objectMemberships:membershipByObject.get(record.object_key)??[],readingOccurrences:reading,graphAssociations:{directStateNodeIds:directNodes,documentReferenceNodeIds:graphNodeIds.filter(id=>!directNodes.includes(id))}}};
 });
 // Keep graph topology authoritative. nextIds is only a derived navigation aid.
 for(const edge of edges.values())if(edge.to)for(const fromGroup of nodes.get(edge.from)!.groupIds)for(const toGroup of nodes.get(edge.to)!.groupIds)if(fromGroup!==toGroup)groups.get(fromGroup)!.nextIds=unique([...groups.get(fromGroup)!.nextIds,toGroup]);
 const usedGroups=new Set(units.map(unit=>unit.groupId));for(const node of nodes.values())for(const groupId of node.groupIds)usedGroups.add(groupId);
 for(const [groupId] of groups)if(!usedGroups.has(groupId))groups.delete(groupId);
 const input:ProjectInput={schemaVersion:2,project:{id:'orwell2-extracted',title:'Orwell: Ignorance is Strength',description:'Complete extracted catalog, including source-language provenance, with original flow graph and unknown execution scopes. Review order is not a playthrough.',sourceLanguage:'en',targetLanguage:'ko'},groups:[...groups.values()].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),units,terms:[],knowledge:[],graph:{version:1,nodes:[...nodes.values()],edges:[...edges.values()],flows,orderingNote:extractionReport.ordering_note,metadata:{extractionReport,sourceManifest:manifest,languagePolicy:'All catalog records are preserved; rawRecord.language distinguishes English, unknown and German. No language or branch inference is performed.',groupingPolicy:'Primary group chooses conversation, then document, then scene material, then shared UI, then unassigned. All known secondary memberships remain in sourceRef and graph associations.'}}};
 const report={schemaVersion:2,records:records.length,units:units.length,groups:input.groups.length,nodes:nodes.size,edges:edges.size,flows:flows.length,orphanNodes:orphanIds.size,unknownBranchUnits:units.filter(unit=>unit.branch==='unknown').length,unitsWithGraphAssociation:units.filter(unit=>unit.graphNodeIds!.length).length,unitsWithConversationGroup:units.filter(unit=>unit.groupId.startsWith('conversation:')).length,unitsWithMultipleGroups:units.filter(unit=>(unit.sourceRef!.groupMemberships as string[]).length>1).length,unassignedUnits:units.filter(unit=>unit.groupId==='unassigned:source').length,sourceIdentityErrors:units.filter(unit=>unit.source!==recordById.get(unit.id)?.source||JSON.stringify(unit.sourceRef!.rawRecord)!==JSON.stringify(recordById.get(unit.id))).map(unit=>unit.id),languageCounts:records.reduce((counts:Raw,record)=>{counts[record.language??'unknown']=(counts[record.language??'unknown']??0)+1;return counts;},{}),warnings:['Unknown branch scopes are preserved, not converted to common.','Graph metadata preserves original conditions and references; it is not a runtime interpreter.','All 9400 records include German and language-unknown records; use source-language filters for translation selection.','Nine orphan state snapshots lack scene graph edges; serialized references are preserved without guessing executable edges.']};
 return {input,report,manifest};
}
