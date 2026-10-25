import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Box, Checkbox, LinkStyle, NormalLabel, Text } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';

/**
 * Where AI results that are knowledge or terms are written or listed: how they land under the
 * project's one AI 문맥 switch (it is changed only in 설정 › 프로젝트), with a link there.
 */
export function AiConfirmNote({ projectId }: { projectId: string }) {
  const project = useQuery(q.project(projectId));
  if (!project.data) return null;
  return (
    <Text as="p" variant="caption" tone="muted">
      AI 결과: {project.data.aiAutoConfirm ? '바로 확정' : '후보'} ·{' '}
      <LinkStyle>
        <Link to="/p/$projectId/settings/project" params={{ projectId }}>
          설정
        </Link>
      </LinkStyle>
    </Text>
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
    <Box spaceY="tight">
      <NormalLabel>
        <Checkbox checked={project.data?.aiAutoConfirm ?? true} disabled={!project.data || save.isPending} onCheckedChange={(checked) => save.mutate(checked === true)} />
        AI가 만든 용어·자료를 바로 확정
      </NormalLabel>
      <Text as="p" variant="caption" tone="muted" paddingLeft="spacious">끄면 후보로 들어가고, 사람이 확정해야 문맥에 쓰입니다.</Text>
    </Box>
  );
}
