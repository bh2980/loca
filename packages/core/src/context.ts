import type {JobStep,SourceUnit,WorkspaceState} from '@workbench/contracts';
import {activeCandidates,termInputsCurrent} from './terms.ts';

export function orderedUnits(s:Pick<WorkspaceState,'groups'|'units'>){
 const order=new Map(s.groups.map(g=>[g.id,g.order]));
 return [...s.units].sort((a,b)=>(order.get(a.groupId)??0)-(order.get(b.groupId)??0)||a.order-b.order||a.id.localeCompare(b.id));
}
/** Source identities remain intact; a batch never creates replacement source IDs. */
export function batches(units:SourceUnit[],maxUnits=40,maxCharacters=14000){
 const result:SourceUnit[][]=[];let current:SourceUnit[]=[],size=0;
 for(const unit of units){const cost=unit.source.length+unit.id.length+150;if(current.length&&(current.length>=maxUnits||size+cost>maxCharacters)){result.push(current);current=[];size=0;}current.push(unit);size+=cost;}
 if(current.length)result.push(current);return result;
}
const brief=(value:unknown,limit=1800):unknown=>{if(value===undefined)return undefined;const text=JSON.stringify(value);return text.length<=limit?value:{truncated:true,preview:text.slice(0,limit),originalCharacters:text.length};};
function unitView(u:SourceUnit){return {id:u.id,groupId:u.groupId,order:u.order,speaker:u.speaker,source:u.source,sourceLanguage:u.sourceLanguage,kind:u.kind,branch:u.branch,termIds:u.termIds,contextNotes:u.contextNotes?.map(n=>n.slice(0,600)).slice(0,4),graphNodeIds:u.graphNodeIds?.slice(0,40)};}

export function buildContext(s:WorkspaceState,step:JobStep,runId?:string):Record<string,unknown>{
 const byId=new Map(s.units.map(u=>[u.id,u])),units=step.unitIds.map(id=>byId.get(id)!);
 const ordered=orderedUnits(s),group=s.groups.find(g=>g.id===step.groupId),branch=group?.branch??'common';
 const ids=new Set(step.unitIds),groupUnits=group?ordered.filter(u=>u.groupId===group.id):units;
 const start=Math.max(0,groupUnits.findIndex(u=>ids.has(u.id))),end=groupUnits.findLastIndex(u=>ids.has(u.id));
 const sceneUnits=group?groupUnits.slice(Math.max(0,start-4),Math.max(start,end)+5):units;
 const groupsById=new Map(s.groups.map(g=>[g.id,g])),parents=new Map<string,string[]>();
 for(const g of s.groups)for(const next of g.nextIds){const list=parents.get(next)??[];list.push(g.id);parents.set(next,list);}
 const ancestors=new Set<string>(),pending=group?[group.id]:[];
 while(pending.length){for(const previous of parents.get(pending.pop()!)??[])if(previous!==group?.id&&!ancestors.has(previous)){ancestors.add(previous);pending.push(previous);}}
 const prior=ordered.filter(u=>{
  const g=groupsById.get(u.groupId),t=s.translations[u.id];if(!group||!g||t?.status!=='checked'||t.freshness!=='current')return false;
  if(g.id===group.id)return u.order<(units[0]?.order??-Infinity);
  if(g.order>=group.order)return false;
  // Unknown scopes must never inherit one another just because their labels match.
  return u.branch==='common'&&g.branch==='common'||branch!=='common'&&branch!=='unknown'&&u.branch===branch&&g.branch===branch;
 }).slice(-12).map(u=>({unitId:u.id,groupId:u.groupId,branch:u.branch,speaker:u.speaker,source:u.source,translation:s.translations[u.id].text,graphAncestor:ancestors.has(u.groupId)}));
 const terms=s.terms.filter(t=>t.unitIds.some(id=>ids.has(id))).slice(0,120).map(t=>{const candidates=activeCandidates(t);return {...t,target:candidates.find(candidate=>candidate.isDefault)?.target??candidates[0]?.target??'',...(t.candidates?{candidates:candidates.map(({evidence,...candidate})=>({...candidate,evidenceCount:evidence?.length??0}))}:{}),unitIds:t.unitIds.filter(id=>ids.has(id))};});
 const relatedIds=new Set(sceneUnits.map(u=>u.id));
 const words=new Set(units.flatMap(u=>[...(u.speaker?[u.speaker.toLowerCase()]:[]),...u.source.toLowerCase().match(/[a-z]{5,}/g)??[]]));
 const relevant=s.knowledge.filter(k=>k.visibility==='translator'||k.branch==='common'||branch!=='unknown'&&k.branch===branch||k.evidenceIds.some(id=>relatedIds.has(id)))
  .map(k=>({k,score:(k.evidenceIds.some(id=>relatedIds.has(id))?1000:0)+[...words].filter(w=>`${k.title} ${k.content}`.toLowerCase().includes(w)).length}))
  .sort((a,b)=>b.score-a.score).slice(0,48).map(({k})=>({...k,content:k.content.slice(0,3000),evidenceIds:k.evidenceIds.slice(0,40)}));
 const nearbyGroups=new Set([...(group?[group.id,...group.nextIds,...(parents.get(group.id)??[])]:units.map(u=>u.groupId))]);
 const selectedGroups=s.groups.length<=30?s.groups:s.groups.filter(g=>nearbyGroups.has(g.id)).slice(0,30);
 const groups=selectedGroups.map(g=>s.groups.length<=30&&!s.graph?g:{id:g.id,title:g.title,description:g.description.slice(0,1800),order:g.order,branch:g.branch,kind:g.kind,nextIds:g.nextIds.slice(0,40)});
 const targets=units.map(u=>{const t=s.translations[u.id],tv=Object.fromEntries(s.terms.filter(t=>t.unitIds.includes(u.id)).map(t=>[t.id,t.version]));
  const draft=(step.stage==='review'||step.stage==='recheck')?s.reviews.find(r=>r.unitId===u.id&&r.jobId===runId&&r.status==='open'&&['semantic','qa'].includes(r.kind)&&r.baseVersion===t.version&&termInputsCurrent(s,u.id,r.termVersions,r.termUsages)):undefined;
  return {...unitView(u),currentTranslation:t.text,translationVersion:t.version,termUsages:t.termUsages??[],...(draft?{pendingDraft:draft.proposedText,pendingIssues:[draft.reason],pendingTermUsages:draft.termUsages??[]}:{})};
 });
 let graphContext:unknown;
 if(s.graph){
  const nodeIds=new Set(units.flatMap(u=>u.graphNodeIds??[]));
  const incident=s.graph.edges.filter(e=>nodeIds.has(e.from)||!!e.to&&nodeIds.has(e.to));
  const edges=incident.slice(0,100);
  const nearby=new Set([...nodeIds,...edges.flatMap(e=>[e.from,...(e.to?[e.to]:[])])]);
  const nodes=[...s.graph.nodes.filter(n=>nodeIds.has(n.id)),...s.graph.nodes.filter(n=>nearby.has(n.id)&&!nodeIds.has(n.id))].slice(0,60);
  graphContext={orderingNote:s.graph.orderingNote,scope:'reference-only; conditions are preserved, not evaluated',nodes:nodes.map(n=>({id:n.id,kind:n.kind,unitIds:n.unitIds.slice(0,40),conditions:brief(n.conditions)})),edges:edges.map(e=>({id:e.id,from:e.from,to:e.to,externalTarget:e.externalTarget,kind:e.kind,direction:e.direction,conditions:brief(e.conditions),metadata:brief(e.metadata,500)})),omittedNodes:Math.max(0,nearby.size-nodes.length),omittedIncidentEdges:incident.length-edges.length};
 }
 const reference=(s.units.length<=40?(step.stage==='analyze'||step.stage==='characters'||step.stage==='glossary'?ordered:ordered.filter(u=>u.branch==='common')):sceneUnits).map(unitView);
 const context={stage:step.stage,project:s.project,groups,currentGroup:group?groups.find(g=>g.id===group.id)??groups[0]:null,ancestorGroupIds:[...ancestors].slice(0,100),branch,targets,sceneContext:sceneUnits.map(unitView),previousTranslations:prior,terms,knowledge:relevant,translatorReference:reference,graphContext,
  coverage:{batchIndex:step.batchIndex??0,batchCount:step.batchCount??1,targetUnits:units.length,totalProjectUnits:s.units.length,omittedGroups:s.groups.length-groups.length,omittedKnowledge:s.knowledge.length-relevant.length},
  sourceConstraint:'References may contain later revelations. Unknown conditions are not satisfied facts. Review order is not an execution trace.'};
 if(JSON.stringify(context).length>180000)throw new Error('이 작업의 문맥이 크기 한도를 초과했습니다. 긴 원문 또는 조건 자료를 더 작은 단위로 나누세요.');
 return context;
}

