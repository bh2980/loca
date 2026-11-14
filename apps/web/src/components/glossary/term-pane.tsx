import { createAndAttachTag } from '@/lib/create-tag';
/** Detail panes for a glossary term: edit one, or add a new one. */
import { CopyButton } from '@/components/copy-button';
import { useMemo, useState } from 'react';
import { useInspectorTab } from '@/lib/inspector-tab';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Inspector, InspectorHeader, InspectorList, InspectorTabs, TagListEditor, DirtyBar, Button, Inline, Input, ListRow, Text, Textarea, Section, Field, Box, Checkbox, Label, Stack, Switch, ConfirmDialog, SegmentedControl } from '@loca/ui';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AiNamed, confirmLabel, SourceBadge, StateCell } from '@/components/knowledge/table';
import { ALL_TERM_KINDS, isSettled, TAG_SCOPES, TERM_LINE_KIND_LABELS, TERM_LINE_KINDS, TERM_MODE_LABELS, TERM_MODES, type TermMode, type TermScope } from '@loca/shared';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { q, tagsIn } from '@/lib/queries';
import { useTaxonomy } from '@/lib/knowledge';
import { useLines } from '@/lib/units';
import { useGroupsById } from '@/lib/groups';
import type { Term } from '@/lib/terms';
import { createTerm, saveTerm, deleteTerm, tagTerms } from '@/lib/terms';

/** `?term=new` opens the pane for a term that does not exist yet. */
export const NEW_TERM = 'new';

type TermForm = { source: string; mode: TermMode; target: string; alternatives: string[]; note: string; scope: TermScope; matchCase: boolean };

/** What each 종류 asks of a translation, under the picker. */
const MODE_HELP: Record<TermMode, string> = {
  fixed: '번역에 이 번역어를 그대로 씁니다. 없으면 용어 위반입니다.',
  choices: '기본 번역어나 허용 번역어 중 문맥에 맞는 것을 씁니다. 하나도 없을 때만 위반입니다.',
  guide: '정해진 말 없이 지침의 뜻·느낌을 문맥에 맞게 옮깁니다. 위반으로 잡지 않습니다.',
};

/** The editable fields of a term, shared by the new-term and edit panes. */
function TermFields({ form, onChange }: { form: TermForm; onChange: (form: TermForm) => void }) {
  return (
    <Box spaceY="normal">
      <Field label="원문" action={form.source ? <CopyButton value={form.source} label="원문 복사" /> : undefined}>
        <Input value={form.source} onChange={(event) => onChange({ ...form, source: event.target.value })} />
      </Field>
      <Field label="종류" description={MODE_HELP[form.mode]}>
        <SegmentedControl ariaLabel="용어 종류" value={form.mode} onChange={(mode) => onChange({ ...form, mode: mode as TermMode })} items={TERM_MODES.map((mode) => ({ value: mode, label: TERM_MODE_LABELS[mode] }))} />
      </Field>
      <Field label={form.mode === 'choices' ? '기본 번역어' : form.mode === 'guide' ? '예시' : '번역'} action={form.target ? <CopyButton value={form.target} label="번역 복사" /> : undefined}>
        <Input value={form.target} placeholder={form.mode === 'guide' ? '선택 · 이렇게 옮길 수 있다는 예' : undefined} onChange={(event) => onChange({ ...form, target: event.target.value })} />
      </Field>
      {form.mode === 'choices' && (
        <Field label="허용 번역어" description="문맥에 따라 기본 번역어 대신 써도 되는 말입니다.">
          <Box spaceY="condensed">
            {form.alternatives.map((alternative, index) => (
              <Inline key={index} gap="condensed">
                <Input aria-label={`허용 번역어 ${index + 1}`} value={alternative} onChange={(event) => onChange({ ...form, alternatives: form.alternatives.map((other, at) => (at === index ? event.target.value : other)) })} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`허용 번역어 ${index + 1} 빼기`} onClick={() => onChange({ ...form, alternatives: form.alternatives.filter((_, at) => at !== index) })}>
                  <X />
                </Button>
              </Inline>
            ))}
            <Button type="button" variant="outline" onClick={() => onChange({ ...form, alternatives: [...form.alternatives, ''] })}>
              <Plus /> 허용 번역어 추가
            </Button>
          </Box>
        </Field>
      )}
      <Field label={form.mode === 'guide' ? '지침' : '메모'}>
        <Textarea rows={4} value={form.note} placeholder={form.mode === 'guide' ? '어떤 뜻·느낌으로 옮길지 (AI에게 그대로 전해집니다)' : '선택'} onChange={(event) => onChange({ ...form, note: event.target.value })} />
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
  const [form, setForm] = useState<TermForm>({ source: '', mode: 'fixed', target: '', alternatives: [], note: '', scope: ALL_TERM_KINDS, matchCase: false });
  const create = useMutation({
    mutationFn: () => createTerm(projectId, { ...form, alternatives: form.alternatives.map((alternative) => alternative.trim()).filter(Boolean) }),
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

type TermTab = 'term' | 'uses';
const TERM_TABS = ['term', 'uses'] as const;

const TERM_FIELD_LABEL = { source: '원문', mode: '종류', target: '번역', alternatives: '허용 번역어', note: '메모', scope: '적용 범위', matchCase: '대소문자 일치' };

export function TermEditor({ projectId, term, onClose, onDecide, deciding }: { projectId: string; term: Term; onClose: () => void; onDecide: (accept: boolean) => void; deciding: boolean }) {
  // Fields the person has not edited follow the saved term (a change from chat or a workflow shows);
  // the unsaved edit is kept per term, so moving to another term and back (or Back) keeps it.
  const saved: TermForm = { source: term.source, mode: term.mode, target: term.target, alternatives: term.alternatives, note: term.note, scope: term.scope, matchCase: term.matchCase };
  const { draft: form, setDraft: setForm, dirty, conflicts, keepMine, takeSaved } = useFormFrom(saved, `term.${projectId}.${term.id}`);
  const candidate = !isSettled(term);
  const save = useMutation({
    mutationFn: () => {
      const changed = changedFields(form, saved);
      return saveTerm(projectId, term.id, { ...changed, ...(changed.alternatives && { alternatives: changed.alternatives.map((alternative) => alternative.trim()).filter(Boolean) }) });
    },
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  // 메인으로: the candidate becomes the form used; the former main one stays a candidate (server side).
  const makeMain = useMutation({
    mutationFn: (target: string) => saveTerm(projectId, term.id, { target }),
    onSuccess: (_, target) => toast.success(`'${target}'을(를) 메인 번역어로 바꿨습니다.`),
    onError: (error) => toast.error(error.message),
  });
  // 허용으로 (후보): an offered form becomes one a translation may use.
  const allow = useMutation({
    mutationFn: (form: string) => saveTerm(projectId, term.id, { alternatives: [...term.alternatives, form] }),
    onSuccess: (_, form) => toast.success(`'${form}'을(를) 허용 번역어로 넣었습니다.`),
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteTerm(projectId, term.id),
    onSuccess: () => {
      toast.success('용어를 삭제했습니다.');
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const usage = useQuery(q.termUsage(projectId, term.id));
  const [tab, setTab] = useInspectorTab<TermTab>(TERM_TABS);
  const [allUses, setAllUses] = useState(false);
  // Which lines use the term is the question; the first of them come from the units collection.
  const useIds = useMemo(() => usage.data?.unitIds.slice(0, 100), [usage.data]);
  const uses = useLines(projectId, useIds).rows ?? [];
  const groupOf = useGroupsById(projectId);
  const taxonomy = useTaxonomy(projectId);
  const termTags = tagsIn(taxonomy.tags, 'terms');
  const attachedTags = (term.tags ?? [])
    .map((item) => taxonomy.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const tagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      await tagTerms(projectId, [term.id], tagId, add);
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
    <Inspector footerStart={<><ConfirmDialog
            trigger={<Button variant="ghost" tone="danger"><Trash2 /> 용어 삭제</Button>}
            title="용어를 삭제할까요?"
            description={`“${term.source}” 용어가 용어집에서 사라집니다. 이미 번역된 대사는 바뀌지 않습니다.`}
            onConfirm={() => remove.mutate()}
          />
          {candidate && (
            <Button variant="ghost" tone="danger" disabled={deciding} onClick={() => onDecide(false)}>버리기</Button>
          )}</>}
      header={<InspectorHeader kind="용어" name={<AiNamed row={term}>{term.source}</AiNamed>} status={
        <Inline as="span" gap="condensed">
          <SourceBadge row={{ ...term, evidence: [] }} />
          <span>·</span>
          {term.status === 'candidate' ? <span>후보</span> : <StateCell row={{ ...term, evidence: [] }} />}
        </Inline>
      } onClose={onClose} />}
      tabs={
        <>
          {conflicts.length > 0 && <Section><ChangedElsewhere fields={conflicts.map((field) => TERM_FIELD_LABEL[field as keyof typeof TERM_FIELD_LABEL])} onTakeSaved={takeSaved} onKeepMine={keepMine} /></Section>}
          <InspectorTabs<TermTab>
            value={tab}
            onChange={setTab}
            items={[
              { value: 'term', label: '용어', attention: dirty },
              { value: 'uses', label: '등장 대사', count: usage.data?.count ?? null },
            ]}
          />
        </>
      }
      scrollKey={tab}
      footer={dirty ? <DirtyBar dirtyCount={Object.keys(changedFields(form, saved)).length} onRevert={takeSaved} onSave={() => save.mutate()} saving={save.isPending} disabled={!form.source.trim()} /> : (candidate ? <Button variant="outline" disabled={deciding || !term.target.trim()} onClick={() => onDecide(true)}><Check /> {confirmLabel([{ ...term, evidence: [] }])}</Button> : null)}
    >
      {tab === 'term' ? (
        <>
          <Section>
            <TermFields form={form} onChange={setForm} />
          </Section>
          {term.targetCandidates.length > 0 && (
            <Section title={`다른 번역어 ${term.targetCandidates.length}`}>
              <InspectorList>
                {term.targetCandidates.map((form) => (
                  <ListRow key={form}>
                    <Inline justify="between" align="center" gap="normal">
                      <Text>{form}</Text>
                      <Inline gap="tight">
                        {term.mode === 'choices' && <Button variant="ghost" disabled={dirty || allow.isPending} onClick={() => allow.mutate(form)}>허용으로</Button>}
                        <Button variant="ghost" disabled={dirty || makeMain.isPending} onClick={() => makeMain.mutate(form)}>메인으로</Button>
                      </Inline>
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
        </>
      ) : (
        <Section
          title="등장 대사"
          count={usage.data?.count ?? '…'}
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
          {usage.data && usage.data.count === 0 ? (
            <Text as="p" variant="body" tone="muted">이 용어가 나오는 대사가 없습니다.</Text>
          ) : (
            <InspectorList>
              {(allUses ? uses : uses.slice(0, USES_SHOWN)).map((row) => <li key={row.id}><ListRow as="link" variant="line" inset><Link to="/p/$projectId/script" params={{ projectId }} search={{ group: row.groupId, line: row.id }}><Text variant="caption" tone="muted">{groupOf.get(row.groupId)?.title} · </Text>{row.speaker && <Text weight="medium">{row.speaker}: </Text>}{row.source}{row.translation && <Text display="block" tone="muted">{row.translation}</Text>}</Link></ListRow></li>)}
            </InspectorList>
          )}
          {uses.length > USES_SHOWN && (
            <Button variant="ghost" size="inline" onClick={() => setAllUses((open) => !open)}>{allUses ? '접기' : `${uses.length - USES_SHOWN}개 더 보기`}</Button>
          )}
          {allUses && (usage.data?.count ?? 0) > uses.length && (
            <Text as="p" variant="caption" tone="muted">앞의 {uses.length}줄만 보입니다. 모두 고치려면 실행을 씁니다.</Text>
          )}
        </Section>
      )}
    </Inspector>
  );
}
