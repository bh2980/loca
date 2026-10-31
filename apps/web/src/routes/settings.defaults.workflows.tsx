import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { WORKFLOW_TEMPLATES, type SavedWorkflow } from '@tw/shared';
import { Box, Button, Checkbox, DataTable, EmptyState, Field, Input, Inspector, InspectorHeader, PageBody, Section, SplitPane, Stack, Text, Textarea, type ColumnDef } from '@loca/ui';
import { Page } from '@/components/page';
import { AiAutoConfirmSetting } from '@/components/settings/ai-confirm';
import { DeleteButton } from '@/components/settings/delete-button';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { useReportView } from '@/lib/view-context';
import { saveAppDefaults, useAppDefaults } from '@/lib/app-data';

export const Route = createFileRoute('/settings/defaults/workflows')({
  validateSearch: (raw: Record<string, unknown>): { saved?: string } => ({ saved: typeof raw.saved === 'string' && raw.saved ? raw.saved : undefined }),
  component: AppWorkflowSettings,
});

type Workflows = { templates: string[]; saved: SavedWorkflow[] };

function AppWorkflowSettings() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const defaults = useAppDefaults();
  const workflows = defaults.data?.workflows as Workflows | undefined;
  const selected = search.saved ? workflows?.saved.find((item) => item.id === search.saved) : undefined;
  const close = () => void navigate({ search: {}, replace: true });

  useReportView('settings-default-workflows', [selected && { kind: '저장한 워크플로', id: selected.id, label: selected.name }]);

  const save = useMutation({
    // Shown at once, put back on failure.
    mutationFn: (next: Workflows) => saveAppDefaults({ workflows: next } as never),
    onError: (error) => toast.error(error.message),
  });

  const toggleTemplate = (key: string, on: boolean) => {
    if (!workflows) return;
    const chosen = new Set(workflows.templates);
    if (on) chosen.add(key);
    else chosen.delete(key);
    // Kept in template order, as the server stores them.
    save.mutate({ ...workflows, templates: WORKFLOW_TEMPLATES.map((template) => template.key).filter((id) => chosen.has(id)) });
  };

  const columns: ColumnDef<SavedWorkflow, unknown>[] = [
    { id: 'name', header: '이름', meta: { width: 240, weight: 'medium', hideable: false }, cell: ({ row }) => row.original.name },
    { id: 'description', header: '설명', meta: { tone: 'muted' }, cell: ({ row }) => row.original.description || '–' },
  ];

  const pane = selected && workflows ? (
    <SavedWorkflowPane
      key={selected.id}
      workflow={selected}
      pending={save.isPending}
      onClose={close}
      onSave={(changed) => save.mutate({ ...workflows, saved: workflows.saved.map((item) => (item.id === selected.id ? { ...item, ...changed } : item)) }, { onSuccess: () => toast.success('저장했습니다.') })}
      onDelete={() => save.mutate({ ...workflows, saved: workflows.saved.filter((item) => item.id !== selected.id) }, { onSuccess: () => { close(); toast.success('삭제했습니다.'); } })}
    />
  ) : null;

  return (
    <Page title="기본 워크플로" flush>
      <SplitPane fill="height" id="settings-default-workflows" selectionKey={search.saved} defaultWidth="384px" pane={pane}>
        <PageBody width="wide">
          <Box spaceY="wide">
            <Section variant="page" title="기본 템플릿" description="새 프로젝트가 처음부터 가질 워크플로입니다. 이미 있는 프로젝트는 그대로입니다.">
              <Stack gap="condensed">
                {WORKFLOW_TEMPLATES.map((template) => (
                  <Box key={template.key}>
                    <Field.Label variant="choice">
                      <Checkbox checked={workflows?.templates.includes(template.key) ?? false} disabled={!workflows || save.isPending} onCheckedChange={(on) => toggleTemplate(template.key, on === true)} />
                      {template.name}
                    </Field.Label>
                    <Text as="p" variant="caption" tone="muted" paddingLeft="spacious">{template.description}</Text>
                  </Box>
                ))}
              </Stack>
            </Section>

            <Section variant="page" title="저장한 워크플로" description="프로젝트의 워크플로 설정에서 '홈 기본값으로 저장'으로 올린 것입니다. 내용은 프로젝트에서 고친 뒤 다시 올립니다. 여기서는 이름과 설명만 바꾸고, 지울 수 있습니다.">
              <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">
                <DataTable
                  compact
                  id="default-workflows"
                  columns={columns}
                  rows={workflows?.saved}
                  rowId={(row) => row.id}
                  selected={search.saved}
                  empty={<EmptyState noun="저장한 워크플로" />}
                  onRowClick={(row) => void navigate({ search: { saved: row.id === search.saved ? undefined : row.id }, replace: true })}
                  rowLabel={(row) => row.name}
                />
              </Box>
            </Section>

            <Section variant="page" title="AI 결과">
              <AiAutoConfirmSetting target={{ kind: 'app' }} />
            </Section>
          </Box>
        </PageBody>
      </SplitPane>
    </Page>
  );
}

function SavedWorkflowPane({ workflow, pending, onClose, onSave, onDelete }: { workflow: SavedWorkflow; pending: boolean; onClose: () => void; onSave: (changed: Partial<Pick<SavedWorkflow, 'name' | 'description'>>) => void; onDelete: () => void }) {
  const saved = { name: workflow.name, description: workflow.description };
  const { draft, setDraft, dirty } = useFormFrom(saved, `default-workflow.${workflow.id}`);
  return (
    <Inspector
      header={<InspectorHeader kind="저장한 워크플로" name={workflow.name} onClose={onClose} />}
      footerStart={<DeleteButton label={`워크플로 '${workflow.name}'`} description="새로 만드는 프로젝트가 이 워크플로를 받지 않습니다. 이미 있는 프로젝트는 그대로입니다." pending={pending} onConfirm={onDelete} />}
      footer={
        <Button disabled={!draft.name.trim() || !dirty || pending} onClick={() => onSave(changedFields(draft, saved))}>
          저장
        </Button>
      }
    >
      <Section title="설정">
        <Box spaceY="normal">
          <Field label="이름">
            <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="설명">
            <Textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
          </Field>
        </Box>
      </Section>
    </Inspector>
  );
}
