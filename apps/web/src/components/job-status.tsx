import { Badge } from '@/components/ui/badge';

const LABEL = { running: '실행 중', paused: '일시정지', completed: '완료', failed: '실패', cancelled: '취소됨' } as const;
const VARIANT = { running: 'default', paused: 'secondary', completed: 'outline', failed: 'destructive', cancelled: 'secondary' } as const;

/** One badge for the state of any run or job: running stands out, failure is red, the rest are quiet. */
export function JobStatusBadge({ status }: { status: keyof typeof LABEL }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
