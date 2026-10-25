/** Right-hand pane to add or edit one status. */
import { Trash2 } from 'lucide-react';
import { DEFAULT_STATUS_COLOR } from '@tw/shared';
import { InspectorToggle, InspectorHeader, Inspector, Button, Input, Select, SelectContent, SelectItem, SelectValue, SelectTrigger, Section, Field, Box } from '@loca/ui';
import { STATUS_KIND } from '@/lib/labels';
import { changedFields, useFormFrom } from '@/lib/use-form-from';
import { ChangedElsewhere } from '@/components/changed-elsewhere';
import { type Kind, type StatusForm, type StatusRowData } from '@/components/settings/status-types';
import { Swatches } from '@/components/settings/swatches';

/** Add or edit one status: its fields are a draft until saved (rows are reordered by dragging in the table). */
const STATUS_FIELD_LABEL: Record<keyof StatusForm, string> = { name: '이름', color: '색상', kind: '종류', inReview: '검토함' };

export function StatusPane({
  status,
  count = 0,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  status?: StatusRowData;
  count?: number;
  pending: boolean;
  onClose: () => void;
  /** The whole form (to add) and the fields that differ from the saved status (to edit). */
  onSave: (form: StatusForm, changed: Partial<StatusForm>) => void;
  onDelete?: () => void;
}) {
  const saved: StatusForm = { name: status?.name ?? '', color: status?.color ?? DEFAULT_STATUS_COLOR, kind: status?.kind ?? 'normal', inReview: status?.inReview ?? false };
  const { draft: form, setDraft: setForm, dirty: changed, conflicts, keepMine, takeSaved } = useFormFrom(saved, status && `status.${status.id}`);
  const dirty = !status || changed;
  return (
    <Inspector footerStart={onDelete ? (<><Button variant="ghost" tone="danger" disabled={count < 2} title={count < 2 ? '상태가 하나뿐이면 지울 수 없습니다' : undefined} onClick={onDelete}>
            <Trash2 /> 상태 삭제
          </Button></>) : undefined} header={<InspectorHeader kind="상태" name={status ? status.name : '상태 추가'} status={status ? `대사 ${status.units.toLocaleString()}개` : undefined} onClose={onClose} />} footer={
        <Button disabled={!form.name.trim() || !dirty || pending} onClick={() => onSave(form, changedFields(form, saved))}>
          {status ? '저장' : '추가'}
        </Button>
      }>
      {conflicts.length > 0 && <Section><ChangedElsewhere fields={conflicts.map((field) => STATUS_FIELD_LABEL[field as keyof StatusForm])} onTakeSaved={takeSaved} onKeepMine={keepMine} /></Section>}
      <Section title="설정">
        <Box spaceY="normal">
          <Field label="이름">
            <Input value={form.name} placeholder="새 상태 이름" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="색상">
            <Swatches value={form.color} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          </Field>
          <Field label="종류">
            <Select value={form.kind} onValueChange={(kind) => setForm((current) => ({ ...current, kind: kind as Kind }))}>
              <SelectTrigger width="full" aria-label="종류">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_KIND) as Kind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {STATUS_KIND[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <InspectorToggle label="검토함" help="이 상태인 대사를 검토함 목록에 모읍니다." checked={form.inReview} onChange={(inReview) => setForm((current) => ({ ...current, inReview }))} />
        </Box>
      </Section>
    </Inspector>
  );
}
