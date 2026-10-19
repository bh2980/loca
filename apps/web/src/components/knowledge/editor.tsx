/** The detail editor for one knowledge item: fields, unsaved edits that survive navigation, decide/discard. */
import { cloneElement, isValidElement, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_KINDS, STYLE_AXES, type StyleAxis, type CharacterRole, type Gender, type AgeBand, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, isSettled, AGE_BAND_LABELS, CHARACTER_ROLE_LABELS, GENDER_LABELS, PALETTE, knowledgeKindScope, type TagScope, type KnowledgeTagKind } from '@tw/shared';
import { Inspector, InspectorHeader, InspectorBlock, InspectorSection, InspectorFields, InspectorField, InspectorToggle, useControlId, TagListEditor, DirtyBar, DangerZone, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, AiMark } from '@loca/ui';
import { ChipInput, joinList, splitList } from '@/components/chip-input';
import { useDraft } from '@/lib/drafts';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { DOCUMENT_KIND } from '@/lib/labels';
import { Evidence, StretchPicker } from '@/components/knowledge/evidence';
import { confirmLabel, fail, KINDS, SourceBadge, text, type Kind, type KindSpec, type Row, type Field } from '@/components/knowledge/table';
import { client, unwrap } from '@/lib/api';
import { q, tagsIn } from '@/lib/queries';

/** A field's value in the draft (the form is kept as JSON in sessionStorage). */
type Value = string | boolean | string[] | Record<string, string> | null;

/**
 * Edit one item (unsaved edits survive navigation), see its evidence, and make it official or
 * discard it while it is AI's. As a right-hand pane, or embedded in another pane (a pair's detail).
 */
export function DraftEditor({ projectId, kind, spec, row, characters, onClose, onDecide, embedded }: {
  projectId: string;
  kind: Kind;
  spec: KindSpec;
  row: Row;
  characters: { id: string; name: string }[];
  onClose?: () => void;
  onDecide: (action: 'confirm' | 'discard') => void;
  embedded?: boolean;
}) {
  const saved = JSON.stringify(Object.fromEntries(spec.fields.map((field) => [field.name, row[field.name] ?? null])));
  const [draft, setDraft, clearDraft] = useDraft(`knowledge.${kind}.${row.id}`, saved);
  // What the item was when editing began: if it changes elsewhere meanwhile (a chat proposal
  // accepted, another window), the unsaved edit must not quietly hide the new value.
  const [base, setBase, clearBase] = useDraft(`knowledge-base.${kind}.${row.id}`, '');
  const form = JSON.parse(draft) as Record<string, Value>;
  const dirty = draft !== saved;
  const changedElsewhere = dirty && Boolean(base) && base !== saved;
  const clear = () => {
    clearDraft();
    clearBase();
  };
  const update = (name: string, value: Value) => {
    if (!dirty) setBase(saved);
    setDraft(JSON.stringify({ ...form, [name]: value }));
  };
  const save = useMutation({
    // Sends the draft as it was when saving began; typing goes on while it is on its way.
    mutationFn: (sent: string) => spec.save(row.id, JSON.parse(sent) as Record<string, Value>),
    onSuccess: (_data, sent) => {
      // Edits typed after it stay a draft, and now differ from what was just saved (not from an outside change).
      if (clearDraft(sent)) clearBase();
      else setBase(sent);
      toast.success('저장했습니다. 사람이 고친 항목이라 다시 분석해도 바뀌지 않습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => spec.remove(row.id), onSuccess: onClose, onError: fail });
  const official = isSettled(row);

  const queryClient = useQueryClient();
  const statuses = useQuery(q.statuses(projectId));
  const tagKind = kind as KnowledgeTagKind;
  const scope: TagScope = tagKind ? knowledgeKindScope(tagKind) : 'documents';
  const knowledgeTags = tagsIn(statuses.data?.tags, scope);
  const attachedTags = (row.tags ?? [])
    .map((item) => statuses.data?.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const tagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      await unwrap(client.projects[':projectId']['knowledge-tags'].$post({
        param: { projectId },
        json: { kind, ids: [row.id], tagId, add },
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: fail,
  });

  const handleCreateTag = async (name: string) => {
    try {
      const color = (PALETTE[knowledgeTags.length % PALETTE.length] as any).light ?? PALETTE[knowledgeTags.length % PALETTE.length].hex;
      const created = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [scope] },
      }));
      await tagMutation.mutateAsync({ tagId: created.id, add: true });
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      toast.success(`'${name}' 태그를 만들고 항목에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const longFields = spec.fields.filter((field) => field.type === 'long');
  const styleFields = spec.fields.filter((field) => field.type === 'style');
  const basicFields = spec.fields.filter((field) => field.type !== 'long' && field.type !== 'style');

  const fieldView = (field: Field) => {
    const value = form[field.name];
    const change = (next: Value) => update(field.name, next);
    if (field.type === 'bool') return <InspectorToggle key={field.name} label={field.label} description={field.description} checked={Boolean(value)} onChange={change} />;
    if (field.type === 'key')
      return <StartKeyField key={field.name} projectId={projectId} field={field} value={text(value)} from={text(form.fromName)} to={text(form.toName)} onChange={change} />;
    return (
      <InspectorField key={field.name} label={field.label} description={field.description}>
        <FieldInput field={field} value={value} characters={characters} onChange={change} />
      </InspectorField>
    );
  };
  const styleView = (field: Field) => <StyleFields key={field.name} value={form[field.name] as Record<string, string> | null} onChange={(next) => update(field.name, next)} />;
  const tagsView = row.id && !embedded && (
    <InspectorField label="태그">
      <TagListEditor tags={attachedTags} allTags={knowledgeTags} onToggle={(tagId, add) => tagMutation.mutate({ tagId, add })} onCreate={handleCreateTag} heading="태그" />
    </InspectorField>
  );
  // Parts such as a rule's lines sit inside a section of their own in a pane, and under a small heading when embedded.
  const extra = spec.extra?.(row);
  const extraView = embedded && isValidElement<{ embedded?: boolean }>(extra) ? cloneElement(extra, { embedded: true }) : extra;

  const body = embedded ? (
    <div className="space-y-4">
      {changedElsewhere && <ChangedElsewhere onTakeSaved={clear} onKeepMine={() => setBase(saved)} />}
      <InspectorFields>
        {basicFields.map(fieldView)}
        {longFields.map(fieldView)}
        {styleFields.map(styleView)}
      </InspectorFields>
      {extraView}
      <Evidence projectId={projectId} keys={row.evidence} embedded />
    </div>
  ) : (
    <>
      {changedElsewhere && <InspectorBlock><ChangedElsewhere onTakeSaved={clear} onKeepMine={() => setBase(saved)} /></InspectorBlock>}
      <InspectorSection title="기본 정보">
        <InspectorFields>
          {basicFields.map(fieldView)}
          {tagsView}
        </InspectorFields>
      </InspectorSection>
      {longFields.length > 0 && (
        <InspectorSection title="내용">
          <InspectorFields>{longFields.map(fieldView)}</InspectorFields>
        </InspectorSection>
      )}
      {styleFields.length > 0 && (
        <InspectorSection title="문체">
          <InspectorFields>{styleFields.map(styleView)}</InspectorFields>
        </InspectorSection>
      )}
      {extraView}
      <Evidence projectId={projectId} keys={row.evidence} />
    </>
  );
  const confirm = (className?: string) => (
    <Button className={className} disabled={save.isPending} onClick={() => onDecide('confirm')}>
      <Check /> {confirmLabel([row])}
    </Button>
  );
  const deleteButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-destructive">
          <Trash2 /> 삭제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>사람이 정한 항목을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>“{spec.label(row)}”이(가) 사라지고 더 이상 AI 문맥에 쓰이지 않습니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const discardButton = (
    <Button variant="ghost" className="text-destructive" onClick={() => onDecide('discard')}>
      <Trash2 /> 버리기
    </Button>
  );
  const dirtyBar = <DirtyBar dirtyCount={1} onRevert={clear} onSave={() => save.mutate(draft)} saving={save.isPending} />;
  if (embedded)
    return (
      <div className="space-y-4">
        {body}
        <div className="flex flex-wrap items-center gap-2">
          {official ? deleteButton : discardButton}
          {dirty ? dirtyBar : !official ? confirm('ml-auto') : null}
        </div>
      </div>
    );
  return (
    <Inspector
      header={<InspectorHeader kind={KINDS[kind]} name={spec.label(row)} status={
        <span className="flex items-center gap-1.5">
          <SourceBadge row={row} />
          <span>·</span>
          {row.status === 'candidate' ? <span>후보</span> : <span className="inline-flex items-center gap-1">확정 <AiMark by={row.statusBy} /></span>}
        </span>
      } onClose={onClose} />}
      footer={dirty ? dirtyBar : !official ? confirm() : null}
    >
      {body}
      <DangerZone title={official ? '삭제' : '후보'}>{official ? deleteButton : discardButton}</DangerZone>
    </Inspector>
  );
}

/** 시작 대사: the key of the line a speech rule starts at, picked from the speaker's lines to that listener. */
function StartKeyField({ projectId, field, value, from, to, onChange }: { projectId: string; field: Field; value: string; from: string; to: string; onChange: (value: Value) => void }) {
  const [picking, setPicking] = useState(false);
  const line = useQuery(q.linesByKeys(projectId, value ? [value] : []));
  const source = line.data?.[0]?.source;
  return (
    <InspectorField
      label={field.label}
      description={value ? (source ? `“${source}”부터` : undefined) : '비우면 처음부터 적용됩니다.'}
      action={
        <Button variant="ghost" size="inline" aria-pressed={picking} onClick={() => setPicking((open) => !open)}>
          대사 고르기
        </Button>
      }
    >
      <Input className="font-mono text-sm" value={value} onChange={(event) => onChange(event.target.value.trim() || null)} />
      {picking && (
        <StretchPicker
          projectId={projectId}
          from={from}
          to={to}
          taken={new Set()}
          onPick={(key) => {
            onChange(key);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </InspectorField>
  );
}

/** One pick per axis; 보통 leaves the axis out of the prompt. */
function StyleFields({ value, onChange }: { value: Record<string, string> | null; onChange: (value: Value) => void }) {
  return (
    <>
      {(Object.keys(STYLE_AXES) as StyleAxis[]).map((axis) => (
        <InspectorField key={axis} label={STYLE_AXES[axis].label}>
          <Select
            value={value?.[axis] ?? NORMAL}
            onValueChange={(next) => {
              const { [axis]: _dropped, ...rest } = value ?? {};
              onChange(next === NORMAL ? rest : { ...rest, [axis]: next });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NORMAL}>보통</SelectItem>
              {Object.entries(STYLE_AXES[axis].options).map(([option, { name }]) => (
                <SelectItem key={option} value={option}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorField>
      ))}
    </>
  );
}

const NORMAL = '__normal';

function FieldInput({ field, value, characters, onChange }: { field: Field; value: Value; characters: { id: string; name: string }[]; onChange: (value: Value) => void }) {
  // The control takes the id of the InspectorField around it (see ControlIdContext).
  const id = useControlId();
  if (field.type === 'long') return <Textarea rows={field.name === 'body' ? 6 : 3} className={field.name === 'body' ? 'font-mono text-sm leading-relaxed' : 'text-sm leading-relaxed'} value={text(value)} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === 'list') return <ChipInput id={id} value={(value as string[] | null) ?? []} onChange={onChange} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />;
  if (field.type === 'chips') return <ChipInput id={id} value={splitList(value)} onChange={(chips) => onChange(joinList(chips))} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />;
  const options =
    field.type === 'docKind' ? DOCUMENT_KINDS.map((kind) => ({ id: kind, name: DOCUMENT_KIND[kind] }))
    : field.type === 'character' ? characters
    : field.type === 'level' ? SPEECH_LEVELS.map((level) => ({ id: level, name: SPEECH_LEVEL_LABELS[level] }))
    : field.type === 'gender' ? Object.entries(GENDER_LABELS).map(([id, name]) => ({ id, name }))
    : field.type === 'ageBand' ? Object.entries(AGE_BAND_LABELS).map(([id, name]) => ({ id, name }))
    : field.type === 'role' ? Object.entries(CHARACTER_ROLE_LABELS).map(([id, name]) => ({ id, name }))
    : undefined;
  if (options)
    return (
      <Select value={text(value) || (field.type === 'gender' || field.type === 'ageBand' || field.type === 'role' ? 'unknown' : '')} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  return <Input value={text(value)} onChange={(event) => onChange(event.target.value)} />;
}
