import type {ExecutionProfile, ExecutionStamp, KnowledgeItem, Stage, Term, TermUpdateInput, TermUsage, TranslationVersion} from './index.js';

export type StudioStatusRole = 'untranslated'|'draft'|'confirmed'|'custom';
export interface StatusDefinition {id:string;name:string;role:StudioStatusRole;color:string;version:number}
export interface LabelDefinition {id:string;name:string;color:string;version:number}
export interface UnitProgress {unitId:string;statusId:string;labelIds:string[];version:number}
export interface AIProfile extends ExecutionProfile {id:string;name:string;version:number;legacyStage?:Stage;outputFormat?:'text'|'json';toolPolicy?:{web:boolean;allowedTools:string[]};createdAt:string;updatedAt:string}
export interface StudioProvenance {actor?:'user'|'ai';sessionId?:string;messageId?:string;toolCallId?:string;runId?:string;nodeId?:string;model?:string;snapshotId?:string;createdAt?:string}
export interface EvidenceReference {id:string;kind:'source'|'web'|'knowledge';unitId?:string;knowledgeId?:string;knowledgeVersion?:number;url?:string;title?:string;retrievedAt?:string;excerpt?:string;location?:string;provenance?:StudioProvenance}
export interface TranslationCandidate {id:string;unitId:string;version:number;text:string;origin:TranslationVersion['origin'];createdAt:string;reason:string;execution?:ExecutionStamp;termVersions:Record<string,number>;termUsages?:TermUsage[];inputTranslationVersion:number;sourceSnapshot:string;knowledgeVersions:Record<string,number>;contextVersions?:Array<{kind:'character'|'relationship'|'knowledge';id:string;version:number}>;evidenceSnapshots?:Record<string,string>;qa:Array<{code:string;message:string}>;provenance?:StudioProvenance;legacyHistoryVersion?:number}
export interface Character {id:string;name:string;aliases:string[];profileKnowledgeId?:string;evidenceIds:string[];version:number;provenance?:StudioProvenance}
export interface Relationship {id:string;fromCharacterId:string;toCharacterId:string;direction:'directed'|'mutual'|'undirected';kind:string;description:string;branch:string;condition?:string;certainty:'confirmed'|'claimed'|'inferred'|'unknown';evidenceIds:string[];version:number;provenance?:StudioProvenance}
export interface ChatSession {id:string;projectId:string;title:string;webEnabled:boolean;unitIds:string[];profileId?:string;maxTurns?:number;maxToolCalls?:number;createdAt:string;updatedAt:string;version:number;status:'idle'|'running'|'stopped'|'failed';error?:string;draft:string}
export interface ChatProviderRoute {connectionId:string;model:string;apiMode:'chat'|'responses';baseUrl?:string}
export interface ChatProviderAttempt {connectionId:string;model:string;routeIndex:number;number:number;status:'completed'|'failed';error?:string}
export interface ChatMessage {id:string;sessionId:string;projectId:string;role:'user'|'assistant'|'system'|'tool';content:string;createdAt:string;proposalIds?:string[];toolCallIds?:string[];responseItems?:Record<string,unknown>[];usage?:{inputTokens?:number;outputTokens?:number;totalTokens?:number;cachedInputTokens?:number};reportedModel?:string;providerRoute?:ChatProviderRoute;providerAttempts?:ChatProviderAttempt[];streamStatus?:'streaming'|'completed'|'stopped'|'failed'}
export interface ChatToolCall {id:string;sessionId:string;projectId:string;messageId?:string;providerCallId?:string;name:string;input:Record<string,unknown>;output?:unknown;status:'running'|'completed'|'failed'|'stopped';startedAt:string;finishedAt?:string;error?:string;web:boolean}
export type StudioBaseVersion = {kind:'source';id:string;snapshot:string}|{kind:'translation'|'term'|'knowledge'|'character'|'relationship'|'progress'|'candidate'|'label'|'status';id:string;version:number};
type KnowledgeDraft = Omit<KnowledgeItem,'version'|'history'|'usedUnitIds'>;
export type ProposalOperation =
 | {kind:'term.create';item:Omit<Term,'version'>}
 | {kind:'term.update';id:string;input:Omit<TermUpdateInput,'autoRecheck'>}
 | {kind:'knowledge.create';item:KnowledgeDraft}
 | {kind:'knowledge.update';id:string;expectedVersion:number;patch:Partial<Pick<KnowledgeItem,'title'|'content'|'evidenceIds'|'branch'|'visibility'|'archived'>>}
 | {kind:'character.create';item:Omit<Character,'version'>}
 | {kind:'character.update';id:string;expectedVersion:number;patch:Partial<Omit<Character,'id'|'version'>>}
 | {kind:'relationship.create';item:Omit<Relationship,'version'>}
 | {kind:'relationship.update';id:string;expectedVersion:number;patch:Partial<Omit<Relationship,'id'|'version'>>}
 | {kind:'evidence.create';item:EvidenceReference}
 | {kind:'label.create';item:Omit<LabelDefinition,'version'>}
 | {kind:'status.create';item:Omit<StatusDefinition,'version'>}
 | {kind:'unit.assign';unitId:string;expectedVersion:number;statusId?:string;labelIds?:string[]}
 | {kind:'translation.candidate';item:Omit<TranslationCandidate,'version'|'createdAt'|'qa'|'sourceSnapshot'|'knowledgeVersions'> & {sourceSnapshot?:string;knowledgeVersions?:Record<string,number>};expectedVersion:number;select?:boolean}
 | {kind:'translation.select';unitId:string;candidateId:string;candidateVersion:number;expectedVersion:number};
export interface ProposalRevision {version:number;title:string;operations:ProposalOperation[];baseVersions:StudioBaseVersion[];evidenceIds:string[];createdAt:string;reason:string;provenance?:StudioProvenance}
export interface ProposalFeedback {id:string;createdAt:string;actor:'user';content:string;fromVersion:number;toVersion?:number}
export interface ChangeProposal {id:string;projectId:string;sessionId:string;idempotencyKey?:string;title:string;version:number;status:'draft'|'accepted'|'rejected';operations:ProposalOperation[];baseVersions:StudioBaseVersion[];evidenceIds:string[];provenance?:StudioProvenance;createdAt:string;updatedAt:string;history:ProposalRevision[];feedback:ProposalFeedback[];acceptance?:{actor:'user';version:number;acceptedAt:string;affectedUnitIds:string[];resultRefs:string[]};rejection?:{actor:'user';version:number;rejectedAt:string;reason?:string}}
export interface WebSearchSettings {kind:'searxng';baseUrl:string;credentialId?:string;maxResults?:number}
export interface StudioState {version:1;projectId:string;statuses:StatusDefinition[];labels:LabelDefinition[];progress:Record<string,UnitProgress>;profiles:AIProfile[];candidates:TranslationCandidate[];selectedCandidateIds:Record<string,string>;characters:Character[];relationships:Relationship[];evidence:EvidenceReference[];sessions:ChatSession[];messages:ChatMessage[];toolCalls:ChatToolCall[];proposals:ChangeProposal[];webSearch?:WebSearchSettings}
export interface CreateSessionInput {title?:string;webEnabled?:boolean;unitIds?:string[];profileId?:string;maxTurns?:number;maxToolCalls?:number}
export interface CreateProposalInput {sessionId:string;title:string;operations:ProposalOperation[];baseVersions?:StudioBaseVersion[];evidenceIds?:string[];provenance?:StudioProvenance;idempotencyKey?:string}
export interface EditProposalInput {expectedVersion:number;title?:string;operations?:ProposalOperation[];baseVersions?:StudioBaseVersion[];evidenceIds?:string[];reason?:string}
export interface ProposalDecision {expectedVersion:number;actor:'user';sessionId?:string;reason?:string}
export type StudioMutationAuthority = {kind:'direct';actor:'user'}|{kind:'workflow';runId:string};
export interface StudioMutationResult {affectedUnitIds:string[];resultRefs:string[]}
export interface StudioValidationIssue {code:string;message:string;ref?:string;expected?:unknown;actual?:unknown}
