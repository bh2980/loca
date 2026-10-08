import {randomUUID} from 'node:crypto';
import type {Engine} from '@workbench/core';
import {WorkbenchError} from '@workbench/core';
import {isLocalApiHost,type WorkflowToolConnection,type Connection} from '@workbench/contracts';
import {ensureWorkflow} from '../../../packages/core/src/workflow.ts';
import type {CredentialStore} from './credentials.ts';
import {validateWorkflowToolConnection} from './workflow-http.ts';

function endpoint(value:unknown){let url:URL;try{url=new URL(String(value));}catch{throw new WorkbenchError('도구 API 주소를 확인하세요.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.search||url.protocol==='http:'&&!isLocalApiHost(url.hostname))throw new WorkbenchError('HTTPS 또는 로컬·사설망 HTTP 주소를 입력하세요.');return url.href.replace(/\/$/,'');}
export const toolCredentialDescriptor=(projectId:string,tool:WorkflowToolConnection):Connection=>({id:`tool:${projectId}:${tool.id}`,name:tool.name,kind:'openai',baseUrl:tool.baseUrl});
function validate(input:WorkflowToolConnection){if(typeof input.name!=='string'||!input.name.trim()||input.name.length>200)throw new WorkbenchError('도구 연결 이름을 입력하세요.');input.baseUrl=endpoint(input.baseUrl);validateWorkflowToolConnection(input);}
export class ToolConnections {
 constructor(private engine:Engine,private credentials:CredentialStore){}
 private state(projectId:string){const state=this.engine.state();if(state.project.id!==projectId)throw new WorkbenchError('다른 프로젝트의 도구 연결 요청입니다.',409);return state;}
 list(projectId:string){return (this.state(projectId).workflow?.toolConnections??[]).map(tool=>({...tool,hasCredential:this.credentials.has(toolCredentialDescriptor(projectId,tool))}));}
 credential(projectId:string,tool:WorkflowToolConnection){return this.credentials.get(toolCredentialDescriptor(projectId,tool));}
 async save(projectId:string,input:Record<string,unknown>,id?:string){
  if(Object.keys(input).some(key=>!['name','baseUrl','auth','headerName','expectedVersion','apiKey'].includes(key)))throw new WorkbenchError('지원하지 않는 도구 연결 필드입니다.');
  const state=this.state(projectId),current=state.workflow?.toolConnections?.find(item=>item.id===id);if(id&&!current)throw new WorkbenchError('도구 연결을 찾을 수 없습니다.',404);
  if(current&&input.expectedVersion!==current.version)throw new WorkbenchError('도구 연결이 이미 변경되었습니다.',409);
  const tool={...current,...input,id:id??randomUUID(),version:(current?.version??0)+1} as unknown as WorkflowToolConnection;
  delete (tool as unknown as Record<string,unknown>).apiKey;delete (tool as unknown as Record<string,unknown>).expectedVersion;validate(tool);
  this.engine.studioMutation(projectId,state=>{const storage=ensureWorkflow(state);const entries=storage.toolConnections??=[];if(current){const index=entries.findIndex(item=>item.id===id);entries[index]=tool;}else entries.push(tool);});
  if(input.apiKey!==undefined&&input.apiKey!=='')await this.credentials.save(toolCredentialDescriptor(projectId,tool),input.apiKey);
  return {...tool,hasCredential:this.credentials.has(toolCredentialDescriptor(projectId,tool))};
 }
 async removeCredential(projectId:string,id:string){const tool=this.state(projectId).workflow?.toolConnections?.find(item=>item.id===id);if(!tool)throw new WorkbenchError('도구 연결을 찾을 수 없습니다.',404);await this.credentials.remove(toolCredentialDescriptor(projectId,tool).id);return {ok:true};}
}
