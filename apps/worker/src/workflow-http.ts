import {isLocalApiHost, type WorkflowBinding, type WorkflowExtensionRequest, type WorkflowJson, type WorkflowToolConnection, type WorkspaceState} from '@workbench/contracts';
import {StudioError} from '../../../packages/core/src/studio.ts';

const LIMIT=2*1024*1024, unsafe=new Set(['__proto__','prototype','constructor']);
export interface WorkflowHttpSettings {
 connectionId:string;method:'GET'|'POST';path:string;mode:'individual'|'batch';
 query?:Record<string,WorkflowBinding>;body?:Record<string,WorkflowBinding>;responseFields:Record<string,string>;
 responseItemsPath?:string;responseIdField?:string;timeoutMs?:number;maxAttempts?:number;
}
export interface WorkflowHttpOptions {state:WorkspaceState;request:WorkflowExtensionRequest;credential?:(connection:WorkflowToolConnection)=>string|undefined;fetch?:typeof fetch}
function fail(message:string,code='workflow-http'):never {throw new StudioError(message,400,[{code,message}]);}
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function fieldName(value:string){if(!value||value.length>128||unsafe.has(value)||/[\u0000-\u001f]/.test(value))fail('HTTP 필드 이름이 잘못되었습니다.');}
function pathParts(value:unknown):string[]{
 if(typeof value!=='string'||value.length>512)fail('HTTP 필드 경로가 잘못되었습니다.');
 if(value===''||value==='$')return [];
 const parts=value.replace(/^\$\./,'').split('.');
 if(parts.some(part=>!part||unsafe.has(part)||!/^[-\w]+$/.test(part)))fail('HTTP 필드 경로는 안전한 점 구분 이름이어야 합니다.');return parts;
}
function valueAt(value:unknown,path:string):unknown{for(const part of pathParts(path)){if(!value||typeof value!=='object'||!Object.hasOwn(value,part))fail('HTTP 필드 경로에 해당하는 값이 없습니다.','workflow-http-mapping');value=(value as Record<string,unknown>)[part];}return value;}
function jsonValue(value:unknown,depth=0):value is WorkflowJson{
 if(depth>32)return false;if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(item=>jsonValue(item,depth+1));
 return record(value)&&Object.entries(value).every(([key,item])=>!unsafe.has(key)&&jsonValue(item,depth+1));
}
function baseUrl(tool:WorkflowToolConnection){
 let url:URL;try{url=new URL(tool.baseUrl);}catch{fail('도구 연결 주소가 잘못되었습니다.');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.protocol==='http:'&&!isLocalApiHost(url.hostname)))fail('도구 연결은 HTTPS 또는 로컬·사설망 HTTP 주소여야 합니다.');
 return url;
}
export function validateWorkflowToolConnection(tool:WorkflowToolConnection):void {
 if(!record(tool)||typeof tool.id!=='string'||!tool.id||unsafe.has(tool.id)||typeof tool.baseUrl!=='string')fail('도구 연결이 잘못되었습니다.');
 baseUrl(tool);if(!['none','bearer','header'].includes(tool.auth))fail('지원하지 않는 도구 인증 방식입니다.');
 if(tool.auth==='header'){
  const name=tool.headerName;
  if(typeof name!=='string'||name.length>128||!/^X-[A-Za-z0-9-]+$/i.test(name)||/^x-(?:forwarded(?:-|$)|real-ip$|http-method(?:-|$)|method-override$|host$|authorization$)/i.test(name))fail('인증 헤더는 안전한 X- 접두사 사용자 헤더여야 합니다.');
 }
}
function endpoint(tool:WorkflowToolConnection,path:string){
 const base=baseUrl(tool);if(typeof path!=='string'||!path||path.length>2048||/[\\?#\u0000-\u0020]/.test(path)||path.startsWith('//')||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path))fail('HTTP 경로는 같은 도구 연결 안의 경로여야 합니다.');
 if(!base.pathname.endsWith('/'))base.pathname+='/';const url=new URL(path,base);
 if(url.origin!==base.origin||url.username||url.password||url.search||url.hash)fail('HTTP 경로는 같은 도구 연결 안의 경로여야 합니다.');return url;
}
function bindings(value:unknown):void {
 if(value===undefined)return;if(!record(value)||Object.keys(value).length>100)fail('HTTP 요청 필드 매핑이 잘못되었습니다.');
 for(const [key,binding] of Object.entries(value)){
  fieldName(key);if(!record(binding)||!['constant','field'].includes(binding.kind as string))fail('HTTP 요청 필드 매핑이 잘못되었습니다.');
  if(binding.kind==='field'){if(Object.keys(binding).some(key=>!['kind','path'].includes(key)))fail('HTTP 필드 매핑 설정이 잘못되었습니다.');pathParts(binding.path);}
  else if(!Object.hasOwn(binding,'value')||!jsonValue(binding.value)||Object.keys(binding).some(key=>!['kind','value'].includes(key)))fail('HTTP 상수는 안전한 JSON 값이어야 합니다.');
 }
}
/** Validation does not resolve credentials, send requests, or mutate state. */
export function validateWorkflowHttpSettings(state:WorkspaceState,settings:unknown):WorkflowHttpSettings {
 if(!record(settings)||Object.keys(settings).some(key=>!['connectionId','method','path','mode','query','body','responseFields','responseItemsPath','responseIdField','timeoutMs','maxAttempts'].includes(key)))fail('HTTP 노드 설정이 잘못되었습니다.');
 const tool=state.workflow?.toolConnections?.find(tool=>tool.id===settings.connectionId);if(!tool)fail('등록한 도구 연결을 선택하세요.');
 if(state.workflow?.projectId!==state.project.id)fail('다른 프로젝트의 도구 연결입니다.');validateWorkflowToolConnection(tool);
 if(!['GET','POST'].includes(settings.method as string)||!['individual','batch'].includes(settings.mode as string))fail('HTTP 노드는 GET/POST와 개별/묶음 방식만 지원합니다.');
 endpoint(tool,settings.path as string);bindings(settings.query);bindings(settings.body);
 if(settings.method==='GET'&&settings.body!==undefined)fail('GET 요청에는 본문 매핑을 사용할 수 없습니다.');
 if(!record(settings.responseFields)||!Object.keys(settings.responseFields).length||Object.keys(settings.responseFields).length>100)fail('HTTP 응답 필드 매핑을 입력하세요.');
 for(const [key,path]of Object.entries(settings.responseFields)){fieldName(key);pathParts(path);}
 if(settings.responseItemsPath!==undefined)pathParts(settings.responseItemsPath);if(settings.responseIdField!==undefined)pathParts(settings.responseIdField);
 if(settings.mode==='batch'&&settings.responseIdField==='')fail('묶음 응답 ID 필드가 필요합니다.');
 if(settings.timeoutMs!==undefined&&(!Number.isInteger(settings.timeoutMs)||Number(settings.timeoutMs)<1||Number(settings.timeoutMs)>120000))fail('HTTP 제한 시간은 1~120000ms 범위여야 합니다.');
 if(settings.maxAttempts!==undefined&&(!Number.isInteger(settings.maxAttempts)||Number(settings.maxAttempts)<1||Number(settings.maxAttempts)>3))fail('HTTP 시도 횟수는 1~3회여야 합니다.');
 if(!jsonValue(settings)||Buffer.byteLength(JSON.stringify(settings))>LIMIT)fail('HTTP 설정 크기 제한을 초과했습니다.');
 return structuredClone(settings) as unknown as WorkflowHttpSettings;
}
function mapped(fields:Record<string,WorkflowBinding>|undefined,context:unknown){
 const result:Record<string,WorkflowJson>={};for(const [key,binding]of Object.entries(fields??{})){
  const value=binding.kind==='constant'?binding.value:valueAt(context,binding.path);if(!jsonValue(value))fail('HTTP 요청 매핑 결과는 안전한 JSON 값이어야 합니다.');result[key]=structuredClone(value);
 }return result;
}
function contexts(state:WorkspaceState,request:WorkflowExtensionRequest){
 const workflow=state.workflow,run=workflow?.runs.find(run=>run.id===request.runId),execution=run?.executions.find(execution=>execution.id===request.executionId);
 if(!workflow||workflow.projectId!==state.project.id||!run||run.projectId!==state.project.id||run.status!=='running'||!execution||execution.status!=='running'||execution.nodeId!==request.node.id)fail('실행 중인 같은 프로젝트의 HTTP 작업이 아닙니다.','workflow-http-scope');
 const node=run.definition.nodes.find(node=>node.id===execution.nodeId);
 if(node?.type!=='extension'||node.config.handler!=='http'||JSON.stringify(node)!==JSON.stringify(request.node)||JSON.stringify(execution.input)!==JSON.stringify(request.input))fail('저장한 HTTP 실행 설정과 요청이 일치하지 않습니다.','workflow-http-scope');
 const ids=request.unitIds;if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>!run.targetUnitIds.includes(id))||ids.length!==execution.unitIds.length||execution.unitIds.some(id=>!ids.includes(id)))fail('HTTP 작업의 대사 범위가 저장한 실행과 다릅니다.','workflow-http-scope');
 const inputs=execution.input.items;if(!Array.isArray(inputs)||inputs.length!==ids.length||new Set(inputs.map(row=>record(row)?row.unitId:undefined)).size!==ids.length)fail('HTTP 실행 입력의 대사 ID가 잘못되었습니다.','workflow-http-scope');
 return ids.map(unitId=>{
  const item=run.items.find(item=>item.unitId===unitId),unit=state.units.find(unit=>unit.id===unitId),translation=state.translations[unitId],input=inputs.find(row=>record(row)&&row.unitId===unitId);
  if(!item||!unit||!translation||!record(input)||!record(input.data)||!record(input.mapped))fail('HTTP 대사 입력을 찾을 수 없습니다.','workflow-http-scope');
  let pinned:unknown;try{pinned=JSON.parse(item.sourceSnapshot);}catch{fail('HTTP 원문 스냅샷이 잘못되었습니다.');}
  if(!record(pinned)||pinned.id!==unitId||typeof pinned.source!=='string'||JSON.stringify({...pinned,termIds:[]})!==JSON.stringify({...unit,termIds:[]})||translation.version!==item.translationVersion||input.translationVersion!==item.translationVersion)fail('HTTP 실행 대상의 원문 또는 번역 버전이 변경되었습니다.','workflow-http-stale');
  return {...structuredClone(pinned),unitId,source:pinned.source,currentTranslation:translation.text,translationVersion:item.translationVersion,data:structuredClone(input.data),mapped:structuredClone(input.mapped)};
 });
}
async function boundedJson(response:Response,signal:AbortSignal){
 const reader=response.body?.getReader();if(!reader)fail('HTTP 응답 본문이 없습니다.');let size=0;const chunks:Uint8Array[]=[];
 const stop=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',stop,{once:true});
 try{while(true){if(signal.aborted)fail('HTTP 작업을 중지했습니다.','workflow-http-cancelled');const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>LIMIT)fail('HTTP 응답은 2MiB를 넘을 수 없습니다.','workflow-http-size');chunks.push(chunk.value);}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('HTTP 응답이 올바른 JSON이 아닙니다.','workflow-http-json');}
  if(!jsonValue(value))fail('HTTP 응답은 안전한 JSON 값이어야 합니다.','workflow-http-json');return value;
 }finally{signal.removeEventListener('abort',stop);if(signal.aborted||size>LIMIT)void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function raceAbort<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const stop=()=>reject(new StudioError('HTTP 작업을 중지했거나 제한 시간이 지났습니다.',400,[{code:'workflow-http-cancelled',message:'HTTP 작업을 중지했거나 제한 시간이 지났습니다.'}]));
  work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));if(signal.aborted){stop();return;}signal.addEventListener('abort',stop,{once:true});
 });
}
const transient=new Set([408,425,429,500,502,503,504]);
function redact(value:WorkflowJson,secret:string|undefined):WorkflowJson {
 if(!secret)return value;
 const variants=[...new Set([secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64')])].filter(Boolean);
 const clean=(text:string)=>variants.reduce((text,secret)=>text.split(secret).join('[REDACTED]'),text);
 if(typeof value==='string')return clean(value);if(typeof value==='number'||typeof value==='boolean'){const text=String(value);return variants.some(secret=>text.includes(secret))?clean(text):value;}if(Array.isArray(value))return value.map(item=>redact(item,secret));
 if(record(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[clean(key),redact(item as WorkflowJson,secret)]));return value;
}
/** Registered dictionary/spelling services only; results never apply translation changes. */
export async function executeWorkflowHttp({state,request,credential,fetch:send=fetch}:WorkflowHttpOptions):Promise<{data:{items:Array<{unitId:string;result:Record<string,WorkflowJson>}>;connectionId:string;method:'GET'|'POST';attempts:number}}> {
 if(request.signal.aborted)fail('HTTP 작업을 중지했습니다.','workflow-http-cancelled');
 const rows=contexts(state,request),run=state.workflow!.runs.find(run=>run.id===request.runId)!;
 const pinnedState={...state,workflow:{...state.workflow!,toolConnections:run.toolConnections??[]}};
 const settings=validateWorkflowHttpSettings(pinnedState,request.node.config.settings),tool=pinnedState.workflow.toolConnections.find(tool=>tool.id===settings.connectionId)!;
 let secret:string|undefined;
 if(tool.auth!=='none'){try{secret=credential?.(structuredClone(tool));}catch{fail('도구 연결 인증을 읽지 못했습니다.','workflow-http-auth');}if(!secret||!secret.trim()||/[\r\n\0]/.test(secret))fail('도구 연결 인증을 저장하세요.','workflow-http-auth');}
 const headers:Record<string,string>={Accept:'application/json'};
 if(tool.auth==='bearer')headers.Authorization=`Bearer ${secret}`;else if(tool.auth==='header')headers[tool.headerName!]=secret!;
 if(settings.method==='POST')headers['Content-Type']='application/json';
 const inputs=settings.mode==='individual'?rows.map(row=>({context:row,ids:[row.unitId]})):[{context:{items:rows},ids:rows.map(row=>row.unitId)}];
 let requestBytes=0;
 const jobs=inputs.map(input=>{
  const url=endpoint(tool,settings.path);for(const [key,value]of Object.entries(mapped(settings.query,input.context)))url.searchParams.set(key,JSON.stringify(value));
  const body=settings.method==='POST'?JSON.stringify(settings.mode==='individual'?{...mapped(settings.body,input.context),unitId:input.ids[0]}:{items:rows.map(row=>({...mapped(settings.body,row),unitId:row.unitId}))}):undefined;
  requestBytes+=Buffer.byteLength(url.href)+(body?Buffer.byteLength(body):0);
  if(requestBytes>LIMIT)fail('한 HTTP 작업의 전체 요청은 2MiB를 넘을 수 없습니다.','workflow-http-size');return {url,body,ids:input.ids};
 });
 const controller=new AbortController(),stop=()=>controller.abort();request.signal.addEventListener('abort',stop,{once:true});const timeout=setTimeout(stop,settings.timeoutMs??30000);let attempts=0;
 try{
  const items:Array<{unitId:string;result:Record<string,WorkflowJson>}>=[];let outputBytes=0;
  for(const job of jobs){
   let data:WorkflowJson|undefined;
   for(let attempt=1;attempt<=(settings.maxAttempts??1);attempt++){
    if(controller.signal.aborted)fail('HTTP 작업을 중지했거나 제한 시간이 지났습니다.','workflow-http-cancelled');attempts++;
    let response:Response;
    try{response=await raceAbort(send(job.url,{method:settings.method,headers:{...headers},body:job.body,signal:controller.signal,redirect:'error'}),controller.signal);}
    catch(error){if(error instanceof StudioError)throw error;if(controller.signal.aborted)fail('HTTP 작업을 중지했거나 제한 시간이 지났습니다.','workflow-http-cancelled');if(attempt===(settings.maxAttempts??1))fail('도구 HTTP 서비스에 연결하지 못했습니다.','workflow-http-network');await raceAbort(new Promise(resolve=>setTimeout(resolve,100*attempt)),controller.signal);continue;}
    if(response.redirected||response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>{});fail('도구 HTTP 리디렉션은 허용하지 않습니다.','workflow-http-redirect');}
    if(!response.ok){void response.body?.cancel().catch(()=>{});if(transient.has(response.status)&&attempt<(settings.maxAttempts??1)){await raceAbort(new Promise(resolve=>setTimeout(resolve,100*attempt)),controller.signal);continue;}fail(`도구 HTTP 서비스가 HTTP ${response.status}로 실패했습니다.`,'workflow-http-status');}
    const type=response.headers.get('content-type');if(type&&!/^(application\/(?:json|[\w.+-]+\+json))(?:\s*;|$)/i.test(type)){void response.body?.cancel().catch(()=>{});fail('도구 HTTP 응답은 JSON이어야 합니다.','workflow-http-json');}
    data=await raceAbort(boundedJson(response,controller.signal),controller.signal);break;
   }
   if(data===undefined)fail('도구 HTTP 응답이 없습니다.');
   const mapResult=(row:unknown)=>Object.fromEntries(Object.entries(settings.responseFields).map(([key,path])=>{const value=redact(valueAt(row,path) as WorkflowJson,secret);outputBytes+=Buffer.byteLength(JSON.stringify(value))+Buffer.byteLength(key)+4;if(outputBytes>LIMIT)fail('HTTP 매핑 결과는 2MiB를 넘을 수 없습니다.','workflow-http-size');return [key,value];}));
   if(settings.mode==='individual')items.push({unitId:job.ids[0],result:mapResult(data)});
   else {
    const resultRows=valueAt(data,settings.responseItemsPath??'items');if(!Array.isArray(resultRows)||resultRows.length!==job.ids.length)fail('HTTP 묶음 응답의 대사 수가 요청과 다릅니다.','workflow-http-ids');
    const indexed=new Map<string,unknown>();for(const row of resultRows){const id=valueAt(row,settings.responseIdField??'unitId');if(typeof id!=='string'||!job.ids.includes(id)||indexed.has(id))fail('HTTP 묶음 응답 ID가 누락·중복되었거나 요청 밖의 대사입니다.','workflow-http-ids');indexed.set(id,row);}
    for(const unitId of job.ids)items.push({unitId,result:mapResult(indexed.get(unitId))});
   }
  }
  if(controller.signal.aborted)fail('HTTP 작업을 중지했거나 제한 시간이 지났습니다.','workflow-http-cancelled');
  const result={data:{items,connectionId:tool.id,method:settings.method,attempts}};if(Buffer.byteLength(JSON.stringify(result))>LIMIT)fail('HTTP 매핑 결과는 2MiB를 넘을 수 없습니다.','workflow-http-size');return result;
 }catch(error){if(error instanceof StudioError)throw error;fail('도구 HTTP 요청 또는 응답을 처리하지 못했습니다.','workflow-http-response');}
 finally{clearTimeout(timeout);request.signal.removeEventListener('abort',stop);controller.abort();}
}
