import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine.ts';

test('failed responses finish the run clock at failure, including after a pause request',async()=>{
 const engine=new Engine('unused',{memory:true,autoStart:false,demoDelayMs:20});
 try{
  (engine as any).mockResult=()=>{throw new Error('Synthetic failed response');};
  const run=engine.requestRun({kind:'translate',groupId:'S0'});
  const pending=engine.tick();engine.control(run.id,'pause');await pending;
  const saved=engine.state().runs[0],step=saved.steps[0];
  assert.equal(saved.status,'failed');assert.equal(saved.updatedAt,step.finishedAt);
  assert.ok(Date.parse(saved.updatedAt)>Date.parse(step.startedAt!));
  assert.equal(saved.steps[1].status,'queued');
 }finally{engine.close();}
});
