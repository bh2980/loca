import type {AIProfile,Connection,ProposalOperation,Stage,StudioBaseVersion,WorkspaceState} from './index.js';

export type WorkflowJson = null|boolean|number|string|WorkflowJson[]|{[key:string]:WorkflowJson};
export type WorkflowPortType = 'unit-set';
export interface WorkflowPort {id:string;type:WorkflowPortType;required:boolean}
export interface WorkflowNodeType {type:WorkflowNode['type'];label:string;inputs:WorkflowPort[];outputs:WorkflowPort[];implemented:boolean}
export type WorkflowBinding = {kind:'constant';value:WorkflowJson}|{kind:'field';path:string};
export type WorkflowCondition = {field:string;operator:'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'contains'|'empty';value?:WorkflowJson}|{operator:'and'|'or';conditions:WorkflowCondition[]}|{operator:'not';condition:WorkflowCondition};
interface NodeBase {id:string;name:string;position?:{x:number;y:number};input?:Record<string,WorkflowBinding>}
export type WorkflowNode =
 | NodeBase & {type:'start';config:{}}
 | NodeBase & {type:'batch';config:{mode:'individual'|'scene'|'selection';maxUnits:number;maxCharacters:number}}
 | NodeBase & {type:'query';config:{terms:boolean;knowledge:boolean;contextUnitIds?:string[];nearby?:number}}
 | NodeBase & {type:'ai';config:{profileId:string;mode:'translate'|'review'|'revise'|'operations';stage?:Stage;prompt?:string;loopId?:string;maxRevisions?:number;maxUnits?:number;maxCharacters?:number}}
 | NodeBase & {type:'condition';config:{scope:'unit'|'batch-all'|'batch-any';condition:WorkflowCondition}}
 | NodeBase & {type:'action';config:{action:'storeCandidate'|'selectCandidate'|'setProgress'|'validate'|'applyOperations';statusId?:string;labelIds?:string[];operations?:ProposalOperation[]}}
 | NodeBase & {type:'human';config:{reason:string}}
 | NodeBase & {type:'end';config:{}}
 | NodeBase & {type:'extension';config:{handler:'http'|'backup';settings:Record<string,WorkflowJson>}};
export interface WorkflowEdge {id:string;from:string;fromPort:string;to:string;toPort:'in'}
export interface WorkflowDefinition {id:string;projectId:string;name:string;version:number;nodes:WorkflowNode[];edges:WorkflowEdge[];maxNodeVisits:number;createdAt:string;updatedAt:string;history:Array<{version:number;name:string;nodes:WorkflowNode[];edges:WorkflowEdge[];maxNodeVisits:number;createdAt:string}>}
export interface WorkflowDefinitionInput {id?:string;name:string;nodes:WorkflowNode[];edges:WorkflowEdge[];maxNodeVisits?:number}
export interface WorkflowValidationIssue {code:string;message:string;nodeId?:string;edgeId?:string}
export interface WorkflowWorkItem {unitId:string;nodeId:string;status:'queued'|'running'|'waiting'|'completed'|'failed'|'cancelled';sourceSnapshot:string;translationVersion:number;progressVersion:number;candidateId?:string;candidateVersion?:number;revisionCounts:Record<string,number>;nodeVisits:Record<string,number>;data:Record<string,unknown>;context?:Record<string,unknown>;contextVersions:StudioBaseVersion[];batchKey:string;executionId?:string;waitingReason?:string;error?:string;path:string[]}
export interface WorkflowProviderAttempt {number:number;routeIndex:number;model:string;connectionId:string;startedAt:string;finishedAt?:string;status:'running'|'completed'|'failed'|'interrupted';error?:string}
export interface WorkflowNodeExecution {id:string;runId:string;nodeId:string;unitIds:string[];status:'running'|'completed'|'failed'|'cancelled'|'interrupted';startedAt:string;finishedAt?:string;input:Record<string,unknown>;output?:unknown;reason?:string;error?:string;attempts:WorkflowProviderAttempt[];routeIndex:number;routeAttempts:number;resultRefs:string[];usage?:{inputTokens?:number;outputTokens?:number;totalTokens?:number;costUsd?:number};reportedModel?:string}
export interface WorkflowBackupProgress {nextThreshold:number;lastCount:number;files:Array<{path:string;revision:number;count:number;thresholds:number[];final:boolean;createdAt:string}>;pending?:{spoolPath:string;path:string;digest:string;revision:number;count:number;thresholds:number[];final:boolean;nextThreshold:number}}
export interface WorkflowRun {id:string;projectId:string;definitionId:string;definitionVersion:number;definition:Omit<WorkflowDefinition,'history'>;profiles:Record<string,AIProfile>;connections:Connection[];toolConnections?:WorkflowToolConnection[];targetUnitIds:string[];items:WorkflowWorkItem[];executions:WorkflowNodeExecution[];status:'queued'|'running'|'paused'|'waiting'|'completed'|'failed'|'cancelled';createdAt:string;updatedAt:string;startedBy:'user';committedUnitIds:string[];confirmedUnitIds:string[];backups?:Record<string,WorkflowBackupProgress>;error?:string;activeExecutionId?:string}
export interface WorkflowToolConnection {id:string;name:string;baseUrl:string;version:number;auth:'none'|'bearer'|'header';headerName?:string}
export interface WorkflowState {version:1;projectId:string;definitions:WorkflowDefinition[];runs:WorkflowRun[];toolConnections?:WorkflowToolConnection[]}
export interface WorkflowRunInput {definitionId:string;unitIds?:string[];groupId?:string;statusIds?:string[];labelIds?:string[]}
export interface WorkflowTask {runId:string;node:WorkflowNode;unitIds:string[];executionId?:string}
export interface WorkflowAIRequest {runId:string;executionId:string;node:Extract<WorkflowNode,{type:'ai'}>;unitIds:string[];profile:AIProfile;profileVersion:number;context:Record<string,unknown>;prompt:string;schema:Record<string,unknown>;signal:AbortSignal}
export interface WorkflowAIResult {data:unknown;usage?:WorkflowNodeExecution['usage'];reportedModel?:string}
export interface WorkflowExtensionRequest {runId:string;executionId:string;node:Extract<WorkflowNode,{type:'extension'}>;unitIds:string[];input:Record<string,unknown>;signal:AbortSignal}
export interface WorkflowRuntimeAdapter {read():WorkspaceState;update<T>(fn:(state:WorkspaceState)=>T):T;invoke(request:WorkflowAIRequest):Promise<WorkflowAIResult>;extension?(request:WorkflowExtensionRequest):Promise<{data:unknown}>}
export interface WorkflowHumanInput {nodeId:string;unitIds:string[];decision:'accepted'|'rejected'|'held';edits?:Record<string,string>}
