import type {WorkflowDefinitionInput,WorkspaceState} from '@workbench/contracts';
import {validateWorkflow} from '../../../packages/core/src/workflow.ts';
import {validateWorkflowHttpSettings} from './workflow-http.ts';
import {validateWorkflowBackupSettings} from './workflow-backup.ts';
import {WorkbenchError} from '@workbench/core';

export function validateRunnableWorkflow(state:WorkspaceState,definition:WorkflowDefinitionInput){
 const result=validateWorkflow(state,definition);
 for(const node of definition?.nodes??[])if(node.type==='extension'){
  try{if(node.config.handler==='http')validateWorkflowHttpSettings(state,node.config.settings);else if(node.config.handler==='backup')validateWorkflowBackupSettings(node.config.settings);else throw new Error('지원하지 않는 행동입니다.');}
  catch(error){result.issues.push({code:'extension',nodeId:node.id,message:(error as Error).message});}
 }
 return {...result,ok:result.issues.length===0};
}
export function requireRunnableWorkflow(state:WorkspaceState,definition:WorkflowDefinitionInput){
 const result=validateRunnableWorkflow(state,definition);if(!result.ok)throw new WorkbenchError(result.issues.map(issue=>issue.message).join('\n'));
}
