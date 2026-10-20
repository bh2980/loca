import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Checkbox, Label } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';

/** The ✦ tooltip on a term or knowledge item AI confirmed: what it already means for prompts. */
export const AI_CONFIRMED_NOTE = 'AI가 확정함 · 이미 문맥에 쓰이고 있습니다. 확인함을 누르면 사람이 본 것으로 기록됩니다.';

/**
 * Where AI results that are knowledge or terms are written or listed: how they land under the
 * project's one AI 문맥 switch (it is changed only in 설정 › 프로젝트), with a link there.
 */
export function AiConfirmNote({ projectId }: { projectId: string }) {
  const project = useQuery(q.project(projectId));
  if (!project.data) return null;
  return (
    <p className="text-xs text-muted-foreground">
      AI 결과: {project.data.aiAutoConfirm ? '바로 확정 (문맥에 쓰임)' : '후보 (사람이 확정해야 문맥에 쓰임)'} ·{' '}
      <Link to="/p/$projectId/settings/project" params={{ projectId }} className="underline underline-offset-2 hover:text-foreground">
        설정
      </Link>
    </p>
  );
}

/**
 * The project's AI 문맥 switch: AI results that are knowledge or terms are confirmed right away
 * (✦ until a person looks) or land as candidates a person confirms. Lines are not touched by it.
 */
export function AiAutoConfirmSetting({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const save = useMutation({
    mutationFn: (aiAutoConfirm: boolean) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { aiAutoConfirm } })),
    onMutate: async (aiAutoConfirm) => ({ undo: await optimistic(queryClient, [{ key: q.project(projectId).queryKey, update: (data: object) => ({ ...data, aiAutoConfirm }) }]) }),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error, _next, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  return (
    <div className="space-y-1">
      <Label className="text-sm font-normal">
        <Checkbox checked={project.data?.aiAutoConfirm ?? true} disabled={!project.data || save.isPending} onCheckedChange={(checked) => save.mutate(checked === true)} />
        AI가 만든 용어·자료를 바로 확정
      </Label>
      <p className="pl-6 text-xs text-muted-foreground">끄면 후보로 들어가고, 사람이 확정해야 문맥에 쓰입니다. 대사의 상태는 바꾸지 않습니다.</p>
    </div>
  );
}
