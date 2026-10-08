export {isLocalApiHost} from './api-host.js';
export {graphNodeSemantics,isGraphControlNode,graphNodeHasRuntimeGuard,graphNodeSourceLabel} from './graph-semantics.js';
export type {GraphNodeSemantics,GraphSemanticNode,GraphSemanticShape} from './graph-semantics.js';
export type * from './studio.js';
export type * from './workflow.js';
import type {StudioState} from './studio.js';
import type {WorkflowState} from './workflow.js';
export const STAGES = ['analyze','glossary','characters','translate','review','recheck'] as const;
export type Stage = typeof STAGES[number];
export const STAGE_LABELS: Record<Stage,string> = {analyze:'작품 분석',glossary:'용어 추출',characters:'인물·관계',translate:'초벌 번역',review:'문맥 검수',recheck:'변경 재검토'};
/** An extraction scope, not proof of mutually exclusive execution. Unknown stays unknown. */
export type Branch = string;
export interface GraphNode {id:string;unitIds:string[];groupIds:string[];kind?:string;conditions?:unknown;metadata?:Record<string,unknown>}
export interface GraphEdge {id:string;from:string;to?:string;externalTarget?:string;kind?:string;direction?:unknown;conditions?:unknown;metadata?:Record<string,unknown>}
export interface GraphFlow {id:string;title:string;rootIds:string[];nodeIds:string[];metadata?:Record<string,unknown>}
export interface NarrativeGraph {version:1;nodes:GraphNode[];edges:GraphEdge[];flows:GraphFlow[];orderingNote:string;metadata?:Record<string,unknown>}
export interface GraphSummary {nodes:number;edges:number;flows:number;unknownGroups:number;orderingNote:string}
export interface Group { id:string; title:string; description:string; order:number; branch:Branch; kind:'scene'|'document'|'ui'; nextIds:string[];graphNodeIds?:string[];graphFlowIds?:string[] }
export interface SourceUnit {id:string;groupId:string;order:number;speaker?:string;source:string;sourceLanguage?:string;kind:'dialogue'|'document'|'ui';branch:Branch;termIds:string[];contextNotes?:string[];graphNodeIds?:string[];sourceRef?:Record<string,unknown>}
export interface TermCandidate {id:string;target:string;guidance:string;isDefault:boolean;enabled:boolean;version:number;status:'provisional'|'confirmed';evidence?:Array<{unitId:string;translationVersion:number;sourceText:string;targetText:string;snapshotId?:string}>}
export interface TermUsage {termId:string;candidateId:string;candidateVersion:number;origin:'model'|'observed'|'extracted'}
export const legacyTermCandidateId=(termId:string)=>`${termId}:default`;
export interface TermCreateInput {source:string;target:string;guidance?:string}
export interface TermUpdateInput {expectedVersion:number;description?:string;target?:string;candidates?:Array<{id?:string;target:string;guidance:string;isDefault:boolean;enabled:boolean}>;autoRecheck?:boolean}
export interface Term {id:string;source:string;target:string;description:string;version:number;unitIds:string[];aliases:string[];status:'provisional'|'confirmed';previousTargets?:string[];candidates?:TermCandidate[]}
export interface KnowledgeVersion {version:number;title:string;content:string;createdAt:string;reason:string;provenance?:{runId?:string;stepId?:string;model?:string;promptVersion?:number}}
export interface KnowledgeItem {id:string;kind:'summary'|'character'|'fact'|'rule';title:string;content:string;evidenceIds:string[];branch:Branch;visibility:'translator'|'character'|'player';version?:number;history?:KnowledgeVersion[];archived?:boolean;usedUnitIds?:string[];provenance?:KnowledgeVersion['provenance']}
export interface Connection {id:string;name:string;kind:'mock'|'openai'|'systemone'|'codex'|'grok'|'antigravity'|'claude';baseUrl?:string;envKey?:string;executable?:string;apiMode?:'chat'|'responses';allowUnauthenticated?:boolean;structuredOutput?:'json-schema'|'json-object'|'text';tokenLimitField?:'max_completion_tokens'|'max_tokens';supportedEfforts?:string[];timeoutMs?:number}
export interface ModelRoute {connectionId:string;model:string;effort:string;timeoutMs:number;maxOutputTokens:number;maxAttempts:number}
export interface ExecutionProfile extends ModelRoute {fallbacks?:ModelRoute[];prompt?:string;promptVersion?:number;contextPolicy?:{terms?:boolean;knowledge?:boolean;previous?:boolean}}
/** Route zero is primary; only explicitly configured alternatives can be used. */
export function profileAtRoute(profile:ExecutionProfile,index=0):ExecutionProfile {
 if(index===0)return profile;
 const route=profile.fallbacks?.[index-1];if(!route)throw new Error('대체 AI 설정을 찾을 수 없습니다.');
 return {...profile,...route};
}
export const profileUsesConnection=(profile:ExecutionProfile,id:string)=>profile.connectionId===id||!!profile.fallbacks?.some(route=>route.connectionId===id);
export interface ModelAttempt {connectionId:string;model:string;effort:string;routeIndex:number;startedAt:string;finishedAt?:string;status:'running'|'completed'|'failed'|'cancelled'|'interrupted';error?:string;snapshotId?:string}
export interface QaIssue {code:string;message:string}
export interface ExecutionStamp {connectionId:string;connectionKind:Connection['kind'];model:string;effort:string;reportedModel?:string;reportedEffort?:string;stage:Stage;demo:boolean;promptVersion?:number;snapshotId?:string;runId?:string;stepId?:string}
export interface TranslationVersion {version:number;text:string;origin:'demo'|'ai'|'manual';createdAt:string;reason:string;execution?:ExecutionStamp;termVersions:Record<string,number>;termUsages?:TermUsage[]}
export interface Translation {unitId:string;text:string;version:number;status:'untranslated'|'draft'|'checked';freshness:'current'|'stale';locked:boolean;origin:'demo'|'ai'|'manual';history:TranslationVersion[];qa:QaIssue[];termVersions:Record<string,number>;termUsages?:TermUsage[];updatedAt:string;execution?:ExecutionStamp}
export interface ReviewItem {id:string;unitId:string;jobId:string;kind:'locked'|'conflict'|'qa'|'semantic';status:'open'|'accepted'|'dismissed'|'resolved';currentText:string;proposedText:string;reason:string;baseVersion:number;termVersions:Record<string,number>;termUsages?:TermUsage[];createdAt:string;execution?:ExecutionStamp}
export interface JobStep {id:string;stage:Stage;groupId?:string;unitIds:string[];status:'queued'|'running'|'completed'|'failed';attempts:number;routeIndex?:number;routeAttempts?:number;attemptHistory?:ModelAttempt[];error?:string;inputVersions?:Record<string,number>;termVersions?:Record<string,number>;batchIndex?:number;batchCount?:number;startedAt?:string;finishedAt?:string;snapshotId?:string}
export interface Run {id:string;kind:'pipeline'|'translate'|'recheck';status:'queued'|'running'|'paused'|'completed'|'cancelled'|'failed';mode:'demo'|'live'|'mixed';steps:JobStep[];profiles:Record<Stage,ExecutionProfile>;connections:Connection[];createdAt:string;updatedAt:string;error?:string;logs:string[];usage:{inputTokens?:number;outputTokens?:number;costUsd?:number}}
export interface Activity {id:string;createdAt:string;message:string;type:'info'|'success'|'warning'|'error'}
export interface TaskInput {stage:Stage;groupId?:string;unitIds?:string[];profile?:ExecutionProfile}
export interface RunInput {kind:Run['kind'];groupId?:string;unitIds?:string[];stage?:Stage}
export interface ProjectSummary {id:string;title:string;unitCount:number;updatedAt:string;current:boolean}
export interface ProjectBackup {format:'translation-workbench-backup';version:1;savedAt:string;data:Omit<WorkspaceState,'connections'|'profiles'|'revision'>}
export interface TaskSnapshot {id:string;createdAt:string;stage:Stage;groupId?:string;unitIds:string[];runId?:string;stepId?:string;context:Record<string,unknown>;prompt:string;schema:Record<string,unknown>;capturedProfile:ExecutionProfile;connection:Connection;termVersions:Record<string,number>;knowledgeVersions:Record<string,number>}
export interface TaskTest {id:string;snapshotId:string;createdAt:string;finishedAt?:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';stage:Stage;groupId?:string;unitIds:string[];capturedProfile:ExecutionProfile;requestedModel:string;requestedEffort:string;reportedModel?:string;reportedEffort?:string;rawResponse?:unknown;usage?:{inputTokens?:number;outputTokens?:number;costUsd?:number;totalTokens?:number;cachedInputTokens?:number};durationMs?:number;validation?:{ok:boolean;issues:{code:string;message:string;unitId?:string}[]};error?:string}
export interface ChangeRecord {id:string;createdAt:string;kind:string;unitIds:string[];groupIds:string[];before:unknown;after:unknown;termId?:string;knowledgeId?:string;runId?:string;stepId?:string;stage?:Stage;model?:string;promptVersion?:number;snapshotId?:string}
export interface WorkspaceState {schemaVersion:1|2;revision:number;project:{id:string;title:string;description:string;sourceLanguage:string;targetLanguage:string};groups:Group[];units:SourceUnit[];translations:Record<string,Translation>;terms:Term[];knowledge:KnowledgeItem[];connections:Connection[];profiles:Record<Stage,ExecutionProfile>;runs:Run[];reviews:ReviewItem[];events:Activity[];graph?:NarrativeGraph;graphSummary?:GraphSummary;taskSnapshots?:TaskSnapshot[];taskTests?:TaskTest[];changes?:ChangeRecord[];studio?:StudioState;workflow?:WorkflowState}
export interface ProjectInput {schemaVersion:1|2;project:WorkspaceState['project'];groups:Group[];units:SourceUnit[];terms?:Term[];knowledge?:KnowledgeItem[];graph?:NarrativeGraph}
