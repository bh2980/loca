import { createAndAttachTag } from '@/lib/create-tag';
/** The detail editor for one knowledge item: fields, unsaved edits that survive navigation, decide/discard. */
import { cloneElement, isValidElement, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_KINDS, STYLE_AXES, type StyleAxis, type CharacterRole, type Gender, type AgeBand, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, isSettled, AGE_BAND_LABELS, CHARACTER_ROLE_LABELS, GENDER_LABELS, knowledgeKindScope, type TagScope, type KnowledgeTagKind } from '@tw/shared';
import { TagInput, Inspector, InspectorHeader, InspectorTabs, InspectorToggle, useControlId, TagListEditor, DirtyBar, Box, Inline, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Input, Select, SelectContent, SelectItem, SelectValue, AiMark, SelectTrigger, Textarea, Section, Field } from '@loca/ui';
import { joinList, splitList } from '@/lib/list-value';
import { Swatches } from '@/components/settings/swatches';
import { useDraft } from '@/lib/drafts';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { DOCUMENT_KIND } from '@/lib/labels';
import { Evidence, StretchPicker } from '@/components/knowledge/evidence';
import { confirmLabel, fail, KINDS, SourceBadge, text, type Kind, type KindSpec, type RelationshipRow, type Row, type Field as KnowledgeField } from '@/components/knowledge/table';
import { client } from '@/lib/api';
import { q, tagsIn } from '@/lib/queries';
import { useInspectorTab } from '@/lib/inspector-tab';
import { useTaxonomy } from '@/lib/knowledge';
import { sent } from '@/lib/collections';
import { useLinesByKeys } from '@/lib/units';

/** A field's value in the draft (the form is kept as JSON in sessionStorage). */
type Value = string | boolean | string[] | Record<string, string> | null;

type EditorTab = 'basic' | 'content' | 'extra' | 'evidence';
/**
 * Each kind's tabs, in this order (노트 has none: it is one form). `content` holds the fields marked `tab: 'content'`;
 * `extra` is the kind's read-only part (a rule's lines, a relationship's changes); `evidence` the lines it cites.
 */
const TAB_LABELS: Record<Kind, Partial<Record<EditorTab, string>>> = {
  characters: { basic: '기본', content: '프로필·문체', evidence: '근거 대사' },
  events: { basic: '기본', content: '내용', evidence: '근거 대사' },
  speechRules: { basic: '규칙', extra: '적용 대사', evidence: '근거 대사' },
  relationships: { basic: '기본', extra: '관계 변화', evidence: '근거 대사' },
  documents: {},
};
const TAB_ORDER: EditorTab[] = ['basic', 'content', 'extra', 'evidence'];

/** Where an item's unsaved edit is kept, and the saved form it is compared with (a pane that does not show the editor reads both: useDirtyDrafts). */
export const draftKeyOf = (kind: Kind, id: string) => `knowledge.${kind}.${id}`;
export const savedOf = (spec: KindSpec, row: Row) => JSON.stringify(Object.fromEntries(spec.fields.map((field) => [field.name, row[field.name] ?? null])));

/**
 * Edit one item (unsaved edits survive navigation), see its evidence, and make it official or discard it while it is AI's.
 * As a right-hand pane, in the kind's tabs (TAB_LABELS); the tabs never switch by themselves, a dot marks one holding an
 * unsaved edit. Embedded in another pane (a pair's detail, which has tabs of its own and decides in its header) it is
 * the fields and the kind's summary only.
 */
export function DraftEditor({ projectId, kind, spec, row, characters, onClose, onDecide, embedded, bare }: {
  projectId: string;
  kind: Kind;
  spec: KindSpec;
  row: Row;
  characters: { id: string; name: string }[];
  onClose?: () => void;
  /** Not used embedded: the pane holding it decides. */
  onDecide?: (action: 'confirm' | 'discard') => void;
  embedded?: boolean;
  /** Embedded, the fields only: the pane around it shows the kind's summary (a change point of a pair's timeline). */
  bare?: boolean;
}) {
  const saved = savedOf(spec, row);
  const [draft, setDraft, clearDraft] = useDraft(draftKeyOf(kind, row.id), saved);
  // What the item was when editing began: if it changes elsewhere meanwhile (a chat proposal
  // accepted, another window), the unsaved edit must not quietly hide the new value.
  const [base, setBase, clearBase] = useDraft(`knowledge-base.${kind}.${row.id}`, '');
  const form = JSON.parse(draft) as Record<string, Value>;
  const savedForm = JSON.parse(saved) as Record<string, Value>;
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

  const taxonomy = useTaxonomy(projectId);
  const tagKind = kind as KnowledgeTagKind;
  const scope: TagScope = tagKind ? knowledgeKindScope(tagKind) : 'documents';
  const knowledgeTags = tagsIn(taxonomy.tags, scope);
  const attachedTags = (row.tags ?? [])
    .map((item) => taxonomy.tags?.find((t) => t.id === item.id))
    .filter(Boolean) as (Parameters<typeof TagListEditor>[0]['tags'][number])[];

  const tagMutation = useMutation({
    mutationFn: async ({ tagId, add }: { tagId: string; add: boolean }) => {
      await sent(projectId, client.projects[':projectId']['knowledge-tags'].$post({
        param: { projectId },
        json: { kind, ids: [row.id], tagId, add },
      }));
    },
    onError: fail,
  });

  const handleCreateTag = async (name: string) => {
    try {
      await createAndAttachTag(projectId, name, knowledgeTags.length, [scope], (tagId) => tagMutation.mutateAsync({ tagId: tagId, add: true }));
      toast.success(`'${name}' 태그를 만들고 항목에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  // The kind's tabs (none embedded, none for 노트).
  const labels = embedded ? {} : TAB_LABELS[kind];
  const tabIds = TAB_ORDER.filter((id) => labels[id]);
  const tabbed = tabIds.length > 1;
  const inContent = (field: KnowledgeField) => Boolean(labels.content) && field.tab === 'content';
  const basicFields = spec.fields.filter((field) => !inContent(field));
  const contentFields = spec.fields.filter((field) => inContent(field) && field.type !== 'style');
  const styleFields = spec.fields.filter((field) => inContent(field) && field.type === 'style');
  const changed = (field: KnowledgeField) => JSON.stringify(form[field.name] ?? null) !== JSON.stringify(savedForm[field.name] ?? null);
  const [tab, setTab] = useInspectorTab<EditorTab>(`knowledge.${kind}`, (tabIds.length ? tabIds : ['basic']) as [EditorTab, ...EditorTab[]]);
  // A rule's line count for its tab, from the same query its 적용 대사 tab reads.
  const ruleLines = useQuery({ ...q.ruleLines(projectId, row.id), enabled: tabbed && kind === 'speechRules' });
  const extraCount = kind === 'relationships' ? (row as RelationshipRow).changes.length : kind === 'speechRules' ? (ruleLines.data?.count ?? null) : undefined;

  const fieldView = (field: KnowledgeField) => {
    const value = form[field.name];
    const change = (next: Value) => update(field.name, next);
    if (field.type === 'bool') return <InspectorToggle key={field.name} label={field.label} description={field.description} help={field.help} checked={Boolean(value)} onChange={change} />;
    if (field.type === 'style') return <StyleFields key={field.name} value={value as Record<string, string> | null} onChange={change} />;
    if (field.type === 'key')
      return <StartKeyField key={field.name} projectId={projectId} field={field} value={text(value)} from={text(form.fromName ?? row.fromName)} to={text(form.toName ?? row.toName)} onChange={change} />;
    return (
      <Field key={field.name} label={field.label} description={field.description} help={field.help}>
        <FieldInput field={field} value={value} characters={characters} onChange={change} />
      </Field>
    );
  };
  const tagsView = row.id && !embedded && (
    <Field label="태그">
      <TagListEditor tags={attachedTags} allTags={knowledgeTags} onToggle={(tagId, add) => tagMutation.mutate({ tagId, add })} onCreate={handleCreateTag} heading="태그" />
    </Field>
  );
  // A rule's lines or a relationship's changes: a tab of its own in a pane, a summary under the fields when embedded.
  const extra = spec.extra?.(row);
  const extraView = embedded && isValidElement<{ embedded?: boolean }>(extra) ? cloneElement(extra, { embedded: true }) : extra;
  const changedView = changedElsewhere && <ChangedElsewhere onTakeSaved={clear} onKeepMine={() => setBase(saved)} />;

  const confirm = (
    <Button disabled={save.isPending} onClick={() => onDecide?.('confirm')}>
      <Check /> {confirmLabel([row])}
    </Button>
  );
  const deleteButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" tone="danger">
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
    <Button variant="ghost" tone="danger" onClick={() => onDecide?.('discard')}>
      <Trash2 /> 버리기
    </Button>
  );
  const dirtyBar = <DirtyBar dirtyCount={spec.fields.filter(changed).length || 1} onRevert={clear} onSave={() => save.mutate(draft)} saving={save.isPending} />;

  if (embedded)
    // Deciding (확인함·버리기) is the pair pane's, in its header; here the edit is saved or reverted, and an official item can be deleted.
    return (
      <Box spaceY="comfortable">
        {changedView}
        <Box spaceY="normal">{spec.fields.map(fieldView)}</Box>
        {!bare && extraView}
        {(official || dirty) && (
          <Inline wrap gap="condensed">
            {official && deleteButton}
            {dirty && dirtyBar}
          </Inline>
        )}
      </Box>
    );

  const panels: Record<EditorTab, ReactNode> = {
    basic: (
      <Section>
        <Box spaceY="normal">
          {basicFields.map(fieldView)}
          {tagsView}
        </Box>
      </Section>
    ),
    content: (
      <>
        {contentFields.length > 0 && (
          <Section>
            <Box spaceY="normal">{contentFields.map(fieldView)}</Box>
          </Section>
        )}
        {styleFields.length > 0 && (
          <Section title="문체">
            <Box spaceY="normal">{styleFields.map(fieldView)}</Box>
          </Section>
        )}
      </>
    ),
    extra: extraView,
    evidence: <Evidence projectId={projectId} keys={row.evidence} />,
  };
  const tabItems = tabIds.map((id) => ({
    value: id,
    label: labels[id],
    count: id === 'evidence' ? row.evidence.length : id === 'extra' ? extraCount : undefined,
    attention: id === 'basic' ? basicFields.some(changed) : id === 'content' ? [...contentFields, ...styleFields].some(changed) : false,
  }));
  return (
    <Inspector footerStart={<>{official ? deleteButton : discardButton}</>}
      header={<InspectorHeader kind={KINDS[kind]} name={spec.label(row)} status={
        <Inline as="span" gap="tight">
          <SourceBadge row={row} />
          <span>·</span>
          {row.status === 'candidate' ? <span>후보</span> : <Inline as="span" inline gap="tight">확정 <AiMark by={row.statusBy} /></Inline>}
        </Inline>
      } onClose={onClose} />}
      tabs={(changedView || tabbed) && (
        <>
          {changedView && <Section>{changedView}</Section>}
          {tabbed && <InspectorTabs<EditorTab> value={tab} onChange={setTab} items={tabItems} />}
        </>
      )}
      scrollKey={tabbed ? tab : undefined}
      footer={dirty ? dirtyBar : !official ? confirm : null}
    >
      {tabbed ? (
        panels[tab]
      ) : (
        // 노트: one form.
        <>
          <Section title="기본 정보">
            <Box spaceY="normal">
              {spec.fields.filter((field) => field.type !== 'long').map(fieldView)}
              {tagsView}
            </Box>
          </Section>
          {spec.fields.some((field) => field.type === 'long') && (
            <Section title="내용">
              <Box spaceY="normal">{spec.fields.filter((field) => field.type === 'long').map(fieldView)}</Box>
            </Section>
          )}
          {extraView}
        </>
      )}
    </Inspector>
  );
}

/** 시작 대사: the key of the line a speech rule starts at, picked from the speaker's lines to that listener. */
function StartKeyField({ projectId, field, value, from, to, onChange }: { projectId: string; field: KnowledgeField; value: string; from: string; to: string; onChange: (value: Value) => void }) {
  const [picking, setPicking] = useState(false);
  const keys = useMemo(() => (value ? [value] : []), [value]);
  const source = useLinesByKeys(projectId, keys).data?.[0]?.source;
  return (
    <Field
      label={field.label}
      description={value ? (source ? `“${source}”부터` : undefined) : '비우면 처음부터 적용됩니다.'}
      action={
        <Button variant="ghost" size="inline" aria-pressed={picking} onClick={() => setPicking((open) => !open)}>
          대사 고르기
        </Button>
      }
    >
      <Input mono variant="body" value={value} onChange={(event) => onChange(event.target.value.trim() || null)} />
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
    </Field>
  );
}

/** One pick per axis; 보통 leaves the axis out of the prompt. */
function StyleFields({ value, onChange }: { value: Record<string, string> | null; onChange: (value: Value) => void }) {
  return (
    <>
      {(Object.keys(STYLE_AXES) as StyleAxis[]).map((axis) => (
        <Field key={axis} label={STYLE_AXES[axis].label}>
          <Select
            value={value?.[axis] ?? NORMAL}
            onValueChange={(next) => {
              const { [axis]: _dropped, ...rest } = value ?? {};
              onChange(next === NORMAL ? rest : { ...rest, [axis]: next });
            }}
          >
            <SelectTrigger width="full">
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
        </Field>
      ))}
    </>
  );
}

const NORMAL = '__normal';

export function FieldInput({ field, value, characters, onChange }: { field: KnowledgeField; value: Value; characters: { id: string; name: string }[]; onChange: (value: Value) => void }) {
  // The control takes the id of the Field around it (see ControlIdContext).
  const id = useControlId();
  if (field.type === 'long') return <Box asChild leading="relaxed"><Textarea variant="body" rows={field.name === 'body' ? 6 : 3} mono={field.name === 'body'} value={text(value)} onChange={(event) => onChange(event.target.value)} /></Box>;
  if (field.type === 'color') return <Swatches value={text(value)} onChange={onChange} onClear={() => onChange('')} />;
  if (field.type === 'list') return <TagInput id={id} value={(value as string[] | null) ?? []} onChange={onChange} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />;
  if (field.type === 'chips') return <TagInput id={id} value={splitList(value)} onChange={(chips) => onChange(joinList(chips))} suggestions={field.suggestions} placeholder="쉼표나 Enter로 추가" />;
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
        <SelectTrigger width="full">
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
