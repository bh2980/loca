import type {WorkspaceState,ExecutionProfile,JobStep,QaIssue} from '@workbench/contracts';
import {buildContext,orderedUnits} from './context.ts';
import {validateTranslation} from './validation.ts';
import {containsTerm,modelTermUsages} from './terms.ts';
export function taskContext(state:WorkspaceState,step:JobStep,profile:ExecutionProfile,runId?:string){
 const knowledge=state.knowledge.filter(k=>!k.archived).map(({history:_history,usedUnitIds:_used,...current})=>current);
 const context=buildContext({...state,knowledge},step,runId);
 const targets=step.unitIds.map(id=>state.units.find(unit=>unit.id===id)!),group=state.groups.find(g=>g.id===step.groupId),groups=new Map(state.groups.map(g=>[g.id,g]));
 const applies=(branch:string,unit:typeof targets[number])=>branch==='common'||branch!=='unknown'&&unit.branch===branch;
 const relatedIds=new Set((context.sceneContext as {id:string}[]).map(unit=>unit.id));
 const words=new Set(targets.flatMap(unit=>[...(unit.speaker?[unit.speaker.toLowerCase()]:[]),...unit.source.toLowerCase().match(/[a-z]{5,}/g)??[]]));
 context.targetBranches=[...new Set(targets.map(unit=>unit.branch))];
 context.knowledge=knowledge.map(k=>({k,applicableUnitIds:targets.filter(unit=>k.visibility==='translator'||applies(k.branch,unit)||k.branch==='unknown'&&k.evidenceIds.includes(unit.id)).map(unit=>unit.id)})).filter(item=>item.applicableUnitIds.length)
  .map(item=>({...item,score:(item.k.evidenceIds.some(id=>relatedIds.has(id))?1000:0)+[...words].filter(word=>`${item.k.title} ${item.k.content}`.toLowerCase().includes(word)).length}))
  .sort((a,b)=>b.score-a.score).slice(0,48).map(({k,applicableUnitIds})=>({...k,content:k.content.slice(0,3000),evidenceIds:k.evidenceIds.slice(0,40),applicableUnitIds,referenceScope:k.visibility==='translator'?'translator-only':'scoped-reference'}));
 // A common group can contain archive/shortcut lines at a join. Scope each
 // reference against the actual target unit, not the group's display label.
 context.previousTranslations=group?orderedUnits(state).filter(unit=>{
  const translation=state.translations[unit.id],previousGroup=groups.get(unit.groupId);if(translation?.status!=='checked'||translation.freshness!=='current'||!previousGroup)return false;
  if(unit.groupId===group.id&&unit.order>=Math.min(...targets.map(target=>target.order)))return false;
  if(unit.groupId!==group.id&&previousGroup.order>=group.order)return false;
  return targets.some(target=>applies(unit.branch,target)||unit.branch==='unknown'&&target.branch==='unknown'&&unit.groupId===target.groupId);
 }).slice(-12).map(unit=>({unitId:unit.id,groupId:unit.groupId,branch:unit.branch,speaker:unit.speaker,source:unit.source,translation:state.translations[unit.id].text,graphAncestor:(context.ancestorGroupIds as string[]).includes(unit.groupId),applicableUnitIds:targets.filter(target=>applies(unit.branch,target)||unit.branch==='unknown'&&target.branch==='unknown'&&unit.groupId===target.groupId).map(target=>target.id)})):[];
 context.knowledgeScopeNote='Use applicableUnitIds for each target. Scoped references preserve claims and evidence; they do not prove that graph conditions fired or characters know the information. Translator-only material is never automatically character memory.';
 if(profile.contextPolicy?.terms===false)context.terms=[];
 if(profile.contextPolicy?.knowledge===false)context.knowledge=[];
 if(profile.contextPolicy?.previous===false)context.previousTranslations=[];
 (context.coverage as Record<string,unknown>).omittedKnowledge=knowledge.length-(context.knowledge as unknown[]).length;
 context.contextPolicy={terms:profile.contextPolicy?.terms!==false,knowledge:profile.contextPolicy?.knowledge!==false,previous:profile.contextPolicy?.previous!==false};
 while(JSON.stringify(context).length>180000&&(context.knowledge as unknown[]).length){(context.knowledge as unknown[]).pop();(context.coverage as Record<string,unknown>).omittedKnowledge=knowledge.length-(context.knowledge as unknown[]).length;}
 if(JSON.stringify(context).length>180000)throw new Error('이 작업의 문맥이 크기 한도를 초과했습니다. 더 작은 원문 범위를 선택하세요.');
 return context;
}
/** Validates the deliberately small schema vocabulary emitted by the engine. */
export function checkTaskOutput(schema:Record<string,unknown>,data:unknown,state:WorkspaceState,step:JobStep){
 const issues:(QaIssue&{unitId?:string})[]=[];
 const walk=(s:any,value:any,path:string)=>{
  if(s.enum&&!s.enum.includes(value))issues.push({code:'schema-enum',message:`${path}: 허용되지 않은 ID 또는 값`});
  if(s.type==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value)){issues.push({code:'schema-type',message:`${path}: 객체 필요`});return;}
   for(const key of s.required??[])if(!(key in value))issues.push({code:'schema-required',message:`${path}.${key}: 필수 필드 누락`});
   for(const [key,child] of Object.entries(value)){if(s.properties?.[key])walk(s.properties[key],child,`${path}.${key}`);else if(s.additionalProperties===false)issues.push({code:'schema-extra',message:`${path}.${key}: 예상하지 않은 필드`});}
  }else if(s.type==='array'){
   if(!Array.isArray(value)){issues.push({code:'schema-type',message:`${path}: 배열 필요`});return;}value.forEach((child,index)=>walk(s.items,child,`${path}[${index}]`));
  }else if(s.type==='string'&&typeof value!=='string')issues.push({code:'schema-type',message:`${path}: 문자열 필요`});
  else if(s.type==='integer'&&!Number.isInteger(value))issues.push({code:'schema-type',message:`${path}: 정수 필요`});
  else if(s.type==='boolean'&&typeof value!=='boolean')issues.push({code:'schema-type',message:`${path}: boolean 필요`});
 };
 walk(schema,data,'result');
 if(['translate','review','recheck'].includes(step.stage)&&Array.isArray((data as any)?.translations)){
  const rows=(data as any).translations,seen=new Set<string>();
  if(rows.length!==step.unitIds.length)issues.push({code:'target-count',message:'대상 원문과 응답 수가 다릅니다.'});
  for(const row of rows){if(seen.has(row?.unitId))issues.push({code:'duplicate-id',message:'같은 원문 ID가 중복되었습니다.',unitId:row?.unitId});seen.add(row?.unitId);const unit=state.units.find(u=>u.id===row?.unitId);if(unit&&typeof row?.text==='string'){issues.push(...validateTranslation(unit.source,row.text).map(issue=>({...issue,unitId:unit.id})));try{modelTermUsages(state,unit.id,row.text,row.termUsages);}catch(error){issues.push({code:'term-usage',message:(error as Error).message,unitId:unit.id});}}}
  for(const uid of step.unitIds)if(!seen.has(uid))issues.push({code:'missing-id',message:'대상 원문의 응답이 없습니다.',unitId:uid});
 }
 if(step.stage==='glossary'&&Array.isArray((data as any)?.terms))for(const term of (data as any).terms){
  if(typeof term?.source!=='string'||!term.source.trim()||typeof term.target!=='string'||!Array.isArray(term.unitIds)||!term.unitIds.length){issues.push({code:'term-evidence',message:'용어에 원문·번역·문장 근거가 필요합니다.'});continue;}
  for(const uid of term.unitIds){const unit=state.units.find(unit=>unit.id===uid);if(!unit||!containsTerm(unit.source,term.source)||term.target.trim()&&!containsTerm(state.translations[uid]?.text??'',term.target))issues.push({code:'term-evidence',message:'용어 후보가 원문과 현재 번역문 쌍에 없습니다.',unitId:uid});}
 }
 return {ok:issues.length===0,issues};
}
