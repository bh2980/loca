import {legacyTermCandidateId,type Term,type TermCandidate,type TermUsage,type WorkspaceState} from '@workbench/contracts';

/** Legacy terms keep a stable virtual candidate until they acquire alternatives. */
export function termCandidates(term:Term):TermCandidate[]{
 return term.candidates??[{id:legacyTermCandidateId(term.id),target:term.target,guidance:term.description,isDefault:true,enabled:true,version:term.version,status:term.status}];
}
export const activeCandidates=(term:Term)=>termCandidates(term).filter(candidate=>candidate.enabled&&candidate.target.trim());
export function deriveTermTarget(term:Term){term.target=activeCandidates(term).find(candidate=>candidate.isDefault)?.target??activeCandidates(term)[0]?.target??'';}
export function containsTerm(text:string,value:string){return !!value.trim()&&text.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase());}
/** Only unique literal matches are evidence; identical alternatives remain ambiguous. */
export function observedTermUsages(state:WorkspaceState,unitId:string,text:string):TermUsage[]{
 return state.terms.filter(term=>term.unitIds.includes(unitId)).flatMap(term=>{
  const matches=termCandidates(term).filter(candidate=>containsTerm(text,candidate.target));
  return matches.length===1?[{termId:term.id,candidateId:matches[0].id,candidateVersion:matches[0].version,origin:'observed' as const}]:[];
 });
}
export function backfillTermUsages(state:WorkspaceState,termId?:string){
 for(const translation of Object.values(state.translations)){
  if(!translation.text)continue;
  if(translation.termUsages===undefined)translation.termUsages=observedTermUsages(state,translation.unitId,translation.text);
  else if(termId&&!translation.termUsages.some(usage=>usage.termId===termId))translation.termUsages.push(...observedTermUsages(state,translation.unitId,translation.text).filter(usage=>usage.termId===termId));
  const current=translation.history.find(version=>version.version===translation.version);
  if(current&&current.termUsages===undefined)current.termUsages=structuredClone(translation.termUsages);
  else if(current&&termId&&!current.termUsages?.some(usage=>usage.termId===termId))current.termUsages?.push(...translation.termUsages.filter(usage=>usage.termId===termId).map(usage=>({...usage})));
 }
}
export function usageIsCurrent(state:WorkspaceState,usage:TermUsage){
 const term=state.terms.find(term=>term.id===usage.termId),candidate=term&&termCandidates(term).find(candidate=>candidate.id===usage.candidateId);
 return !!candidate&&candidate.enabled&&!!candidate.target.trim()&&candidate.version===usage.candidateVersion;
}
export function termInputsCurrent(state:WorkspaceState,unitId:string,versions:Record<string,number>,usages?:TermUsage[]){
 if(usages?.some(usage=>!usageIsCurrent(state,usage)))return false;
 // Candidate terms are governed by the variants actually used, not their container version.
 return state.terms.filter(term=>term.unitIds.includes(unitId)&&!term.candidates).every(term=>versions[term.id]===term.version);
}
export function modelTermUsages(state:WorkspaceState,unitId:string,text:string,raw:unknown):TermUsage[]{
 if(raw!==undefined&&!Array.isArray(raw))throw new Error('용어 후보 사용 기록은 배열이어야 합니다.');
 const usages:TermUsage[]=[],seen=new Set<string>();
 for(const value of (raw??[]) as any[]){
  if(!value||typeof value.termId!=='string'||typeof value.candidateId!=='string'||!Number.isInteger(value.candidateVersion))throw new Error('용어 후보 사용 기록의 ID·버전 형식 오류');
  const term=state.terms.find(term=>term.id===value.termId&&term.unitIds.includes(unitId)),candidate=term&&activeCandidates(term).find(candidate=>candidate.id===value.candidateId);
  if(!candidate||candidate.version!==value.candidateVersion||!containsTerm(text,candidate.target))throw new Error(`용어 후보 사용 근거가 없습니다: ${value.candidateId}`);
  const key=`${value.termId}\u0000${value.candidateId}`;if(seen.has(key))throw new Error('용어 후보 사용 기록이 중복되었습니다.');seen.add(key);
  usages.push({termId:term!.id,candidateId:candidate.id,candidateVersion:candidate.version,origin:'model'});
 }
 for(const term of state.terms.filter(term=>term.unitIds.includes(unitId))){
  const matching=activeCandidates(term).filter(candidate=>containsTerm(text,candidate.target));
  if(term.candidates&&activeCandidates(term).length>1&&matching.length&&!usages.some(usage=>usage.termId===term.id))throw new Error(`복수 용어 후보의 사용 기록이 필요합니다: ${term.id}`);
 }
 for(const usage of observedTermUsages(state,unitId,text))if(!usages.some(item=>item.termId===usage.termId))usages.push(usage);
 return usages;
}
export function validateTermCandidates(term:Term){
 if(term.candidates===undefined)return;
 if(!Array.isArray(term.candidates))throw new Error('용어 후보는 배열이어야 합니다.');
 const ids=new Set<string>();let defaults=0;
 for(const candidate of term.candidates){
  if(!candidate||typeof candidate.id!=='string'||!candidate.id||ids.has(candidate.id)||typeof candidate.target!=='string'||typeof candidate.guidance!=='string'||typeof candidate.enabled!=='boolean'||typeof candidate.isDefault!=='boolean'||!Number.isInteger(candidate.version)||candidate.version<1||!['provisional','confirmed'].includes(candidate.status))throw new Error('용어 후보의 ID·텍스트·버전 형식 오류');
  ids.add(candidate.id);if(candidate.enabled&&candidate.isDefault)defaults++;
  if(candidate.evidence!==undefined&&(!Array.isArray(candidate.evidence)||candidate.evidence.some(e=>!e||typeof e.unitId!=='string'||!Number.isInteger(e.translationVersion)||e.translationVersion<0||typeof e.sourceText!=='string'||typeof e.targetText!=='string'||e.snapshotId!==undefined&&typeof e.snapshotId!=='string')))throw new Error('용어 후보의 문장 근거 형식 오류');
 }
 if(defaults>1)throw new Error('기본 용어 후보는 하나만 선택하세요.');
}
/** Historical usages can refer to disabled/older candidates, but must retain valid identities. */
export function validateStoredTermUsages(state:Pick<WorkspaceState,'terms'>,usages:unknown){
 if(usages===undefined)return;
 if(!Array.isArray(usages))throw new Error('번역의 용어 사용 기록은 배열이어야 합니다.');
 const seen=new Set<string>();
 for(const usage of usages){
  if(!usage||typeof usage.termId!=='string'||typeof usage.candidateId!=='string'||!Number.isInteger(usage.candidateVersion)||usage.candidateVersion<1||!['model','observed','extracted'].includes(usage.origin))throw new Error('번역의 용어 사용 기록 형식 오류');
  const term=state.terms.find(term=>term.id===usage.termId),candidate=term&&termCandidates(term).find(candidate=>candidate.id===usage.candidateId),key=`${usage.termId}\u0000${usage.candidateId}`;
  if(!candidate||usage.candidateVersion>candidate.version||seen.has(key))throw new Error('번역의 용어 후보 참조·버전 오류');seen.add(key);
 }
}
