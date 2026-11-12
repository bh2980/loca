import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Box, Button, DirtyBar, Inspector, InspectorHeader, InspectorResult, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text, Textarea, Section, Field, KeyValue, KeyValueRow, ConfirmDialog } from '@loca/ui';
import { useDraft } from '@/lib/drafts';
import { useLineDetail } from '@/lib/units';
import { SOURCE_GROUP_LABEL, SOURCE_UNIT_LABEL } from '@/lib/labels';
import { useGroup, useGroups, createGroup, saveGroup, deleteGroup } from '@/lib/groups';
import type { LineDetail } from '@/lib/units';
import { createLine, editLineSource, deleteLine } from '@/lib/line-writes';
import { undoChange } from '@/lib/undo';
import { useShortcuts } from '@/lib/shortcuts';

export type SourceGroupKind = 'scene' | 'document' | 'ui';
export type SourceEditorMode = 'create-group' | 'edit-group' | 'create-unit' | 'edit-unit';
export interface SourceSaved { entity: 'group' | 'unit'; id: string; groupId: string; kind: SourceGroupKind }

type Form = { kind: SourceGroupKind; groupId: string; key: string; title: string; description: string; section: string; source: string; speaker: string; listener: string };
type UnitRecord = LineDetail;
const EMPTY_FORM = (kind: SourceGroupKind, groupId = ''): Form => ({ kind, groupId, key: '', title: '', description: '', section: '', source: '', speaker: '', listener: '' });
const KEY_HINT = '비우면 자동 생성 · 바꾸면 참조가 끊길 수 있음';
const sourceKind = (kind: UnitRecord['kind']): SourceGroupKind => kind === 'dialogue' ? 'scene' : kind;

/** Create or edit one imported-source group or source line. These edits never create a graph edge. */
export function SourceEditor({ projectId, kind, groupId, unitId, mode, onClose, onBack, onSaved, onDeleted, onCreateGroup }: {
  projectId: string;
  kind: SourceGroupKind;
  groupId?: string;
  unitId?: string;
  mode: SourceEditorMode;
  onClose?: () => void;
  /** Opened from another view (a line's detail): ‹ in the header and Esc go back to it; what was typed stays a draft. */
  onBack?: () => void;
  onSaved?: (result: SourceSaved) => void;
  onDeleted?: () => void;
  onCreateGroup?: () => void;
}) {
  const editingGroup = mode === 'edit-group';
  const editingUnit = mode === 'edit-unit';
  const group = useGroup(projectId, editingGroup ? groupId : undefined);
  const unit = useLineDetail(projectId, unitId ?? '', { enabled: editingUnit });
  const formKind = editingGroup ? (group.data?.kind ?? kind) : editingUnit ? (unit.data ? sourceKind(unit.data.kind) : kind) : kind;
  const groups = useGroups(projectId, { kind: formKind });
  // How many lines the scene holds: its row in the groups collection (it loads, it does not fail).
  const count = group.data?.total;
  const saved = useMemo(() => JSON.stringify(
    editingGroup && group.data ? { ...EMPTY_FORM(group.data.kind), key: group.data.key, title: group.data.title, description: group.data.description ?? '', section: group.data.section ?? '' }
      : editingUnit && unit.data ? { ...EMPTY_FORM(sourceKind(unit.data.kind), unit.data.group.id), key: unit.data.key, source: unit.data.source, speaker: unit.data.speaker ?? '', listener: unit.data.listener ?? '' }
        : EMPTY_FORM(kind, groupId),
  ), [editingGroup, editingUnit, group.data, unit.data, kind, groupId]);
  const draftKey = editingGroup ? `source.${projectId}.group.${groupId}` : editingUnit ? `source.${projectId}.unit.${unitId}` : mode === 'create-group' ? `source.${projectId}.create-group.${kind}` : `source.${projectId}.create-unit.${kind}`;
  const [draft, setDraft, clearDraft] = useDraft(draftKey, saved);
  const form = JSON.parse(draft) as Form;
  const dirty = draft !== saved;
  const update = (name: keyof Form, value: string) => setDraft(JSON.stringify({ ...form, [name]: value }));
  // Esc goes back unless an open menu, select or dialog takes it first.
  useShortcuts({ sourceBack: onBack && (() => onBack()) });

  const save = useMutation<SourceSaved, Error, string>({
    mutationFn: async (sent: string) => {
      const values = JSON.parse(sent) as Form;
      if (mode === 'create-group') {
        const result = await createGroup(projectId, { kind: values.kind, title: values.title, ...(values.key.trim() && { key: values.key }), description: values.description, section: values.section.trim() || null });
        return { entity: 'group', id: result.id, groupId: result.id, kind: result.kind };
      }
      if (mode === 'edit-group') {
        const result = await saveGroup(projectId, groupId!, { key: values.key.trim() || undefined, title: values.title, description: values.description, section: values.section.trim() || null });
        return { entity: 'group', id: result.id, groupId: result.id, kind: result.kind };
      }
      const json = { groupId: values.groupId, ...(values.key.trim() && { key: values.key }), source: values.source, ...(values.kind === 'scene' && { speaker: values.speaker.trim() || null, listener: values.listener.trim() || null }) };
      const result = mode === 'create-unit'
        ? await createLine(projectId, json)
        : await editLineSource(projectId, unitId!, json);
      return { entity: 'unit', id: result.id, groupId: result.groupId, kind: sourceKind(result.kind) };
    },
    onSuccess: async (result, sent) => {
      clearDraft(sent);
      const isGroup = mode.endsWith('group');
      toast.success(isGroup ? '묶음을 저장했습니다.' : '원문을 저장했습니다.');
      onSaved?.(result);
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => editingGroup
      ? deleteGroup(projectId, groupId!)
      : deleteLine(projectId, unitId!),
    onSuccess: async ({ token }) => {
      // The delete answers with its undo record: 되돌리기 puts the lines back with their translations, tags and history.
      const undo = () => void undoChange(projectId, token!).then(() => toast.success('삭제한 것을 되살렸습니다.'), (error: Error) => toast.error(error.message));
      toast.success(editingGroup ? '묶음을 삭제했습니다.' : '원문을 삭제했습니다.', token ? { action: { label: '되돌리기', onClick: undo }, duration: 10000 } : undefined);
      (onDeleted ?? onClose)?.();
    },
    onError: (error) => toast.error(error.message),
  });

  const loading = (editingGroup && group.isLoading) || (editingUnit && unit.isPending);
  const invalidTarget = (editingGroup && !groupId) || (editingUnit && !unitId);
  // A group comes from the groups collection, which keeps trying until it loads; only a line's detail can fail.
  const loadError = invalidTarget || (editingUnit && unit.isError);
  const heading = editingGroup || mode === 'create-group'
    ? `${SOURCE_GROUP_LABEL[form.kind]} ${editingGroup ? '편집' : '추가'}`
    : `${SOURCE_UNIT_LABEL[form.kind]} ${editingUnit ? '편집' : '추가'}`;
  const isGroup = mode.endsWith('group');
  const canSave = !loading && !loadError && dirty && Boolean(form.title.trim() || !isGroup) && Boolean(form.source.trim() || isGroup) && (isGroup || Boolean(groups.data?.some((item) => item.id === form.groupId))) && !save.isPending;
  const groupTitle = groups.data?.find((item) => item.id === form.groupId)?.title;
  const groupDeleteCopy = count === undefined ? '삭제할 원문 수를 확인하고 있습니다.' : count === 0 ? '비어 있는 묶음이 삭제됩니다.' : `이 묶음과 원문 ${count!.toLocaleString()}개, 번역·후보와 실행 기록의 해당 항목이 함께 삭제됩니다.`;

  const creating = mode === 'create-group' || mode === 'create-unit';
  const whyDisabled = isGroup ? '이름을 입력하면 추가할 수 있습니다.' : !form.groupId ? `${SOURCE_GROUP_LABEL[form.kind]}을(를) 고르고 원문을 입력하면 추가할 수 있습니다.` : '원문을 입력하면 추가할 수 있습니다.';

  return (
    <Inspector footerStart={(editingGroup || editingUnit) ? (<><ConfirmDialog
            trigger={<Button type="button" variant="ghost" tone="danger"><Trash2 /> {editingGroup ? '묶음 삭제' : '원문 삭제'}</Button>}
            title={editingGroup ? '묶음과 원문을 삭제할까요?' : '원문을 삭제할까요?'}
            description={editingGroup ? groupDeleteCopy : '이 원문과 대표 번역, 번역 후보 및 실행 기록의 해당 항목이 삭제됩니다. 삭제한 뒤 알림의 되돌리기로 되살릴 수 있습니다.'}
            confirmLabel={remove.isPending ? '삭제 중…' : '삭제'}
            pending={remove.isPending}
            disabled={editingGroup && count === undefined}
            onConfirm={() => remove.mutate()}
          /></>) : undefined}
      header={<InspectorHeader kind={isGroup ? SOURCE_GROUP_LABEL[form.kind] : SOURCE_UNIT_LABEL[form.kind]} name={heading} onClose={onClose} onBack={onBack} />}
      loading={loading}
      footer={creating
        ? <>{!canSave && !save.isPending && <Text marginRight="auto" variant="caption" tone="muted">{whyDisabled}</Text>}<Button disabled={!canSave} onClick={() => save.mutate(draft)} aria-busy={save.isPending}>{save.isPending ? '추가 중' : '추가'}</Button></>
        : dirty ? <DirtyBar dirtyCount={1} onRevert={() => clearDraft()} onSave={() => save.mutate(draft)} saving={save.isPending} disabled={!canSave} /> : undefined}
    >
      {loadError && (
        <Section title="불러오기 실패">
          <InspectorResult tone="error">{invalidTarget ? '편집할 원문 ID가 없습니다.' : '원문 정보를 불러오지 못했습니다.'}</InspectorResult>
          {!invalidTarget && editingUnit && <Button variant="outline" onClick={() => void unit.refetch()}>다시 시도</Button>}
        </Section>
      )}
      {isGroup ? (
        <>
          {editingGroup && (
            <Section title="정보">
              <KeyValue>
                <KeyValueRow label="종류">{SOURCE_GROUP_LABEL[form.kind]}</KeyValueRow>
                <KeyValueRow label="안에 든 원문">{count === undefined ? '개수 불러오는 중…' : `${count.toLocaleString()}개`}</KeyValueRow>
              </KeyValue>
            </Section>
          )}
          <Section title="설정">
            <Box spaceY="normal">
              {mode === 'create-group' && (
                <Field label="종류">
                  <Select value={form.kind} onValueChange={(value) => update('kind', value)}><SelectTrigger width="full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scene">장면</SelectItem><SelectItem value="document">문서</SelectItem><SelectItem value="ui">UI 묶음</SelectItem></SelectContent></Select>
                </Field>
              )}
              <Field label="이름"><Input value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="묶음 이름" /></Field>
              <Field label="키" description={KEY_HINT}><Input value={form.key} onChange={(event) => update('key', event.target.value)} placeholder="비우면 자동 생성" /></Field>
              <Field label="장 / 분류"><Input value={form.section} onChange={(event) => update('section', event.target.value)} placeholder="선택 사항" /></Field>
              <Field label="설명"><Textarea rows={3} value={form.description} onChange={(event) => update('description', event.target.value)} /></Field>
            </Box>
          </Section>
        </>
      ) : (
        <Section title="원문">
            <Box spaceY="normal">
              <Field label={SOURCE_GROUP_LABEL[form.kind]}>
                {groups.isLoading ? <Text variant="caption" tone="muted">불러오는 중…</Text> : groups.data?.length ? (
                  <Select value={form.groupId} onValueChange={(value) => update('groupId', value)}><SelectTrigger width="full"><SelectValue placeholder={`${SOURCE_GROUP_LABEL[form.kind]} 선택`} /></SelectTrigger><SelectContent>{groups.data.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select>
                ) : (
                  <Box spaceY="condensed"><Text as="p" variant="body" tone="muted">이 종류의 묶음이 없습니다.</Text>{onCreateGroup && <Button type="button" variant="outline" onClick={onCreateGroup}>{SOURCE_GROUP_LABEL[form.kind]} 추가</Button>}</Box>
                )}
              </Field>
              <Field label="원문" description={editingUnit && unit.data?.translation ? '바꾸면 번역 상태가 처음으로 돌아갑니다. 기존 번역과 후보는 남으니 다시 확인하세요.' : undefined}>
                <Textarea rows={5} value={form.source} onChange={(event) => update('source', event.target.value)} placeholder="원문을 입력하세요" />
              </Field>
              {form.kind === 'scene' && <>
                <Field label="화자" description="이름을 그대로 적습니다. 비우면 지문·문구로 봅니다."><Input value={form.speaker} onChange={(event) => update('speaker', event.target.value)} placeholder="선택 사항" /></Field>
                <Field label="청자" description="비우면 미상으로 둡니다."><Input value={form.listener} onChange={(event) => update('listener', event.target.value)} placeholder="선택 사항" /></Field>
              </>}
              <Field label="키" description={KEY_HINT}><Input value={form.key} onChange={(event) => update('key', event.target.value)} placeholder="비우면 자동 생성" /></Field>
            </Box>
        </Section>
      )}
    </Inspector>
  );
}
