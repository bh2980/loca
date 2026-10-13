import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AI_CONFIRM_KINDS, DEFAULT_AI_CONFIRM, type AiConfirm, type AiConfirmKind } from '@tw/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Page } from '@/components/page';
import { AI_CONFIRM_LABELS } from '@/components/settings/ai-confirm';
import { Toolbar } from '@/components/toolbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/p/$projectId/settings/ai-confirm')({
  component: AiConfirmSettings,
});

/** Where each kind's AI results come from, for the table. */
const WRITERS: Record<AiConfirmKind, string> = {
  terms: '작품 분석, 워크플로 ‘용어 후보 추가’',
  documents: '작품 분석(작품 개요)',
  characters: '작품 분석, 워크플로 ‘자료 반영’',
  relationships: '작품 분석, 워크플로 ‘자료 반영’',
  events: '작품 분석, 워크플로 ‘자료 반영’',
  speechRules: '작품 분석, 워크플로 ‘자료 반영’',
};
const NOTES: Partial<Record<AiConfirmKind, string>> = {
  terms: '번역이 빈 용어는 늘 후보로 들어옵니다.',
  speechRules: '자동 확정이어도 대사가 많은 주요 쌍, 엇갈리거나 근거가 맞지 않는 규칙에는 ‘확인 권장’이 붙고, 사람이 정한 규칙과 다른 것은 후보로 옆에 둡니다.',
};

/**
 * 설정 › AI 확정: one choice per knowledge kind for what AI results become — used right away (✦ until a
 * person looks) or candidates a person confirms. Every AI step that writes these follows it (docs/DESIGN.md 3.5).
 */
function AiConfirmSettings() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const policy: AiConfirm = project.data?.aiConfirm ?? DEFAULT_AI_CONFIRM;
  const save = useMutation({
    mutationFn: (next: AiConfirm) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { aiConfirm: next } })),
    onMutate: (next) => queryClient.setQueryData(q.project(projectId).queryKey, (data) => (data ? { ...data, aiConfirm: next } : data)),
    onSuccess: () => toast.success('저장했습니다. 다음 분석·실행부터 적용됩니다.'),
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: q.project(projectId).queryKey });
      toast.error(error.message);
    },
  });
  const rows = (Object.keys(AI_CONFIRM_KINDS) as AiConfirmKind[]).map((kind) => ({ kind }));
  const columns: ColumnDef<{ kind: AiConfirmKind }, unknown>[] = [
    { id: 'kind', header: '종류', meta: { width: 120 }, cell: ({ row }) => <span className="font-medium">{AI_CONFIRM_KINDS[row.original.kind]}</span> },
    {
      id: 'mode',
      header: 'AI 결과',
      meta: { width: 160 },
      cell: ({ row }) => (
        <Select value={policy[row.original.kind]} onValueChange={(value) => save.mutate({ ...policy, [row.original.kind]: value as 'auto' | 'candidate' })}>
          <SelectTrigger size="sm" aria-label={`${AI_CONFIRM_KINDS[row.original.kind]} AI 결과`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['auto', 'candidate'] as const).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {AI_CONFIRM_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: 'from',
      header: '넣는 곳 · 참고',
      meta: { className: 'text-muted-foreground', wrap: true },
      cell: ({ row }) => (
        <span className="text-xs">
          {WRITERS[row.original.kind]}
          {NOTES[row.original.kind] && <span className="block">{NOTES[row.original.kind]}</span>}
        </span>
      ),
    },
  ];
  return (
    <Page title="AI 확정" flush>
      <div className="min-h-0 flex-1 overflow-auto">
        <Toolbar>
          <div>
            <h2 className="text-sm font-semibold">AI가 만든 자료·용어</h2>
            <p className="text-xs text-muted-foreground">
              자동 확정: 바로 번역 문맥에 쓰이고, 사람이 확인하기 전까지 ✦가 붙습니다(각 표의 ‘AI가 정한 것만’ 필터로 모아 보고 ‘확인함’). 후보로만: 사람이 확정해야 쓰입니다. 번역 상태는 워크플로가 정하고, 사람만 정해야 하는 상태는{' '}
              <Link to="/p/$projectId/settings/statuses" params={{ projectId }} className="underline underline-offset-2 hover:text-foreground">
                상태·태그
              </Link>
              에서 ‘사람만 지정’을 켭니다.
            </p>
          </div>
        </Toolbar>
        <DataTable columns={columns} rows={project.data ? rows : undefined} loading={project.isLoading} rowId={(row) => row.kind} empty="" />
      </div>
    </Page>
  );
}
