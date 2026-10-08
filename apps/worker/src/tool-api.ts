import type {IncomingMessage} from 'node:http';
import {WorkbenchError} from '@workbench/core';
import type {ToolConnections} from './tool-connections.ts';
import type {StudioResponse} from './studio-api.ts';
export async function toolApi({toolConnections,path,method,url,req,body}:{toolConnections:ToolConnections;path:string;method:string;url:URL;req:IncomingMessage;body:(req:IncomingMessage)=>Promise<Record<string,unknown>>}):Promise<StudioResponse|undefined>{
 if(!path.startsWith('/api/studio/tool-connections'))return;
 const projectId=url.searchParams.get('projectId');if(!projectId)throw new WorkbenchError('프로젝트를 선택하세요.');
 if(path==='/api/studio/tool-connections'){
  if(method==='GET')return {status:200,data:toolConnections.list(projectId)};
  if(method==='POST')return {status:201,data:await toolConnections.save(projectId,await body(req))};
 }
 const match=path.match(/^\/api\/studio\/tool-connections\/([^/]+)(?:\/(credential))?$/);if(match){const id=decodeURIComponent(match[1]);if(method==='PATCH'&&!match[2])return {status:200,data:await toolConnections.save(projectId,await body(req),id)};if(method==='DELETE'&&match[2])return {status:200,data:await toolConnections.removeCredential(projectId,id)};}
 return {status:404,data:{error:'도구 연결 API를 찾을 수 없습니다.'}};
}
