import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Box, Checkbox, Text, TextLink, Field } from '@loca/ui';
import { q } from '@/lib/queries';
import type { SettingsTarget } from '@/lib/settings-target';
import { useTargetSettings } from '@/lib/target-settings';

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
      <TextLink asChild underline="offset" quiet>
        <Link to="/p/$projectId/settings/project" params={{ projectId }}>
          설정
        </Link>
      </TextLink>
    </Text>
  );
}

/**
 * The AI 문맥 switch of a project or of the home's defaults: AI results that are knowledge or terms are confirmed right away
 * (✦ until a person looks) or land as candidates a person confirms. Lines are not touched by it.
 */
export function AiAutoConfirmSetting({ target }: { target: SettingsTarget }) {
  const { loaded, aiAutoConfirm, save } = useTargetSettings(target);
  return (
    <Box spaceY="tight">
      <Field.Label variant="choice">
        <Checkbox checked={aiAutoConfirm} disabled={!loaded || save.isPending} onCheckedChange={(checked) => save.mutate({ aiAutoConfirm: checked === true }, { onSuccess: () => toast.success('저장했습니다.') })} />
        AI가 만든 용어·자료를 바로 확정
      </Field.Label>
      <Text as="p" variant="caption" tone="muted" paddingLeft="spacious">끄면 후보로 들어가고, 사람이 확정해야 문맥에 쓰입니다.</Text>
    </Box>
  );
}
