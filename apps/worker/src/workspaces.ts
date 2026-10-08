import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Engine } from '@workbench/core';
import { threeSceneDemo } from '../../../packages/core/src/demo-three-scenes.ts';
import { CredentialStore } from './credentials.ts';
import { Accounts } from './accounts.ts';
import { Connections } from './connections.ts';
import { ProjectChat } from './project-chat.ts';
import { WorkflowService } from './workflow-service.ts';
import {ToolConnections} from './tool-connections.ts';
import {WorkflowBackups} from './workflow-backup.ts';
import {executeWorkflowHttp} from './workflow-http.ts';

export async function openWorkspace(dataDir: string, demo = false) {
  const fresh = !existsSync(join(dataDir, 'workbench.sqlite'));
  const credentials = new CredentialStore(join(dataDir, 'credentials.dpapi.json'));
  await credentials.load();
  const accounts = new Accounts(credentials, dataDir);
  const engine = new Engine(dataDir, { credential: connection => ['openai', 'systemone'].includes(connection.kind) ? credentials.get(connection) : undefined });
  if (demo && fresh) engine.importProject(threeSceneDemo);
  const connections = new Connections(engine, credentials, accounts);
  const toolConnections=new ToolConnections(engine,credentials),backups=new WorkflowBackups(engine);
  try{backups.recoverPending();}catch(error){engine.studioMutation(engine.state().project.id,state=>{for(const run of state.workflow?.runs??[])if(Object.values(run.backups??{}).some(progress=>progress.pending))run.error=`백업 복구: ${(error as Error).message}`;});}
  const chat = new ProjectChat(engine,{credential:connection=>credentials.get(connection),webCredential:id=>{const state=engine.state(),tool=state.workflow?.toolConnections?.find(item=>item.id===id);return tool&&tool.baseUrl.replace(/\/$/,'')===state.studio?.webSearch?.baseUrl.replace(/\/$/,'')?toolConnections.credential(state.project.id,tool):undefined;}});
  const workflow = new WorkflowService(engine,{credential:connection=>credentials.get(connection),extension:async request=>request.node.config.handler==='backup'?backups.execute(request):executeWorkflowHttp({state:engine.state(),request,credential:tool=>toolConnections.credential(engine.state().project.id,tool)}),finalize:async runId=>{backups.finalize(runId);}});
  return { engine, credentials, accounts, connections, chat, workflow, toolConnections, close: async () => { await chat.close(); await workflow.close(); engine.close(); await accounts.close(); } };
}

export function workspaceRoute(path: string) {
  return path.startsWith('/api/demo/') ? { demo: true, path: `/api/${path.slice('/api/demo/'.length)}` } : { demo: false, path };
}
