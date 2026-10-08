import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {STAGES,type ExecutionProfile,type Stage,type ReviewItem} from '@workbench/contracts';
import {Engine} from '../src/engine.ts';
import {demoFixture,demoTranslations} from '../src/fixture.ts';
import {validateOutput} from '../../providers/src/output.ts';

test('live-shaped pipeline carries graph/disclosure and isolated prior translations, reviews unresolved drafts and resolves their issues',async()=>{
 const contexts:any[]=[];const errors:string[]=[];const observed:{stage:Stage;data:unknown}[]=[];
 const server=createServer(async(req,res)=>{try{
  if(req.method==='GET'&&req.url==='/v1/models'){res.writeHead(404);res.end('{}');return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const prompt=body.messages.find((m:any)=>m.role==='user').content;
  const context=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n{')+2));contexts.push(context);
  let result:unknown;
  if(context.stage==='analyze'||context.stage==='characters')result={knowledge:[]};
  else if(context.stage==='glossary')result={terms:context.terms.flatMap((t:any)=>t.unitIds.map((unitId:string)=>({source:t.source,target:context.targets.find((u:any)=>u.id===unitId)?.currentTranslation.includes(t.target)?t.target:'',description:t.description,unitIds:[unitId]})))};
  else result={translations:context.targets.map((u:any)=>({unitId:u.id,text:context.stage==='translate'&&u.id==='U01'?'문서 열기':demoTranslations[u.id],issues:context.stage==='translate'&&u.id==='S0-01'?['기관명 사용을 검수해 주세요.']:[]}))};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]}));
 }catch(error){errors.push(String(error));res.writeHead(500);res.end('{}');}});
 const engine=new Engine('unused-context-test',{memory:true,autoStart:false,onModelResult:(stage,data)=>{observed.push({stage,data:structuredClone(data)});if((data as any).translations)(data as any).translations[0].text='observer cannot change model result';}});
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const profiles=Object.fromEntries(STAGES.map(stage=>[stage,{connectionId:'fake',model:'fake-model',effort:'',timeoutMs:3000,maxOutputTokens:3000,maxAttempts:1}])) as Record<Stage,ExecutionProfile>;
  engine.updateSettings({connections:[{id:'fake',name:'Local synthetic response',kind:'openai',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,allowUnauthenticated:true}],profiles});
  const run=engine.requestRun({kind:'pipeline'});await engine.drain();
  assert.deepEqual(errors,[]);assert.equal(engine.state().runs.find(r=>r.id===run.id)?.status,'completed');
  assert.deepEqual(contexts[0].groups,demoFixture.groups);assert.equal(contexts[0].currentGroup,null);
  const scene=(stage:Stage,id:string)=>contexts.find(c=>c.stage===stage&&c.currentGroup?.id===id);
  assert.match(scene('translate','S0').currentGroup.description,/D01/);
  assert.deepEqual(scene('translate','S0').currentGroup.nextIds,['S1A','S1B']);
  const review=scene('review','S0').targets.find((u:any)=>u.id==='S0-01');
  assert.equal(review.currentTranslation,'');assert.equal(review.pendingDraft,demoTranslations['S0-01']);assert.match(review.pendingIssues[0],/기관명/);
  const qa=scene('review','ui').targets.find((u:any)=>u.id==='U01');
  assert.equal(qa.pendingDraft,'문서 열기');assert.match(qa.pendingIssues[0],/자리표시자/);
  const branchB=scene('translate','S1B');assert.ok(branchB.previousTranslations.length>0);
  assert.ok(branchB.previousTranslations.every((u:any)=>u.branch==='common'||u.branch==='B'));
  assert.ok(!branchB.previousTranslations.some((u:any)=>u.unitId.startsWith('A-')));
  const merge=scene('translate','S2');assert.ok(merge.ancestorGroupIds.includes('S1A'));assert.ok(merge.ancestorGroupIds.includes('S1B'));
  assert.ok(merge.previousTranslations.every((u:any)=>u.branch==='common'));
  assert.ok(merge.previousTranslations.every((u:any)=>u.groupId==='S0'));
  const ui=scene('translate','ui');assert.equal(ui.previousTranslations.length,12,'context is bounded to the 12 most recent checked common units');
  assert.ok(ui.previousTranslations.every((u:any)=>u.branch==='common'&&u.translation));
  const state=engine.state();for(const uid of ['S0-01','U01']){
   assert.equal(state.translations[uid].status,'checked');assert.equal(state.reviews.find(r=>r.unitId===uid&&r.jobId===run.id)?.status,'resolved');
   assert.equal(engine.exportProject().translations.find(t=>t.unitId===uid)?.unresolved,0);
  }
  assert.equal(observed.length,18);assert.deepEqual(observed.map(item=>item.stage),state.runs.find(r=>r.id===run.id)!.steps.map(step=>step.stage));
  assert.equal(contexts.at(-1).stage,'glossary');assert.ok(contexts.at(-1).targets.every((unit:any)=>unit.currentTranslation),'final extraction receives the translated sentence pairs');
  assert.equal(state.translations['S0-02'].text,demoTranslations['S0-02'],'observer only receives a clone of structured output');
 }finally{engine.close();server.close();await once(server,'close');}
});

test('dynamic schemas reject group/invented evidence IDs and translation IDs outside the current target set',()=>{
 const engine=new Engine('unused-source-id-schema',{memory:true,autoStart:false});try{
  const state=engine.state(),step={unitIds:['S0-01']};
  const schema=(stage:Stage)=>(engine as any).schema(stage,state,step);
  const knowledge={kind:'fact',title:'근거 검증',content:'내용',evidenceIds:['S0-01'],branch:'common',visibility:'translator'};
  assert.doesNotThrow(()=>validateOutput({knowledge:[knowledge]},schema('analyze')));
  assert.throws(()=>validateOutput({knowledge:[{...knowledge,evidenceIds:['S0']}]},schema('analyze')),/스키마/);
  assert.throws(()=>validateOutput({knowledge:[{...knowledge,evidenceIds:['invented-source']}]},schema('characters')),/스키마/);
  const term={source:'Watch Office',target:'감시국',description:'기관',unitIds:['S0-01']};
  assert.doesNotThrow(()=>validateOutput({terms:[term]},schema('glossary')));
  assert.throws(()=>validateOutput({terms:[{...term,unitIds:['U02']}]},schema('glossary')),/스키마/);
  assert.throws(()=>validateOutput({terms:[{...term,unitIds:['documents']}]},schema('glossary')),/스키마/);
  assert.doesNotThrow(()=>validateOutput({translations:[{unitId:'S0-01',text:'번역',issues:[]}]},schema('translate')));
  assert.throws(()=>validateOutput({translations:[{unitId:'S0-02',text:'번역',issues:[]}]},schema('review')),/스키마/);
  const prompt=(engine as any).prompt(state,{stage:'analyze',unitIds:['S0-01']}) as string;
  assert.match(prompt,/never group IDs/);
 }finally{engine.close();}
});

test('fallback result validation names invalid source IDs briefly and escapes control characters',()=>{
 const engine=new Engine('unused-invalid-id-detail',{memory:true,autoStart:false});try{
  const state=engine.state(),run={id:'run',logs:[]},stamp={};
  const apply=(stage:Stage,data:unknown)=>(engine as any).applyResult(state,run,{stage,unitIds:['S0-01']},data,{'S0-01':0},{},stamp);
  assert.throws(()=>apply('analyze',{knowledge:[{title:'test',content:'test',evidenceIds:['S0\n\u001b[31m']}] }),(error:unknown)=>error instanceof Error&&error.message.includes('S0\\n\\u001b[31m')&&!error.message.includes('\n'));
  assert.throws(()=>apply('glossary',{terms:[{source:'test',target:'test',description:'test',unitIds:['wrong-source']}]}),/wrong-source/);
  assert.throws(()=>apply('translate',{translations:[{unitId:'other-target',text:'test',issues:[]}]}),/other-target/);
 }finally{engine.close();}
});

test('pending candidates match input and term versions, and newer human edits take precedence',()=>{
 const engine=new Engine('unused-draft-context',{memory:true,autoStart:false});try{
  const uid='S0-01';const step={id:'review-step',stage:'review',groupId:'S0',unitIds:[uid]};
  engine.store.update(s=>{s.reviews.push({id:'pending',unitId:uid,jobId:'run',kind:'semantic',status:'open',currentText:'',proposedText:'검토할 초안',reason:'의미 질문',baseVersion:0,termVersions:{'watch-office':1},createdAt:'test'});});
  const prompt=()=>{const raw=(engine as any).prompt(engine.state(),step,'run') as string;return JSON.parse(raw.slice(raw.lastIndexOf('\n\n{')+2));};
  assert.equal(prompt().targets[0].pendingDraft,'검토할 초안');
  engine.store.update(s=>{s.reviews[0].termVersions={'watch-office':999};});assert.equal(prompt().targets[0].pendingDraft,undefined);
  engine.store.update(s=>{s.reviews[0].termVersions={'watch-office':1};});
  engine.updateUnit(uid,{text:'사람이 새로 편집한 번역',expectedVersion:0});
  const target=prompt().targets[0];assert.equal(target.currentTranslation,'사람이 새로 편집한 번역');assert.equal(target.pendingDraft,undefined);assert.equal(target.pendingIssues,undefined);
 }finally{engine.close();}
});

test('successful validation only resolves matching semantic/QA reviews from the same run',()=>{
 const engine=new Engine('unused-resolution-test',{memory:true,autoStart:false});try{
  const s=engine.state(),uid='S0-01',tv={'watch-office':1};
  const base:ReviewItem={id:'base',unitId:uid,jobId:'run',kind:'semantic',status:'open',currentText:'',proposedText:'초안',reason:'질문',baseVersion:0,termVersions:tv,createdAt:'test'};
  s.reviews=[base,{...base,id:'qa',kind:'qa'},{...base,id:'locked',kind:'locked'},{...base,id:'conflict',kind:'conflict'},{...base,id:'old-version',baseVersion:5},{...base,id:'old-terms',termVersions:{'watch-office':9}},{...base,id:'other-run',jobId:'other'}];
  const step={stage:'review',unitIds:[uid]};const stamp={connectionId:'fake',connectionKind:'openai',model:'fake',effort:'',stage:'review',demo:false};
  (engine as any).applyResult(s,{id:'run',logs:[]},step,{translations:[{unitId:uid,text:demoTranslations[uid],issues:[]}]},{[uid]:0},tv,stamp);
  assert.deepEqual(s.reviews.filter(r=>r.status==='resolved').map(r=>r.id),['base','qa']);
  assert.ok(s.reviews.filter(r=>!['base','qa'].includes(r.id)).every(r=>r.status==='open'));
 }finally{engine.close();}
});
