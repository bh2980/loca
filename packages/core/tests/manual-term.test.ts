import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.ts';
import {buildContext} from '../src/context.ts';

test('manual terms validate required fields and reject normalized duplicate sources atomically',()=>{
 const engine=new Engine('unused-manual-term-validation',{memory:true,autoStart:false});try{
  const before=engine.state();
  for(const body of [{source:' ',target:'번역'},{source:'word',target:' '},{source:1,target:'번역'},{source:'word',target:'번역',guidance:12}])assert.throws(()=>engine.createTerm(body as any));
  assert.throws(()=>engine.createTerm({source:'  WATCH   OFFICE ',target:'감시국'}),/이미 있습니다.*후보 추가/);
  assert.deepEqual(engine.state(),before);
  const term=engine.createTerm({source:'Unseen term',target:'보이지 않는 용어'});
  assert.deepEqual(term.unitIds,[]);assert.equal(term.status,'confirmed');
  assert.throws(()=>engine.createTerm({source:'Ｕｎｓｅｅｎ ｔｅｒｍ',target:'다른 번역'}),/이미 있습니다/);
 }finally{engine.close();}
});

test('manual terms link source matches, backfill existing translation evidence and enter relevant context',()=>{
 const engine=new Engine('unused-manual-term-matching',{memory:true,autoStart:false});try{
  engine.store.update(state=>{
   state.units.find(unit=>unit.id==='S0-01')!.source='The Courier delivered a package.';
   state.units.find(unit=>unit.id==='S3-03')!.source='Ask the COURIER.';
  });
  engine.updateUnit('S0-01',{expectedVersion:0,text:'배달원이 소포를 전달했습니다.'});
  engine.updateUnit('S3-03',{expectedVersion:0,text:'그에게 물어보세요.'});
  const before=engine.state(),term=engine.createTerm({source:' Courier ',target:' 배달원 ',guidance:' 배송 담당자 '});
  const state=engine.state(),candidate=term.candidates![0];
  assert.deepEqual(term.unitIds,['S0-01','S3-03']);assert.equal(term.source,'Courier');assert.equal(candidate.guidance,'배송 담당자');
  for(const uid of term.unitIds){assert.ok(state.units.find(unit=>unit.id===uid)!.termIds.includes(term.id));assert.equal(state.translations[uid].text,before.translations[uid].text);assert.equal(state.translations[uid].version,before.translations[uid].version);assert.equal(state.translations[uid].freshness,before.translations[uid].freshness);}
  const usage={termId:term.id,candidateId:candidate.id,candidateVersion:1,origin:'observed'};
  assert.ok(state.translations['S0-01'].termUsages!.some(item=>JSON.stringify(item)===JSON.stringify(usage)));
  assert.ok(state.translations['S0-01'].history.at(-1)!.termUsages!.some(item=>item.termId===term.id));
  assert.ok(!state.translations['S3-03'].termUsages!.some(item=>item.termId===term.id));
  const context=buildContext(state,{id:'manual-context',stage:'translate',unitIds:['S0-01'],groupId:'S0',status:'queued',attempts:0});
  assert.ok((context.terms as any[]).some(item=>item.id===term.id&&item.candidates[0].target==='배달원'));
  assert.ok(state.changes!.some(change=>change.kind==='term-created'&&change.termId===term.id));
 }finally{engine.close();}
});
