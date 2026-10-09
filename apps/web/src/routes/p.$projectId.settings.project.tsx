import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { GRAPH_FLOW_LABELS, GRAPH_FLOWS, type FormatRules, type GraphFlow } from '@tw/shared';
import { FormatRulesSection } from '@/components/format-rules';
import { Page } from '@/components/page';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/p/$projectId/settings/project')({
  component: ProjectSettings,
});

function ProjectSettings() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));
  if (!project.data) return <Page title="프로젝트">{null}</Page>;
  return <ProjectForm key={project.data.id} projectId={projectId} project={project.data} />;
}

function ProjectForm({ projectId, project }: { projectId: string; project: { name: string; description: string | null; sourceLanguage: string; targetLanguage: string; formatRules: FormatRules; graphFlow: GraphFlow } }) {
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
  const setFlow = useMutation({
    mutationFn: (graphFlow: GraphFlow) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { graphFlow } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['units', 'project', projectId] });
      toast.success('그래프 범위를 저장했습니다.');
    },
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
    <Page title="프로젝트">
      <div className="max-w-2xl space-y-8">
        <section className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">이름</Label>
            <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">설명</Label>
            <Textarea id="project-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">
            언어: {project.sourceLanguage} → {project.targetLanguage}
          </p>
          <Button disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>
            저장
          </Button>
        </section>

        <FormatRulesSection projectId={projectId} rules={project.formatRules} />

        <section className="space-y-2 border-t pt-6">
          <h2 className="text-sm font-semibold">원문 그래프 범위</h2>
          <p className="text-sm text-muted-foreground">
            그래프가 게임의 진행 흐름(분기·조건·이동)을 빠짐없이 담고 있는지입니다. 가져온 파일의 변환기가 정하며, 잘못됐으면 여기서 고칩니다. 지금은 기록만 하고, 이후 장면의 앞뒤를 판단할 때 씁니다: 전체일 때만 서로 닿지 않는 장면을 ‘한 플레이에서 함께 나오지 않음’으로 보고, 일부면 ‘순서 모름’으로 봅니다.
          </p>
          <RadioGroup value={project.graphFlow} onValueChange={(value) => setFlow.mutate(value as GraphFlow)} disabled={setFlow.isPending}>
            {GRAPH_FLOWS.map((flow) => (
              <div key={flow} className="flex items-center gap-2">
                <RadioGroupItem value={flow} id={`graph-flow-${flow}`} />
                <Label htmlFor={`graph-flow-${flow}`} className="font-normal">
                  {GRAPH_FLOW_LABELS[flow]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </section>

        <section className="space-y-2 border-t pt-6">
          <h2 className="text-sm font-semibold">번역 결과 내보내기</h2>
          <p className="text-sm text-muted-foreground">모든 대사의 키, 원문, 번역, 상태를 JSON 파일로 내려받습니다. 원본 게임 파일은 바뀌지 않습니다.</p>
          <Button variant="outline" asChild>
            <a href={`/api/projects/${projectId}/export`} download>
              <Download /> 번역 결과 내보내기
            </a>
          </Button>
        </section>

        <section className="space-y-2 rounded-lg border border-destructive/40 p-4">
          <h2 className="text-sm font-semibold text-destructive">위험 영역</h2>
          <p className="text-sm text-muted-foreground">프로젝트의 장면, 대사, 번역, 워크플로, 실행 기록이 모두 삭제되며 되돌릴 수 없습니다. 실행 중인 작업은 취소됩니다.</p>
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
        </section>
      </div>
    </Page>
  );
}
