import type {StudioState, WorkspaceState} from '@workbench/contracts';
import {ensureStudio,StudioError,validateCandidateContextMetadata,refreshCandidateContextFreshness} from './studio.ts';
import {validateWorkflowStorage} from './workflow.ts';

const fail=(message:string):never=>{throw new StudioError(`Studio 백업: ${message}`);};
const safeId=(value:unknown)=>typeof value==='string'&&value.length>0&&!['__proto__','prototype','constructor'].includes(value);
const record=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Validate stored boundaries before migration. Historical source references may
 * intentionally point to removed source units; they remain history, never targets. */
export function validateStudioStorage(state:WorkspaceState){
 validateWorkflowStorage(state);
 const studio=state.studio;if(!studio)return;
 if(!record(studio)||studio.version!==1||studio.projectId!==state.project.id)fail('프로젝트 또는 저장 버전이 다릅니다.');
 const names=['statuses','labels','profiles','candidates','characters','relationships','evidence','sessions','messages','toolCalls','proposals'] as const;
 for(const name of names){const items=studio[name];if(!Array.isArray(items))fail(`${name} 목록이 없습니다.`);const ids=new Set<string>();for(const item of items){if(!record(item)||!safeId(item.id)||ids.has(item.id))fail(`${name} ID가 잘못되었거나 중복됩니다.`);ids.add(item.id);}}
 if(!record(studio.progress)||!record(studio.selectedCandidateIds))fail('진행 또는 대표 후보 정보가 없습니다.');
 const sessions=new Set(studio.sessions.map(item=>item.id)),characters=new Set(studio.characters.map(item=>item.id));
 const candidates=new Map(studio.candidates.map(item=>[item.id,item]));
 for(const [unitId,progress] of Object.entries(studio.progress)){
  if(!safeId(unitId)||!record(progress)||progress.unitId!==unitId||!studio.statuses.some(item=>item.id===progress.statusId)||!Array.isArray(progress.labelIds)||progress.labelIds.some(id=>!studio.labels.some(item=>item.id===id)))fail('진행 상태 참조가 잘못되었습니다.');
 }
 for(const [unitId,candidateId] of Object.entries(studio.selectedCandidateIds))if(!safeId(unitId)||candidates.get(candidateId)?.unitId!==unitId)fail('대표 후보 참조가 잘못되었습니다.');
 for(const item of studio.candidates)if(typeof item.text!=='string'||typeof item.sourceSnapshot!=='string'||!Array.isArray(item.qa)||!record(item.termVersions)||!record(item.knowledgeVersions))fail('번역 후보 형식이 잘못되었습니다.');
 for(const item of studio.candidates)validateCandidateContextMetadata(item);
 const stringList=(value:unknown)=>Array.isArray(value)&&value.every(item=>typeof item==='string');
 for(const item of studio.characters)if(typeof item.name!=='string'||!stringList(item.aliases)||!stringList(item.evidenceIds)||item.profileKnowledgeId!==undefined&&typeof item.profileKnowledgeId!=='string')fail('인물 형식이 잘못되었습니다.');
 for(const item of studio.relationships)if(!characters.has(item.fromCharacterId)||!characters.has(item.toCharacterId)||!['directed','mutual','undirected'].includes(item.direction)||!stringList(item.evidenceIds)||typeof item.branch!=='string'||typeof item.kind!=='string'||typeof item.description!=='string'||item.condition!==undefined&&typeof item.condition!=='string'||!['confirmed','claimed','inferred','unknown'].includes(item.certainty))fail('인물 관계 참조 또는 형식이 잘못되었습니다.');
 for(const item of state.knowledge){if(typeof item.title!=='string'||typeof item.content!=='string'||typeof item.branch!=='string'||!stringList(item.evidenceIds)||!['summary','character','fact','rule'].includes(item.kind)||!['translator','character','player'].includes(item.visibility)||item.archived!==undefined&&typeof item.archived!=='boolean'||item.history!==undefined&&(!Array.isArray(item.history)||item.history.some(version=>!record(version)||!Number.isSafeInteger(version.version)||version.version<1||typeof version.title!=='string'||typeof version.content!=='string'||typeof version.createdAt!=='string'||typeof version.reason!=='string')))fail('작품 자료 또는 자료 이력 형식이 잘못되었습니다.');}
 for(const item of studio.sessions)if(item.projectId!==state.project.id||!Array.isArray(item.unitIds)||typeof item.draft!=='string'||typeof item.webEnabled!=='boolean')fail('채팅 세션 형식이 잘못되었습니다.');
 for(const name of ['messages','toolCalls','proposals'] as const)for(const item of studio[name])if(item.projectId!==state.project.id||!sessions.has(item.sessionId))fail(`${name}가 다른 세션에 속합니다.`);
 for(const item of studio.messages)if(typeof item.content!=='string'||Buffer.byteLength(item.content,'utf8')>8*1024*1024||item.streamStatus!==undefined&&(item.role!=='assistant'||!['streaming','completed','stopped','failed'].includes(item.streamStatus)))fail('채팅 메시지 또는 응답 상태가 잘못되었습니다.');
 for(const proposal of studio.proposals)if(!Array.isArray(proposal.operations)||!Array.isArray(proposal.baseVersions)||!Array.isArray(proposal.history)||!Array.isArray(proposal.feedback)||!['draft','accepted','rejected'].includes(proposal.status))fail('제안 형식이 잘못되었습니다.');
}

/** A restored or reopened snapshot cannot resume network work by itself. */
export function recoverStudio(state:WorkspaceState,reason='실행부가 재시작되어 응답이 중단되었습니다.'){
 validateStudioStorage(state);const studio=ensureStudio(state),stamp=new Date().toISOString();
 for(const session of studio.sessions)if(session.status==='running'){session.status='stopped';session.error=reason;session.updatedAt=stamp;session.version++;}
 for(const message of studio.messages)if(message.streamStatus==='streaming')message.streamStatus='stopped';
 refreshCandidateContextFreshness(state);
 for(const call of studio.toolCalls)if(call.status==='running'){call.status='stopped';call.error=reason;call.finishedAt=stamp;}
}

/** Frequent UI polling carries summaries; conversations/candidate bodies have
 * dedicated endpoints. Never send all chat history every 1.2 seconds. */
export function studioUiState(studio:StudioState):StudioState {
 return {...studio,candidates:[],messages:[],toolCalls:[],proposals:[],evidence:studio.evidence.map(({excerpt:_excerpt,...item})=>item),sessions:studio.sessions.map(item=>({...item,draft:''}))};
}
