import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Input, Field, FieldDescription, FieldGroup, FieldLabel, Skeleton, Textarea, SettingsSection, SettingsContent } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import type { FormatRules } from '@tw/shared';

export const Route = createFileRoute('/p/$projectId/settings/project')({
  component: ProjectSettings,
});

function ProjectSettings() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));
  if (!project.data)
    return (
      <Page title="프로젝트" flush>
        <SettingsContent>
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-20" />
          </div>
        </SettingsContent>
      </Page>
    );
  return <ProjectForm key={project.data.id} projectId={projectId} project={project.data} />;
}

function ProjectForm({ projectId, project }: { projectId: string; project: { name: string; description: string | null; sourceLanguage: string; targetLanguage: string; formatRules: FormatRules } }) {
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  // Fields the person has not edited follow the saved project (a rename from chat shows); the unsaved edit survives leaving the page.
  const saved = { name: project.name, description: project.description ?? '' };
  const { draft: form, setDraft: setForm, dirty, conflicts, keepMine, takeSaved, reset } = useFormFrom(saved, `project.${projectId}`);
  const { name, description } = form;

  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: changedFields(form, saved) })),
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
      <SettingsContent>
        <div className="space-y-8">
          <SettingsSection
            title="기본 정보"
            actions={
              <>
                <Button disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>
                  저장
                </Button>
                {dirty && (
                  <Button variant="ghost" onClick={reset}>
                    되돌리기
                  </Button>
                )}
              </>
            }
          >
            {conflicts.length > 0 && <ChangedElsewhere fields={conflicts.map((field) => (field === 'name' ? '이름' : '설명'))} onTakeSaved={takeSaved} onKeepMine={keepMine} />}
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="project-name">이름</FieldLabel>
                <Input id="project-name" value={name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-description">설명</FieldLabel>
                <Textarea id="project-description" rows={3} value={description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>언어</FieldLabel>
                <FieldDescription>
                  {project.sourceLanguage} → {project.targetLanguage}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </SettingsSection>

          <SettingsSection title="번역 결과">
            <Button variant="outline" asChild>
              <a href={`/api/projects/${projectId}/export`} download>
                <Download /> 내보내기
              </a>
            </Button>
          </SettingsSection>

          <SettingsSection tone="danger" title="위험 구역 · 프로젝트 삭제" description="프로젝트의 모든 데이터가 삭제되며 되돌릴 수 없습니다.">
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
      </SettingsContent>
    </Page>
  );
}
