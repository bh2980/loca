import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { APP_DEFAULT_SECTION_LABELS, APP_DEFAULT_SECTIONS, type AppDefaultSection } from '@tw/shared';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Box, Button, Checkbox, Field, Inline, Section, Spinner, Stack, Text } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { useWorkflows } from '@/lib/workflows';

type Direction = 'pull' | 'push';

/** What each button does to a section, said in the confirmation (the server's rules, docs/DESIGN-APP-SETTINGS §3). */
const EFFECT: Record<Direction, (workflowCount: number) => Record<AppDefaultSection, string>> = {
  pull: () => ({
    connections: '같은 이름의 연결은 주소·키를 홈 것으로 바꾸고, 없는 이름은 추가합니다.',
    editorAi: '이 프로젝트의 값을 홈 값으로 바꿉니다.',
    agentSettings: '이 프로젝트의 값을 홈 값으로 바꿉니다.',
    prompts: '이 프로젝트에 없는 이름만 추가합니다.',
    aiAutoConfirm: '이 프로젝트의 값을 홈 값으로 바꿉니다.',
    statuses: '이 프로젝트에 없는 이름만 추가합니다. 있는 상태는 그대로입니다.',
    tags: '이 프로젝트에 없는 이름만 추가합니다.',
    workflows: '홈의 워크플로를 새 워크플로로 추가합니다. 있는 워크플로는 그대로입니다.',
  }),
  push: (workflowCount) => ({
    connections: '이름이 같은 홈 연결은 이 프로젝트 값으로 바꾸고, 없는 이름은 추가합니다.',
    editorAi: '홈의 값을 이 프로젝트 값으로 바꿉니다.',
    agentSettings: '홈의 값을 이 프로젝트 값으로 바꿉니다.',
    prompts: '이름이 같은 홈 지시는 이 프로젝트 것으로 바꾸고, 없는 이름은 추가합니다.',
    aiAutoConfirm: '홈의 값을 이 프로젝트 값으로 바꿉니다.',
    statuses: '홈의 상태 목록을 이 프로젝트의 상태로 바꿉니다.',
    tags: '홈의 태그 목록을 이 프로젝트의 태그로 바꿉니다.',
    workflows: `고른 워크플로 ${workflowCount}개를 홈의 저장한 워크플로에 추가합니다.`,
  }),
};

/**
 * 홈 기본값: the buttons that bring the home's defaults into this project (가져오기) or lift this
 * project's sections up to the home (올리기). The checked sections live in this component only;
 * each button confirms what it does per section, then shows the server's report.
 */
export function HomeDefaultsSection({ projectId }: { projectId: string }) {
  const [sections, setSections] = useState<ReadonlySet<AppDefaultSection>>(new Set());
  const [workflowIds, setWorkflowIds] = useState<ReadonlySet<string>>(new Set());
  // The dialog keeps its direction while it closes, so its text does not flip during the fade-out.
  const [dialog, setDialog] = useState<{ open: boolean; direction: Direction }>({ open: false, direction: 'pull' });
  const confirming = dialog.direction;
  const [report, setReport] = useState<{ direction: Direction; lines: [AppDefaultSection, string][] } | null>(null);
  const workflows = useWorkflows(projectId);

  const checked = APP_DEFAULT_SECTIONS.filter((section) => sections.has(section));
  const pickedWorkflows = (workflows.data ?? []).filter((workflow) => workflowIds.has(workflow.id));
  const needsWorkflows = sections.has('workflows');

  const run = useMutation({
    mutationFn: (direction: Direction) =>
      direction === 'pull'
        ? unwrap(client.projects[':projectId'].defaults.pull.$post({ param: { projectId }, json: { sections: checked } }))
        : unwrap(client.projects[':projectId'].defaults.push.$post({ param: { projectId }, json: { sections: checked, workflowIds: needsWorkflows ? pickedWorkflows.map((workflow) => workflow.id) : [] } })),
    onSuccess: (result, direction) => {
      const done = result as Partial<Record<AppDefaultSection, string>>;
      setReport({ direction, lines: checked.filter((section) => done[section] !== undefined).map((section) => [section, done[section]!]) });
    },
    onError: (error) => toast.error(error.message),
  });

  const toggle = (section: AppDefaultSection, on: boolean) => {
    setReport(null);
    setSections((current) => {
      const next = new Set(current);
      if (on) next.add(section);
      else next.delete(section);
      return next;
    });
  };
  const toggleWorkflow = (id: string, on: boolean) =>
    setWorkflowIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const noneChecked = checked.length === 0;
  const pushBlocked = needsWorkflows && pickedWorkflows.length === 0;
  const effects = EFFECT[confirming](pickedWorkflows.length);

  return (
    <Section variant="page" title="홈 기본값" description="홈 설정의 새 프로젝트 기본값과 이 프로젝트를 맞춥니다. 고른 항목에만 적용됩니다.">
      <Box spaceY="normal">
        <Stack direction="row" wrap gapX="comfortable" gapY="condensed">
          {APP_DEFAULT_SECTIONS.map((section) => (
            <Field.Label key={section} variant="choice">
              <Checkbox checked={sections.has(section)} onCheckedChange={(on) => toggle(section, on === true)} />
              {APP_DEFAULT_SECTION_LABELS[section]}
            </Field.Label>
          ))}
        </Stack>

        {needsWorkflows && (
          <Box spaceY="condensed">
            <Text as="p" variant="label">홈에 저장할 워크플로</Text>
            {workflows.data?.length ? (
              <Stack gap="condensed">
                {workflows.data.map((workflow) => (
                  <Field.Label key={workflow.id} variant="choice">
                    <Checkbox checked={workflowIds.has(workflow.id)} onCheckedChange={(on) => toggleWorkflow(workflow.id, on === true)} />
                    {workflow.name}
                  </Field.Label>
                ))}
              </Stack>
            ) : (
              <Text as="p" variant="caption" tone="muted">{workflows.isPending ? '불러오는 중…' : '이 프로젝트에 워크플로가 없습니다.'}</Text>
            )}
            <Text as="p" variant="caption" tone="muted">가져오기에는 고르지 않아도 됩니다. 홈에 저장할 때만 쓰입니다.</Text>
          </Box>
        )}

        <Inline gap="condensed">
          <Button variant="outline" disabled={noneChecked || run.isPending} onClick={() => setDialog({ open: true, direction: 'pull' })}>
            {run.isPending && run.variables === 'pull' && <Spinner />}
            홈 기본값 가져오기
          </Button>
          <Button variant="outline" disabled={noneChecked || pushBlocked || run.isPending} title={pushBlocked ? '홈에 저장할 워크플로를 고르세요' : undefined} onClick={() => setDialog({ open: true, direction: 'push' })}>
            {run.isPending && run.variables === 'push' && <Spinner />}
            홈 기본값으로 저장
          </Button>
        </Inline>

        {report && (
          <Box spaceY="hair" role="status">
            <Text as="p" variant="label">{report.direction === 'pull' ? '가져왔습니다' : '홈 기본값에 저장했습니다'}</Text>
            {report.lines.map(([section, result]) => (
              <Text key={section} as="p" variant="caption" tone="muted">{APP_DEFAULT_SECTION_LABELS[section]}: {result}</Text>
            ))}
          </Box>
        )}
      </Box>

      <AlertDialog open={dialog.open} onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming === 'pull' ? '홈 기본값을 가져올까요?' : '홈 기본값으로 저장할까요?'}</AlertDialogTitle>
            <AlertDialogDescription>{confirming === 'pull' ? '이 프로젝트에 다음처럼 적용됩니다.' : '홈의 새 프로젝트 기본값이 다음처럼 바뀝니다. 이미 있는 다른 프로젝트는 그대로입니다.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <Box as="ul" spaceY="condensed">
            {checked.map((section) => (
              <Box as="li" key={section}>
                <Text as="p" variant="label">{APP_DEFAULT_SECTION_LABELS[section]}</Text>
                <Text as="p" variant="caption" tone="muted">{effects[section]}</Text>
              </Box>
            ))}
          </Box>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => run.mutate(confirming)}>{confirming === 'pull' ? '가져오기' : '저장'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
