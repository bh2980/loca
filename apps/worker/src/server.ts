import http from 'node:http';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,dirname,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Engine,WorkbenchError} from '@workbench/core';
import {inspectConnection,listModels} from '@workbench/providers';
import {projectGraphView} from '../../../packages/core/src/graph.ts';
import {openWorkspace,workspaceRoute} from './workspaces.ts';
import {studioApi} from './studio-api.ts';
import {workflowApi} from './workflow-api.ts';
import {toolApi} from './tool-api.ts';
import {projectSceneGraphView} from '../../../packages/core/src/scene-projection.ts';
import {StudioError} from '../../../packages/core/src/studio.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const port=Number(process.env.WORKBENCH_PORT??4317);
const dataDir=process.env.WORKBENCH_DATA_DIR??join(root,'.workbench');
const primary=await openWorkspace(dataDir);
let demo:ReturnType<typeof openWorkspace>|undefined;
const getDemo=()=>demo??=openWorkspace(join(dataDir,'demo-three-scenes'),true);
const dist=join(root,'apps','web','dist');
const json=(res:http.ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req:http.IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw new WorkbenchError('입력 파일은 64 MiB 이하로 제한됩니다.',413);chunks.push(Buffer.from(chunk));}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new WorkbenchError('올바른 JSON이 아닙니다.');}}
const server=http.createServer(async(req,res)=>{
 const start=Date.now();const url=new URL(req.url??'/','http://127.0.0.1');const route=workspaceRoute(url.pathname);const path=route.path;const method=req.method??'GET';
 res.on('finish',()=>{if(path!=='/api/state'&&path.startsWith('/api/'))console.log(`${method} ${path} ${res.statusCode} ${Date.now()-start}ms`);});
 try {
  const host=(req.headers.host??'').split(':')[0];if(!['127.0.0.1','localhost','[::1]'].includes(host))throw new WorkbenchError('로컬 주소에서만 접근할 수 있습니다.',403);
  if(req.headers.origin){const origin=new URL(req.headers.origin);if(!['http:','https:'].includes(origin.protocol)||!['localhost','127.0.0.1'].includes(origin.hostname)||![String(port),'4318'].includes(origin.port))throw new WorkbenchError('허용되지 않은 요청 출처입니다.',403);}
  if(!['GET','HEAD'].includes(method)&&!req.headers['content-type']?.startsWith('application/json'))throw new WorkbenchError('application/json 요청이 필요합니다.',415);
  const {engine,credentials,accounts,connections,chat,workflow,toolConnections}=route.demo?await getDemo():primary;
  const toolResult=await toolApi({toolConnections,path,method,url,req,body});if(toolResult)return json(res,toolResult.status,toolResult.data);
  const workflowResult=await workflowApi({engine,workflow,path,method,url,req,body});if(workflowResult)return json(res,workflowResult.status,workflowResult.data);
  const studioResult=await studioApi({engine,chat,path,method,url,req,body});if(studioResult)return json(res,studioResult.status,studioResult.data);
  if(method==='GET'&&path==='/api/health')return json(res,200,{ok:true,version:'0.1.0'});
  if(method==='GET'&&path==='/api/state')return json(res,200,url.searchParams.get('view')==='ui'?engine.uiState(url.searchParams.has('since')?Number(url.searchParams.get('since')):undefined):engine.state());
  if(method==='GET'&&path==='/api/graph'&&url.searchParams.get('scope')==='scenes')return json(res,200,projectSceneGraphView(engine.state(),{flowId:url.searchParams.get('flowId')??undefined,groupId:url.searchParams.get('groupId')??undefined}));
  if(method==='GET'&&path==='/api/graph'){const offset=Number(url.searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0)throw new WorkbenchError('올바른 그래프 위치가 필요합니다.');return json(res,200,url.searchParams.get('scope')==='all'?projectGraphView(engine.state(),{complete:url.searchParams.get('complete')==='1',offset,limit:Number(url.searchParams.get('limit')??120),groupId:url.searchParams.get('groupId')??undefined,flowId:url.searchParams.get('flowId')??undefined,nodeId:url.searchParams.get('nodeId')??undefined,unitId:url.searchParams.get('unitId')??undefined}):engine.graphView(url.searchParams.get('groupId')??'',url.searchParams.get('nodeId')??undefined,offset));}
  if(method==='GET'&&path==='/api/changes')return json(res,200,engine.changeLedger({unitId:url.searchParams.get('unitId')??undefined,groupId:url.searchParams.get('groupId')??undefined,runId:url.searchParams.get('runId')??undefined,kind:url.searchParams.get('kind')??undefined,offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)}));
  if(method==='POST'&&path==='/api/tasks/preview')return json(res,200,engine.previewTask(await body(req)));
  if(method==='POST'&&path==='/api/tasks/test')return json(res,202,engine.testProfile(await body(req)));
  if(method==='GET'&&path==='/api/tasks/tests')return json(res,200,engine.taskTests());
  if(method==='GET'&&path==='/api/tasks/snapshots')return json(res,200,engine.taskSnapshots({runId:url.searchParams.get('runId')??undefined,stepId:url.searchParams.get('stepId')??undefined}));
  const taskMatch=path.match(/^\/api\/tasks\/(tests|snapshots)\/([^/]+)(?:\/(cancel))?$/);
  if(taskMatch){const id=decodeURIComponent(taskMatch[2]);if(method==='GET')return json(res,200,taskMatch[1]==='tests'?engine.taskTest(id):engine.taskSnapshot(id));if(method==='POST'&&taskMatch[1]==='tests'&&taskMatch[3]==='cancel')return json(res,200,engine.cancelTaskTest(id));}
  const knowledgeMatch=path.match(/^\/api\/knowledge\/([^/]+)(?:\/(restore))?$/);
  if(knowledgeMatch){const id=decodeURIComponent(knowledgeMatch[1]);if(method==='PATCH'&&!knowledgeMatch[2])return json(res,200,engine.updateKnowledge(id,await body(req)));if(method==='POST'&&knowledgeMatch[2]==='restore')return json(res,200,engine.rollbackKnowledge(id,await body(req)));}
  if(method==='GET'&&path==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="translation-export.json"');return json(res,200,engine.exportProject());}
  if(method==='GET'&&path==='/api/projects')return json(res,200,engine.projects());
  if(method==='GET'&&path==='/api/project/backup'){res.setHeader('Content-Disposition','attachment; filename="project-backup.json"');return json(res,200,engine.backupProject());}
  if(method==='POST'&&path==='/api/project/restore')return json(res,200,engine.restoreProject(await body(req)));
  const projectOpen=path.match(/^\/api\/projects\/([^/]+)\/open$/);if(method==='POST'&&projectOpen)return json(res,200,engine.openProject(decodeURIComponent(projectOpen[1])));
  const retryCurrent=path.match(/^\/api\/runs\/([^/]+)\/retry-current$/);if(method==='POST'&&retryCurrent)return json(res,201,engine.retryCurrent(decodeURIComponent(retryCurrent[1])));
  const profilePatch=path.match(/^\/api\/profiles\/([^/]+)$/);if(method==='PATCH'&&profilePatch)return json(res,200,engine.updateProfile(decodeURIComponent(profilePatch[1]),(await body(req)).profile));
  if(method==='POST'&&path==='/api/terms')return json(res,201,engine.createTerm(await body(req)));
  if(method==='POST'&&path==='/api/runs')return json(res,201,engine.requestRun(await body(req)));
  if(method==='PUT'&&path==='/api/settings')return json(res,200,await connections.settings(await body(req)));
  if(method==='POST'&&path==='/api/connections')return json(res,201,await connections.create(await body(req)));
  if(method==='POST'&&path==='/api/project/import')return json(res,200,engine.importProject(await body(req)));
  const accountMatch=path.match(/^\/api\/connections\/([^/]+)\/(auth|login|credential|models)(?:\/(cancel))?$/);
  if(accountMatch){
   const connection=engine.state().connections.find(c=>c.id===decodeURIComponent(accountMatch[1]));if(!connection)throw new WorkbenchError('연결을 찾을 수 없습니다.',404);
   const action=accountMatch[2];
   if(method==='GET'&&action==='auth')return json(res,200,await accounts.status(connection));
   if(method==='GET'&&action==='login')return json(res,200,accounts.get(connection));
   if(method==='GET'&&action==='models')return json(res,200,await listModels(connection,undefined,credentials.get(connection)));
   if(method==='POST'&&action==='login')return json(res,200,accountMatch[3]==='cancel'?await accounts.cancel(connection.id):accounts.start(connection,(await body(req)).method));
   if(action==='credential'&&['POST','DELETE'].includes(method)){
    if(!['openai','systemone'].includes(connection.kind))throw new WorkbenchError('API 연결에만 키를 저장할 수 있습니다.');
    if(method==='POST')await connections.saveKey(connection.id,(await body(req)).apiKey);else await connections.removeKey(connection.id);
    return json(res,200,await accounts.status(connection));
   }
  }
  const m=path.match(/^\/api\/(units|terms|reviews|runs|connections)\/([^/]+)(?:\/(accept|dismiss|pause|resume|cancel|probe))?$/);
  if(m){const [,resource,rawId,action]=m;const entityId=decodeURIComponent(rawId);
   if(resource==='connections'&&!action&&method==='PATCH')return json(res,200,await connections.patch(entityId,await body(req)));
   if(resource==='connections'&&!action&&method==='DELETE')return json(res,200,await connections.remove(entityId));
   if(method==='PATCH'&&resource==='units'&&!action)return json(res,200,engine.updateUnit(entityId,await body(req)));
   if(method==='PATCH'&&resource==='terms'&&!action)return json(res,200,engine.updateTerm(entityId,await body(req)));
   if(method==='POST'&&resource==='reviews'&&action)return json(res,200,engine.resolveReview(entityId,action));
   if(method==='POST'&&resource==='runs'&&action)return json(res,200,engine.control(entityId,action));
   if(method==='POST'&&resource==='connections'&&action==='probe'){const connection=engine.state().connections.find(c=>c.id===entityId);if(!connection)throw new WorkbenchError('연결을 찾을 수 없습니다.',404);return json(res,200,connection.kind==='mock'?{available:true,detail:'저장된 샘플을 반환하는 모의 연결입니다. 실제 AI 호출 없음.'}:await inspectConnection(connection));}
  }
  if(path.startsWith('/api/'))return json(res,404,{error:'API를 찾을 수 없습니다.'});
  if(method!=='GET'&&method!=='HEAD')return json(res,405,{error:'지원하지 않는 메서드입니다.'});
  if(existsSync(dist)){let file=resolve(dist,'.'+decodeURIComponent(path));if(!file.startsWith(dist+sep))file=join(dist,'index.html');if(!existsSync(file)||!statSync(file).isFile())file=join(dist,'index.html');const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json'};res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(method==='HEAD'?undefined:readFileSync(file));return;}
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('작업실 UI: http://127.0.0.1:4318 — npm run dev 또는 npm run build 후 npm start');
 }catch(error){const status=error instanceof WorkbenchError||error instanceof StudioError?error.status:500;json(res,status,{error:(error as Error).message,...(error instanceof StudioError?{issues:error.issues}:{})});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Translation Workbench http://127.0.0.1:${port} · SQLite persisted locally`));
const closeAll=async()=>{await primary.close();if(demo)await(await demo).close();};
server.on('error',err=>{console.error(err.message);void closeAll();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void closeAll().then(()=>server.close(()=>process.exit(0)));});
