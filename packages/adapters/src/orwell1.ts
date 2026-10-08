import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {ProjectInput,ProjectBackup,Group,SourceUnit,GraphNode,GraphEdge,GraphFlow,Translation} from '../../contracts/src/index.ts';
import {validateTranslation} from '../../core/src/validation.ts';

type Raw=Record<string,any>;
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const stable=(value:any):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const unique=<T>(values:T[])=>[...new Set(values)];
export function orwell1Identity(category:string,entry:Raw){
 return stable(category==='ui'?['ui',entry.key]:category==='direct'?['direct',entry.owner_type,entry.owner_id,entry.id_field,entry.asset_path,entry.hierarchy,entry.part_index,entry.component_index,entry.field,entry.root_index,entry.unique_root_name]:['entries',entry.owner_type,String(entry.owner_id),entry.id_field,entry.field]);
}
export interface Orwell1Conversion {input:ProjectInput;backup:ProjectBackup;manifest:{relativePath:string;bytes:number;sha256:string}[];report:Raw}
/** Convert editable published records only; projections contribute relationships, never text. */
export async function buildOrwell1Project(sourceRoot:string):Promise<Orwell1Conversion>{
 const manifest:Orwell1Conversion['manifest']=[],read=async(relativePath:string)=>{const bytes=await readFile(path.join(sourceRoot,relativePath));manifest.push({relativePath,bytes:bytes.length,sha256:sha(bytes)});return JSON.parse(bytes.toString('utf8')) as Raw;};
 const groups:Group[]=[],units:SourceUnit[]=[],translations:Record<string,Translation>={},nodes:GraphNode[]=[],edges:GraphEdge[]=[],flows:GraphFlow[]=[];
 const groupById=new Map<string,Group>(),nodeById=new Map<string,GraphNode>(),canonical=new Map<string,{unit:SourceUnit;entry:Raw;category:string;sourcePath:string;index:number}>();
 const scenes:{file:string;data:Raw;group:Group}[]=[],readingDifferences:Raw[]=[],duplicateOccurrences:Raw[]=[];
 const savedAt=new Date().toISOString();
 const addGroup=(id:string,title:string,kind:Group['kind'],description:string,flowId?:string)=>{const group:Group={id,title,kind,description,order:groups.length+1,branch:'unknown',nextIds:[],graphNodeIds:[],graphFlowIds:flowId?[flowId]:[]};groups.push(group);groupById.set(id,group);return group;};
 const sceneFiles=(await readdir(path.join(sourceRoot,'translations/scenes'))).filter(name=>name.endsWith('.json')).sort((a,b)=>{
  const rank=(name:string)=>name.startsWith('gameflow-day-')?Number(name.match(/\d+/)?.[0]??0):name==='endings.json'?6:name==='credits.json'?7:8;return rank(a)-rank(b)||a.localeCompare(b);
 });
 const addRecords=(data:Raw,sourcePath:string,group:Group)=>{
  for(const category of ['entries','direct','ui'])for(const [index,entry] of (data[category]??[]).entries()){
   const identity=orwell1Identity(category,entry),existing=canonical.get(identity);
   if(existing){if(stable(existing.entry)!==stable(entry))throw new Error(`Conflicting canonical identity: ${sourcePath}:${category}[${index}] and ${existing.sourcePath}`);duplicateOccurrences.push({identity,sourcePath,category,index});continue;}
   const source=entry.source_en!==undefined?entry.source_en:entry.source;
   if(typeof source!=='string'||typeof entry.translation!=='string')throw new Error(`Missing source/translation: ${sourcePath}:${category}[${index}]`);
   const unit:SourceUnit={id:`orwell1:${sha(identity).slice(0,32)}`,groupId:group.id,order:index+1,source,sourceLanguage:entry.source_en!==undefined?'en':category==='entries'?'en':'unknown',kind:group.kind==='document'?'document':group.kind==='ui'?'ui':/NewChatMessageState|NewCommentaryLineState/.test(entry.owner_type??'')?'dialogue':'ui',branch:'unknown',termIds:[],graphNodeIds:[],sourceRef:{identity,sourcePath,category,index,rawRecord:entry,sourceSelection:entry.source_en!==undefined?'source_en':'source',memberships:[group.id]}};
   units.push(unit);canonical.set(identity,{unit,entry,category,sourcePath,index});
   const text=entry.translation,version=text?1:0,history=text?[{version:1,text,origin:'manual' as const,createdAt:savedAt,reason:'Imported existing Korean translation; not reviewed by this workbench.',termVersions:{},termUsages:[]}]:[];
   translations[unit.id]={unitId:unit.id,text,version,status:text?'draft':'untranslated',freshness:'current',locked:true,origin:'manual',history,qa:validateTranslation(source,text),termVersions:{},termUsages:[],updatedAt:savedAt};
  }
 };
 for(const file of sceneFiles){const sourcePath=`translations/scenes/${file}`,data=await read(sourcePath),flowId=data.graph?.length?String(data.scene_id):undefined;
  const group=addGroup(`scene:${file.replace('.json','')}`,`${data.scene_id} · 장면 자료`,'scene','원본 검토 순서입니다. 실행 시간순과 분기는 확정하지 않습니다.',flowId);scenes.push({file,data,group});addRecords(data,sourcePath,group);
  if(!data.graph?.length)continue;
  for(const raw of data.graph){const nodeId=String(raw.id);if(nodeById.has(nodeId))throw new Error(`Duplicate graph node: ${nodeId}`);
   const node:GraphNode={id:nodeId,unitIds:[],groupIds:[],kind:raw.owner_type,conditions:raw.conditions,metadata:{rawNode:raw,sceneId:data.scene_id,sourcePath}};nodes.push(node);nodeById.set(nodeId,node);
   for(const [edgeIndex,outgoing] of raw.outgoing.entries())edges.push({id:`orwell1-edge:${nodeId}:${edgeIndex}`,from:nodeId,to:String(outgoing.target),kind:outgoing.kind,direction:outgoing.direction,conditions:outgoing.conditions,metadata:{rawEdge:outgoing,pin:outgoing.pin,sourcePath}});
  }
  flows.push({id:flowId!,title:String(data.scene_id),rootIds:(data.roots??[]).map(String),nodeIds:data.graph.map((node:Raw)=>String(node.id)),metadata:{sourcePath,flowIndex:data.flow_index,ordering:data.ordering,sourceOrdering:data.source_ordering,unreachableFromRoots:data.unreachable_from_roots,topologicalOrder:data.topological_order,reviewOnly:data.review_only}});
 }
 for(const file of (await readdir(path.join(sourceRoot,'translations/documents'))).filter(file=>file.endsWith('.json')).sort()){
  const sourcePath=`translations/documents/${file}`,data=await read(sourcePath);const first=(data.entries??[]).find((entry:Raw)=>entry.field==='_displayNames');
  const group=addGroup(`document:${file.replace('.json','')}`,first?.source??String(data.document_id??file.replace('.json','')),'document',`문서 원본: ${sourcePath}`);addRecords(data,sourcePath,group);
 }
 const ui=await read('translations/ui.json');addRecords(ui,'translations/ui.json',addGroup('ui:shared','공용 UI','ui','원본 UI 키별 기록'));
 const conversationIndex=await read('reading/conversations/index.json') as unknown as Raw[];
 const conversationMetadata=new Map<string,Raw>();
 for(const summary of conversationIndex){
  const relativePath=`reading/${String(summary.file).replace(/\.txt$/,'.json')}`,data=await read(relativePath);
  const day=String(data.scene_id).match(/Day (\d+)/)?.[1],title=`${day?`Day ${day}`:data.scene_id} · ${data.title}`;
  const group=addGroup(`conversation:${data.scene_id}:${data.id}`,title,'scene','대화 소속은 원본의 직접 소속 또는 그래프 기반 추정입니다. 문맥과 조건을 함께 확인하세요.',String(data.scene_id));conversationMetadata.set(group.id,{sourcePath:relativePath,conversation:data.conversation,membership:data.membership,boundaries:data.boundaries,declaredMessagesNotReachable:data.declared_messages_not_reachable,reviewRank:data.review_rank});
  const membershipNodes=unique<string>([String(data.id),...(data.traversal_nodes??[]).map(String),...(data.membership??[]).map((item:Raw)=>String(item.id))]);
  for(const nodeId of membershipNodes){const node=nodeById.get(nodeId);if(node){node.groupIds.push(group.id);group.graphNodeIds!.push(nodeId);}}
  for(const [recordOrder,record] of (data.records??[]).entries()){
   const identity=orwell1Identity(record.source_group,record.entry),found=canonical.get(identity);if(!found)throw new Error(`Reading identity absent from editable canonical: ${relativePath}:${record.entry_key}`);
   const exact=stable(found.entry)===stable(record.entry);if(!exact)readingDifferences.push({sourcePath:relativePath,entryKey:record.entry_key,canonicalPath:found.sourcePath,identity,reason:'Projection differs; editable record retained'});
   const memberships=found.unit.sourceRef!.memberships as string[];memberships.push(group.id);
   ((found.unit.sourceRef!.readingRecords??=[]) as Raw[]).push({sourcePath:relativePath,entryKey:record.entry_key,sourceArrayIndex:record.source_array_index,sourceGroup:record.source_group,exactCanonicalMatch:exact,readerMessageId:record.reader_message_id,membership:(data.membership??[]).filter((item:Raw)=>String(item.id)===String(found.entry.owner_id))});
   if(!found.unit.groupId.startsWith('conversation:')){found.unit.groupId=group.id;found.unit.order=recordOrder+1;}
  }
 }
 // Canonical state IDs attach text; scene material groups cover only remaining unit-bearing nodes.
 for(const {unit,entry} of canonical.values()){
  const node=nodeById.get(String(entry.owner_id));
  const rawNode=node?.metadata?.rawNode as Raw|undefined;
  const speaker=entry.context?._speakerId??entry.context?._speaker??rawNode?.context?._speakerId??rawNode?.context?._speaker;
  if(speaker)unit.speaker=String(speaker);
  if(node){const ownConversation=node.groupIds.find(groupId=>groupId.startsWith('conversation:')&&groupId.endsWith(`:${node.id}`));if(ownConversation&&!unit.groupId.startsWith('conversation:')){unit.groupId=ownConversation;unit.order=0;(unit.sourceRef!.memberships as string[]).push(ownConversation);}
   node.unitIds.push(unit.id);unit.graphNodeIds!.push(node.id);if(!node.groupIds.includes(unit.groupId))node.groupIds.push(unit.groupId);const group=groupById.get(unit.groupId)!;group.graphNodeIds!.push(node.id);}
  unit.sourceRef!.memberships=unique(unit.sourceRef!.memberships as string[]);
 }
 for(const node of nodes){node.groupIds=unique(node.groupIds);node.unitIds=unique(node.unitIds);}
 const outgoing=new Map<string,string[]>();for(const edge of edges)if(edge.to){if(!nodeById.has(edge.to))throw new Error(`Unresolved graph target: ${edge.to}`);const list=outgoing.get(edge.from)??[];list.push(edge.to);outgoing.set(edge.from,list);}
 // Stop at each next group boundary; ungrouped control nodes carry reachability only.
 for(const group of groups){group.graphNodeIds=unique(group.graphNodeIds??[]);const visited=new Set(group.graphNodeIds),queue=group.graphNodeIds.flatMap(id=>outgoing.get(id)??[]),next=new Set<string>();
  for(let i=0;i<queue.length;i++){const nodeId=queue[i];if(visited.has(nodeId))continue;visited.add(nodeId);const node=nodeById.get(nodeId)!;const boundaries=node.groupIds.filter(id=>id!==group.id);if(boundaries.length){boundaries.forEach(id=>next.add(id));continue;}queue.push(...(outgoing.get(nodeId)??[]));}group.nextIds=[...next];
 }
 // Put conversations before the remaining materials within each scene, then documents and UI.
 const sceneRank=new Map(scenes.map((scene,index)=>[String(scene.data.scene_id),index]));
 groups.sort((a,b)=>{const af=a.graphFlowIds?.[0],bf=b.graphFlowIds?.[0],ar=af?sceneRank.get(af)??999:a.id.startsWith('scene:')?scenes.findIndex(scene=>scene.group.id===a.id):1000,br=bf?sceneRank.get(bf)??999:b.id.startsWith('scene:')?scenes.findIndex(scene=>scene.group.id===b.id):1000;if(ar!==br)return ar-br;const ac=conversationMetadata.get(a.id),bc=conversationMetadata.get(b.id);return ac&&bc?ac.reviewRank-bc.reviewRank:ac?-1:bc?1:a.order-b.order;});groups.forEach((group,index)=>group.order=index+1);
 const input:ProjectInput={schemaVersion:2,project:{id:'orwell1-existing-ko',title:'Orwell: Keeping an Eye On You · 기존 한국어 번역',description:'기존 Orwell 1 한국어 번역을 보존한 작업실 복사본. 원본 검토 순서는 실행 시간순이 아니며 조건·분기는 unknown으로 유지합니다.',sourceLanguage:'en',targetLanguage:'ko'},groups,units,terms:[],knowledge:[],graph:{version:1,nodes,edges,flows,orderingNote:'SCC 위상 검토 순서입니다. 병렬 분기, 사용자 행동, 조건은 실제 플레이의 단일 시간순을 뜻하지 않습니다. 원본 조건과 연결을 보존합니다.',metadata:{sourceRoot,conversationMetadata:Object.fromEntries(conversationMetadata),scopePolicy:'unknown; conditions not evaluated'}}};
 const backup:ProjectBackup={format:'translation-workbench-backup',version:1,savedAt,data:{...input,terms:[],knowledge:[],translations,runs:[],reviews:[],events:[],changes:[],taskSnapshots:[],taskTests:[]}};
 const report={records:units.length,existingTranslations:Object.values(translations).filter(t=>!!t.text).length,groups:groups.length,conversations:conversationIndex.length,documents:groups.filter(group=>group.kind==='document').length,nodes:nodes.length,edges:edges.length,flows:flows.length,categories:Object.fromEntries(['entries','ui','direct'].map(category=>[category,[...canonical.values()].filter(item=>item.category===category).length])),qaTranslations:Object.values(translations).filter(t=>t.qa.length).length,readingDifferences,duplicateOccurrences,sourceFiles:manifest.length,modelCalls:0,originalWrites:0};
 return {input,backup,manifest,report};
}
