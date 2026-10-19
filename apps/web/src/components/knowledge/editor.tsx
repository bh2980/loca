/** The detail editor for one knowledge item: fields, unsaved edits that survive navigation, decide/discard. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_KINDS, STYLE_AXES, type StyleAxis, type CharacterRole, type Gender, type AgeBand, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, isSettled, AGE_BAND_LABELS, CHARACTER_ROLE_LABELS, GENDER_LABELS, PALETTE, knowledgeKindScope, type TagScope, type KnowledgeTagKind } from '@tw/shared';
import { Inspector, InspectorHeader, InspectorBlock, InspectorSection, PropertyGrid, PropertyRow, TagListEditor, DirtyBar, DangerZone, Group, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea, AiMark } from '@loca/ui';
import { ChipInput, joinList, splitList } from '@/components/chip-input';
import { useDraft } from '@/lib/drafts';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { DOCUMENT_KIND } from '@/lib/labels';
import { Evidence } from '@/components/knowledge/evidence';
import { confirmLabel, fail, KINDS, SourceBadge, text, type Kind, type KindSpec, type Row, type Field } from '@/components/knowledge/table';
import { client, unwrap } from '@/lib/api';
import { q, tagsIn } from '@/lib/queries';

const PRIMARY_FIELD_NAMES = new Set(['title', 'name', 'kind', 'role', 'gender', 'age', 'fromId', 'toId', 'fromName', 'toName', 'level', 'mutual']);
const CONTENT_FIELD_NAMES = new Set(['body', 'profile', 'summary', 'cause', 'outcome', 'description', 'style']);

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

  const primaryFields = spec.fields.filter((field) => PRIMARY_FIELD_NAMES.has(field.name));
  const contentFields = spec.fields.filter((field) => CONTENT_FIELD_NAMES.has(field.name));
  const secondaryFields = spec.fields.filter((field) => !PRIMARY_FIELD_NAMES.has(field.name) && !CONTENT_FIELD_NAMES.has(field.name));

  const body = (
    <>
      {changedElsewhere && <InspectorBlock><ChangedElsewhere onTakeSaved={clear} onKeepMine={() => setBase(saved)} /></InspectorBlock>}
      <InspectorSection title="기본 정보">
        <PropertyGrid>
          {primaryFields.map((field) => (
            <PropertyRow key={field.name} label={field.label} description={field.description}>
              <FieldInput field={field} value={form[field.name]} characters={characters} onChange={(value) => update(field.name, value)} hideLabel />
            </PropertyRow>
          ))}
          {row.id && (
            <PropertyRow label="태그">
              <TagListEditor
                tags={attachedTags}
                allTags={knowledgeTags}
                onToggle={(tagId, add) => tagMutation.mutate({ tagId, add })}
                onCreate={handleCreateTag}
                heading="태그"
              />
            </PropertyRow>
          )}
        </PropertyGrid>
      </InspectorSection>
      {contentFields.length > 0 && (
        <InspectorSection title="내용">
          <div className="space-y-4">
            {contentFields.map((field) => (
              <Group key={field.name} title={field.type === 'style' ? field.label : <Label htmlFor={`field-${field.name}`} className="font-semibold">{field.label}</Label>}>
                {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                <FieldInput field={field} value={form[field.name]} characters={characters} onChange={(value) => update(field.name, value)} hideLabel />
              </Group>
            ))}
          </div>
        </InspectorSection>
      )}
      {secondaryFields.length > 0 && (
        <InspectorSection title="근거">
          <div className="space-y-4">
            {secondaryFields.map((field) => (
              <Group key={field.name} title={<Label htmlFor={`field-${field.name}`} className="font-semibold">{field.label}</Label>}>
                {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                <FieldInput field={field} value={form[field.name]} characters={characters} onChange={(value) => update(field.name, value)} hideLabel />
              </Group>
            ))}
          </div>
        </InspectorSection>
      )}
      {spec.extra?.(row)}
      <Evidence projectId={projectId} keys={row.evidence} />
    </>
  );
  const actions = !official ? (
    <>
      <Button variant="ghost" className="text-destructive" onClick={() => onDecide('discard')}>
        <Trash2 /> 버리기
      </Button>
      {dirty && (
        <span className="ml-auto flex items-center gap-1 text-xs text-warning">
          저장 안 된 수정
          <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={clear}>
            되돌리기
          </Button>
        </span>
      )}
      <Button variant="outline" className={dirty ? undefined : 'ml-auto'} disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
        저장
      </Button>
      <Button disabled={dirty} title={dirty ? '먼저 저장하세요' : undefined} onClick={() => onDecide('confirm')}>
        <Check /> {confirmLabel([row])}
      </Button>
    </>
  ) : (
    <>
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
      {dirty && (
        <span className="ml-auto flex items-center gap-1 text-xs text-warning">
          저장 안 된 수정
          <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={clear}>
            되돌리기
          </Button>
        </span>
      )}
      <Button className={dirty ? undefined : 'ml-auto'} disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
        저장
      </Button>
    </>
  );
  if (embedded)
    return (
      <div className="space-y-6">
        {body}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
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
      footer={dirty ? <DirtyBar dirtyCount={1} onRevert={clear} onSave={() => save.mutate(draft)} saving={save.isPending} /> : (!official ? <Button disabled={save.isPending} onClick={() => onDecide('confirm')}><Check /> {confirmLabel([row])}</Button> : null)}
    >
      {body}
      {!official && <DangerZone title="후보 처리"><Button variant="ghost" className="text-destructive" onClick={() => onDecide('discard')}>버리기</Button></DangerZone>}
      {official && <DangerZone title="삭제"><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" className="text-destructive"><Trash2 /> 삭제</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>사람이 정한 항목을 삭제할까요?</AlertDialogTitle><AlertDialogDescription>“{spec.label(row)}”이(가) 사라지고 더 이상 AI 문맥에 쓰이지 않습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></DangerZone>}
    </Inspector>
  );
}

const NORMAL = '__normal';

function FieldInput({ field, value, characters, onChange, hideLabel = false }: { field: Field; value: Value; characters: { id: string; name: string }[]; onChange: (value: Value) => void; hideLabel?: boolean }) {
  const id = `field-${field.name}`;
  if (field.type === 'bool')
    return hideLabel ? (
      <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
    ) : (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel p-3">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium leading-snug text-foreground">{field.label}</Label>
        <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    );
  return (
      <div className={hideLabel ? undefined : 'space-y-1.5'}>
        {!hideLabel && <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{field.label}</Label>}
      {field.type === 'long' ? (
        <Textarea id={id} aria-label={hideLabel ? field.label : undefined} rows={field.name === 'body' ? 6 : 3} className={field.name === 'body' ? 'font-mono text-sm leading-relaxed' : 'text-sm leading-relaxed'} value={text(value)} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === 'docKind' || field.type === 'character' ? (
        <Select value={text(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.type === 'docKind' ? DOCUMENT_KINDS.map((kind) => ({ id: kind, name: DOCUMENT_KIND[kind] })) : characters).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'list' ? (
        <ChipInput id={id} value={(value as string[] | null) ?? []} onChange={onChange} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />
      ) : field.type === 'chips' ? (
        <ChipInput id={id} value={splitList(value)} onChange={(chips) => onChange(joinList(chips))} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />
      ) : field.type === 'style' ? (
        // One pick per axis; 보통 leaves the axis out of the prompt.
        <div className="space-y-2">
          {(Object.keys(STYLE_AXES) as StyleAxis[]).map((axis) => {
            const current = (value as Record<string, string> | null)?.[axis] ?? NORMAL;
            return (
              <div key={axis} className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{STYLE_AXES[axis].label}</span>
                <Select
                  value={current}
                  onValueChange={(next) => {
                    const { [axis]: _dropped, ...rest } = (value as Record<string, string> | null) ?? {};
                    onChange(next === NORMAL ? rest : { ...rest, [axis]: next });
                  }}
                >
                  <SelectTrigger id={axis === 'length' ? id : undefined} className="w-32 shrink-0" aria-label={STYLE_AXES[axis].label}>
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
              </div>
            );
          })}
        </div>
      ) : field.type === 'gender' || field.type === 'ageBand' || field.type === 'role' ? (
        <Select value={text(value) || 'unknown'} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(field.type === 'gender' ? GENDER_LABELS : field.type === 'ageBand' ? AGE_BAND_LABELS : CHARACTER_ROLE_LABELS).map(([option, label]) => (
              <SelectItem key={option} value={option}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'level' ? (
        <Select value={text(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEECH_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {SPEECH_LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} className={field.type === 'key' ? 'font-mono text-sm' : undefined} value={text(value)} onChange={(event) => onChange(field.type === 'key' ? event.target.value.trim() || null : event.target.value)} />
      )}
    </div>
  );
}
