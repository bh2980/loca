import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/engine.ts';
import {acceptProposal,appendChatMessage,applyStudioOperations,createProposal,createSession,editProposal,ensureStudio,feedbackProposal,reconcileStudio,recordToolCall,rejectProposal,sessionDetail,StudioError,studioContext,studioProgress,validateProposal} from '../src/studio.ts';
import type {ProposalOperation,StudioMutationAuthority,WorkspaceState} from '@workbench/contracts';

function setup(){const state=initialState();const studio=ensureStudio(state);const session=createSession(state,{title:'조사',unitIds:['S0-01']});return {state,studio,session};}
const knowledge=(id='document'):ProposalOperation=>({kind:'knowledge.create',item:{id,kind:'summary',title:'작품 설명',content:'원문을 근거로 한 설명',evidenceIds:['S0-01'],branch:'common',visibility:'translator'}});
const body=(state:WorkspaceState)=>structuredClone({units:state.units,translations:state.translations,terms:state.terms,knowledge:state.knowledge,characters:state.studio?.characters,relationships:state.studio?.relationships});

test('additive migration preserves source, full translation history, locks, provenance, usages and legacy profiles',()=>{
 const state=initialState(),translation=state.translations['S0-01'];Object.assign(translation,{text:'원래 번역',version:2,status:'checked',locked:true,origin:'manual',termUsages:[{termId:'watch-office',candidateId:'watch-office:default',candidateVersion:1,origin:'observed'}],history:[{version:1,text:'첫 번역',origin:'demo',createdAt:'2026-01-01',reason:'첫 결과',termVersions:{}},{version:2,text:'원래 번역',origin:'manual',createdAt:'2026-01-02',reason:'사용자 편집',termVersions:{'watch-office':1}}]});
 const before=structuredClone(state),studio=ensureStudio(state);assert.deepEqual({...state,studio:undefined},{...before,studio:undefined});assert.equal(studio.candidates.find(item=>item.id===studio.selectedCandidateIds['S0-01'])?.text,'원래 번역');assert.equal(studio.candidates.filter(item=>item.unitId==='S0-01').length,2);assert.equal(studio.statuses.find(item=>item.id===studio.progress['S0-01'].statusId)?.role,'confirmed');assert.equal(studio.profiles.length,6);assert.deepEqual(studio.profiles[0].fallbacks,state.profiles.analyze.fallbacks);assert.equal(studio.profiles[0].connectionId,state.profiles.analyze.connectionId);
 const serialized=JSON.parse(JSON.stringify(state)) as WorkspaceState;const restored=ensureStudio(serialized);assert.deepEqual(restored.candidates,JSON.parse(JSON.stringify(studio.candidates)));assert.deepEqual(serialized.translations,JSON.parse(JSON.stringify(before.translations)));assert.ok(!studio.proposals.some(item=>item.acceptance));
 const stable=JSON.stringify(studio);ensureStudio(state);assert.equal(JSON.stringify(studio),stable);
});

test('chat drafts, direct draft edits, feedback and rejection never mutate project body or model context',()=>{
 const {state,session}=setup(),before=body(state);const item=createProposal(state,{sessionId:session.id,title:'자료',operations:[knowledge()]});assert.deepEqual(body(state),before);assert.equal(studioContext(state).knowledge.length,0);
 const edited=editProposal(state,item.id,{expectedVersion:1,operations:[knowledge('edited')]});assert.equal(edited.version,2);const feedback=feedbackProposal(state,item.id,{expectedVersion:2,content:'원문 근거를 설명에 넣어주세요.',operations:[knowledge('feedback')]});assert.equal(feedback.version,3);assert.equal(feedback.feedback[0].fromVersion,2);assert.equal(feedback.history.length,3);assert.deepEqual(body(state),before);assert.equal(studioContext(state).knowledge.length,0);
 rejectProposal(state,item.id,{expectedVersion:3,actor:'user',sessionId:session.id});assert.deepEqual(body(state),before);assert.throws(()=>acceptProposal(state,item.id,{expectedVersion:3,actor:'user'}),/거절/);
});

test('accept applies once across duplicate clicks, serialization and duplicate tool responses',()=>{
 const {state,session}=setup(),input={sessionId:session.id,title:'자료',operations:[knowledge()],idempotencyKey:'tool-output-1'};const item=createProposal(state,input);assert.equal(createProposal(state,input).id,item.id);const accepted=acceptProposal(state,item.id,{expectedVersion:1,actor:'user'});assert.equal(accepted.acceptance?.version,1);assert.equal(state.knowledge.length,1);assert.equal(acceptProposal(state,item.id,{expectedVersion:1,actor:'user'}).id,item.id);assert.equal(state.knowledge.length,1);
 const restored=JSON.parse(JSON.stringify(state)) as WorkspaceState;acceptProposal(restored,item.id,{expectedVersion:1,actor:'user'});assert.equal(restored.knowledge.length,1);assert.throws(()=>createProposal(state,{...input,operations:[knowledge('other')]}),/중복/);
});

test('batch acceptance is atomic when a later operation has an invalid relationship reference',()=>{
 const {state,session}=setup();const item=createProposal(state,{sessionId:session.id,title:'자료와 잘못된 관계',operations:[knowledge(),{kind:'relationship.create',item:{id:'r',fromCharacterId:'a',toCharacterId:'missing',direction:'directed',kind:'친구',description:'관계 초안',branch:'unknown',certainty:'inferred',evidenceIds:['S0-01']}}]});const before=structuredClone(state);assert.equal(validateProposal(state,item.id).ok,false);assert.throws(()=>acceptProposal(state,item.id,{expectedVersion:1,actor:'user'}),/양끝/);assert.deepEqual(state,before);
});

test('old source, term, translation and knowledge baselines reject acceptance without a partial apply',()=>{
 for(const changed of ['source','term','translation','knowledge'] as const){const {state,session}=setup();state.knowledge.push({id:'k',kind:'fact',title:'근거',content:'기존 자료',evidenceIds:['S0-01'],branch:'common',visibility:'translator',version:1});const item=createProposal(state,{sessionId:session.id,title:'자료',operations:[knowledge()]});
  if(changed==='source')state.units.find(unit=>unit.id==='S0-01')!.source+=' changed';if(changed==='term')state.terms.find(term=>term.unitIds.includes('S0-01'))!.version++;if(changed==='translation')state.translations['S0-01'].version++;if(changed==='knowledge')state.knowledge[0].version=2;
  const before=body(state);assert.throws(()=>acceptProposal(state,item.id,{expectedVersion:1,actor:'user'}),(error:unknown)=>error instanceof StudioError&&error.status===409&&error.issues.some(issue=>issue.code==='stale'));assert.deepEqual(body(state),before);
 }
});

test('project and session refs cannot cross and model actor cannot accept or execute direct writes',()=>{
 const {state,session}=setup(),second=createSession(state);const item=createProposal(state,{sessionId:session.id,title:'자료',operations:[knowledge()]});assert.throws(()=>acceptProposal(state,item.id,{expectedVersion:1,actor:'user',sessionId:second.id}),/세션/);assert.throws(()=>acceptProposal(state,item.id,{expectedVersion:1,actor:'model' as 'user'}),/사용자/);assert.throws(()=>applyStudioOperations(state,[knowledge()],{kind:'chat'} as unknown as StudioMutationAuthority),/권한/);assert.throws(()=>createSession(state,{unitIds:['other-project-unit']}),/원문/);state.project.id='another-project';assert.throws(()=>ensureStudio(state),/다른 프로젝트/);
});

test('profile documents and relationship endpoints share accepted records while unknown branch remains unknown',()=>{
 const {state,session}=setup();const operations:ProposalOperation[]=[{kind:'knowledge.create',item:{id:'profile-a',kind:'character',title:'인물 A',content:'말투',evidenceIds:['S0-01'],branch:'unknown',visibility:'translator'}},{kind:'character.create',item:{id:'a',name:'A',aliases:['별칭'],profileKnowledgeId:'profile-a',evidenceIds:['S0-01']}},{kind:'character.create',item:{id:'b',name:'B',aliases:[],evidenceIds:[]}},{kind:'character.create',item:{id:'isolated',name:'고립 인물',aliases:[],evidenceIds:[]}},{kind:'relationship.create',item:{id:'r',fromCharacterId:'a',toCharacterId:'b',direction:'directed',kind:'의심',description:'특정 분기에서 의심',branch:'unknown',condition:'시점 미확인',certainty:'claimed',evidenceIds:['S0-01']}}];const item=createProposal(state,{sessionId:session.id,title:'인물·관계',operations});assert.equal(studioContext(state).characters.length,0);acceptProposal(state,item.id,{expectedVersion:1,actor:'user'});const context=studioContext(state);assert.equal(context.characters.length,3);assert.equal(context.characters[0].profileKnowledgeId,context.knowledge[0].id);assert.equal(context.relationships[0].branch,'unknown');assert.equal(context.relationships[0].certainty,'claimed');assert.equal(context.relationships.length,1);
 const mutation=createProposal(state,{sessionId:session.id,title:'잘못된 프로필',operations:[{kind:'character.update',id:'a',expectedVersion:1,patch:{profileKnowledgeId:'missing'}}]});assert.throws(()=>acceptProposal(state,mutation.id,{expectedVersion:1,actor:'user'}),/프로필/);
});

test('candidate storage preserves representative until selection and locked/stale selection is blocked',()=>{
 const {state,session}=setup();const translation=state.translations['S0-01'];const op:ProposalOperation={kind:'translation.candidate',expectedVersion:0,item:{id:'candidate-a',unitId:'S0-01',text:'새 후보',origin:'manual',reason:'편집 초안',inputTranslationVersion:0,termVersions:{}}};const item=createProposal(state,{sessionId:session.id,title:'번역 후보',operations:[op]});acceptProposal(state,item.id,{expectedVersion:1,actor:'user'});assert.equal(state.translations['S0-01'].text,'');assert.equal(state.studio!.candidates.find(item=>item.id==='candidate-a')?.text,'새 후보');
 const selection=createProposal(state,{sessionId:session.id,title:'대표 선택',operations:[{kind:'translation.select',unitId:'S0-01',candidateId:'candidate-a',candidateVersion:1,expectedVersion:0}]});state.translations['S0-01'].locked=true;assert.throws(()=>acceptProposal(state,selection.id,{expectedVersion:1,actor:'user'}),/잠긴/);state.translations['S0-01'].locked=false;acceptProposal(state,selection.id,{expectedVersion:1,actor:'user'});assert.equal(state.translations['S0-01'].text,'새 후보');assert.equal(state.translations['S0-01'].version,translation.version+1);assert.equal(state.translations['S0-01'].history.length,1);assert.equal(state.studio!.selectedCandidateIds['S0-01'],'candidate-a');
});

test('label and status identities survive rename-like names and progress aggregates whole explicit scope',()=>{
 const {state,session}=setup();state.translations['S0-01'].text='좋은 저녁입니다.';const item=createProposal(state,{sessionId:session.id,title:'진행',operations:[{kind:'status.create',item:{id:'finished',name:'현지화 완료',role:'confirmed',color:'#00ff00'}},{kind:'label.create',item:{id:'needs-context',name:'문맥',color:'#fff'}},{kind:'unit.assign',unitId:'S0-01',expectedVersion:1,statusId:'finished',labelIds:['needs-context','needs-context']}]});acceptProposal(state,item.id,{expectedVersion:1,actor:'user'});assert.deepEqual(state.studio!.progress['S0-01'].labelIds,['needs-context']);assert.equal(studioProgress(state).total,state.units.length);assert.equal(studioProgress(state).confirmed,1);assert.equal(state.translations['S0-01'].status,'checked');
});

test('chat traces remain project/session scoped and web off rejects new web records',()=>{
 const {state,session}=setup(),second=createSession(state);appendChatMessage(state,{id:'message',sessionId:session.id,role:'user',content:'조사'});assert.throws(()=>recordToolCall(state,{id:'call',sessionId:session.id,name:'search',input:{q:'work'},status:'running',web:true}),/꺼져/);recordToolCall(state,{id:'call',sessionId:session.id,messageId:'message',name:'sources',input:{unitIds:['S0-01']},status:'completed',output:{unitIds:['S0-01']},web:false});assert.throws(()=>recordToolCall(state,{id:'other',sessionId:second.id,messageId:'message',name:'sources',input:{},status:'running',web:false}),/세션/);assert.equal(sessionDetail(state,second.id).messages.length,0);assert.equal(sessionDetail(state,session.id).toolCalls.length,1);
});

test('knowledge and term accepted changes mark impacts stale but never start model execution',()=>{
 const {state,session}=setup();state.translations['S0-01'].text='감시국';state.translations['S0-01'].freshness='current';const term=state.terms.find(term=>term.id==='watch-office')!;const item=createProposal(state,{sessionId:session.id,title:'용어',operations:[{kind:'term.update',id:term.id,input:{expectedVersion:term.version,target:'관측국'}}]});const runs=structuredClone(state.runs);acceptProposal(state,item.id,{expectedVersion:1,actor:'user'});assert.equal(state.terms.find(item=>item.id===term.id)?.target,'관측국');assert.equal(state.translations['S0-01'].text,'감시국');assert.equal(state.translations['S0-01'].freshness,'stale');assert.deepEqual(state.runs,runs);
});

test('user-started workflow authority remains automatic; chat acceptance does not become a blanket gate',()=>{
 const {state}=setup();state.runs.push({id:'run',kind:'translate',status:'running',mode:'demo',steps:[],profiles:state.profiles,connections:state.connections,createdAt:'now',updatedAt:'now',logs:[],usage:{}});applyStudioOperations(state,[knowledge()],{kind:'workflow',runId:'run'});assert.equal(state.knowledge.length,1);assert.equal(state.studio!.proposals.length,0);assert.throws(()=>applyStudioOperations(state,[knowledge('other')],{kind:'workflow',runId:'missing'}),/실행/);
});

test('explicit legacy reconciliation mirrors statuses and candidates while preserving custom status and labels',()=>{
 const {state,studio}=setup();studio.labels.push({id:'keep',name:'유지',color:'#fff',version:1});studio.progress['S0-01'].labelIds=['keep'];state.translations['S0-01'].status='checked';state.translations['S0-01'].text='기존 엔진 결과';state.translations['S0-01'].version=1;
 const before=JSON.stringify(studio);ensureStudio(state);assert.equal(JSON.stringify(studio),before);reconcileStudio(state,['S0-01']);assert.equal(studio.progress['S0-01'].statusId,'status:confirmed');assert.deepEqual(studio.progress['S0-01'].labelIds,['keep']);assert.equal(studio.candidates.find(candidate=>candidate.id===studio.selectedCandidateIds['S0-01'])?.text,'기존 엔진 결과');studio.statuses.push({id:'custom',name:'편집 대기',role:'custom',color:'#fff',version:1});studio.progress['S0-01'].statusId='custom';state.translations['S0-01'].status='draft';reconcileStudio(state,['S0-01']);assert.equal(studio.progress['S0-01'].statusId,'custom');
});

test('candidate token corruption and empty/stale/locked confirmation cannot change the representative',()=>{
 const {state,session}=setup();state.units.find(unit=>unit.id==='S0-01')!.source='Hello {name}';const op:ProposalOperation={kind:'translation.candidate',expectedVersion:0,select:true,item:{id:'broken',unitId:'S0-01',text:'안녕하세요',origin:'manual',reason:'서식 누락',inputTranslationVersion:0,termVersions:{}}};const item=createProposal(state,{sessionId:session.id,title:'잘못된 후보',operations:[op]});const before=body(state);assert.throws(()=>acceptProposal(state,item.id,{expectedVersion:1,actor:'user'}),/서식/);assert.deepEqual(body(state),before);
 const confirm=createProposal(state,{sessionId:session.id,title:'빈 번역 확정',operations:[{kind:'unit.assign',unitId:'S0-01',expectedVersion:1,statusId:'status:confirmed'}]});assert.throws(()=>acceptProposal(state,confirm.id,{expectedVersion:1,actor:'user'}),/통과한 번역/);
});

test('provider tool-only assistant turns retain typed raw response items and later tool records',()=>{
 const {state,session}=setup();appendChatMessage(state,{id:'tool-turn',sessionId:session.id,role:'assistant',content:'',toolCallIds:['tool-next'],responseItems:[{type:'function_call',call_id:'provider-call'}],usage:{inputTokens:10,outputTokens:3},reportedModel:'fixture'});recordToolCall(state,{id:'tool-next',providerCallId:'provider-call',sessionId:session.id,messageId:'tool-turn',name:'read_sources',input:{unitIds:['S0-01']},status:'completed',web:false});const detail=sessionDetail(state,session.id);assert.equal(detail.messages[0].responseItems?.[0].type,'function_call');assert.equal(detail.messages[0].usage?.inputTokens,10);assert.equal(detail.toolCalls[0].providerCallId,'provider-call');assert.throws(()=>appendChatMessage(state,{sessionId:session.id,role:'assistant',content:''}),/메시지/);
});
