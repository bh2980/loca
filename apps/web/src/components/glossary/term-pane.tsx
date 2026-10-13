/** Detail panes for a glossary term: edit one, or add a new one. */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { confirmLabel, SourceBadge, StateCell, type ItemTag } from '@/components/knowledge/table';
import { isSettled, type KnowledgeOrigin, type KnowledgeStatus, type StatusBy } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { q } from '@/lib/queries';

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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="term-source">원문</Label>
        <Input id="term-source" value={form.source} onChange={(event) => onChange({ ...form, source: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-target">번역</Label>
        <Input id="term-target" value={form.target} onChange={(event) => onChange({ ...form, target: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="term-note">메모</Label>
        <Textarea id="term-note" rows={4} value={form.note} placeholder="선택" onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </div>
    </div>
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
    <DetailPane
      kicker="용어"
      title="새 용어"
      onClose={onClose}
      footer={
        <Button className="ml-auto" disabled={!form.source.trim() || create.isPending} onClick={() => create.mutate()}>
          <Plus /> 추가
        </Button>
      }
    >
      <TermFields form={form} onChange={setForm} />
    </DetailPane>
  );
}

export function TermEditor({ projectId, term, onClose, onDecide, deciding }: { projectId: string; term: Term; onClose: () => void; onDecide: (accept: boolean) => void; deciding: boolean }) {
  // Follows the saved term (a change from chat or a workflow shows) until the person has edited it.
  const saved = { source: term.source, target: term.target, note: term.note };
  const { draft: form, setDraft: setForm, dirty } = useFormFrom(saved);
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

  return (
    <DetailPane
      kicker="용어"
      title={term.source}
      subtitle={
        <span className="flex items-center gap-2">
          <SourceBadge row={{ ...term, evidence: [] }} />
          <span>·</span>
          {term.status === 'candidate' ? <span>후보 · 아직 문맥에 쓰이지 않음</span> : <StateCell row={{ ...term, evidence: [] }} />}
        </span>
      }
      onClose={onClose}
      footer={
        <>
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
            <>
              <Button variant="ghost" className="text-destructive" disabled={deciding} onClick={() => onDecide(false)}>
                버리기
              </Button>
              <Button variant="outline" disabled={deciding || dirty || !term.target.trim()} title={term.target.trim() ? (dirty ? '먼저 저장하세요.' : undefined) : '번역을 채운 뒤 확정할 수 있습니다.'} onClick={() => onDecide(true)}>
                <Check /> {confirmLabel([{ ...term, evidence: [] }])}
              </Button>
            </>
          )}
          <Button className="ml-auto" disabled={!dirty || !form.source.trim() || save.isPending} onClick={() => save.mutate()}>
            저장
          </Button>
        </>
      }
    >
      <TermFields form={form} onChange={setForm} />
      <PaneSection
        title={`이 용어가 나오는 대사 ${usage.data?.count ?? '…'}개`}
        actions={
          !!usage.data?.count && (
            <RunDialog
              projectId={projectId}
              unitIds={usage.data.unitIds}
              defaultIgnoreStatus
              trigger={
                <Button variant="outline">
                  <Play /> 워크플로 실행 · {usage.data.count}줄
                </Button>
              }
            />
          )
        }
      >
        <p className="mb-2 text-xs text-muted-foreground">번역어를 바꿨다면 이 대사들만 골라 워크플로를 실행해 새 번역어를 반영합니다(실행 창에서 워크플로를 고름).</p>
        <ul className="max-h-60 space-y-1 overflow-auto">
          {usage.data?.rows.map((row) => (
            <li key={row.id}>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: row.groupId, line: row.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
                <span className="text-muted-foreground">{row.groupTitle} · </span>
                {row.speaker && <span className="font-medium">{row.speaker}: </span>}
                {row.source}
                {row.translation && <span className="block text-muted-foreground">{row.translation}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </PaneSection>
    </DetailPane>
  );
}
