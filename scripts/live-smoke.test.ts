import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '@workbench/core';
import {STAGES,type ExecutionStamp} from '@workbench/contracts';
import {assessment,executionEvidence,grokModelIds,parseOptions,parseProfiles,stampMatches} from './live-smoke.ts';
const profiles=()=>parseProfiles(Object.fromEntries(STAGES.map(stage=>[stage,{model:stage==='translate'?'chosen-translator':'chosen-reviewer',effort:'medium'}])));

test('explicit opt-in, strict option values and backward-compatible --model',()=>{
 assert.throws(()=>parseOptions(['--model','m']),/Usage/);
 assert.throws(()=>parseOptions(['--live','--model','m','--profiles','p']),/Usage/);
 assert.throws(()=>parseOptions(['--live','--model','--resume']),/value/);
 assert.throws(()=>parseOptions(['--live','--model','m','--model','n']),/Duplicate/);
 assert.throws(()=>parseOptions(['--live','--model','m','--typo']),/Unknown/);
 assert.throws(()=>parseOptions(['--live','--model','m','--resume']),/explicit/);
 for(const value of ['0','-1','1.2','NaN','99999999999999999999'])assert.throws(()=>parseOptions(['--live','--model','m','--restart-after-step',value]),/positive integer/);
 assert.equal(parseOptions(['--','--live','--profiles','file.json','--restart-after-step','3']).restartAfterStep,3);
 assert.equal(parseOptions(['--live','--model','legacy-model']).model,'legacy-model');
});
test('profiles require every stage and preserve model/effort/connection',()=>{
 const p=profiles();assert.equal(p.translate.model,'chosen-translator');assert.equal(p.review.model,'chosen-reviewer');assert.equal(p.translate.connectionId,'codex');assert.equal(p.translate.timeoutMs,180000);
 assert.throws(()=>parseProfiles({translate:{model:'m',effort:'medium'}}),/Missing profile/);
 assert.throws(()=>parseProfiles({...p,typo:{}}),/unknown stage/);
 assert.throws(()=>parseProfiles({...p,translate:{...p.translate,maxAttempts:0}}),/maxAttempts/);
 assert.throws(()=>parseProfiles({...p,review:{...p.review,effrot:'low'}}),/Unknown profile field/);
 assert.equal(parseProfiles({...p,review:{...p.review,connectionId:'grok',effort:''}}).review.effort,'');
});
test('semantic proposal is retained output; omission and broken tags stay distinct',()=>{
 const s=initialState(),stamp:ExecutionStamp={connectionId:'codex',connectionKind:'codex',model:'chosen-reviewer',effort:'medium',stage:'review',demo:false};
 s.reviews.push({id:'semantic',unitId:'S0-01',jobId:'job',kind:'semantic',status:'open',currentText:'',proposedText:'감시국에서 저를 보냈어요.',reason:'화자의 어조를 검토하세요.',baseVersion:0,termVersions:{},createdAt:new Date().toISOString(),execution:stamp});
 assert.equal(assessment(s).missingUnits.length,21);assert.deepEqual(assessment(s).proposalOnlyUnits,['S0-01']);assert.deepEqual(assessment(s).mechanicalIssues,[]);
 const tagged=s.units.find(u=>u.source.includes('<'))!;assert.ok(tagged);
 s.reviews.push({...s.reviews[0],id:'bad-tags',unitId:tagged.id,kind:'qa',proposedText:'태그 없는 번역'});
 assert.ok(assessment(s).mechanicalIssues.some(q=>q.code==='tag_mismatch'));
});
test('requested provenance differs from optional reported metadata',()=>{
 const p=profiles(),stamp:ExecutionStamp={connectionId:'codex',connectionKind:'codex',model:p.translate.model,effort:'medium',stage:'translate',demo:false};
 assert.ok(stampMatches(stamp,p.translate,'translate'));assert.equal(stampMatches({...stamp,model:'wrong'},p.translate,'translate'),false);assert.equal(stampMatches({...stamp,demo:true},p.translate,'translate'),false);
 const s=initialState(),t=s.translations['S0-01'];t.execution=stamp;t.history.push({version:1,text:'번역',origin:'ai',createdAt:new Date().toISOString(),reason:'test',execution:{...stamp,reportedModel:'reported-alias'},termVersions:{}});
 const rows=executionEvidence(s,p);assert.deepEqual(rows[0].reported,{model:null,effort:null});assert.equal(rows[1].reported.model,'reported-alias');assert.ok(rows.every(row=>row.matchesRequested));
});
test('Grok model discovery keeps exact advertised IDs only',()=>{
 assert.deepEqual(grokModelIds('You are logged in with grok.com.\nDefault model: grok-4.7\nAvailable models:\n * grok-4.7 (default)\n - grok-4.7-build-fast\n - grok-4.6\n'),['grok-4.7','grok-4.7-build-fast','grok-4.6']);
 assert.deepEqual(grokModelIds('some unrelated output grok-invented'),[]);
});
