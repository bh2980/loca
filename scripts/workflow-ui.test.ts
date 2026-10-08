import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGES,type ExecutionProfile,type ExecutionStamp,type KnowledgeItem,type ReviewItem,type Translation} from '@workbench/contracts';
import {equalProfile,mergeSettingsDrafts,runOutcome,type SettingsSnapshot} from '../apps/web/src/workflow-state.ts';

const profile:ExecutionProfile={connectionId:'codex',model:'fixture-model',effort:'',timeoutMs:1000,maxOutputTokens:800,maxAttempts:1};
function settings():SettingsSnapshot{return {revision:1,connections:[{id:'codex',name:'Codex',kind:'codex',executable:'codex'}],profiles:Object.fromEntries(STAGES.map(stage=>[stage,structuredClone(profile)])) as SettingsSnapshot['profiles']};}

test('an account update preserves unsaved task values while adopting newly registered connections',()=>{
  const before=settings(),draft=structuredClone(before),next=structuredClone(before);
  draft.profiles.translate.model='';draft.profiles.translate.prompt='unsaved instructions';
  next.connections.push({id:'claude',name:'Claude Code',kind:'claude',executable:'claude'});next.revision++;
  const merged=mergeSettingsDrafts(draft,before,next);
  assert.equal(merged.profiles.translate.model,'');
  assert.equal(merged.profiles.translate.prompt,'unsaved instructions');
  assert.equal(merged.connections.length,2);
  assert.equal(before.connections.length,1,'the saved baseline must remain immutable');
});

test('saving one task preserves another task draft and edits made while the save is in flight',()=>{
  const before=settings(),draft=structuredClone(before),next=structuredClone(before);
  const captured={...draft.profiles.translate,prompt:'first instructions'};
  draft.profiles.translate={...captured,prompt:'newer instructions'};
  draft.profiles.review={...draft.profiles.review,model:'unsaved-reviewer'};
  next.profiles.translate={...captured,promptVersion:2};next.revision++;
  const merged=mergeSettingsDrafts(draft,before,next,{profiles:{translate:captured}});
  assert.equal(merged.profiles.translate.prompt,'newer instructions');
  assert.equal(merged.profiles.translate.promptVersion,2);
  assert.equal(merged.profiles.review.model,'unsaved-reviewer');
  assert.equal(equalProfile(merged.profiles.translate,next.profiles.translate),false);
});

test('successful profile save becomes clean without resetting connection edits',()=>{
  const before=settings(),draft=structuredClone(before),next=structuredClone(before);
  draft.connections[0].executable='C:/custom/codex.exe';
  draft.profiles.translate.prompt='saved instruction';
  next.profiles.translate={...draft.profiles.translate,promptVersion:4};next.revision++;
  const merged=mergeSettingsDrafts(draft,before,next,{profiles:{translate:structuredClone(draft.profiles.translate)}});
  assert.equal(equalProfile(merged.profiles.translate,next.profiles.translate),true);
  assert.equal(merged.connections[0].executable,'C:/custom/codex.exe');
});

test('a connection save retains edits made during the request and server-managed additions',()=>{
  const before=settings(),draft=structuredClone(before),next=structuredClone(before);
  const captured=[{...before.connections[0],executable:'C:/first/codex.exe'}];
  draft.connections=[{...captured[0],executable:'C:/second/codex.exe'}];
  next.connections=[...captured,{id:'api-1',name:'Saved endpoint',kind:'openai',baseUrl:'https://example.invalid/v1'}];next.revision++;
  const merged=mergeSettingsDrafts(draft,before,next,{connections:captured});
  assert.equal(merged.connections[0].executable,'C:/second/codex.exe');
  assert.equal(merged.connections[1].id,'api-1');
});

test('server-normalized profile defaults do not falsely show unsaved work',()=>{
  assert.equal(equalProfile(profile,{...profile,effort:'default',prompt:'',promptVersion:9,contextPolicy:{terms:true,knowledge:true,previous:true}}),true);
  assert.equal(equalProfile(profile,{...profile,contextPolicy:{previous:false}}),false);
  assert.equal(equalProfile(profile,{...profile,timeoutMs:2000}),false);
});

test('run summaries count historical saved units once and separate open proposals from saved text',()=>{
  const stamp=(runId:string):ExecutionStamp=>({connectionId:'codex',connectionKind:'codex',model:'fixture-model',effort:'',stage:'translate',demo:false,runId});
  const translation=(unitId:string,runIds:string[]):Translation=>({unitId,text:'latest',version:runIds.length,status:'draft',freshness:'current',locked:false,origin:'ai',qa:[],termVersions:{},updatedAt:'2026-01-01',execution:stamp('later'),history:runIds.map((runId,index)=>({version:index+1,text:'saved',origin:'ai',createdAt:'2026-01-01',reason:'test',termVersions:{},execution:stamp(runId)}))});
  const proposal=(id:string,unitId:string,status:ReviewItem['status'],runId:string):ReviewItem=>({id,unitId,status,kind:'semantic',jobId:'step',currentText:'current',proposedText:'proposal',reason:'check',baseVersion:0,termVersions:{},createdAt:'2026-01-01',execution:stamp(runId)});
  const knowledge:KnowledgeItem={id:'k1',kind:'summary',title:'summary',content:'later version',evidenceIds:[],branch:'common',visibility:'translator',provenance:{runId:'later'},history:[{version:1,title:'first',content:'saved',reason:'test',createdAt:'2026-01-01',provenance:{runId:'wanted'}}]};
  const result=runOutcome({translations:{a:translation('a',['wanted','wanted','later']),b:translation('b',['elsewhere'])},reviews:[proposal('r1','b','open','wanted'),proposal('r2','b','open','wanted'),proposal('r3','c','dismissed','wanted'),proposal('r4','d','open','elsewhere')],knowledge:[knowledge]},'wanted');
  assert.deepEqual(result,{savedUnitIds:['a'],reviewUnitIds:['b'],proposedUnitIds:['b','c'],knowledgeIds:['k1']});
});
