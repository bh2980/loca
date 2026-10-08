import type {SourceUnit, WorkspaceState} from '@workbench/contracts';

export interface ProjectReadTool {name:string;description:string;parameters:Record<string,unknown>}
const textField={type:'string'};
const pageFields={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const projectReadTools:ProjectReadTool[]=[
 {name:'project_overview',description:'현재 프로젝트의 언어, 원문 종류별 수, 번역 상태와 장면 목록을 읽습니다. 원문 정렬은 실제 사건 순서의 증거가 아닙니다.',parameters:schema(pageFields)},
 {name:'search_script',description:'원문·현재 번역·화자·ID에서 문자열을 검색합니다. 검색한 전체 범위의 수와 현재 페이지를 반환합니다.',parameters:schema({query:textField,speaker:textField,groupId:textField,kind:{enum:['dialogue','document','ui']},...pageFields},['query'])},
 {name:'read_script',description:'원문 ID 목록 또는 장면을 읽습니다. 서로 배타적인 분기나 미확정 순서를 확정 사실로 합치지 마세요.',parameters:schema({unitIds:{type:'array',items:textField,maxItems:100},groupId:textField,...pageFields})},
 {name:'search_materials',description:'저장된 작품 자료의 제목·본문·근거를 검색합니다. 승인 대기 초안과 보관된 자료는 제외합니다.',parameters:schema({query:textField,unitIds:{type:'array',items:textField,maxItems:100},...pageFields})},
 {name:'read_material',description:'저장된 작품 자료 하나를 현재 버전과 근거 원문 ID와 함께 읽습니다.',parameters:schema({id:textField},['id'])},
 {name:'list_terms',description:'용어와 번역 후보·사용 방향·사용처를 읽습니다.',parameters:schema({query:textField,...pageFields})},
 {name:'run_progress',description:'질문 시점의 실제 실행 상태와 현재 단계, 처리 원문·실패·대기·완료 수를 조회합니다.',parameters:schema({runId:textField,...pageFields})},
 {name:'change_history',description:'원문·자료의 실제 변경 기록을 조회합니다. 모델의 추측으로 상태를 판단하지 마세요.',parameters:schema({unitId:textField,...pageFields})},
 {name:'list_characters',description:'저장된 인물 이름과 별칭을 검색합니다. 승인 대기 인물은 제외합니다.',parameters:schema({query:textField,...pageFields})},
 {name:'read_character',description:'인물과 저장된 프로필 문서, 관계와 근거를 읽습니다.',parameters:schema({id:textField},['id'])},
 {name:'list_relationships',description:'저장된 인물 관계의 방향, 분기, 조건과 근거를 조회합니다. 함께 등장했다는 이유로 관계를 추론하지 않습니다.',parameters:schema({characterId:textField,query:textField,...pageFields})},
 {name:'studio_status',description:'사용자 상태·라벨 정의와 원문별 실제 진행 상태를 조회합니다.',parameters:schema({unitIds:{type:'array',items:textField,maxItems:100},...pageFields})},
];

function page(args:Record<string,unknown>){
 const offset=args.offset??0,limit=args.limit??30;
 if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('조회 위치는 0 이상, 개수는 1~100이어야 합니다.');
 return {offset,limit};
}
function string(args:Record<string,unknown>,key:string,required=false){
 const value=args[key];if(value===undefined&&!required)return undefined;
 if(typeof value!=='string'||value.length>2000||(required&&!value.trim()))throw new Error(`${key} 문자열을 확인하세요.`);
 return value;
}
function ids(args:Record<string,unknown>,key:string){
 const value=args[key];if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length<1||value.length>100||value.some(id=>typeof id!=='string'||!id)||new Set(value).size!==value.length)throw new Error(`${key}에는 중복 없는 원문 ID 1~100개가 필요합니다.`);
 return value as string[];
}
function slice<T>(values:T[],args:Record<string,unknown>){const {offset,limit}=page(args);return {total:values.length,offset,items:values.slice(offset,offset+limit),nextOffset:offset+limit<values.length?offset+limit:null};}
function unitRecord(state:WorkspaceState,unit:SourceUnit){
 const translation=state.translations[unit.id];
 return {id:unit.id,groupId:unit.groupId,speaker:unit.speaker,source:unit.source,sourceLanguage:unit.sourceLanguage,kind:unit.kind,reviewOrder:unit.order,branch:unit.branch,currentTranslation:translation?.text??'',translationVersion:translation?.version??0,status:translation?.status,freshness:translation?.freshness,contextNotes:unit.contextNotes,graphNodeIds:unit.graphNodeIds,sourceRef:unit.sourceRef};
}
function validateUnitIds(state:WorkspaceState,unitIds:string[]|undefined){if(unitIds?.some(id=>!state.units.some(unit=>unit.id===id)))throw new Error('현재 프로젝트에 없는 원문 ID가 포함되어 있습니다.');}
function validateGroup(state:WorkspaceState,groupId:string|undefined){if(groupId&&!state.groups.some(group=>group.id===groupId))throw new Error('현재 프로젝트에 없는 장면입니다.');}

/** Read-only queries: no external requests, model calls, mutations or draft inclusion. */
export function queryProject(state:WorkspaceState,name:string,args:Record<string,unknown>,expectedProjectId=state.project.id):unknown{
 if(expectedProjectId!==state.project.id)throw new Error('조회 중 프로젝트가 변경되었습니다.');
 const definition=projectReadTools.find(tool=>tool.name===name);if(!definition)throw new Error('지원하지 않는 프로젝트 조회 도구입니다.');
 const properties=definition.parameters.properties as Record<string,unknown>;
 if(Object.keys(args).some(key=>!Object.hasOwn(properties,key)))throw new Error('지원하지 않는 조회 필드입니다.');
 const common={projectId:state.project.id,revision:state.revision};
 if(name==='project_overview'){
  const status:Record<string,number>={};for(const translation of Object.values(state.translations))status[translation.status]=(status[translation.status]??0)+1;
  return {...common,project:state.project,totalUnits:state.units.length,unitKinds:Object.fromEntries(['dialogue','document','ui'].map(kind=>[kind,state.units.filter(unit=>unit.kind===kind).length])),translationStatuses:status,stale:Object.values(state.translations).filter(t=>t.freshness==='stale').length,materials:state.knowledge.filter(item=>!item.archived).length,terms:state.terms.length,groups:slice(state.groups.map(({graphNodeIds:_nodes,graphFlowIds:_flows,...group})=>group),args),ordering:'review/extraction order; unknown conditions are not established events'};
 }
 if(name==='search_script'||name==='read_script'){
  const groupId=string(args,'groupId'),speaker=string(args,'speaker'),query=string(args,'query',name==='search_script')?.toLocaleLowerCase(),unitIds=ids(args,'unitIds'),kind=string(args,'kind');
  validateGroup(state,groupId);validateUnitIds(state,unitIds);
  if(kind&&!['dialogue','document','ui'].includes(kind))throw new Error('원문 종류를 확인하세요.');
  if(name==='read_script'&&!groupId&&!unitIds)throw new Error('읽을 장면 또는 원문 ID를 지정하세요.');
  if(groupId&&unitIds?.some(id=>state.units.find(unit=>unit.id===id)?.groupId!==groupId))throw new Error('선택 원문이 지정한 장면 밖에 있습니다.');
  const selected=state.units.filter(unit=>(!groupId||unit.groupId===groupId)&&(!unitIds||unitIds.includes(unit.id))&&(!speaker||unit.speaker?.toLocaleLowerCase()===speaker.toLocaleLowerCase())&&(!kind||unit.kind===kind)&&(!query||[unit.id,unit.source,unit.speaker??'',state.translations[unit.id]?.text??''].some(value=>value.toLocaleLowerCase().includes(query))));
  const groups=new Map(state.groups.map(group=>[group.id,group.order]));selected.sort((a,b)=>(groups.get(a.groupId)??0)-(groups.get(b.groupId)??0)||a.order-b.order||a.id.localeCompare(b.id));
  const result=slice(selected,args);
  return {...common,...result,items:result.items.map(unit=>unitRecord(state,unit)),ordering:'order is a review order, not a proven story timeline',scope:{groupId,unitIds,query,speaker,kind}};
 }
 if(name==='search_materials'){
  const query=string(args,'query')?.toLocaleLowerCase(),unitIds=ids(args,'unitIds');validateUnitIds(state,unitIds);
  const materials=state.knowledge.filter(item=>!item.archived&&(!query||`${item.title}\n${item.content}`.toLocaleLowerCase().includes(query))&&(!unitIds||item.evidenceIds.some(id=>unitIds.includes(id))));
  return {...common,...slice(materials.map(item=>({id:item.id,title:item.title,kind:item.kind,contentPreview:item.content.slice(0,800),version:item.version??1,evidenceIds:item.evidenceIds,branch:item.branch,visibility:item.visibility})),args)};
 }
 if(name==='read_material'){
  const id=string(args,'id',true),material=state.knowledge.find(item=>item.id===id&&!item.archived);if(!material)throw new Error('현재 프로젝트의 저장 자료를 찾을 수 없습니다.');
  const {history:_history,usedUnitIds:_used,...current}=material;return {...common,material:current};
 }
 if(name==='list_terms'){
  const query=string(args,'query')?.toLocaleLowerCase();
  return {...common,...slice(state.terms.filter(term=>!query||[term.source,term.target,...term.aliases,...(term.candidates??[]).map(candidate=>candidate.target)].some(text=>text.toLocaleLowerCase().includes(query))),args)};
 }
 if(name==='run_progress'){
  const runId=string(args,'runId');
  const legacy=state.runs.map(run=>({id:run.id,kind:run.kind,status:run.status,mode:run.mode,createdAt:run.createdAt,updatedAt:run.updatedAt,steps:run.steps.length,completedSteps:run.steps.filter(step=>step.status==='completed').length,failedSteps:run.steps.filter(step=>step.status==='failed').length,currentSteps:run.steps.filter(step=>step.status==='running').map(step=>({id:step.id,stage:step.stage,unitIds:step.unitIds,groupId:step.groupId})),targetUnits:new Set(run.steps.flatMap(step=>step.unitIds)).size,error:run.error,usage:run.usage}));
  const workflows=(state.workflow?.runs??[]).map(run=>({id:run.id,kind:'workflow',name:run.definition.name,status:run.status,createdAt:run.createdAt,updatedAt:run.updatedAt,targetUnits:run.items.length,counts:Object.fromEntries(['queued','running','waiting','completed','failed','cancelled'].map(status=>[status,run.items.filter(item=>item.status===status).length])),currentSteps:run.definition.nodes.flatMap(node=>{const targets=run.items.filter(item=>item.nodeId===node.id&&['running','waiting'].includes(item.status));return targets.length?[{id:node.id,name:node.name,type:node.type,unitIds:targets.map(item=>item.unitId)}]:[];}),error:run.error}));
  const runs=[...legacy,...workflows].filter(run=>!runId||run.id===runId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(runId&&!runs.length)throw new Error('현재 프로젝트의 실행을 찾을 수 없습니다.');
  return {...common,...slice(runs,args)};
 }
 if(name==='list_characters'){
  const query=string(args,'query')?.toLocaleLowerCase();
  return {...common,...slice((state.studio?.characters??[]).filter(item=>!query||[item.name,...item.aliases].some(text=>text.toLocaleLowerCase().includes(query))),args)};
 }
 if(name==='read_character'){
  const id=string(args,'id',true),character=state.studio?.characters.find(item=>item.id===id);
  if(!character)throw new Error('저장된 인물을 찾을 수 없습니다.');
  const profile=state.knowledge.find(item=>item.id===character.profileKnowledgeId&&!item.archived);
  return {...common,character,profile:profile?{id:profile.id,version:profile.version??1,title:profile.title,content:profile.content,evidenceIds:profile.evidenceIds}:null,evidence:(state.studio?.evidence??[]).filter(item=>character.evidenceIds.includes(item.id))};
 }
 if(name==='list_relationships'){
  const characterId=string(args,'characterId'),query=string(args,'query')?.toLocaleLowerCase();
  if(characterId&&!state.studio?.characters.some(item=>item.id===characterId))throw new Error('저장된 인물을 찾을 수 없습니다.');
  return {...common,...slice((state.studio?.relationships??[]).filter(item=>(!characterId||item.fromCharacterId===characterId||item.toCharacterId===characterId)&&(!query||[item.kind,item.description,item.branch,item.condition??''].some(text=>text.toLocaleLowerCase().includes(query)))),args)};
 }
 if(name==='studio_status'){
  const unitIds=ids(args,'unitIds');validateUnitIds(state,unitIds);
  return {...common,statuses:state.studio?.statuses??[],labels:state.studio?.labels??[],...slice(state.units.filter(unit=>!unitIds||unitIds.includes(unit.id)).map(unit=>({unitId:unit.id,statusId:state.studio?.progress[unit.id]?.statusId,labelIds:state.studio?.progress[unit.id]?.labelIds??[],version:state.studio?.progress[unit.id]?.version,translationVersion:state.translations[unit.id]?.version,freshness:state.translations[unit.id]?.freshness,locked:state.translations[unit.id]?.locked})),args)};
 }
 const unitId=string(args,'unitId');validateUnitIds(state,unitId?[unitId]:undefined);
 return {...common,...slice((state.changes??[]).filter(change=>!unitId||change.unitIds.includes(unitId)),args)};
}
