import type {JobStep,Stage,WorkflowNode,WorkflowRun,WorkspaceState} from '@workbench/contracts';

const activeStates=new Set<WorkflowRun['status']>(['queued','running','paused','waiting']);
export const workflowStatusLabels:Record<WorkflowRun['status'],string>={queued:'실행 대기',running:'처리 중',paused:'일시정지',waiting:'사용자 확인 대기',completed:'완료',failed:'오류',cancelled:'취소됨'};
export interface WorkflowActivityNode {id:string;name:string;type:WorkflowNode['type'];unitIds:string[];status:'running'|'waiting'|'queued'}
export interface WorkflowActivity {
 runId:string;name:string;status:WorkflowRun['status'];active:boolean;running:boolean;
 label:string;unitIds:string[];nodes:WorkflowActivityNode[];step?:JobStep;
 counts:{total:number;completed:number;failed:number;cancelled:number;waiting:number;running:number;queued:number;committed:number;confirmed:number};error?:string;
}
const stageOf=(node:WorkflowNode|undefined):Stage=>node?.type==='ai'?(node.config.stage??(node.config.mode==='operations'?'analyze':node.config.mode==='translate'?'translate':node.config.mode==='review'?'review':'translate')):'analyze';
/** UI-only JobStep compatibility: non-AI nodes display their own names, never stage labels. */
export function workflowRunActivity(state:Pick<WorkspaceState,'project'|'units'>,run:WorkflowRun):WorkflowActivity|undefined {
 if(run.projectId!==state.project.id)return;
 const targets=new Set(run.targetUnitIds),unitGroups=new Map(state.units.map(unit=>[unit.id,unit.groupId]));
 const items=run.items.filter(item=>targets.has(item.unitId)&&unitGroups.has(item.unitId));
 const counts={total:targets.size,completed:items.filter(item=>item.status==='completed').length,failed:items.filter(item=>item.status==='failed').length,cancelled:items.filter(item=>item.status==='cancelled').length,waiting:items.filter(item=>item.status==='waiting').length,running:items.filter(item=>item.status==='running').length,queued:items.filter(item=>item.status==='queued').length,committed:new Set(run.committedUnitIds.filter(id=>targets.has(id))).size,confirmed:new Set(run.confirmedUnitIds.filter(id=>targets.has(id))).size};
 const active=activeStates.has(run.status),running=active&&counts.running>0;
 const current=active?(running?items.filter(item=>item.status==='running'):counts.waiting?items.filter(item=>item.status==='waiting'):items.filter(item=>item.status==='queued')):[];
 const nodeIndex=new Map(run.definition.nodes.map(node=>[node.id,node]));
 const nodes:WorkflowActivityNode[]=[];
 for(const item of current){const node=nodeIndex.get(item.nodeId);if(!node)continue;let group=nodes.find(group=>group.id===node.id);if(!group){group={id:node.id,name:node.name,type:node.type,unitIds:[],status:item.status as WorkflowActivityNode['status']};nodes.push(group);}if(!group.unitIds.includes(item.unitId))group.unitIds.push(item.unitId);}
 const unitIds=[...new Set(nodes.flatMap(node=>node.unitIds))],groups=[...new Set(unitIds.map(id=>unitGroups.get(id)))];
 const nodeLabel=nodes.length===1?nodes[0].name:nodes.length>1?`${nodes.map(node=>node.name).join(' · ')} (${nodes.length}개 노드)`:'현재 대상 없음';
 const label=`${run.definition.name} · ${nodeLabel} · ${workflowStatusLabels[run.status]}${unitIds.length?` · 현재 ${unitIds.length}개`:''}`;
 const step=unitIds.length?{id:`workflow:${run.id}`,stage:stageOf(nodeIndex.get(nodes[0].id)),unitIds,groupId:groups.length===1?groups[0]:undefined,status:running?'running' as const:'queued' as const,attempts:0}:undefined;
 return {runId:run.id,name:run.definition.name,status:run.status,active,running,label,unitIds,nodes,step,counts,error:run.error};
}
export function workflowActivities(state:Pick<WorkspaceState,'project'|'units'|'workflow'>):WorkflowActivity[]{
 const priority={running:0,queued:1,waiting:2,paused:3};
 return (state.workflow?.projectId===state.project.id?state.workflow.runs:[]).filter(run=>activeStates.has(run.status)).sort((a,b)=>priority[a.status as keyof typeof priority]-priority[b.status as keyof typeof priority]||b.createdAt.localeCompare(a.createdAt)).flatMap(run=>{const result=workflowRunActivity(state,run);return result?[result]:[];});
}
/** Highlight all in-flight jobs together; held/queued units must not inherit their spinner. */
export function combineActivityStep(state:Pick<WorkspaceState,'units'>,legacy:JobStep|undefined,activities:WorkflowActivity[]):JobStep|undefined {
 const available=[...(legacy?[legacy]:[]),...activities.flatMap(activity=>activity.step?[activity.step]:[])];if(!available.length)return;
 const steps=available.some(step=>step.status==='running')?available.filter(step=>step.status==='running'):available;
 const unitIds=[...new Set(steps.flatMap(step=>step.unitIds))],groups=[...new Set(state.units.filter(unit=>unitIds.includes(unit.id)).map(unit=>unit.groupId))];
 return {...steps[0],id:steps.length===1?steps[0].id:`activity:${steps.map(step=>step.id).join(':')}`,unitIds,groupId:groups.length===1?groups[0]:undefined,status:steps.some(step=>step.status==='running')?'running':steps.some(step=>step.status==='queued')?'queued':steps[0].status};
}
