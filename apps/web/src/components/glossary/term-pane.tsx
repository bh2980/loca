/** Detail panes for a glossary term: edit one, or add a new one. */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Inspector, InspectorHeader, InspectorSection, PropertyGrid, PropertyRow, TagListEditor, DirtyBar, DangerZone, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Input, Textarea } from '@loca/ui';
import { RunDialog } from '@/components/workflow/run-dialog';
import { confirmLabel, SourceBadge, StateCell, type ItemTag } from '@/components/knowledge/table';
import { isSettled, PALETTE, TAG_SCOPES, type KnowledgeOrigin, type KnowledgeStatus, type StatusBy } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { q, tagsIn } from '@/lib/queries';

export interface Term {
  id: string;
  source: string;
  target: string;
  note: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  statusBy: StatusBy;
  jobId?: string | null;
  evidence?: string[];
  lines: number | null;
  examples: string[];
  tags?: ItemTag[];
}
/** `?term=new` opens the pane for a term that does not exist yet. */
export const NEW_TERM = 'new';

/** The three editable fields of a term, shared by the new-term and edit panes. */
function TermFields({ form, onChange }: { form: { source: string; target: string; note: string }; onChange: (form: { source: string; target: string; note: string }) => void }) {
  return (
    <PropertyGrid>
      <PropertyRow label="원문">
        <Input aria-label="원문" value={form.source} onChange={(event) => onChange({ ...form, source: event.target.value })} />
      </PropertyRow>
      <PropertyRow label="번역">
        <Input aria-label="번역" value={form.target} onChange={(event) => onChange({ ...form, target: event.target.value })} />
      </PropertyRow>
      <PropertyRow label="메모">
        <Textarea aria-label="메모" rows={4} value={form.note} placeholder="선택" onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </PropertyRow>
    </PropertyGrid>
  );
}

export function NewTermPane({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ source: '', target: '', note: '' });
  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.$post({ param: { projectId }, json: form })),
    onSuccess: (created) => {
      toast.success('용어를 추가했습니다.');
      if (created && typeof created === 'object' && 'id' in created && typeof created.id === 'string') onCreated(created.id);
      else onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Inspector header={<InspectorHeader kind="용어" name="새 용어" onClose={onClose} />} footer={
        <Button disabled={!form.source.trim() || create.isPending} onClick={() => create.mutate()}>
          <Plus /> 추가
        </Button>
      }>
      <InspectorSection title="용어"><TermFields form={form} onChange={setForm} /></InspectorSection>
    </Inspector>
  );
}

const TERM_FIELD_LABEL = { source: '원문', target: '번역', note: '메모' };

export function TermEditor({ projectId, term, onClose, onDecide, deciding }: { projectId: string; term: Term; onClose: () => void; onDecide: (accept: boolean) => void; deciding: boolean }) {
  // Fields the person has not edited follow the saved term (a change from chat or a workflow shows);
  // the unsaved edit is kept per term, so moving to another term and back (or Back) keeps it.
  const saved = { source: term.source, target: term.target, note: term.note };
  const { draft: form, setDraft: setForm, dirty, conflicts, keepMine, takeSaved } = useFormFrom(saved, `term.${projectId}.${term.id}`);
  const candidate = !isSettled(term);
  const save = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms[':id'].$patch({ param: { projectId, id: term.id }, json: changedFields(form, saved) })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms[':id'].$delete({ param: { projectId, id: term.id } })),
    onSuccess: () => {
      toast.success('용어를 삭제했습니다.');
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const usage = useQuery(q.termUsage(projectId, term.id));
  const queryClient = useQueryClient();
  const statuses = useQuery(q.statuses(projectId));
  const termTags = tagsIn(statuses.data?.tags, 'terms');
  const attachedTags = (term.tags ?? [])
    .map((item) => statuses.data?.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const tagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      await unwrap(client.projects[':projectId']['knowledge-tags'].$post({
        param: { projectId },
        json: { kind: 'terms', ids: [term.id], tagId, add },
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: q.terms(projectId).queryKey });
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCreateTag = async (name: string) => {
    try {
      const color = (PALETTE[termTags.length % PALETTE.length] as any).light ?? PALETTE[termTags.length % PALETTE.length].hex;
      const created = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [...TAG_SCOPES] },
      }));
      await tagMutation.mutateAsync({ tagId: created.id, add: true });
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      toast.success(`'${name}' 태그를 만들고 용어에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  return (
    <Inspector
      header={<InspectorHeader kind="용어" name={term.source} status={
        <span className="flex items-center gap-2">
          <SourceBadge row={{ ...term, evidence: [] }} />
          <span>·</span>
          {term.status === 'candidate' ? <span>후보</span> : <StateCell row={{ ...term, evidence: [] }} />}
        </span>
      } onClose={onClose} />}
      footer={dirty ? <DirtyBar dirtyCount={Object.keys(changedFields(form, saved)).length} onRevert={takeSaved} onSave={() => save.mutate()} saving={save.isPending} disabled={!form.source.trim()} /> : (candidate ? <Button variant="outline" disabled={deciding || !term.target.trim()} onClick={() => onDecide(true)}><Check /> {confirmLabel([{ ...term, evidence: [] }])}</Button> : null)}
    >
      {conflicts.length > 0 && <ChangedElsewhere fields={conflicts.map((field) => TERM_FIELD_LABEL[field as keyof typeof TERM_FIELD_LABEL])} onTakeSaved={takeSaved} onKeepMine={keepMine} />}
      <InspectorSection title="기본 정보">
        <TermFields form={form} onChange={setForm} />
      </InspectorSection>
      <InspectorSection title="태그">
        <PropertyGrid>
          <PropertyRow label="태그">
            <TagListEditor
              tags={attachedTags}
              allTags={termTags}
              onToggle={(tagId, add) => tagMutation.mutate({ tagId, add })}
              onCreate={handleCreateTag}
              heading="태그"
            />
          </PropertyRow>
        </PropertyGrid>
      </InspectorSection>
      {candidate && <div className="flex justify-end"><Button variant="outline" disabled={deciding || dirty || !term.target.trim()} title={term.target.trim() ? (dirty ? '먼저 저장하세요.' : undefined) : '번역을 채운 뒤 확정할 수 있습니다.'} onClick={() => onDecide(true)}><Check /> {confirmLabel([{ ...term, evidence: [] }])}</Button></div>}
      <InspectorSection
        title={`등장 대사 ${usage.data?.count ?? "…"}`}
        actions={
          !!usage.data?.count && (
            <RunDialog
              projectId={projectId}
              unitIds={usage.data.unitIds}
              defaultIgnoreStatus
              trigger={<Button variant="outline"><Play /> 실행 · {usage.data.count}줄</Button>}
            />
          )
        }
      >
        <ul className="max-h-60 space-y-1 overflow-auto">
          {usage.data?.rows.map((row) => <li key={row.id}><Link to="/p/$projectId/script" params={{ projectId }} search={{ group: row.groupId, line: row.id }} className="block rounded px-2 py-1 text-sm hover:bg-muted"><span className="text-xs text-muted-foreground">{row.groupTitle} · </span>{row.speaker && <span className="font-medium">{row.speaker}: </span>}{row.source}{row.translation && <span className="block text-muted-foreground">{row.translation}</span>}</Link></li>)}
        </ul>
      </InspectorSection>
      <DangerZone title="용어 삭제">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="text-destructive">
                <Trash2 /> 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>용어를 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>“{term.source}” 용어가 용어집에서 사라집니다. 이미 번역된 대사는 바뀌지 않습니다.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {candidate && (
            <Button variant="ghost" className="text-destructive" disabled={deciding} onClick={() => onDecide(false)}>버리기</Button>
          )}
      </DangerZone>
    </Inspector>
  );
}
