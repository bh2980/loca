import { Button } from './components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { useState } from 'react';
import { Activity, FlaskConical, LoaderCircle, X } from 'lucide-react';
import { STAGE_LABELS, type JobStep, type TaskTest, type WorkspaceState } from '@workbench/contracts';
import type { Mutate } from './App';
import { RunProgress, runLabels } from './RunProgress';
import { activeTest, runOutcome } from './workflow-state';
import {workflowActivities,workflowRunActivity,workflowStatusLabels} from './workflow-activity';

export function TaskButton({ state, mutate, busy, lastSyncAt, disconnected, onOpenTarget, onHistory, onOpenTest, onWorkflow }: {
  state: WorkspaceState; mutate: Mutate; busy: boolean; lastSyncAt: number; disconnected: boolean;
  onOpenTarget: (step: JobStep) => void; onHistory: () => void;
  onOpenTest?: (test: TaskTest) => void;
  onWorkflow?: (runId:string) => void;
}) {
  const [open, setOpen] = useState(false);
  const run = state.runs.find(item => ['running', 'queued', 'paused'].includes(item.status)) ?? state.runs[0];
  const active = run && ['running', 'queued', 'paused'].includes(run.status);
  const trials = (state.taskTests ?? []).filter(activeTest);
  const outcome = run?.status === 'completed' ? runOutcome(state, run.id) : undefined;
  const customActive=workflowActivities(state),recentCustom=(state.workflow?.projectId===state.project.id?state.workflow.runs:[]).filter(item=>item.projectId===state.project.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  const custom=customActive.length?customActive:recentCustom?[workflowRunActivity(state,recentCustom)!].filter(Boolean):[];
  const customRunning=customActive.some(item=>item.running||item.status==='running');
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button className={`task-button ${active || trials.length || customActive.length ? 'active' : ''}`} aria-label="작업 상태 열기" variant="ghost">
      {run?.status === 'running' || trials.length || customRunning ? <LoaderCircle className="spinning" size={14} /> : <Activity size={14} />}<span>작업</span>{trials.length ? <span className="task-badge">시험 {trials.length}개 진행</span> : customActive.length ? <span className="task-badge">프로세스 {customActive.length>1?`${customActive.length}개 진행`:workflowStatusLabels[customActive[0].status]}</span> : active ? <span className="task-badge">{runLabels[run.status]}</span> : run?.status === 'failed'||custom[0]?.status==='failed' ? <span className="task-badge error">오류</span> : null}
    </Button></PopoverTrigger>
    <PopoverContent className="task-popover" align="end" sideOffset={8} aria-label="작업 상태">
      <div className="task-popover-heading"><strong>작업 상태</strong><Button onClick={() => { onHistory(); setOpen(false); }} variant="ghost" size="sm">실행 결과</Button><Button aria-label="작업 상태 닫기" onClick={() => setOpen(false)} variant="ghost" size="icon-sm"><X size={14} /></Button></div>
      {trials.length ? <div className="task-trial-list" aria-label="진행 중인 시험">{trials.map(trial => <div className="task-trial-row" key={trial.id}><FlaskConical size={14} /><div><strong>{STAGE_LABELS[trial.stage]} 시험 · {trial.status === 'running' ? '응답 대기' : '대기'}</strong><small>{trial.requestedModel} · 원문 {trial.unitIds.length}개 · 번역에 적용하지 않음</small></div>{onOpenTest ? <Button onClick={() => { onOpenTest(trial); setOpen(false); }} variant="outline" size="sm">보기</Button> : null}<Button disabled={busy} onClick={() => void mutate(`/tasks/tests/${encodeURIComponent(trial.id)}/cancel`)} variant="ghost" size="sm">취소</Button></div>)}</div> : null}
      {custom.length?<div className="task-trial-list" aria-label="프로세스 실행 상태">{custom.map(activity=><div key={activity.runId}>
       <div className="task-trial-row"><Activity size={14}/><div><strong>{activity.name} · {workflowStatusLabels[activity.status]}</strong><small>종료 {activity.counts.completed}/{activity.counts.total}개 · 번역 반영 {activity.counts.committed}개 · 확정 {activity.counts.confirmed}개</small>{activity.counts.failed||activity.counts.waiting||activity.counts.cancelled?<small>실패 {activity.counts.failed}개 · 확인 대기 {activity.counts.waiting}개 · 취소 {activity.counts.cancelled}개</small>:null}</div>{onWorkflow?<Button onClick={()=>{onWorkflow(activity.runId);setOpen(false);}} variant="outline" size="sm">프로세스 보기</Button>:null}</div>
       {activity.nodes.map(node=><div className="task-trial-row" key={node.id}><div><strong>{node.name}</strong><small>{node.unitIds.length}개 · {node.status==='running'?'현재 처리 대상':node.status==='waiting'?'사용자 확인 대기':'다음 처리 대상'}</small></div><Button onClick={()=>{onOpenTarget({...activity.step!,id:`workflow:${activity.runId}:${node.id}`,unitIds:node.unitIds,groupId:undefined,status:node.status==='running'?'running':'queued'});setOpen(false);}} variant="ghost" size="sm">원문 보기</Button></div>)}
       {activity.error?<p className="notice">{activity.error}</p>:null}
      </div>)}</div>:null}
      {run && outcome ? <div className="task-completed-result"><p><strong>최근 작업이 완료됐어요.</strong><span>{run.mode === 'demo' ? '모의 실행' : run.mode === 'mixed' ? '혼합 실행' : '실제 모델'}</span></p><p>번역 {outcome.savedUnitIds.length}개 저장 · 수정안 {outcome.proposedUnitIds.length}개 · 작품 자료 {outcome.knowledgeIds.length}개</p>{outcome.reviewUnitIds.length ? <p>검토가 필요한 원문 {outcome.reviewUnitIds.length}개가 있어요.</p> : null}<Button onClick={() => { onHistory(); setOpen(false); }} variant="outline" size="sm">변경된 내용 보기</Button></div> : run ? <RunProgress run={run} state={state} mutate={mutate} busy={busy} lastSyncAt={lastSyncAt} disconnected={disconnected} onOpenTarget={step => { onOpenTarget(step); setOpen(false); }} /> : !trials.length&&!custom.length ? <p>진행 중인 작업이 없습니다.</p> : null}
    </PopoverContent>
  </Popover>;
}
