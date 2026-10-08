import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,initialState} from '../src/engine.ts';
import {backfillTermUsages} from '../src/terms.ts';
import {buildContext} from '../src/context.ts';

test('legacy attribution migration keeps text and records only unique observed matches',()=>{
 const state=initialState(),translation=state.translations['S0-01'];translation.text='감시국에 보고하세요.';translation.version=1;translation.history=[{version:1,text:translation.text,origin:'manual',createdAt:translation.updatedAt,reason:'saved',termVersions:{'watch-office':1}}];
 backfillTermUsages(state);
 assert.equal(translation.text,'감시국에 보고하세요.');assert.deepEqual(translation.termUsages,[{termId:'watch-office',candidateId:'watch-office:default',candidateVersion:1,origin:'observed'}]);
 assert.deepEqual(translation.history[0].termUsages,translation.termUsages);
 const usage=structuredClone(translation.termUsages);state.terms.find(term=>term.id==='watch-office')!.version++;
 backfillTermUsages(state);assert.deepEqual(translation.termUsages,usage);
});

test('disabling the only candidate preserves old text and leaves its proposal unresolved',async()=>{
 const engine=new Engine('unused-candidate-empty',{memory:true,autoStart:false,demoDelayMs:0});try{
  engine.requestRun({kind:'pipeline'});await engine.drain();const before=engine.state().translations['S0-01'].text,term=engine.state().terms.find(term=>term.id==='watch-office')!;
  engine.updateTerm(term.id,{expectedVersion:term.version,candidates:term.candidates!.map(candidate=>({...candidate,enabled:false,isDefault:false}))});await engine.drain();
  const state=engine.state(),proposal=state.reviews.find(review=>review.unitId==='S0-01'&&review.status==='open')!;
  assert.equal(state.translations['S0-01'].text,before);assert.equal(state.translations['S0-01'].freshness,'stale');assert.equal(proposal.proposedText,before);assert.match(proposal.reason,/활성 대체/);
  assert.throws(()=>engine.resolveReview(proposal.id,'accept'),/미해결/);
 }finally{engine.close();}
});

test('one glossary response can append two variants to an existing term',()=>{
 const engine=new Engine('unused-candidate-append',{memory:true,autoStart:false});try{
  engine.updateUnit('S0-01',{expectedVersion:0,text:'관측국에 보고하세요.'});engine.updateUnit('S3-03',{expectedVersion:0,text:'관찰국이 그들을 없앴나요?'});
  const state=engine.state(),run=engine.requestRun({kind:'translate',stage:'glossary',unitIds:['S0-01','S3-03']}),step=run.steps[0],versions=Object.fromEntries(step.unitIds.map(uid=>[uid,state.translations[uid].version])),terms=Object.fromEntries(state.terms.map(term=>[term.id,term.version]));
  engine.store.update(current=>(engine as any).applyResult(current,run,step,{terms:[{source:'Watch Office',target:'관측국',description:'first context',unitIds:['S0-01']},{source:'Watch Office',target:'관찰국',description:'second context',unitIds:['S3-03']}]},versions,terms,{connectionId:'mock',connectionKind:'mock',model:'fixture-v1',effort:'',stage:'glossary',demo:true}));
  const term=engine.state().terms.find(term=>term.id==='watch-office')!;assert.ok(term.candidates?.some(candidate=>candidate.target==='관측국'));assert.ok(term.candidates?.some(candidate=>candidate.target==='관찰국'));assert.equal(term.target,'감시국');
 }finally{engine.close();}
});

test('task context keeps candidate choices while omitting unbounded unrelated evidence',()=>{
 const state=initialState(),term=state.terms.find(term=>term.id==='watch-office')!;term.candidates=[{id:'A',target:term.target,guidance:'usual institution',isDefault:true,enabled:true,version:1,status:'confirmed',evidence:Array.from({length:300},()=>({unitId:'D01',translationVersion:1,sourceText:'unrelated '.repeat(1000),targetText:'unrelated '.repeat(1000)}))}];
 const context=buildContext(state,{id:'context',stage:'translate',unitIds:['S0-01'],groupId:'S0',status:'queued',attempts:0});const candidate=(context.terms as any[]).find(item=>item.id===term.id).candidates[0];
 assert.equal(candidate.target,term.target);assert.equal(candidate.evidenceCount,300);assert.equal(candidate.evidence,undefined);assert.ok(JSON.stringify(context).length<50000);
});

