import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.ts';
import {createSession,createProposal,acceptProposal,applyStudioOperations,appendChatMessage,updateSession} from '../src/studio.ts';

const engine=()=>new Engine('unused',{memory:true,autoStart:false});
test('studio migration and backup preserve source, history, people, drafts and primary candidates',()=>{
 const a=engine(),b=engine();try{
  const original=a.state();a.updateUnit('S0-01',{text:'안녕하세요.',expectedVersion:0});
  const translated=a.state(),projectId=translated.project.id;
  assert.equal(translated.studio?.progress['S0-01'].statusId,'status:draft');
  const selected=translated.studio?.selectedCandidateIds['S0-01'];assert.equal(translated.studio?.candidates.find(item=>item.id===selected)?.text,'안녕하세요.');
  const session=a.studioMutation(projectId,state=>createSession(state,{title:'인물 조사'}));
  a.studioMutation(projectId,state=>{
   appendChatMessage(state,{sessionId:session.id,role:'user',content:'인물을 정리해줘.'});updateSession(state,session.id,{draft:'다음 질문'});
   const proposal=createProposal(state,{sessionId:session.id,title:'인물 두 명과 관계',operations:[
    {kind:'character.create',item:{id:'a',name:'Alice',aliases:[],evidenceIds:['S0-01']}},
    {kind:'character.create',item:{id:'b',name:'Bob',aliases:[],evidenceIds:[]}},
    {kind:'relationship.create',item:{id:'ab',fromCharacterId:'a',toCharacterId:'b',direction:'directed',kind:'동료',description:'같이 근무한다.',branch:'unknown',certainty:'claimed',evidenceIds:['S0-01']}},
   ]});acceptProposal(state,proposal.id,{expectedVersion:1,actor:'user'});
  });
  const saved=a.state(),backup=a.backupProject();b.restoreProject(backup);const restored=b.state();
  assert.deepEqual(restored.units,original.units);assert.deepEqual(restored.translations,saved.translations);assert.deepEqual(restored.studio,saved.studio);
  assert.equal(restored.studio?.relationships.length,1);assert.equal(restored.studio?.sessions[0].draft,'다음 질문');
  assert.ok(!('connections' in backup.data));
 }finally{a.close();b.close();}
});

test('UI polling omits heavy trace bodies while detail state and backup retain them',()=>{
 const e=engine();try{
  const project=e.state().project.id;e.studioMutation(project,state=>{const session=createSession(state);appendChatMessage(state,{sessionId:session.id,role:'assistant',content:'saved body'});});
  const ui=e.uiState();assert.ok(!('unchanged' in ui));if('unchanged' in ui)return;
  assert.deepEqual(ui.studio?.messages,[]);assert.deepEqual(ui.studio?.candidates,[]);assert.equal(e.state().studio?.messages.length,1);
 }finally{e.close();}
});

test('project switching isolates sessions and running chat prevents switch; restore stops active calls',()=>{
 const e=engine(),restored=engine();try{
  const initial=e.state(),pid=initial.project.id;
  const session=e.studioMutation(pid,state=>createSession(state,{title:'original'}));
  e.studioMutation(pid,state=>updateSession(state,session.id,{status:'running'}));
  const backup=e.backupProject();restored.restoreProject(backup);assert.equal(restored.state().studio?.sessions[0].status,'stopped');
  const replacement={schemaVersion:initial.schemaVersion,project:{...initial.project,id:'second'},groups:initial.groups,units:initial.units,terms:initial.terms};
  assert.throws(()=>e.importProject(replacement),/진행 중/);
  e.studioMutation(pid,state=>updateSession(state,session.id,{status:'idle'}));e.importProject(replacement);
  assert.equal(e.state().studio?.sessions.length,0);assert.throws(()=>e.studioMutation(pid,()=>{}),/다른 프로젝트/);
  e.openProject(pid);assert.equal(e.state().studio?.sessions[0].title,'original');
 }finally{e.close();restored.close();}
});

test('accepted web evidence survives backup while legacy backups migrate without studio fields',()=>{
 const e=engine(),b=engine();try{
  e.studioMutation(e.state().project.id,state=>applyStudioOperations(state,[
   {kind:'evidence.create',item:{id:'web-evidence',kind:'web',url:'https://example.org/article',retrievedAt:'2026-10-09T00:00:00.000Z',excerpt:'A setting.'}},
   {kind:'knowledge.create',item:{id:'setting',kind:'summary',title:'배경',content:'배경 문서',branch:'global',visibility:'translator',evidenceIds:['web-evidence']}},
  ],{kind:'direct',actor:'user'}));
  b.restoreProject(e.backupProject());assert.equal(b.state().knowledge[0].evidenceIds[0],'web-evidence');
  const old=e.backupProject();delete old.data.studio;old.data.knowledge=[];b.restoreProject(old);assert.ok(b.state().studio);assert.equal(b.state().studio?.characters.length,0);
 }finally{e.close();b.close();}
});
