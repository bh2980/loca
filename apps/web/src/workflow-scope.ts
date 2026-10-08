import type {WorkflowRunInput,WorkspaceState} from '@workbench/contracts';

export interface WorkflowScope {scope:'scene'|'ids'|'all';groupId:string;targetText:string;statusIds?:string[];labelIds?:string[]}
/** Scope, preview and trial share one exact target set. Status is OR; labels AND,
 * matching core createWorkflowRun. Filtering does not mutate source or progress. */
export function workflowTargets(state:WorkspaceState,input:WorkflowScope){
 const sources=new Map(state.units.map(unit=>[unit.id,unit])),requested=[...new Set(input.targetText.split(/[\s,]+/).filter(Boolean))],statusIds=input.statusIds??[],labelIds=input.labelIds??[];
 const missingUnitIds=input.scope==='ids'?requested.filter(id=>!sources.has(id)):[];
 const missingStatusIds=statusIds.filter(id=>!state.studio?.statuses.some(status=>status.id===id)),missingLabelIds=labelIds.filter(id=>!state.studio?.labels.some(label=>label.id===id));
 const base=input.scope==='ids'?requested.filter(id=>sources.has(id)):state.units.filter(unit=>input.scope==='all'||unit.groupId===input.groupId).map(unit=>unit.id);
 const unitIds=base.filter(id=>{const progress=state.studio?.progress[id];return (!statusIds.length||!!progress&&statusIds.includes(progress.statusId))&&(!labelIds.length||!!progress&&labelIds.every(label=>progress.labelIds.includes(label)));});
 return {unitIds,scopeCount:base.length,missingUnitIds,missingStatusIds,missingLabelIds,valid:!missingUnitIds.length&&!missingStatusIds.length&&!missingLabelIds.length};
}
export function workflowRunSelection(definitionId:string,targets:ReturnType<typeof workflowTargets>,scope:WorkflowScope):WorkflowRunInput {
 if(!targets.valid)throw new Error('현재 프로젝트에 없는 원문 ID·상태·라벨을 확인하세요.');
 if(!targets.unitIds.length)throw new Error('선택 범위와 필터에 맞는 대사가 없습니다.');
 return {definitionId,unitIds:[...targets.unitIds],...(scope.statusIds?.length?{statusIds:[...scope.statusIds]}:{}),...(scope.labelIds?.length?{labelIds:[...scope.labelIds]}:{})};
}
