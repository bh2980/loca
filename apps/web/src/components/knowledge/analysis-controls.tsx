import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Sparkles, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

const fail = (error: Error) => toast.error(error.message);

/** The last work analysis: progress with a stop button, or its result. */
export function JobStatus({ projectId }: { projectId: string }) {
  const jobs = useQuery(q.analysisJobs(projectId));
  const cancel = useMutation({ mutationFn: (jobId: string) => unwrap(client.projects[':projectId'].analysis[':jobId'].cancel.$post({ param: { projectId, jobId } })), onError: fail });
  const job = jobs.data?.[0];
  if (!job) return <span>작품 분석을 돌리면 대본 전체를 읽고 아래 다섯 가지 초안을 만듭니다.</span>;
  const when = new Date(job.finishedAt ?? job.createdAt).toLocaleString();
  if (job.status === 'running')
    return (
      <span className="flex items-center gap-2">
        <Sparkles className="size-4 animate-pulse" /> 대본 전체를 읽는 중 · {job.model} · {job.partsDone}/{job.partsTotal} 부분
        <Button size="sm" variant="ghost" className="h-7" onClick={() => cancel.mutate(job.id)}>
          <Square /> 중단
        </Button>
      </span>
    );
  if (job.status === 'failed') return <span className="text-destructive">분석 실패 ({when}): {job.error}</span>;
  if (job.status === 'cancelled') return <span>분석을 중단했습니다 ({when}).</span>;
  const result = job.result ?? {};
  const total = ['documents', 'characters', 'relationships', 'events', 'speechRules'].reduce((sum, kind) => sum + (result[kind] ?? 0), 0);
  return (
    <span>
      마지막 분석 {when} · {job.model} · 초안 {total}개
      {result.rulesForReview ? ` · 확인 권장 말투 규칙 ${result.rulesForReview}개` : ''}
      {result.listeners ? ` · 청자 ${result.listeners.toLocaleString()}줄 채움` : ''}
      {result.invalidEvidence ? ` · 대본에 없는 근거 ${result.invalidEvidence}개 제외` : ''}
    </span>
  );
}

/** Start (or redo) a work analysis with a profile, auto-confirm on by default. */
export function StartAnalysis({ projectId }: { projectId: string }) {
  const profiles = useQuery(q.profiles());
  const jobs = useQuery(q.analysisJobs(projectId));
  const [profileId, setProfileId] = useState<string>();
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [resume, setResume] = useState(true);
  const [open, setOpen] = useState(false);
  // A failed or stopped analysis that finished some parts can be continued from where it stopped.
  const last = jobs.data?.[0];
  const resumable = last && (last.status === 'failed' || last.status === 'cancelled') && last.partsDone > 0 ? last : undefined;
  const start = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].analysis.$post({ param: { projectId }, json: { profileId: profileId!, autoConfirm, resume: Boolean(resumable) && resume } })),
    onSuccess: () => {
      setOpen(false);
      toast.success('작품 분석을 시작했습니다. 끝나면 초안이 여기에 들어옵니다.');
    },
    onError: fail,
  });
  const running = jobs.data?.[0]?.status === 'running';
  const hasDrafts = (jobs.data ?? []).some((job) => job.status === 'completed');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={running}>
          <Sparkles /> {hasDrafts ? '작품 다시 분석' : '작품 분석'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">작품 분석</h3>
          <p className="text-xs text-muted-foreground">
            모델이 대본 전체를 한 번에 읽고 개요·인물·관계·사건·말투 규칙 초안을 근거와 함께 만듭니다. 번역과 상태는 바뀌지 않습니다. 긴 문맥 모델을 권장하고, 출력 한도가 작으면 답이 잘릴 수 있습니다.
            {hasDrafts && ' 다시 분석하면 사람이 고치거나 확정하지 않은 AI 항목이 새 결과로 바뀝니다.'}
          </p>
        </div>
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="w-full" aria-label="모델 프로필">
            <SelectValue placeholder="모델 프로필 선택" />
          </SelectTrigger>
          <SelectContent>
            {profiles.data?.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name} · {profile.model} · 출력 {profile.maxOutputTokens.toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-confirm">자동 확정</Label>
            <Switch id="auto-confirm" checked={autoConfirm} onCheckedChange={setAutoConfirm} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {autoConfirm
              ? '결과가 바로 번역 문맥에 쓰입니다. 다만 대사가 많은 주요 쌍, 엇갈리거나 근거가 맞지 않는 말투 규칙은 후보로 남아 확인을 기다립니다.'
              : '결과가 후보로 들어오고, 확정한 것만 번역 문맥에 쓰입니다.'}
          </p>
        </div>
        {resumable && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="resume-analysis">이어서 분석</Label>
              <Switch id="resume-analysis" checked={resume} onCheckedChange={setResume} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              지난 분석이 {resumable.partsTotal}부분 중 {resumable.partsDone}부분을 마쳤습니다. 그 뒤로 대본이 바뀌지 않은 부분은 다시 읽지 않습니다.
            </p>
          </div>
        )}
        <Button className="w-full" disabled={!profileId || start.isPending} onClick={() => start.mutate()}>
          <Play /> 시작
        </Button>
      </PopoverContent>
    </Popover>
  );
}
