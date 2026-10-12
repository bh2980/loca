import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { type FormatRules } from '@tw/shared';
import { FormatRulesSection } from '@/components/format-rules';
import { Page } from '@/components/page';
import { SettingsSection } from '@/components/settings/section';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/p/$projectId/settings/project')({
  component: ProjectSettings,
});

function ProjectSettings() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));
  if (!project.data)
    return (
      <Page title="프로젝트" flush>
        <div className="max-w-3xl space-y-4 px-6 py-6">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-20" />
        </div>
      </Page>
    );
  return <ProjectForm key={project.data.id} projectId={projectId} project={project.data} />;
}

function ProjectForm({ projectId, project }: { projectId: string; project: { name: string; description: string | null; sourceLanguage: string; targetLanguage: string; formatRules: FormatRules } }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [confirmName, setConfirmName] = useState('');
  const dirty = name !== project.name || description !== (project.description ?? '');

  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { name, description } })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].$delete({ param: { projectId } })),
    onSuccess: () => {
      toast.success('프로젝트를 삭제했습니다.');
      void navigate({ to: '/' });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Page title="프로젝트" flush>
      <div className="h-full overflow-auto">
        <div className="max-w-3xl space-y-8 px-6 py-6">
          <SettingsSection title="기본 정보">
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="project-name">이름</FieldLabel>
                <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-description">설명</FieldLabel>
                <Textarea id="project-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel>언어</FieldLabel>
                <FieldDescription>
                  {project.sourceLanguage} → {project.targetLanguage}
                </FieldDescription>
              </Field>
              <div>
                <Button disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>
                  저장
                </Button>
              </div>
            </FieldGroup>
          </SettingsSection>

          <FormatRulesSection projectId={projectId} rules={project.formatRules} />

          <SettingsSection title="번역 결과 내보내기" description="모든 대사의 키, 원문, 번역, 상태를 JSON 파일로 내려받습니다. 원본 게임 파일은 바뀌지 않습니다.">
            <Button variant="outline" asChild>
              <a href={`/api/projects/${projectId}/export`} download>
                <Download /> 번역 결과 내보내기
              </a>
            </Button>
          </SettingsSection>

          <SettingsSection title={<span className="text-destructive">프로젝트 삭제</span>} description="프로젝트의 장면, 대사, 번역, 워크플로, 실행 기록이 모두 삭제되며 되돌릴 수 없습니다. 실행 중인 작업은 취소됩니다.">
            <AlertDialog onOpenChange={() => setConfirmName('')}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 /> 프로젝트 삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>프로젝트를 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>계속하려면 프로젝트 이름 “{project.name}”을(를) 입력하세요.</AlertDialogDescription>
                </AlertDialogHeader>
                <Input aria-label="프로젝트 이름 확인" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={project.name} />
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <Button variant="destructive" disabled={confirmName !== project.name || remove.isPending} onClick={() => remove.mutate()}>
                    삭제
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SettingsSection>
        </div>
      </div>
    </Page>
  );
}
