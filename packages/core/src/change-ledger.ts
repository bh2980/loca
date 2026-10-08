import {randomUUID} from 'node:crypto';
import type {WorkspaceState,ChangeRecord,Translation,ExecutionStamp} from '@workbench/contracts';
const compact=(t:Translation)=>({text:t.text,version:t.version,status:t.status,freshness:t.freshness,locked:t.locked,origin:t.origin,termVersions:t.termVersions,termUsages:t.termUsages,execution:t.execution,updatedAt:t.updatedAt});
export function captureChanges(s:WorkspaceState){return {translations:new Map(Object.entries(s.translations).map(([id,t])=>[id,structuredClone(compact(t))])),terms:new Map(s.terms.map(t=>[t.id,structuredClone(t)])),knowledge:new Map(s.knowledge.map(k=>[k.id,structuredClone(k)]))};}
export function appendChange(s:WorkspaceState,kind:string,unitIds:string[],before:unknown,after:unknown,refs:Partial<ChangeRecord>={}){
 const groupIds=[...new Set(unitIds.map(uid=>s.units.find(u=>u.id===uid)?.groupId).filter((id):id is string=>!!id))];
 (s.changes??=[]).unshift({id:randomUUID(),createdAt:new Date().toISOString(),kind,unitIds:[...new Set(unitIds)],groupIds,before,after,...refs});
}
const refsFor=(stamp:ExecutionStamp|undefined):Partial<ChangeRecord>=>stamp?{runId:stamp.runId,stepId:stamp.stepId,stage:stamp.stage,model:stamp.model,promptVersion:stamp.promptVersion,snapshotId:stamp.snapshotId}:{};
export function recordChanges(s:WorkspaceState,before:ReturnType<typeof captureChanges>,taskRefs:Partial<ChangeRecord>={}){
 for(const [uid,t] of Object.entries(s.translations)){
  const old=before.translations.get(uid),next=compact(t);if(JSON.stringify(old)===JSON.stringify(next))continue;
  const refs={...refsFor(t.execution),...taskRefs};
  if(t.freshness==='stale'&&old?.freshness!=='stale')appendChange(s,'translation-stale',[uid],old,next,refs);
  if(!old&&t.version===0)continue;
  if((old?.version??0)!==t.version||old?.text!==t.text)appendChange(s,t.origin==='manual'?'translation-manual':(old?.version??0)===0?'translation-created':'translation-updated',[uid],old,next,refs);
  else if(old?.locked!==t.locked)appendChange(s,'translation-lock',[uid],old,next,refs);
  else if(t.status==='checked'&&(t.updatedAt!==old?.updatedAt||old?.status!=='checked'||JSON.stringify(t.execution)!==JSON.stringify(old?.execution)))appendChange(s,'translation-reviewed',[uid],old,next,refs);
  else if(JSON.stringify(old?.termUsages)!==JSON.stringify(t.termUsages))appendChange(s,'translation-term-usage',[uid],old,next,refs);
 }
 for(const term of s.terms){const old=before.terms.get(term.id);if(JSON.stringify(old)!==JSON.stringify(term))appendChange(s,old?'term-updated':'term-created',term.unitIds,old,structuredClone(term),{termId:term.id,...taskRefs});}
 for(const k of s.knowledge){const old=before.knowledge.get(k.id);const relevant=(item:typeof k|undefined)=>item?{...item,usedUnitIds:undefined}:undefined;if(JSON.stringify(relevant(old))!==JSON.stringify(relevant(k)))appendChange(s,!old?'knowledge-created':k.archived&&!old.archived?'knowledge-archived':'knowledge-revised',[...new Set([...k.evidenceIds,...(k.usedUnitIds??[])])],old,structuredClone(k),{knowledgeId:k.id,...k.provenance,...taskRefs});}
}
