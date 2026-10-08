import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {isDeepStrictEqual,promisify} from 'node:util';
import {isAbsolute,relative,resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Engine} from '@workbench/core';
import {STAGES,type Connection,type ExecutionProfile,type ExecutionStamp,type Run,type Stage,type WorkspaceState} from '@workbench/contracts';
import {inspectAuth,listModels,resolveCli} from '@workbench/providers';
import {validateTranslation} from '../packages/core/src/validation.ts';

const USAGE='Usage: npm exec tsx scripts/live-smoke.ts -- --live (--model MODEL | --profiles FILE) [--out artifacts/DIRECTORY] [--resume] [--restart-after-step N]';
type Profiles=Record<Stage,ExecutionProfile>;
export interface Options {model?:string;profiles?:string;out?:string;resume:boolean;restartAfterStep?:number}
interface Check {name:string;ok:boolean;category:'harness'|'mechanical-output';detail?:unknown}

export function parseOptions(input:string[]):Options {
 const args=input[0]==='--'?input.slice(1):input,values=new Map<string,string|true>();
 const flags=new Set(['--live','--resume']),options=new Set(['--model','--profiles','--out','--restart-after-step']);
 for(let i=0;i<args.length;i++){
  const name=args[i];
  if(!flags.has(name)&&!options.has(name))throw new Error(`Unknown option: ${name}. ${USAGE}`);
  if(values.has(name))throw new Error(`Duplicate option: ${name}`);
  if(flags.has(name)){values.set(name,true);continue;}
  const value=args[++i];if(!value?.trim()||value.startsWith('--'))throw new Error(`A value is required for ${name}.`);
  values.set(name,value);
 }
 if(!values.has('--live')||values.has('--model')===values.has('--profiles'))throw new Error(USAGE);
 const raw=values.get('--restart-after-step');
 if(raw!==undefined&&(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1))throw new Error('--restart-after-step must be a positive integer.');
 if(values.has('--resume')&&!values.has('--out'))throw new Error('--resume requires an explicit --out directory.');
 return {model:values.get('--model') as string|undefined,profiles:values.get('--profiles') as string|undefined,out:values.get('--out') as string|undefined,resume:values.has('--resume'),restartAfterStep:raw===undefined?undefined:Number(raw)};
}

/** Complete stage -> {model, effort, optional ExecutionProfile fields} map. */
export function parseProfiles(input:unknown):Profiles {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Profiles must be an object keyed by stage.');
 const rows=input as Record<string,unknown>,allowed=new Set(['connectionId','model','effort','timeoutMs','maxOutputTokens','maxAttempts']);
 if(Object.keys(rows).some(key=>!STAGES.includes(key as Stage)))throw new Error('Profiles contain an unknown stage.');
 return Object.fromEntries(STAGES.map(stage=>{
  const raw=rows[stage];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`Missing profile: ${stage}`);
  const row=raw as Record<string,unknown>;
  if(Object.keys(row).some(key=>!allowed.has(key)))throw new Error(`Unknown profile field in ${stage}.`);
  if(typeof row.model!=='string'||!row.model.trim()||typeof row.effort!=='string')throw new Error(`${stage} needs model and effort strings.`);
  const p={connectionId:'codex',timeoutMs:180000,maxOutputTokens:6000,maxAttempts:1,...row,model:row.model.trim(),effort:row.effort.trim()} as ExecutionProfile;
  if(typeof p.connectionId!=='string'||!p.connectionId.trim())throw new Error(`${stage}: invalid connectionId.`);
  for(const [key,min,max] of [['timeoutMs',1000,1800000],['maxOutputTokens',100,100000],['maxAttempts',1,3]] as const)if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw new Error(`${stage}.${key} must be an integer between ${min} and ${max}.`);
  return [stage,p];
 })) as Profiles;
}

export function stampMatches(stamp:ExecutionStamp|undefined,p:ExecutionProfile,stage:Stage,kind:Connection['kind']='codex') {
 return !!stamp&&!stamp.demo&&stamp.connectionKind===kind&&stamp.stage===stage&&stamp.connectionId===p.connectionId&&stamp.model===p.model&&stamp.effort===p.effort;
}

export function assessment(state:WorkspaceState){
 const translations=Object.values(state.translations),open=state.reviews.filter(r=>r.status==='open');
 const mechanicalIssues=state.units.flatMap(u=>{
  const t=state.translations[u.id];
  return [...(t?.text.trim()?validateTranslation(u.source,t.text).map(q=>({unitId:u.id,location:'saved',...q})):[]),
   ...open.filter(r=>r.unitId===u.id).flatMap(r=>validateTranslation(u.source,r.proposedText).map(q=>({unitId:u.id,location:`review:${r.id}`,...q})))];
 });
 return {units:state.units.length,nonempty:translations.filter(t=>t.text.trim()).length,checked:translations.filter(t=>t.status==='checked').length,
  stale:translations.filter(t=>t.freshness==='stale').length,openReviews:open.length,semanticReviews:open.filter(r=>r.kind==='semantic').length,
  origins:[...new Set(translations.filter(t=>t.text).map(t=>t.origin))],mechanicalIssues,
  missingUnits:state.units.filter(u=>!state.translations[u.id]?.text.trim()&&!open.some(r=>r.unitId===u.id&&r.proposedText.trim())).map(u=>u.id),
  proposalOnlyUnits:state.units.filter(u=>!state.translations[u.id]?.text.trim()&&open.some(r=>r.unitId===u.id&&r.proposedText.trim())).map(u=>u.id),
  knowledgeCount:state.knowledge.length,termCount:state.terms.length};
}

export function executionEvidence(state:WorkspaceState,profiles:Profiles){
 const rows:{location:string;unitId:string;requested:{connectionId:string;model:string;effort:string;stage:Stage};reported:{model:string|null;effort:string|null};matchesRequested:boolean}[]=[];
 const add=(location:string,unitId:string,s?:ExecutionStamp)=>{
  if(!s)return;const kind=state.connections.find(c=>c.id===profiles[s.stage].connectionId)?.kind;
  rows.push({location,unitId,requested:{connectionId:s.connectionId,model:s.model,effort:s.effort,stage:s.stage},reported:{model:s.reportedModel??null,effort:s.reportedEffort??null},matchesRequested:!!kind&&stampMatches(s,profiles[s.stage],s.stage,kind)});
 };
 for(const t of Object.values(state.translations)){add('current',t.unitId,t.execution);for(const h of t.history)add(`history:${h.version}`,t.unitId,h.execution);}
 for(const r of state.reviews)add(`review:${r.id}:${r.status}`,r.unitId,r.execution);
 return rows;
}

/** Parse only the public model IDs, never account labels or credentials. */
export function grokModelIds(output:string){
 const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
 return [...clean.matchAll(/^\s*[*-]\s+(grok-[A-Za-z0-9._-]+)(?:\s|$)/gm)].map(match=>match[1]);
}
function sourceIdentity(s:WorkspaceState){return s.units.map(({id,source,groupId,order,branch,kind,speaker})=>({id,source,groupId,order,branch,kind,speaker}));}
function resultSnapshot(s:WorkspaceState){return {units:s.units,groups:s.groups,translations:s.translations,knowledge:s.knowledge,terms:s.terms,reviews:s.reviews};}
function within(parent:string,child:string){const path=relative(parent,child);return !!path&&path!=='..'&&!path.startsWith(`..${sep}`)&&!isAbsolute(path);}

export async function main(args=process.argv.slice(2)){
 const options=parseOptions(args),root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const profiles=options.profiles?parseProfiles(JSON.parse(await readFile(resolve(root,options.profiles),'utf8'))):parseProfiles(Object.fromEntries(STAGES.map(stage=>[stage,{model:options.model,effort:'medium'}])));
 const artifacts=join(root,'artifacts'),out=resolve(root,options.out??join('artifacts',`live-smoke-${new Date().toISOString().replace(/[:.]/g,'-')}`));
 if(!within(artifacts,out))throw new Error('Live verification output must be under this workbench artifacts directory.');
 await mkdir(out,{recursive:true});
 if(!within(await realpath(artifacts),await realpath(out)))throw new Error('The output directory resolves outside artifacts.');
 const checks=new Map<string,Check>();
 const check=(name:string,ok:boolean,detail?:unknown,category:Check['category']='harness')=>{
  checks.set(name,{name,ok,category,...(detail===undefined?{}:{detail})});
  if(!ok)console.error(JSON.stringify({event:'assertion-failed',name,category,detail}));
 };
 let responseNumber=0,engine:Engine,restarted=false;
 let restartEvidence:{runId:string;completedSteps:{id:string;stage:Stage;attempts:number}[];recoveredStatus:string}|undefined;
 const openEngine=()=>new Engine(join(out,'data'),{autoStart:false,onModelResult:(stage,data)=>{
  const run=engine.state().runs.find(r=>r.steps.some(s=>s.status==='running')),step=run?.steps.find(s=>s.status==='running');
  writeFileSync(join(out,`response-${Date.now()}-${++responseNumber}-${stage}.json`),JSON.stringify({stage,runId:run?.id,stepId:step?.id,requestedProfile:run?.profiles[stage],data},null,2),'utf8');
 }});
 engine=openEngine();
 const startedAt=new Date().toISOString(),initial=engine.state(),baseline=sourceIdentity(initial);
 const matches=(s:ExecutionStamp|undefined,stage:Stage)=>stampMatches(s,profiles[stage],stage,initial.connections.find(c=>c.id===profiles[stage].connectionId)!.kind);

 async function capture(name:string){
  const state=engine.state(),verification={ok:[...checks.values()].every(c=>c.ok),checks:[...checks.values()],restart:{requestedAfterStep:options.restartAfterStep??null,performed:restarted,evidence:restartEvidence}};
  const report={requestedProfiles:profiles,startedAt,capturedAt:new Date().toISOString(),assessment:assessment(state),verification,
   stageExecutions:state.runs.flatMap(run=>run.steps.map(step=>({runId:run.id,stepId:step.id,stage:step.stage,groupId:step.groupId,status:step.status,attempts:step.attempts,requestedProfile:run.profiles[step.stage],profileMatches:isDeepStrictEqual(run.profiles[step.stage],profiles[step.stage])}))),
   executionEvidence:executionEvidence(state,profiles),reportedMetadataNote:'Requested fields record configuration; null reported fields mean the CLI did not report that metadata. Analysis/glossary/character artifacts have no execution stamps: their completed run steps and response files are the available evidence.',
   runs:state.runs,reviews:state.reviews,translations:state.translations,exported:engine.exportProject()};
  await writeFile(join(out,`${name}.json`),JSON.stringify(report,null,2));
  await writeFile(join(out,`${name}.txt`),state.units.map(u=>`${u.groupId} / ${u.id} / ${u.speaker??''}\nEN: ${u.source}\nKO: ${state.translations[u.id]?.text??''}\n${state.reviews.filter(r=>r.unitId===u.id&&r.status==='open').map(r=>`PROPOSAL (${r.kind}): ${r.proposedText}\nREASON: ${r.reason}`).join('\n')}\n`).join('\n'),'utf8');
  return state;
 }

 async function execute(run:Run){
  while(true){
   const current=engine.state().runs.find(r=>r.id===run.id)!;
   if(!['queued','running'].includes(current.status))return current;
   const step=current.steps.find(s=>s.status==='queued');
   console.log(JSON.stringify({event:'step-start',number:current.steps.filter(s=>s.status==='completed').length+1,total:current.steps.length,stage:step?.stage,group:step?.groupId,requestedProfile:step?current.profiles[step.stage]:undefined}));
   await engine.tick();
   const state=engine.state(),latest=state.runs.find(r=>r.id===run.id)!,done=step&&latest.steps.find(s=>s.id===step.id);
   if(done?.status==='completed'){
    check(`step:${done.id}:profile`,isDeepStrictEqual(latest.profiles[done.stage],profiles[done.stage]));
    if(['translate','review','recheck'].includes(done.stage))for(const uid of done.unitIds){
     const t=state.translations[uid],saved=!!t?.text.trim()&&matches(t.execution,done.stage);
     const proposal=state.reviews.some(r=>r.jobId===run.id&&r.unitId===uid&&r.proposedText.trim()&&matches(r.execution,done.stage));
     check(`step:${done.id}:${uid}:preserved`,saved||proposal,{saved,proposal,stage:done.stage});
    }
   }
   const completed=latest.steps.filter(s=>s.status==='completed');
   if(run.kind==='pipeline'&&!restarted&&options.restartAfterStep===completed.length&&['queued','running'].includes(latest.status)){
    engine.control(run.id,'pause');
    const before=engine.state(),beforeRun=before.runs.find(r=>r.id===run.id)!;
    await capture('before-restart');engine.close();engine=openEngine();
    const recovered=engine.state(),recoveredRun=recovered.runs.find(r=>r.id===run.id)!;
    check('restart:paused-state',recoveredRun.status==='paused');
    check('restart:completed-steps-unchanged',isDeepStrictEqual(beforeRun.steps,recoveredRun.steps));
    check('restart:results-unchanged',isDeepStrictEqual(resultSnapshot(before),resultSnapshot(recovered)));
    check('restart:profiles-unchanged',isDeepStrictEqual(beforeRun.profiles,recoveredRun.profiles));
    restartEvidence={runId:run.id,completedSteps:completed.map(s=>({id:s.id,stage:s.stage,attempts:s.attempts})),recoveredStatus:recoveredRun.status};
    restarted=true;engine.control(run.id,'resume');await capture('after-restart');
    console.log(JSON.stringify({event:'restart-resumed',afterStep:completed.length,runId:run.id}));
   }
   await capture('progress');
   console.log(JSON.stringify({event:'step-end',status:latest.status,completed:completed.length,error:latest.error}));
  }
 }

 function validateState(phase:string,state:WorkspaceState){
  const summary=assessment(state),evidence=executionEvidence(state,profiles);
  check(`${phase}:source-identity`,isDeepStrictEqual(sourceIdentity(state),baseline));
  check(`${phase}:translation-ids`,isDeepStrictEqual(Object.keys(state.translations).sort(),baseline.map(u=>u.id).sort()));
  check(`${phase}:no-missing-output`,summary.missingUnits.length===0,summary.missingUnits);
  check(`${phase}:mechanical-output`,summary.mechanicalIssues.length===0,summary.mechanicalIssues,'mechanical-output');
  check(`${phase}:execution-stamps`,evidence.every(row=>row.matchesRequested),evidence.filter(row=>!row.matchesRequested));
  check(`${phase}:no-mock-output`,Object.values(state.translations).every(t=>(!t.text||t.origin!=='demo')&&t.history.every(h=>h.origin!=='demo')));
  check(`${phase}:ai-history-stamped`,Object.values(state.translations).every(t=>t.history.every(h=>h.origin!=='ai'||!!h.execution)));
  const exported=engine.exportProject();
  check(`${phase}:export-source-mapping`,exported.translations.length===baseline.length&&exported.translations.every(t=>baseline.some(u=>u.id===t.unitId&&u.source===t.source)));
  check(`${phase}:semantic-proposals-preserved`,state.reviews.filter(r=>r.status==='open'&&r.kind==='semantic').every(r=>!!r.proposedText.trim()&&!!r.reason.trim()&&!!r.execution));
 }

 try{
  const existing=initial.runs.find(r=>r.kind==='pipeline');
  if(existing&&(!options.resume||!['paused','failed'].includes(existing.status)))throw new Error('Existing output requires --resume and a failed/paused pipeline. Choose a fresh directory otherwise.');
  if(!existing&&options.resume)throw new Error('No pipeline exists to resume.');
  if(existing&&!isDeepStrictEqual(existing.profiles,profiles))throw new Error('Resume profiles must exactly match the saved run snapshot.');
  if(initial.runs.some(r=>r.kind!=='pipeline'&&['queued','running','paused'].includes(r.status)))throw new Error('This directory contains another unfinished run.');
  if(options.restartAfterStep&&existing&&existing.steps.filter(s=>s.status==='completed').length>=options.restartAfterStep)throw new Error('Restart boundary already passed; omit --restart-after-step when resuming.');
  for(const cid of new Set(STAGES.map(stage=>profiles[stage].connectionId))){
   const c=initial.connections.find(c=>c.id===cid);
   if(!c||!['codex','grok'].includes(c.kind))throw new Error(`This live verifier supports Codex and Grok connections only: ${cid}`);
   let catalog:{id:string;efforts:string[]}[];
   if(c.kind==='codex'){
    if((await inspectAuth(c)).state!=='signed-in')throw new Error(`Existing sign-in required for ${cid}. This script never starts login.`);
    catalog=(await listModels(c)).models;
   }else{
    const cli=await resolveCli(c);
    let stdout:string;try{({stdout}=await promisify(execFile)(cli.executable,[...cli.prefixArgs,'models'],{cwd:out,timeout:15000,windowsHide:true,maxBuffer:262144}));}catch{throw new Error('Grok models preflight failed. Check the existing CLI sign-in.');}
    if(!/You are logged in with grok\.com\./i.test(stdout))throw new Error('Grok models did not confirm an existing grok.com sign-in.');
    catalog=grokModelIds(stdout).map(id=>({id,efforts:[]}));
   }
   for(const stage of STAGES.filter(s=>profiles[s].connectionId===cid)){
    const p=profiles[stage];
    if(!catalog.some(m=>m.id===p.model&&(!p.effort||m.efforts.includes(p.effort))))throw new Error(`${stage}: ${p.model}/${p.effort||'(CLI default)'} is not advertised by this installed CLI.`);
   }
  }
  console.log(JSON.stringify({event:'live-validation-start',requestedProfiles:profiles,out,units:initial.units.length,restartAfterStep:options.restartAfterStep}));
  let run:Run;
  if(existing)run=engine.control(existing.id,'resume');
  else{
   engine.updateSettings({connections:initial.connections,profiles});
   engine.store.update(s=>{s.project.description='실제 모델 연결을 검증하는 가상 원문 22개. 모의 번역은 사용하지 않습니다.';});
   run=engine.requestRun({kind:'pipeline'});
  }
  if(options.restartAfterStep&&options.restartAfterStep>=run.steps.length)throw new Error('--restart-after-step must precede the final pipeline step.');
  check('pipeline:all-profile-snapshots',isDeepStrictEqual(run.profiles,profiles));
  const result=await execute(run),state=engine.state();
  check('pipeline:completed',result.status==='completed',{status:result.status,error:result.error});
  check('pipeline:all-steps-completed',result.steps.every(s=>s.status==='completed'));
  if(options.restartAfterStep)check('restart:performed',restarted);
  if(restartEvidence)check('restart:completed-steps-not-repeated',restartEvidence.completedSteps.every(s=>result.steps.some(a=>a.id===s.id&&a.attempts===s.attempts&&a.status==='completed')));
  validateState('pipeline',state);await capture('pipeline');
  console.log(JSON.stringify({event:'pipeline-result',status:result.status,...assessment(state),usage:result.usage}));
  if(result.status==='completed'){
   const term=state.terms.find(t=>t.id==='watch-office');if(!term)throw new Error('The sample watch-office term was lost.');
   const uid=term.unitIds.find(id=>id==='S0-01'&&state.translations[id]?.text.trim())??term.unitIds.find(id=>state.translations[id]?.text.trim());
   check('recheck:lock-target-available',!!uid);
   if(uid){
    const first=state.translations[uid];engine.updateUnit(uid,{text:first.text,expectedVersion:first.version});
    const before=engine.state(),lockedBefore=before.translations[uid],target=term.target==='관측국'?'관찰국':'관측국';
    const affected=before.units.filter(u=>term.unitIds.includes(u.id)&&before.translations[u.id].text).map(u=>u.id).sort();
    engine.updateTerm(term.id,{target,expectedVersion:term.version});
    const queued=engine.state(),recheck=queued.runs.find(r=>r.kind==='recheck');
    check('recheck:queued',!!recheck&&recheck.status==='queued');
    check('recheck:exact-use-sites',isDeepStrictEqual(recheck?.steps.flatMap(s=>s.unitIds).sort(),affected));
    check('recheck:marked-stale',affected.every(id=>queued.translations[id].freshness==='stale'));
    check('recheck:profiles-snapshot',isDeepStrictEqual(recheck?.profiles,profiles));
    if(recheck){
     const rechecked=await execute(recheck),after=engine.state(),locked=after.translations[uid];
     check('recheck:completed',rechecked.status==='completed',{status:rechecked.status,error:rechecked.error});
     check('recheck:locked-text-and-version-preserved',locked.locked&&locked.text===lockedBefore.text&&locked.version===lockedBefore.version);
     check('recheck:unrelated-translations-unchanged',before.units.filter(u=>!affected.includes(u.id)).every(u=>isDeepStrictEqual(before.translations[u.id],after.translations[u.id])));
     for(const id of affected){
      const t=after.translations[id],saved=t.freshness==='current'&&t.termVersions[term.id]===term.version+1&&matches(t.execution,'recheck');
      const proposal=after.reviews.some(r=>r.jobId===recheck.id&&r.unitId===id&&r.status==='open'&&r.proposedText.trim()&&r.termVersions[term.id]===term.version+1&&matches(r.execution,'recheck'));
      check(`recheck:${id}:current-or-preserved-proposal`,saved||proposal,{saved,proposal,freshness:t.freshness});
     }
     validateState('recheck',after);await capture('recheck');
     console.log(JSON.stringify({event:'recheck-result',status:rechecked.status,...assessment(after),lockedUnitId:uid,lockedTextPreserved:locked.text===lockedBefore.text&&locked.locked,usage:rechecked.usage}));
    }
   }
  }
 }catch(error){check('runner:completed-without-exception',false,error instanceof Error?error.message:String(error));}
 finally{try{await capture('final');}finally{engine.close();}}
 const failed=[...checks.values()].filter(c=>!c.ok);
 console.log(JSON.stringify({event:'live-validation-finished',ok:failed.length===0,failedChecks:failed,out}));
 if(failed.length)process.exitCode=1;
}

// Importing from tests is inert. Only this explicit command consumes CLI quota.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
