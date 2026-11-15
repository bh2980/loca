import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { Box, Button, Input, Field, Textarea, Skeleton, Section, PageBody, ConfirmDialog } from '@loca/ui';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { AiAutoConfirmSetting } from '@/components/settings/ai-confirm';
import { HomeDefaultsSection } from '@/components/settings/home-defaults';
import type { FormatRules } from '@loca/shared';
import { exportDialog } from '@/lib/export-dialog';
import { useProject, saveProject, deleteProject } from '@/lib/project';

export const Route = createFileRoute('/p/$projectId/settings/project')({
  component: ProjectSettings,
});

function ProjectSettings() {
  const { projectId } = Route.useParams();
  const project = useProject(projectId);
  if (!project.data)
    return (
      <Page title="프로젝트" flush>
        <PageBody>
          <Box spaceY="comfortable">
            <Skeleton height="control" width="1/2" />
            <Skeleton height="placeholder-sm" />
          </Box>
        </PageBody>
      </Page>
    );
  return <ProjectForm key={project.data.id} projectId={projectId} project={project.data} />;
}

const FIELD_LABELS = { name: '이름', description: '설명', sourceLanguage: '원문 언어', targetLanguage: '번역 언어' } as const;

function ProjectForm({ projectId, project }: { projectId: string; project: { name: string; description: string | null; sourceLanguage: string; targetLanguage: string; formatRules: FormatRules } }) {
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  // Fields the person has not edited follow the saved project (a rename from chat shows); the unsaved edit survives leaving the page.
  const saved = { name: project.name, description: project.description ?? '', sourceLanguage: project.sourceLanguage, targetLanguage: project.targetLanguage };
  const { draft: form, setDraft: setForm, dirty, conflicts, keepMine, takeSaved, reset } = useFormFrom(saved, `project.${projectId}`);
  const { name, description, sourceLanguage, targetLanguage } = form;
  const valid = Boolean(name.trim()) && sourceLanguage.trim().length >= 2 && targetLanguage.trim().length >= 2;

  const save = useMutation({
    mutationFn: () => saveProject(projectId, changedFields(form, saved)),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      toast.success('프로젝트를 삭제했습니다.');
      void navigate({ to: '/' });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Page title="프로젝트" flush>
      <PageBody>
        <Box spaceY="wide">
          <Section variant="page"
            title="기본 정보"
            footer={
              <>
                <Button disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate()}>
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
            {conflicts.length > 0 && <ChangedElsewhere fields={conflicts.map((field) => FIELD_LABELS[field as keyof typeof FIELD_LABELS])} onTakeSaved={takeSaved} onKeepMine={keepMine} />}
            <Field.Group>
              <Field>
                <Field.Label htmlFor="project-name">이름</Field.Label>
                <Input id="project-name" value={name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field>
                <Field.Label htmlFor="project-description">설명</Field.Label>
                <Textarea id="project-description" rows={3} value={description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </Field>
              <Field>
                <Field.Label htmlFor="project-source-language">원문 언어</Field.Label>
                <Input id="project-source-language" value={sourceLanguage} onChange={(event) => setForm({ ...form, sourceLanguage: event.target.value })} />
                <Field.Description>언어 코드 (en, ja, zh…). 번역 제외의 &lsquo;원문 언어 글자 없음&rsquo;이 이 언어의 글자를 봅니다.</Field.Description>
              </Field>
              <Field>
                <Field.Label htmlFor="project-target-language">번역 언어</Field.Label>
                <Input id="project-target-language" value={targetLanguage} onChange={(event) => setForm({ ...form, targetLanguage: event.target.value })} />
              </Field>
            </Field.Group>
          </Section>

          <Section variant="page" title="AI 문맥">
            <AiAutoConfirmSetting target={{ kind: 'project', projectId }} />
          </Section>

          <HomeDefaultsSection projectId={projectId} />

          <Section variant="page" title="번역 결과">
            <Button variant="outline" onClick={() => exportDialog.open()}>
              <Download /> 내보내기
            </Button>
          </Section>

          <Section variant="page" tone="danger" title="위험 구역 · 프로젝트 삭제" description="프로젝트의 모든 데이터가 삭제되며 되돌릴 수 없습니다.">
            <ConfirmDialog
              trigger={<Button variant="destructive"><Trash2 /> 프로젝트 삭제</Button>}
              onOpenChange={() => setConfirmName('')}
              title="프로젝트를 삭제할까요?"
              description={`계속하려면 프로젝트 이름 “${project.name}”을(를) 입력하세요.`}
              keepOpen
              disabled={confirmName !== project.name}
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
            >
              <Input aria-label="프로젝트 이름 확인" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={project.name} />
            </ConfirmDialog>
          </Section>
        </Box>
      </PageBody>
    </Page>
  );
}
