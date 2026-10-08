import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.ts';
import {demoFixture} from '../src/fixture.ts';
test('reimport retains edited glossary, and changed source invalidates translation and derived knowledge',async()=>{
 const engine=new Engine('test',{memory:true,autoStart:false,demoDelayMs:0});
 try {
  engine.requestRun({kind:'pipeline'});await engine.drain();
  engine.updateTerm('watch-office',{target:'관측국',expectedVersion:1});await engine.drain();
  engine.importProject(structuredClone(demoFixture));
  assert.equal(engine.state().terms.find(t=>t.id==='watch-office')?.target,'관측국');
  assert.equal(engine.state().translations['S0-01'].freshness,'current');
  assert.ok(engine.state().knowledge.length>0);
  const update=structuredClone(demoFixture);update.units.find(u=>u.id==='S0-01')!.source='The Watch Office sent us.';
  engine.importProject(update);
  assert.equal(engine.state().translations['S0-01'].freshness,'stale');
  assert.ok(engine.state().knowledge.length>0,'previous knowledge retained for audit');
  assert.equal(engine.state().knowledge.filter(k=>!k.archived).length,0);
 } finally {engine.close();}
});
