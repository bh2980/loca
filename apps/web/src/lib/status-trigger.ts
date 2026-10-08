import { toast } from 'sonner';

/** Tell the user when a status change started that status's on-enter workflow (or why it did not). */
export function announceTrigger(started: { workflowName: string; count: number; skipped?: string } | null | undefined) {
  if (!started) return;
  if (started.skipped) toast.warning(`‘${started.workflowName}’ 자동 실행 안 함: ${started.skipped}`);
  else toast.info(`‘${started.workflowName}’ 워크플로를 대사 ${started.count}개로 시작했습니다.`);
}
