import test from 'node:test';
import assert from 'node:assert/strict';
import {STAGES,type JobStep,type KnowledgeItem,type ProjectInput,type WorkspaceState} from '@workbench/contracts';
import {Engine} from '../src/engine.ts';
import {batches,buildContext,orderedUnits} from '../src/context.ts';

const provenanceMarker='SOURCE_REF_PRIVATE_EXTRACTOR_PAYLOAD';

function graphProject(count=3):ProjectInput {
 const units=Array.from({length:count},(_,index)=>({
  id:`unit-${String(index+1).padStart(3,'0')}`,groupId:'scene',order:index+1,
  source:`Source line ${index+1}.`,speaker:'Witness',kind:'dialogue' as const,branch:'unknown',termIds:[],
  graphNodeIds:[`node-${index+1}`],sourceRef:{file:provenanceMarker,pathId:index+1,fields:{Text:`Original ${index+1}`}}
 }));
 return {
  schemaVersion:2,project:{id:'graph-context-regression',title:'Graph fixture',description:'Synthetic sources only',sourceLanguage:'en',targetLanguage:'ko'},
  groups:[{id:'scene',title:'Unresolved scene',description:'The ordering is editorial, not a proven execution path.',order:1,branch:'unknown',kind:'scene',nextIds:[],graphNodeIds:units.map((_,i)=>`node-${i+1}`),graphFlowIds:['flow-1']}],
  units,
  graph:{version:1,orderingNote:'Source order retained; conditions have not been evaluated.',
   nodes:units.map((u,i)=>({id:`node-${i+1}`,unitIds:[u.id],groupIds:['scene'],kind:'dialogue',conditions:{flag:`seen-${i}`,expected:true},metadata:{extractorOrder:i}})),
   edges:[...units.slice(1).map((_,i)=>({id:`edge-${i+1}`,from:`node-${i+1}`,to:`node-${i+2}`,kind:'conditional',direction:'forward',conditions:{flag:`choice-${i}`,equals:'left'}})),{id:'external-edge',from:`node-${count}`,externalTarget:'unresolved-external-node',kind:'external',conditions:{expression:'not yet understood'}}],
   flows:[{id:'flow-1',title:'Original extracted flow',rootIds:['node-1'],nodeIds:units.map((_,i)=>`node-${i+1}`),metadata:{executionConfirmed:false}}],metadata:{extractionVersion:2}
  },
  knowledge:[{id:'evidenced-fact',kind:'fact',title:'Witness account',content:'The account is unverified.',evidenceIds:[units[0].id],branch:'unknown',visibility:'character'}]
 };
}

function memoryEngine(){return new Engine('unused-graph-context-test',{memory:true,autoStart:false});}
function step(unitIds:string[],groupId='scene'):JobStep{return {id:'context-step',stage:'translate',groupId,unitIds,status:'queued',attempts:0};}
function fullUi(value:ReturnType<Engine['uiState']>):WorkspaceState {
 assert.ok(!('unchanged' in value),'a changed revision returns a workspace projection');
 return value;
}

test('graph import/export retains original nodes, conditions, flows, external edges and source identities',()=>{
 const engine=memoryEngine();try{
  const input=graphProject();const original=structuredClone(input);engine.importProject(input);
  assert.deepEqual(engine.state().graph,original.graph);
  assert.deepEqual(engine.exportProject().graph,original.graph);
  assert.deepEqual(engine.exportProject().units,original.units);
  assert.equal(engine.exportProject().schemaVersion,2);
  input.graph!.nodes[0].conditions={mutated:true};input.units[0].source='outside mutation';
  assert.deepEqual(engine.state().graph,original.graph,'the importer owns a clone of the graph');
  assert.equal(engine.state().units[0].source,original.units[0].source);
  const context=buildContext(engine.state(),step([original.units[0].id]));
  const graph=context.graphContext as {scope:string;nodes:{id:string;conditions:unknown}[];edges:{id:string;conditions:unknown}[]};
  assert.match(graph.scope,/not evaluated/);
  assert.deepEqual(graph.nodes.find(n=>n.id==='node-1')?.conditions,original.graph!.nodes[0].conditions);
  assert.deepEqual(graph.edges.find(e=>e.id==='edge-1')?.conditions,original.graph!.edges[0].conditions);
 }finally{engine.close();}
});

test('invalid graph references reject imports atomically, retaining manual work and the revision',()=>{
 const engine=memoryEngine();try{
  const input=graphProject();engine.importProject(input);
  engine.updateUnit(input.units[0].id,{text:'사람이 번역한 문장',expectedVersion:0});
  const before=engine.state();
  const invalidChanges:((p:ProjectInput)=>void)[]=[
   p=>{p.graph!.nodes.push(structuredClone(p.graph!.nodes[0]));},
   p=>{p.graph!.nodes[0].unitIds=['missing-unit'];},
   p=>{p.graph!.edges[0].to='missing-node';},
   p=>{p.graph!.flows[0].rootIds=['missing-root'];},
   p=>{p.units[0].graphNodeIds=['missing-unit-node'];},
   p=>{p.groups[0].graphFlowIds=['missing-flow'];}
  ];
  for(const corrupt of invalidChanges){
   const invalid=structuredClone(input);corrupt(invalid);
   assert.throws(()=>engine.importProject(invalid),/그래프 입력 오류/);
   assert.deepEqual(engine.state(),before,'validation must not partially replace any existing workspace data');
   assert.equal(engine.store.revision(),before.revision);
  }
 }finally{engine.close();}
});

test('100 unordered input units become ordered batches of at most 40 across every pipeline stage',()=>{
 const engine=memoryEngine();try{
  const input=graphProject(100);input.units.reverse();engine.importProject(input);
  // No worker is started and no tick/drain is called. This connection is never invoked.
  const profiles=engine.state().profiles;
  for(const stage of STAGES)profiles[stage]={...profiles[stage],connectionId:'uninvoked',model:'synthetic-model'};
  engine.updateSettings({connections:[{id:'uninvoked',kind:'openai',name:'Never invoked',baseUrl:'http://127.0.0.1:9/v1',allowUnauthenticated:true}],profiles});
  const run=engine.requestRun({kind:'pipeline'});
  const ids=orderedUnits(engine.state()).map(u=>u.id);
  for(const stage of ['analyze','glossary','characters','translate','review'] as const){
   const selected=run.steps.filter(s=>s.stage===stage);
   const passes=stage==='glossary'?2:1;
   assert.deepEqual(selected.map(s=>s.unitIds.length),Array.from({length:passes},()=>[40,40,20]).flat());
   assert.deepEqual(selected.flatMap(s=>s.unitIds),Array.from({length:passes},()=>ids).flat(),'each source identity occurs once in source order within each pass');
   assert.deepEqual(selected.map(s=>s.batchIndex),Array.from({length:passes},()=>[0,1,2]).flat());
   assert.ok(selected.every(s=>s.batchCount===3&&s.status==='queued'&&s.attempts===0));
   if(stage==='translate'||stage==='review')assert.ok(selected.every(s=>s.groupId==='scene'));
  }
  assert.equal(run.steps.length,18);
  assert.deepEqual(run.steps.filter(s=>s.stage==='translate'||s.stage==='review').map(s=>[s.stage,s.batchIndex]),[['translate',0],['review',0],['translate',1],['review',1],['translate',2],['review',2]]);
  const first=run.steps[0],context=buildContext(engine.state(),first);
  assert.deepEqual(context.coverage,{batchIndex:0,batchCount:3,targetUnits:40,totalProjectUnits:100,omittedGroups:0,omittedKnowledge:0});
  assert.equal((context.translatorReference as unknown[]).length,40,'large projects do not repeat every source in every prompt');
 }finally{engine.close();}
});

test('character budget splits long source batches while retaining oversized units and IDs intact',()=>{
 const units=graphProject(4).units;units[0].source='a'.repeat(8000);units[1].source='b'.repeat(8000);units[2].source='c'.repeat(15000);
 const chunks=batches(units);
 assert.deepEqual(chunks.map(c=>c.length),[1,1,1,1]);
 assert.deepEqual(chunks.flat().map(u=>u.id),units.map(u=>u.id));
 assert.equal(chunks[2][0],units[2],'an oversized source is never silently truncated or assigned a replacement identity');
});

test('source extraction payload stays in the export but is excluded from every prompt source view and the UI projection',()=>{
 const engine=memoryEngine();try{
  const input=graphProject();input.groups[0].branch='common';for(const unit of input.units)unit.branch='common';
  engine.importProject(input);const state=engine.state();
  for(const stage of STAGES){
   const target={...step([input.units[0].id]),stage};
   const context=buildContext(state,target);
   assert.ok(!JSON.stringify(context).includes(provenanceMarker),`${stage} context excludes raw extractor data`);
   const prompt=(engine as unknown as {prompt:(s:WorkspaceState,j:JobStep)=>string}).prompt(state,target);
   assert.ok(!prompt.includes(provenanceMarker),`${stage} serialized prompt excludes raw extractor data`);
   for(const key of ['targets','sceneContext','translatorReference']){
    const units=context[key] as Record<string,unknown>[];
    assert.ok(units.length>0);assert.ok(units.every(u=>!Object.hasOwn(u,'sourceRef')));
   }
  }
  const ui=fullUi(engine.uiState());
  assert.ok(!Object.hasOwn(ui,'graph'));assert.ok(ui.units.every(u=>!Object.hasOwn(u,'sourceRef')));
  assert.deepEqual(ui.graphSummary,{nodes:3,edges:3,flows:1,unknownGroups:0,orderingNote:input.graph!.orderingNote});
  assert.ok(JSON.stringify(engine.exportProject()).includes(provenanceMarker));
  assert.deepEqual(engine.state(),state,'building prompts and UI projections must not mutate canonical state');
 }finally{engine.close();}
});

test('unknown scopes do not share character memories or earlier translations merely because both are unknown',()=>{
 const engine=memoryEngine();try{
  const input=graphProject(5);delete input.graph;
  const groupSpecs=[['common',0,'common'],['foreign',1,'unknown'],['current',2,'unknown']] as const;
  input.groups=groupSpecs.map(([id,order,branch])=>({id,title:id,description:'',order,branch,kind:'scene',nextIds:[]}));
  input.units.forEach((u,i)=>{u.groupId=i===0?'common':i===1?'foreign':'current';u.branch=i===0?'common':'unknown';delete u.graphNodeIds;});
  const [common,foreign,local,target,future]=input.units;
  const knowledge=(id:string,evidence:string,visibility:KnowledgeItem['visibility']='character',branch='unknown'):KnowledgeItem=>({id,kind:'fact',title:id,content:id,evidenceIds:[evidence],branch,visibility});
  input.knowledge=[knowledge('shared-common',common.id,'character','common'),knowledge('foreign-character',foreign.id),knowledge('foreign-player',foreign.id,'player'),knowledge('local-character',local.id),knowledge('translator-future',foreign.id,'translator')];
  engine.importProject(input);
  engine.store.update(s=>{for(const unit of s.units){Object.assign(s.translations[unit.id],{text:`번역 ${unit.id}`,status:'checked',freshness:'current'});}});
  const context=buildContext(engine.state(),step([target.id],'current'));
  assert.deepEqual((context.previousTranslations as {unitId:string}[]).map(u=>u.unitId),[common.id,local.id]);
  assert.ok(!(context.previousTranslations as {unitId:string}[]).some(u=>[foreign.id,target.id,future.id].includes(u.unitId)));
  const memories=context.knowledge as KnowledgeItem[];
  assert.deepEqual(memories.map(k=>k.id).sort(),['local-character','shared-common','translator-future']);
  assert.equal(memories.find(k=>k.id==='translator-future')?.visibility,'translator','future knowledge stays explicitly translator-only');
  assert.match(String(context.sourceConstraint),/Unknown conditions are not satisfied facts/);
 }finally{engine.close();}
});

test('changed graph, group or dialogue context preserves human text but invalidates derived context and open proposals',()=>{
 const changes:{name:string;apply:(p:ProjectInput)=>void}[]=[
  {name:'graph condition',apply:p=>{p.graph!.edges[0].conditions={newCondition:true};}},
  {name:'group branch',apply:p=>{p.groups[0].branch='verified-route';}},
  {name:'dialogue context',apply:p=>{p.units[0].contextNotes=['The speaker is concealing their identity.'];}}
 ];
 for(const change of changes){
  const engine=memoryEngine();try{
   const input=graphProject();engine.importProject(input);const uid=input.units[0].id;
   engine.updateUnit(uid,{text:'직접 번역한 문장',expectedVersion:0});
   engine.store.update(s=>{s.reviews.push({id:'old-proposal',unitId:uid,jobId:'old-run',kind:'semantic',status:'open',currentText:'직접 번역한 문장',proposedText:'예전 문맥에 기반한 제안',reason:'이전 문맥',baseVersion:1,termVersions:{},createdAt:'2026-01-01T00:00:00Z'});});
   engine.importProject(structuredClone(input));
   const unchanged=engine.state();assert.equal(unchanged.knowledge.length,1);assert.equal(unchanged.translations[uid].freshness,'current');assert.equal(unchanged.reviews[0].status,'open');
   const edited=structuredClone(input);change.apply(edited);engine.importProject(edited);
   const after=engine.state();const beforeTranslation=unchanged.translations[uid];
   assert.deepEqual(after.translations[uid],{...beforeTranslation,freshness:'stale'},`${change.name} preserves text, version, lock and edit history`);
   assert.deepEqual(after.knowledge.filter(k=>!k.archived),[],`${change.name} requires fresh derived knowledge`);
   assert.deepEqual(after.knowledge.map(({archived:_archived,...k})=>k),unchanged.knowledge,`${change.name} retains the prior evidence archive`);
   assert.equal(after.reviews[0].status,'dismissed',`${change.name} discards obsolete proposals`);
   assert.equal(after.units[0].source,input.units[0].source,'source text itself was not edited');
  }finally{engine.close();}
 }
});

test('unchanged UI revisions are compact, mutations invalidate the cursor, and idle ticks do not create revisions',async()=>{
 const engine=memoryEngine();try{
  const input=graphProject();engine.importProject(input);const first=fullUi(engine.uiState());
  assert.deepEqual(engine.uiState(first.revision),{unchanged:true,revision:first.revision});
  await engine.tick();await engine.tick();
  assert.equal(engine.store.revision(),first.revision,'idle polling must not write new revisions');
  assert.deepEqual(engine.uiState(first.revision),{unchanged:true,revision:first.revision});
  engine.updateUnit(input.units[0].id,{text:'UI에서 저장한 번역',expectedVersion:0});
  const next=fullUi(engine.uiState(first.revision));
  assert.ok(next.revision>first.revision);assert.equal(next.translations[input.units[0].id].text,'UI에서 저장한 번역');
  assert.deepEqual(engine.uiState(next.revision),{unchanged:true,revision:next.revision});
  assert.deepEqual(engine.state().graph,input.graph);assert.ok(engine.state().units[0].sourceRef);
 }finally{engine.close();}
});
