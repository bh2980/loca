import { createAndAttachTag } from '@/lib/create-tag';
/** Detail panes for a glossary term: edit one, or add a new one. */
import { CopyButton } from '@/components/copy-button';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Inspector, InspectorHeader, InspectorList, TagListEditor, DirtyBar, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Inline, Input, ListRow, Text, Textarea, Section, Field, Box, Checkbox, Label, Stack, Switch } from '@loca/ui';
import { RunDialog } from '@/components/workflow/run-dialog';
import { confirmLabel, SourceBadge, StateCell, type ItemTag } from '@/components/knowledge/table';
import { ALL_TERM_KINDS, isSettled, TAG_SCOPES, TERM_LINE_KIND_LABELS, TERM_LINE_KINDS, type KnowledgeOrigin, type KnowledgeStatus, type StatusBy, type TermScope } from '@tw/shared';
import { client } from '@/lib/api';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { q, tagsIn } from '@/lib/queries';
import { sent } from '@/lib/collections';
import { useTaxonomy } from '@/lib/knowledge';

export interface Term {
  id: string;
  source: string;
  target: string;
  note: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  statusBy: StatusBy;
  evidence?: string[];
  lines: number | null;
  examples: string[];
  scope: TermScope;
  matchCase: boolean;
  /** Other Korean forms (a former main one, an AI's), newest first. */
  targetCandidates: string[];
  duplicateTarget?: boolean;
  tags?: ItemTag[];
}
/** `?term=new` opens the pane for a term that does not exist yet. */
export const NEW_TERM = 'new';

type TermForm = { source: string; target: string; note: string; scope: TermScope; matchCase: boolean };

/** The editable fields of a term, shared by the new-term and edit panes. */
function TermFields({ form, onChange }: { form: TermForm; onChange: (form: TermForm) => void }) {
  return (
    <Box spaceY="normal">
      <Field label="원문" action={form.source ? <CopyButton value={form.source} label="원문 복사" /> : undefined}>
        <Input value={form.source} onChange={(event) => onChange({ ...form, source: event.target.value })} />
      </Field>
      <Field label="번역" action={form.target ? <CopyButton value={form.target} label="번역 복사" /> : undefined}>
        <Input value={form.target} onChange={(event) => onChange({ ...form, target: event.target.value })} />
      </Field>
      <Field label="메모">
        <Textarea rows={4} value={form.note} placeholder="선택" onChange={(event) => onChange({ ...form, note: event.target.value })} />
      </Field>
      <Field label="적용 범위" description="버튼 이름처럼 UI에만 쓰는 말은 UI만 두면 대사 속 같은 낱말에는 걸리지 않습니다.">
        <Stack direction="row" wrap gap="comfortable" role="group" aria-label="적용 범위">
          {TERM_LINE_KINDS.map((kind) => (
            <Inline key={kind} gap="condensed">
              <Checkbox
                id={`term-scope-${kind}`}
                checked={form.scope.includes(kind)}
                // At least one kind stays.
                disabled={form.scope.length === 1 && form.scope.includes(kind)}
                onCheckedChange={(on) => onChange({ ...form, scope: TERM_LINE_KINDS.filter((other) => (other === kind ? on === true : form.scope.includes(other))) })}
              />
              <Label htmlFor={`term-scope-${kind}`}>{TERM_LINE_KIND_LABELS[kind]}</Label>
            </Inline>
          ))}
        </Stack>
      </Field>
      <Field orientation="horizontal">
        <Switch id="term-match-case" checked={form.matchCase} onCheckedChange={(matchCase) => onChange({ ...form, matchCase })} />
        <Field.Label htmlFor="term-match-case">대소문자 일치</Field.Label>
      </Field>
    </Box>
  );
}

export function NewTermPane({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState<TermForm>({ source: '', target: '', note: '', scope: ALL_TERM_KINDS, matchCase: false });
  const create = useMutation({
    mutationFn: () => sent(projectId, client.projects[':projectId'].terms.$post({ param: { projectId }, json: form })),
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
      <Section title="용어"><TermFields form={form} onChange={setForm} /></Section>
    </Inspector>
  );
}

/** How many lines of 등장 대사 show before 더 보기. */
const USES_SHOWN = 5;

const TERM_FIELD_LABEL = { source: '원문', target: '번역', note: '메모', scope: '적용 범위', matchCase: '대소문자 일치' };

export function TermEditor({ projectId, term, onClose, onDecide, deciding }: { projectId: string; term: Term; onClose: () => void; onDecide: (accept: boolean) => void; deciding: boolean }) {
  // Fields the person has not edited follow the saved term (a change from chat or a workflow shows);
  // the unsaved edit is kept per term, so moving to another term and back (or Back) keeps it.
  const saved: TermForm = { source: term.source, target: term.target, note: term.note, scope: term.scope, matchCase: term.matchCase };
  const { draft: form, setDraft: setForm, dirty, conflicts, keepMine, takeSaved } = useFormFrom(saved, `term.${projectId}.${term.id}`);
  const candidate = !isSettled(term);
  const save = useMutation({
    mutationFn: () => sent(projectId, client.projects[':projectId'].terms[':id'].$patch({ param: { projectId, id: term.id }, json: changedFields(form, saved) })),
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  // 메인으로: the candidate becomes the form used; the former main one stays a candidate (server side).
  const makeMain = useMutation({
    mutationFn: (target: string) => sent(projectId, client.projects[':projectId'].terms[':id'].$patch({ param: { projectId, id: term.id }, json: { target } })),
    onSuccess: (_, target) => toast.success(`'${target}'을(를) 메인 번역어로 바꿨습니다.`),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => sent(projectId, client.projects[':projectId'].terms[':id'].$delete({ param: { projectId, id: term.id } })),
    onSuccess: () => {
      toast.success('용어를 삭제했습니다.');
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const usage = useQuery(q.termUsage(projectId, term.id));
  const [allUses, setAllUses] = useState(false);
  const uses = usage.data?.rows ?? [];
  const shownUses = allUses ? uses : uses.slice(0, USES_SHOWN);
  const taxonomy = useTaxonomy(projectId);
  const termTags = tagsIn(taxonomy.tags, 'terms');
  const attachedTags = (term.tags ?? [])
    .map((item) => taxonomy.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const tagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      await sent(projectId, client.projects[':projectId']['knowledge-tags'].$post({
        param: { projectId },
        json: { kind: 'terms', ids: [term.id], tagId, add },
      }));
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCreateTag = async (name: string) => {
    try {
      await createAndAttachTag(projectId, name, termTags.length, [...TAG_SCOPES], (tagId) => tagMutation.mutateAsync({ tagId: tagId, add: true }));
      toast.success(`'${name}' 태그를 만들고 용어에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  return (
    <Inspector footerStart={<><AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" tone="danger">
                <Trash2 /> 용어 삭제
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
            <Button variant="ghost" tone="danger" disabled={deciding} onClick={() => onDecide(false)}>버리기</Button>
          )}</>}
      header={<InspectorHeader kind="용어" name={term.source} status={
        <Inline as="span" gap="condensed">
          <SourceBadge row={{ ...term, evidence: [] }} />
          <span>·</span>
          {term.status === 'candidate' ? <span>후보</span> : <StateCell row={{ ...term, evidence: [] }} />}
        </Inline>
      } onClose={onClose} />}
      footer={dirty ? <DirtyBar dirtyCount={Object.keys(changedFields(form, saved)).length} onRevert={takeSaved} onSave={() => save.mutate()} saving={save.isPending} disabled={!form.source.trim()} /> : (candidate ? <Button variant="outline" disabled={deciding || !term.target.trim()} onClick={() => onDecide(true)}><Check /> {confirmLabel([{ ...term, evidence: [] }])}</Button> : null)}
    >
      {conflicts.length > 0 && <Section><ChangedElsewhere fields={conflicts.map((field) => TERM_FIELD_LABEL[field as keyof typeof TERM_FIELD_LABEL])} onTakeSaved={takeSaved} onKeepMine={keepMine} /></Section>}
      <Section title="용어">
        <TermFields form={form} onChange={setForm} />
      </Section>
      {term.targetCandidates.length > 0 && (
        <Section title={`다른 번역어 ${term.targetCandidates.length}`}>
          <InspectorList>
            {term.targetCandidates.map((form) => (
              <ListRow key={form}>
                <Inline justify="between" align="center" gap="normal">
                  <Text>{form}</Text>
                  <Button variant="ghost" disabled={dirty || makeMain.isPending} onClick={() => makeMain.mutate(form)}>메인으로</Button>
                </Inline>
              </ListRow>
            ))}
          </InspectorList>
        </Section>
      )}
      <Section title="태그">
        <TagListEditor
          tags={attachedTags}
          allTags={termTags}
          onToggle={(tagId, add) => tagMutation.mutate({ tagId, add })}
          onCreate={handleCreateTag}
          heading="용어에 붙일 태그"
        />
      </Section>
      <Section
        defaultOpen={false}
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
        {usage.data && usage.data.rows.length === 0 ? (
          <Text as="p" variant="body" tone="muted">이 용어가 나오는 대사가 없습니다.</Text>
        ) : (
          <InspectorList>
            {shownUses.map((row) => <li key={row.id}><ListRow as="link" variant="line" inset><Link to="/p/$projectId/script" params={{ projectId }} search={{ group: row.groupId, line: row.id }}><Text variant="caption" tone="muted">{row.groupTitle} · </Text>{row.speaker && <Text weight="medium">{row.speaker}: </Text>}{row.source}{row.translation && <Text display="block" tone="muted">{row.translation}</Text>}</Link></ListRow></li>)}
          </InspectorList>
        )}
        {uses.length > USES_SHOWN && (
          <Button variant="ghost" size="inline" onClick={() => setAllUses((open) => !open)}>{allUses ? '접기' : `${uses.length - USES_SHOWN}개 더 보기`}</Button>
        )}
      </Section>
    </Inspector>
  );
}
